import sharp from 'sharp';

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
  // Stop script-driven rendering too, and rasterize viewport-sized strips rather
  // than asking the serverless compositor for one large full-page surface.
  await session.send('Emulation.setScriptExecutionDisabled', { value: true });
  let timer;
  try {
    const screenshot = await Promise.race([
      (async () => {
        const tiles = [];
        const { x, y, width, height } = options.clip;
        const tileHeight = page.viewportSize()?.height ?? 960;
        for (let top = 0; top < height; top += tileHeight) {
          const result = await session.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: true,
            clip: { x, y: y + top, width, height: Math.min(tileHeight, height - top), scale: 1 },
          });
          tiles.push({ input: Buffer.from(result.data, 'base64'), top, left: 0 });
        }
        return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
          .composite(tiles)
          .png()
          .toBuffer();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Screenshot fallback timeout')), 20000);
      }),
    ]);
    return { screenshot, fallback: true };
  } finally {
    clearTimeout(timer);
    await session.send('Emulation.setScriptExecutionDisabled', { value: false }).catch(() => {});
  }
}
