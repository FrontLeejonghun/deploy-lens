import http from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePage, launchBrowser } from '../server/capture.mjs';
import { captureTarget } from '../server/target.mjs';
test('capture authentication across redirects, cookies, assets, and SSO', async () => {
  const events = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local.test');
    const authorized = req.headers['x-test-auth'] === 'fixture-secret';
    const cookie = req.headers.cookie?.includes('fixture=accepted');
    events.push({ path: url.pathname, authorized, cookie: !!cookie });
    if (url.pathname === '/cross') {
      res.writeHead(302, { location: root.replace('127.0.0.1', 'localhost') + '/page' });
      return res.end();
    }
    if (url.pathname === '/sso') {
      res.writeHead(302, { location: 'https://vercel.com/sso-api' });
      return res.end();
    }
    if (url.searchParams.get('share') === 'fixture-query-secret') {
      res.writeHead(302, { 'set-cookie': 'fixture=accepted; Path=/; HttpOnly', location: '/page' });
      return res.end();
    }
    if (!authorized && !cookie) {
      res.writeHead(401);
      return res.end('denied');
    }
    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: '/page' });
      return res.end();
    }
    if (url.pathname === '/styles.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      return res.end('body {color:rgb(30,40,50)}');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<html><head><title>Auth fixture</title><link rel="stylesheet" href="/styles.css"></head><body><h1>Protected page</h1></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const run = (url, headers = [], afterHeaders = headers) =>
    comparePage({
      createBrowser: () => launchBrowser(),
      beforeUrl: url,
      afterUrl: url,
      device: 'mobile',
      masks: [],
      threshold: 0.1,
      signal: AbortSignal.timeout(45000),
      beforeHeaders: headers,
      afterHeaders,
    });
  try {
    const query = await run(captureTarget(root + '?share=fixture-query-secret', '/'));
    assert.equal(query.before.metadata.title, 'Auth fixture');
    assert.equal(query.before.renderHealth.pendingStylesheets, 0);
    assert.equal(query.before.requests.length, 0);
    assert.equal(JSON.stringify(query).includes('fixture-query-secret'), false);
    const header = await run(root + '/redirect', [
      { name: 'x-test-auth', value: 'fixture-secret' },
    ]);
    assert.equal(header.before.status, 200);
    assert.equal(header.before.requests.length, 0);
    assert.equal(header.before.finalUrl, root + '/page');
    assert.equal(JSON.stringify(header).includes('fixture-secret'), false);
    const beforeCross = events.length;
    await assert.rejects(
      run(root + '/cross', [{ name: 'x-test-auth', value: 'fixture-secret' }]),
      /HTTP 401/,
    );
    assert.deepEqual(events.slice(beforeCross), [
      { path: '/cross', authorized: true, cookie: false },
      { path: '/page', authorized: false, cookie: false },
    ]);
    await assert.rejects(run(root + '/sso'), (error) => {
      assert.match(error.message, /DEPLOYMENT_PROTECTION/);
      const { documentStatus: _documentStatus, ...details } = error.captureDetails;
      assert.deepEqual(details, {
        step: 'navigation',
        side: 'before',
        hasCustomHeaders: false,
        hasVercelBypassHeader: false,
        hasUrlParameters: false,
      });
      return true;
    });
    await assert.rejects(
      run(root + '/page', [{ name: 'x-test-auth', value: 'fixture-secret' }], []),
      (error) => {
        assert.equal(error.captureDetails.side, 'after');
        assert.equal(error.captureDetails.hasCustomHeaders, false);
        assert.equal(JSON.stringify(error.captureDetails).includes('fixture-secret'), false);
        return true;
      },
    );
  } finally {
    server.close();
  }
});
