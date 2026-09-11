export function captureTarget(base, path) {
  const root = new URL(base);
  const combined = new URL(root.pathname.replace(/\/$/, '') + path, root.origin);
  if (combined.origin !== root.origin) throw new Error('페이지 경로가 올바르지 않습니다.');
  for (const key of new Set(root.searchParams.keys())) {
    if (!combined.searchParams.has(key)) {
      for (const value of root.searchParams.getAll(key)) combined.searchParams.append(key, value);
    }
  }
  return combined.href;
}

export function isVercelLogin(value, originalOrigin) {
  const url = new URL(value);
  return (
    url.origin !== originalOrigin &&
    url.hostname === 'vercel.com' &&
    /^\/(sso-api|login|auth)(\/|$)/.test(url.pathname)
  );
}
