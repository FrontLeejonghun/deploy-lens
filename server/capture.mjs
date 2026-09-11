import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { access, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import serverlessChromium from '@sparticuz/chromium';
import { specimen } from './specimen.mjs';

export const VIEWPORT_MAP = {
  desktop: { width: 1440, height: 960 },
  mobile: { width: 390, height: 844 },
};

let serverlessPreparation;
function prepareServerlessBrowser() {
  serverlessPreparation ??= (async () => {
    const executablePath = await serverlessChromium.executablePath(
      fileURLToPath(new URL('./chromium', import.meta.url)),
    );
    const fontDirectory = join(tmpdir(), 'fonts');
    await mkdir(fontDirectory, { recursive: true });
    await copyFile(
      fileURLToPath(new URL('./fonts/NotoSansKR.ttf', import.meta.url)),
      join(fontDirectory, 'NotoSansKR.ttf'),
    );
    return executablePath;
  })().catch((error) => {
    serverlessPreparation = undefined;
    throw error;
  });
  return serverlessPreparation;
}

export async function launchBrowser(proxy) {
  const options = {
    headless: true,
    ...(proxy ? { proxy: { server: proxy, bypass: '<-loopback>' } } : {}),
  };
  if (process.env.VERCEL) {
    const executablePath = await prepareServerlessBrowser();
    return chromium.launch({
      ...options,
      args: [
        ...serverlessChromium.args.filter(
          (argument) =>
            !['--disable-web-security', '--allow-running-insecure-content'].includes(argument),
        ),
        '--disable-quic',
      ],
      executablePath,
    });
  }
  try {
    return await chromium.launch(options);
  } catch (error) {
    const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    await access(executablePath).catch(() => {
      throw error;
    });
    return chromium.launch({ ...options, executablePath });
  }
}

function scrub(text) {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
      try {
        const url = new URL(value);
        return url.origin + url.pathname;
      } catch {
        return value;
      }
    })
    .slice(0, 1500);
}

async function capture(browser, url, viewport, masks, signal, demo, customHeaders) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  const abort = () => {
    void context.close().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const messages = [];
  const requests = [];
  const warnings = [];
  let blockedRequests = 0;
  const headerMap = Object.fromEntries(
    customHeaders.map((header) => [header.name.toLowerCase(), header.value]),
  );
  const redact = (value) =>
    customHeaders.reduce(
      (text, header) => text.split(header.value).join('[비공개 헤더 값]'),
      value,
    );
  const protectedOrigin = new URL(url).origin;
  try {
    await context.route('**/*', async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (demo && target.hostname === 'demo.deploy-lens.test') {
        if (target.pathname.endsWith('/assets/renderCheck.css'))
          return route.fulfill({
            status: 200,
            contentType: 'text/css',
            body: '.external{background:#d7e4f5;border:3px solid #7698c7;padding:24px;border-radius:16px}.responsive{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:600px){.responsive{grid-template-columns:1fr}}',
          });
        if (target.pathname.endsWith('/assets/missing.css'))
          return route.fulfill({ status: 404, contentType: 'text/css', body: '' });
        if (target.pathname.endsWith('missing-price.json'))
          return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        const parts = target.pathname.split('/');
        return route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: specimen(parts[1], parts.slice(2).join('/')),
        });
      }
      if (
        !['GET', 'HEAD'].includes(request.method()) ||
        !['http:', 'https:'].includes(target.protocol)
      ) {
        blockedRequests += 1;
        return route.abort('blockedbyclient');
      }
      if (target.origin === protectedOrigin && customHeaders.length) {
        try {
          const response = await route.fetch({
            headers: { ...request.headers(), ...headerMap },
            maxRedirects: 0,
            timeout: 20000,
          });
          await route.fulfill({ response });
          await response.dispose();
          return;
        } catch {
          if (warnings.length < 20)
            warnings.push(
              '인증 헤더를 포함한 요청을 완료하지 못했습니다. 접근 권한 또는 응답 시간을 확인하세요.',
            );
          return route.abort('failed').catch(() => {});
        }
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('dialog', (dialog) => {
      void dialog.dismiss();
    });
    page.on('popup', (popup) => {
      void popup.close();
    });
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type()) && messages.length < 100)
        messages.push({ level: message.type(), text: redact(scrub(message.text())) });
    });
    page.on('pageerror', (error) => {
      if (messages.length < 100)
        messages.push({ level: 'error', text: redact(scrub(error.message)) });
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && requests.length < 100)
        requests.push({
          url: scrub(response.url()),
          status: response.status(),
          type: response.request().resourceType(),
        });
    });
    page.on('requestfailed', (request) => {
      if (requests.length < 100 && !request.failure()?.errorText.includes('ERR_BLOCKED_BY_CLIENT'))
        requests.push({
          url: scrub(request.url()),
          status: 0,
          type: request.resourceType(),
          error: request.failure()?.errorText,
        });
    });
    const started = Date.now();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (response && response.status() >= 400)
      throw new Error(`페이지가 HTTP ${response.status()}로 응답했습니다.`);
    await page
      .waitForLoadState('networkidle', { timeout: 4500 })
      .catch(() => warnings.push('요청이 계속되어 대기 시간 이후 촬영했습니다.'));
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    const maxCaptureHeight = 10000;
    for (let y = 0; y < maxCaptureHeight; y += Math.max(500, viewport.height - 120)) {
      const height = await page.evaluate(() =>
        Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      );
      if (y > height) break;
      await page.evaluate((position) => window.scrollTo({ top: position, behavior: 'instant' }), y);
      await page.waitForTimeout(120);
    }
    await page
      .waitForLoadState('networkidle', { timeout: 2500 })
      .catch(() =>
        warnings.push(
          '스크롤 후에도 요청이 계속되어 일부 지연 콘텐츠가 준비되지 않았을 수 있습니다.',
        ),
      );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page
      .waitForFunction(
        () =>
          document.fonts.status === 'loaded' &&
          Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))
            .filter((link) => !link.disabled && (!link.media || matchMedia(link.media).matches))
            .every((link) => link.sheet !== null) &&
          Array.from(document.images)
            .filter((image) => {
              const box = image.getBoundingClientRect();
              return box.top < 10000 && box.bottom > 0;
            })
            .every((image) => image.complete),
        undefined,
        { timeout: 4000 },
      )
      .catch(() =>
        warnings.push(
          '일부 CSS·폰트·이미지가 대기 시간 안에 준비되지 않았습니다. 화면 차이보다 로딩 상태를 먼저 확인하세요.',
        ),
      );
    await page.evaluate(() => {
      document.querySelectorAll('video,audio').forEach((media) => {
        media.pause();
        try {
          media.currentTime = 0;
        } catch {}
      });
    });
    await page.waitForTimeout(500);
    const renderHealth = await page.evaluate(() => ({
      stylesheetCount: document.styleSheets.length,
      pendingStylesheets: Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).filter(
        (link) => !link.disabled && (!link.media || matchMedia(link.media).matches) && !link.sheet,
      ).length,
      failedFonts: Array.from(document.fonts).filter((font) => font.status === 'error').length,
      fontStatus: document.fonts.status,
      brokenImages: Array.from(document.images).filter((image) => {
        const box = image.getBoundingClientRect();
        return (
          box.top < 10000 &&
          box.bottom > 0 &&
          image.complete &&
          !image.naturalWidth &&
          !!image.currentSrc
        );
      }).length,
    }));
    const stylesheetFailures = requests.filter((request) => request.type === 'stylesheet').length;
    if (stylesheetFailures || renderHealth.pendingStylesheets)
      warnings.push(
        `CSS 로딩 확인 필요: 실패 ${stylesheetFailures}개, 적용되지 않은 스타일시트 ${renderHealth.pendingStylesheets}개. 렌더링이 불완전할 수 있습니다.`,
      );
    if (renderHealth.failedFonts || renderHealth.fontStatus !== 'loaded')
      warnings.push(
        `웹폰트 로딩 확인 필요: 실패 ${renderHealth.failedFonts}개. 대체 글꼴로 보일 수 있습니다.`,
      );
    if (renderHealth.brokenImages)
      warnings.push(`촬영 영역 이미지 ${renderHealth.brokenImages}개를 불러오지 못했습니다.`);
    const metadata = await page.evaluate(() => ({
      title: document.title,
      description:
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '',
      h1: Array.from(document.querySelectorAll('h1'))
        .map((node) => node.textContent?.trim())
        .join(' | '),
      lang: document.documentElement.lang,
    }));
    const maskList = [];
    for (const selector of masks) {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (!count) warnings.push(`제외 영역을 찾지 못했습니다: ${selector}`);
      maskList.push(locator);
    }
    const documentHeight = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    );
    const captureHeight = Math.min(maxCaptureHeight, Math.max(viewport.height, documentHeight));
    if (documentHeight > maxCaptureHeight)
      warnings.push(
        `페이지 높이 ${documentHeight.toLocaleString()}px 중 상단 ${maxCaptureHeight.toLocaleString()}px까지 촬영했습니다. 무한 스크롤 또는 긴 페이지는 일부가 잘릴 수 있습니다.`,
      );
    const screenshot = await page.screenshot({
      fullPage: true,
      clip: { x: 0, y: 0, width: viewport.width, height: captureHeight },
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
      mask: maskList,
      maskColor: '#d8dbe6',
      timeout: 10000,
    });
    if (blockedRequests)
      warnings.push(
        `조회 외 요청 등 ${blockedRequests}건을 차단했습니다. 해당 요청에 의존하는 화면은 다를 수 있습니다.`,
      );
    return {
      screenshot,
      documentHeight,
      captureHeight,
      truncated: documentHeight > maxCaptureHeight,
      renderHealth,
      metadata: Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => [key, redact(value)]),
      ),
      messages,
      requests,
      warnings,
      status: response?.status() ?? 0,
      finalUrl: redact(scrub(page.url())),
      elapsedMs: Date.now() - started,
    };
  } finally {
    signal.removeEventListener('abort', abort);
    await context.close().catch(() => {});
  }
}

const unique = (list, key) =>
  list.filter((item, index) => list.findIndex((other) => key(other) === key(item)) === index);
const requestKey = (item) => {
  try {
    return `${new URL(item.url).pathname}:${item.status}`;
  } catch {
    return `${item.url}:${item.status}`;
  }
};

export async function comparePage({
  createBrowser,
  beforeUrl,
  afterUrl,
  device,
  masks,
  threshold,
  signal,
  demo,
  beforeHeaders = [],
  afterHeaders = [],
}) {
  const viewport = VIEWPORT_MAP[device];
  const captures = [];
  for (const [targetUrl, headers] of [
    [beforeUrl, beforeHeaders],
    [afterUrl, afterHeaders],
  ]) {
    const browser = await createBrowser();
    try {
      captures.push(await capture(browser, targetUrl, viewport, masks, signal, demo, headers));
    } finally {
      await browser.close().catch(() => {});
    }
  }
  const [before, after] = captures;
  const imageSize = {
    width: viewport.width,
    height: Math.max(before.captureHeight, after.captureHeight),
  };
  const pad = async (buffer, height) =>
    height < imageSize.height
      ? sharp(buffer)
          .extend({
            top: 0,
            left: 0,
            right: 0,
            bottom: imageSize.height - height,
            background: '#ffffff',
          })
          .png()
          .toBuffer()
      : buffer;
  const [beforePng, afterPng] = await Promise.all([
    pad(before.screenshot, before.captureHeight),
    pad(after.screenshot, after.captureHeight),
  ]);
  const imageA = PNG.sync.read(beforePng);
  const imageB = PNG.sync.read(afterPng);
  const diff = new PNG(imageSize);
  const changedPixels = pixelmatch(
    imageA.data,
    imageB.data,
    diff.data,
    imageSize.width,
    imageSize.height,
    { threshold, diffColor: [231, 80, 123], alpha: 0.22, includeAA: false },
  );
  const diffPng = PNG.sync.write(diff);
  let encoded;
  let imageQuality = 86;
  for (const quality of [86, 70, 50, 30]) {
    imageQuality = quality;
    encoded = await Promise.all(
      [beforePng, afterPng, diffPng].map((buffer) =>
        sharp(buffer).webp({ quality, effort: 2 }).toBuffer(),
      ),
    );
    if (encoded.reduce((sum, buffer) => sum + buffer.length, 0) < 2700000) break;
  }
  if (encoded.reduce((sum, buffer) => sum + buffer.length, 0) >= 2700000)
    throw new Error(
      '보고서 이미지 크기가 너무 큽니다. 페이지 경로나 제외 영역을 줄여 다시 실행하세요.',
    );
  const [beforeImage, afterImage, diffImage] = encoded.map(
    (buffer) => 'data:image/webp;base64,' + buffer.toString('base64'),
  );
  const seoChanges = Object.keys(before.metadata)
    .filter((key) => before.metadata[key] !== after.metadata[key])
    .map((key) => ({ key, before: before.metadata[key], after: after.metadata[key] }));
  const newMessages = unique(
    after.messages.filter(
      (item) =>
        !before.messages.some((other) => other.text === item.text && other.level === item.level),
    ),
    (item) => `${item.level}:${item.text}`,
  );
  const newRequests = unique(
    after.requests.filter(
      (item) => !before.requests.some((other) => requestKey(item) === requestKey(other)),
    ),
    requestKey,
  );
  const { screenshot: _ignoredA, ...beforeInfo } = before;
  const { screenshot: _ignoredB, ...afterInfo } = after;
  return {
    images: { before: beforeImage, after: afterImage, diff: diffImage },
    viewport,
    imageSize,
    imageQuality,
    captureMode: 'fullPage',
    changedPixels,
    diffPercent: Number(((changedPixels / (imageSize.width * imageSize.height)) * 100).toFixed(2)),
    before: beforeInfo,
    after: afterInfo,
    seoChanges,
    newMessages,
    newRequests,
  };
}
