import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTarget, isVercelLogin } from '../server/target.mjs';
import { withoutUrlParameters } from '../src/urlPrivacy.ts';

test('base URL query survives path composition, with page overrides and duplicate values', () => {
  const url = new URL(
    captureTarget(
      'https://example.com/ko?_vercel_share=sample&tag=a&tag=b&lang=en',
      '/pricing?lang=ko',
    ),
  );
  assert.equal(url.pathname, '/ko/pricing');
  assert.equal(url.searchParams.get('_vercel_share'), 'sample');
  assert.deepEqual(url.searchParams.getAll('tag'), ['a', 'b']);
  assert.equal(url.searchParams.get('lang'), 'ko');
});

test('record URLs and paths omit all query values and fragments', () => {
  assert.equal(
    withoutUrlParameters('https://example.com/?_vercel_share=sample#private'),
    'https://example.com/',
  );
  assert.equal(withoutUrlParameters('/pricing?x-vercel-protection-bypass=sample'), '/pricing');
});

test('Vercel SSO redirects are distinguished from application URLs and unrelated login routes', () => {
  assert.equal(isVercelLogin('https://vercel.com/sso-api?url=test', 'https://example.com'), true);
  assert.equal(isVercelLogin('https://vercel.com/login', 'https://example.com'), true);
  assert.equal(isVercelLogin('https://example.com/login', 'https://example.com'), false);
  assert.equal(isVercelLogin('https://vercel.com/docs', 'https://example.com'), false);
  assert.equal(isVercelLogin('https://vercel.com/login', 'https://vercel.com'), false);
});
