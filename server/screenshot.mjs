export async function captureScreenshot(page, session, options) {
  try {
    return { screenshot: await page.screenshot(options), fallback: false };
  } catch (error) {
    if (!(error instanceof Error) || !/Timeout|timeout/.test(error.message)) throw error;
  }

  await page.evaluate(() => {
    document.getAnimations().forEach((animation) => animation.pause());
  });
  for (const locator of options.mask ?? []) {
    await locator.evaluateAll((elements) => {
      for (const element of elements) {
        const box = element.getBoundingClientRect();
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
          position: 'absolute',
          left: `${box.left + window.scrollX}px`,
          top: `${box.top + window.scrollY}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          background: '#d8dbe6',
          zIndex: '2147483647',
          pointerEvents: 'none',
        });
        // Hide the source too, so moving content cannot escape a positioned mask.
        element.style.setProperty('opacity', '0', 'important');
        (document.body ?? document.documentElement).append(overlay);
      }
    });
  }
  // Assets have already had a bounded loading wait. CDP captures the painted page
  // without Playwright's additional, potentially unbounded font readiness wait.
  let timer;
  try {
    const result = await Promise.race([
      session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { ...options.clip, scale: 1 },
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Screenshot fallback timeout')), 20000);
      }),
    ]);
    return { screenshot: Buffer.from(result.data, 'base64'), fallback: true };
  } finally {
    clearTimeout(timer);
  }
}
