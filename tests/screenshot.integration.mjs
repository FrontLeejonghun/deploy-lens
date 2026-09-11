import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { PNG } from 'pngjs';
import { launchBrowser } from '../server/capture.mjs';
import { captureScreenshot } from '../server/screenshot.mjs';

test('a stalled font does not prevent fallback capture or reveal a masked element', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/stalled.woff2') return;
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<style>@font-face{font-family:Pending;src:url(/stalled.woff2)}body{margin:0;height:720px;font-family:Pending,Arial}#lower{position:absolute;top:500px;width:100px;height:100px;background:#00ff00}#private{position:absolute;left:20px;top:20px;width:100px;height:100px;background:red}#private span{visibility:visible}</style><div id="private"><span>PRIVATE</span></div><p>Public page</p><div id="lower"></div>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 240 } });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.fonts.status === 'loading');
    const result = await captureScreenshot(page, session, {
      type: 'png',
      fullPage: true,
      clip: { x: 0, y: 0, width: 320, height: 720 },
      animations: 'disabled',
      mask: [page.locator('#private')],
      maskColor: '#d8dbe6',
      timeout: 300,
    });
    assert.equal(result.fallback, true);
    const png = PNG.sync.read(result.screenshot);
    assert.equal(png.width, 320);
    assert.equal(png.height, 720);
    const offset = (30 * png.width + 30) * 4;
    assert.deepEqual([...png.data.subarray(offset, offset + 4)], [216, 219, 230, 255]);
    const lowerOffset = (510 * png.width + 10) * 4;
    assert.deepEqual([...png.data.subarray(lowerOffset, lowerOffset + 4)], [0, 255, 0, 255]);
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
});
