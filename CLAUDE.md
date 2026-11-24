# wishroute (잇다)

서울에서 대중교통·자동차로 여러 경유지를 도는 하루 일정의 구간별 이동시간과 방문 순서를 검사하고 더 효율적인 순서를 제안하는 서비스. 자세한 내용은 `README.md` 참고.
- 서비스: https://itda-rho.vercel.app/ (Vercel 배포)
- 저장소: https://github.com/umggae/itda (로컬 폴더 이름은 wishroute)

## 구조
- `index.html`, `css/`, `js/` : 프론트엔드
- `api/` : Vercel 서버 함수 (`search`, `detail`, `leg`, `matrix`)
- `server/` : API 클라이언트와 공용 로직
- `tests/` : `npm test` (node 내장 테스트 러너)
- `scripts/dev-server.mjs` : 로컬 개발 서버, 나머지 `check-*.mjs`는 API 확인용
- `docs/` : 데이터 출처, 검증, AI 사용 기록

## 규칙
- 사용자에게는 한국어로 답한다.
- API 키(`TOURAPI_KEY`, `KAKAO_REST_API_KEY`, `GOOGLE_ROUTES_API_KEY`)는 코드나 GitHub에 절대 넣지 않는다. 이 저장소는 PUBLIC이다.
- 키는 배포는 Vercel 환경변수, 로컬은 `.env.local`에만 둔다.

## 두 컴퓨터 동기화
- 작업 시작: `git pull` / 작업 끝: 커밋 → `git push`, 아래 진행 상황 갱신
- `.env.local`은 git에 올라가지 않으므로 컴퓨터마다 직접 만든다. `.env.example`을 복사해 키를 채운다.

## 진행 상황
- (2026-11-24) GitHub 동기화 설정 완료, 최신 상태.

## 다음에 할 일
- (작업 끝낼 때 여기에 적기)
