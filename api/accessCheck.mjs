// 공개 데모 헤더만 확인하는 고정 샘플입니다. 실제 계정이나 비밀 값을 사용하지 않습니다.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'https://deploy-lens-silk.vercel.app');
  if (url.searchParams.get('redirect') === '1') {
    res.setHeader(
      'Location',
      'https://deploy-lens-frontleejonghuns-projects.vercel.app/api/accessCheck',
    );
    return res.status(302).end();
  }
  if (req.headers['x-deploy-lens-demo'] !== 'preview')
    return res.status(401).send('데모 인증 헤더가 필요합니다.');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res
    .status(200)
    .send(
      '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>헤더 인증 확인</title><style>body{font-family:Arial,"Noto Sans KR",sans-serif;padding:70px;background:#f3f1fa;color:#675780}h1{font-size:48px}p{font-size:20px}</style></head><body><h1>보호된 샘플 페이지</h1><p>요청한 사이트에만 커스텀 헤더를 전달했습니다.</p></body></html>',
    );
}
