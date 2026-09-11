import { z } from 'zod';
import { comparePage, launchBrowser } from '../server/capture.mjs';
import { publicAddress, createEgressProxy } from '../server/egress.mjs';
import { captureTarget } from '../server/target.mjs';

const urlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      (!url.port || ['80', '443'].includes(url.port))
    );
  }, 'HTTP 또는 HTTPS 공개 주소를 입력하세요.');
const headerSchema = z
  .array(
    z.object({
      name: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/)
        .refine(
          (name) =>
            !/^(host|connection|content-length|transfer-encoding|upgrade|origin|referer|accept-encoding|proxy-.*|sec-.*)$/i.test(
              name,
            ),
        ),
      value: z
        .string()
        .min(1)
        .max(2048)
        .regex(/^[^\r\n\0]*$/),
    }),
  )
  .max(8)
  .default([]);
const schema = z.object({
  beforeUrl: urlSchema,
  beforeHeaders: headerSchema,
  afterHeaders: headerSchema,
  afterUrl: urlSchema,
  path: z
    .string()
    .max(250)
    .regex(/^\/(?!\/)[^\\]*$/),
  device: z.enum(['desktop', 'mobile']),
  masks: z.array(z.string().min(1).max(200)).max(8).default([]),
  threshold: z.number().min(0.01).max(0.5).default(0.1),
  demo: z.boolean().default(false),
});
let active = 0;
const rateMap = new Map();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }
  const origin = req.headers.origin;
  let originHost;
  try {
    originHost = origin ? new URL(origin).host : undefined;
  } catch {
    return res.status(403).json({ error: '요청 출처가 올바르지 않습니다.' });
  }
  if (
    req.headers['sec-fetch-site'] === 'cross-site' ||
    (originHost && originHost !== req.headers.host)
  )
    return res.status(403).json({ error: '같은 사이트에서만 실행할 수 있습니다.' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: 'URL·페이지 경로·헤더 설정을 확인하세요. 헤더 이름·값에 줄바꿈은 사용할 수 없습니다.',
    });
  const now = Date.now();
  for (const [key, item] of rateMap) if (now - item.start > 60000) rateMap.delete(key);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'local').split(
    ',',
  )[0];
  const rate = rateMap.get(ip) ?? { start: now, count: 0 };
  if (rate.count >= 24 || active >= 2)
    return res.status(429).json({ error: '비교 작업이 많습니다. 잠시 후 다시 실행하세요.' });
  rate.count += 1;
  rateMap.set(ip, rate);
  active += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 170000);
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);
  let stage = 'validate';
  let browser;
  let proxy;
  try {
    const input = parsed.data;
    const beforeUrl = input.demo
      ? `https://demo.deploy-lens.test/before${input.path}`
      : captureTarget(input.beforeUrl, input.path);
    const afterUrl = input.demo
      ? `https://demo.deploy-lens.test/after${input.path}`
      : captureTarget(input.afterUrl, input.path);
    if (!input.demo) {
      await Promise.all([
        publicAddress(new URL(beforeUrl).hostname),
        publicAddress(new URL(afterUrl).hostname),
      ]);
      proxy = await createEgressProxy();
    }

    const result = await comparePage({
      ...input,
      beforeUrl,
      afterUrl,
      createBrowser: async () => {
        stage = 'browser';
        browser = await launchBrowser(proxy?.url);
        stage = 'capture';
        return browser;
      },
      signal: controller.signal,
    });
    return res.status(200).json({
      ...result,
      path: input.path.split(/[?#]/, 1)[0],
      device: input.device,
      capturedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '비교 작업을 완료하지 못했습니다.';
    const details = error instanceof Error ? error.captureDetails : undefined;
    const code =
      controller.signal.aborted || /Timeout|timeout|초과/.test(message)
        ? 'timeout'
        : /DEPLOYMENT_PROTECTION/.test(message)
          ? 'deploymentProtection'
          : /HTTP (401|403)/.test(message)
            ? 'accessDenied'
            : /Target.*closed|browser.*closed|Browser.*closed|browserType/.test(message) ||
                stage === 'browser'
              ? 'browserFailure'
              : /ERR_NAME_NOT_RESOLVED/.test(message)
                ? 'dnsFailure'
                : /ERR_CERT|SSL/.test(message)
                  ? 'certificateFailure'
                  : /공개 인터넷/.test(message)
                    ? 'privateAddress'
                    : /selector|Selector/.test(message)
                      ? 'invalidSelector'
                      : 'captureFailure';
    console.error('촬영 실패', {
      stage,
      code,
      name: error instanceof Error ? error.name : 'UnknownError',
      ...details,
    });
    const messages = {
      deploymentProtection:
        'Vercel 로그인으로 이동했습니다. Share 링크는 발급된 URL 전체를, 자동화 시크릿은 x-vercel-protection-bypass 헤더에 입력하세요. 링크의 도메인·만료 여부도 확인하세요.',
      timeout:
        '페이지 촬영 대기 시간이 초과되었습니다. 동적 영역을 제외하거나 잠시 후 다시 실행하세요.',
      accessDenied:
        '사이트가 접근을 거부했습니다. 해당 환경의 커스텀 헤더에 인증 또는 배포 보호 우회 값을 추가하세요.',
      browserFailure:
        '서버의 촬영 브라우저가 종료되었습니다. URL 오류는 아닐 수 있습니다. 잠시 후 다시 실행하세요.',
      dnsFailure: '촬영 서버에서 도메인을 찾지 못했습니다. 공개 DNS와 주소를 확인하세요.',
      certificateFailure:
        '사이트의 HTTPS 인증서를 확인하지 못했습니다. 인증서 또는 만료 상태를 확인하세요.',
      privateAddress: '공개 인터넷 주소만 비교할 수 있습니다.',
      invalidSelector: '제외 영역의 CSS 선택자를 해석하지 못했습니다. 선택자를 확인하세요.',
      captureFailure:
        '페이지 촬영을 완료하지 못했습니다. 서버 접근 제한, 필수 API 차단 또는 로딩 상태를 확인하세요.',
    };
    const sideLabel =
      details?.side === 'before' ? '[A 변경 전] ' : details?.side === 'after' ? '[B 변경 후] ' : '';
    let friendly = messages[code];
    if (code === 'deploymentProtection' && details) {
      friendly = details.hasVercelBypassHeader
        ? 'x-vercel-protection-bypass 헤더를 설정했지만 Vercel이 인증을 거부했습니다. 해당 사이트 프로젝트의 Automation Bypass 시크릿인지, 복사한 값이 정확한지 확인하세요.'
        : details.hasUrlParameters
          ? 'URL 쿼리를 전달했지만 Vercel이 인증을 거부했습니다. 발급된 URL 전체와 해당 배포의 접근 권한을 확인하세요.'
          : 'Vercel 인증이 필요하지만 이 환경에 x-vercel-protection-bypass 헤더가 없습니다. A와 B의 커스텀 헤더는 각각 설정해야 합니다.';
    }
    if (code === 'timeout' && details?.documentStatus === 200)
      friendly =
        '페이지 접근은 성공했지만 화면 준비 시간이 초과되었습니다. 인증 오류가 아닙니다. 잠시 후 다시 촬영하세요.';
    if (!res.destroyed) return res.status(422).json({ error: sideLabel + friendly, code, details });
  } finally {
    clearTimeout(timer);
    res.off('close', onClose);
    await browser?.close().catch(() => {});
    await proxy?.close().catch(() => {});
    active -= 1;
  }
}
