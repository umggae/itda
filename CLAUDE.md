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
- (2026-11-24) 윈도우 PC에서 이어서 작업: `design` 브랜치(지도를 Leaflet → MapLibre GL + OpenFreeMap으로 교체)를 `main`에 병합해 push함. 임시 `?tiles=` 코드 제거, README·`docs/data-sources.md` 지도 출처 문구 갱신. 테스트 86개 통과, `?mock=1`로 지도·핀·경로선 확인.

## 다음에 할 일
- Vercel 배포 사이트(https://itda-rho.vercel.app/)에서 새 지도가 정상인지 확인.
- 키가 필요한 검색·길찾기는 새 지도에서 실제 키로 확인하지 못함(`.env.local` 필요).
- 지도 서버(`tiles.openfreemap.org`)가 막혔을 때의 동작 확인(미확인).
- 확장 목표(`docs/ai-log.md`): 쉬는 날 경고, 식사 시간대, 지하철 배차 간격 공공데이터, 여러 날 일정.
- 11-18 Google Routes 403(결제 수단 문제 추정)이 복구됐는지 확인.
- 새 컴퓨터에서는 `.env.local` 만들기, Node와 Git 설치 필요.
