# 검증 기록

2026-09-11, macOS 로컬 및 개인 Vercel 프로덕션에서 확인했습니다.

- Oxlint, Oxfmt, TypeScript 검사와 Vite 빌드 통과
- 초기 샘플 3개 경로×2개 화면 크기 6건 촬영 성공
- 동일 공개 URL 두 개: 픽셀 차이 0%, 문서 제목 수집
- 요금제의 콘솔 오류, 404 실패 요청, SEO 변경 감지
- 모바일 390px 및 데스크톱 1440px에서 문서 가로 넘침 없음
- 키보드 방향키로 비교 슬라이더 50→51 이동
- 배포된 전체 페이지 뷰어에서 PageDown 후 scrollTop 0→558px 이동, 화면 아래 Studio·Collective 요금제 확인
- 의도한 변경 표시 및 브라우저 기록 저장 확인
- 보호된 고정 샘플: 공개 데모 헤더가 있으면 200과 0% 비교, 없으면 accessDenied
- 별도 HTTP 서버의 cross-origin redirect 검증: 원래 출처에는 커스텀 헤더, 이동한 출처에는 헤더 없음, 401 확인
- 사설·메타데이터·IPv6 loopback 목적지 7종 거절
- protocol-relative 경로·file URL 400, cross-site 요청 403
- Vercel /renderCheck: 외부 CSS, CSSOM insertRule, Shadow DOM adoptedStyleSheets, 지연 주입 스타일 포함. 모바일 높이 861px, 경고 없음, 차이 0%
- Vercel /brokenStyle: CSS 응답 실패를 별도 경고로 표시. 픽셀이 같아도 로딩 품질을 구분
- Vercel /pricing 모바일: 전체 촬영 높이 1,481px, 첫 화면보다 아래까지 촬영

초기 Vercel 빌드 패키지의 심볼릭 링크 문제는 Chromium 바이너리를 빌드 때 실제 디렉터리로 복사하여 해결했습니다. 설치된 Chromium 패키지의 폰트 등록 API 변경과 단일 프로세스에서 복수 컨텍스트 충돌은 임시 폰트 디렉터리와 A/B 독립 브라우저 실행으로 해결했습니다.

실제 사용자의 dev 인증 정보는 제공받거나 사용하지 않았습니다. 해당 환경의 권한·추가 로그인 요구 여부는 사용자 헤더로 확인해야 합니다. 실제 모바일 기기, 모든 랜덤 콘텐츠, iframe 내부 및 중첩 스크롤 전체를 검증한 것은 아닙니다.

## 인증 리다이렉트 수정

- 기존 구현에서 올바른 헤더로 최초 요청이 성공해도 같은 origin의 302 후속 요청은 401이 되는 현상을 로컬 Chromium으로 재현했다.
- Chromium Fetch의 요청 단위 헤더 적용으로 전환한 뒤 같은 origin의 문서·CSS 요청은 성공하고, 다른 origin으로의 리다이렉트에는 헤더가 전달되지 않음을 확인했다.
- 기본 URL 쿼리 → Set-Cookie → 302 → 문서·CSS 요청 성공을 검증했다. 결과 JSON에서 테스트 토큰이 노출되지 않았다.
- Vercel SSO로 향하는 문서 이동은 deploymentProtection으로 분류했다.
- `pnpm test` 3개와 `pnpm test:browser` 통합 테스트 통과. Oxlint·TypeScript·빌드 통과.
- 실제 dev.aistudio.dropshot.io의 무인증 응답은 Vercel SSO 302였다. 사용자의 유효한 자동화 시크릿으로 이 도메인의 인증 성공까지 검증한 것은 아니다.

## 실제 AI Studio dev 재검증

- `dev.aistudio.dropshot.io`가 AI Studio 프로젝트의 배포를 가리키는 것을 Vercel API로 확인했다.
- 기존 Automation Bypass 시크릿 2개 모두 직접 GET 요청에서 HTTP 200을 반환했다. 값을 파일·로그·소스에 기록하거나 새 시크릿을 만들지 않았다.
- 실제 촬영은 인증 성공 후 B 화면 스크롤 중 기존 55초 제한에 걸렸다. 요청 제한을 170초, Vercel 함수 제한을 180초로 조정했다.
- 제한 조정 후 배포 API에서 모바일 A/B 모두 HTTP 200, 높이 8,350px, 약 80.9초로 완료했다. 일부 폰트·지연 콘텐츠 경고는 남았다.
- 데스크톱에서 추가 스크린샷 시간 초과를 관측해 대체 촬영을 추가했다. 멈춘 폰트의 로컬 통합 테스트에서 대체 촬영 완료와 제외 영역 픽셀 비노출을 확인했다.
