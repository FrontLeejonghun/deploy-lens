import type { Report } from '@/types';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
export function downloadReport(report: Report) {
  const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deploy Lens 비교 보고서</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#252b38;background:#f6f7fb;max-width:1200px;margin:auto;padding:32px}h1{font-size:36px}article{padding:28px;background:#fff;border:1px solid #e3e5ed;border-radius:16px;margin:24px 0}small{color:#697287}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border:1px solid #e3e5ed}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f7fb;padding:16px}summary{cursor:pointer}h2{overflow-wrap:anywhere}@media(max-width:600px){.pair{grid-template-columns:1fr}body{padding:16px}}</style><h1>Deploy Lens</h1><p>${escape(report.name)} · ${escape(new Date(report.createdAt).toLocaleString('ko-KR'))}</p><small>${escape(report.settings.demo ? '직접 촬영한 데모 사이트 비교' : report.settings.beforeUrl + ' → ' + report.settings.afterUrl)}<br>동일한 화면 크기의 비교입니다. 전체 페이지 촬영은 최대 10,000px이며, 높이 제한과 로딩 경고는 각 결과에 포함됩니다. 화면 차이가 오류를 의미하지는 않습니다.</small>${report.pages
    .map((page) => {
      const result = page.comparison;
      if (!result)
        return `<article><h2>${escape(page.path)} · ${page.device}</h2><p>${escape(page.error ?? '미완료')}</p></article>`;
      return `<article><h2>${escape(page.path)} · ${page.device}</h2><p>화면 차이 ${result.diffPercent}% · ${page.intended ? '의도한 변경' : '검토 전'}</p><div class="pair"><div><h3>변경 전</h3><img alt="변경 전" src="${result.images.before}"></div><div><h3>변경 후</h3><img alt="변경 후" src="${result.images.after}"></div></div><details><summary>차이 강조 보기</summary><img alt="차이 강조" src="${result.images.diff}"></details><h3>새 콘솔 메시지 ${result.newMessages.length}건 / 실패 요청 ${result.newRequests.length}건</h3><pre>${escape(JSON.stringify({ console: result.newMessages, network: result.newRequests, seo: result.seoChanges, warnings: [...result.before.warnings, ...result.after.warnings] }, null, 2))}</pre></article>`;
    })
    .join(
      '',
    )}<footer>Deploy Lens · 브라우저에서 촬영한 비교 결과 · 이미지가 포함된 독립 HTML 파일</footer></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `deploy-lens-${report.createdAt.slice(0, 10)}.html`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
