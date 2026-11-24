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
- (2026-11-24) 배포 사이트 확인: 새 지도, 실제 검색, 대중교통·자동차 길찾기 정상, Google Routes 403 복구됨. 원격 `design` 브랜치 삭제.
- (2026-11-24) 지도 배경 서버를 못 불러올 때 빈 배경으로 바꾸고 안내 문구를 띄움. 경로선은 `style.load`마다 다시 얹도록 고침(이전에는 `load`에 묶여 서버 장애 시 선이 안 그려짐). 접속 불가 주소로 바꾼 복사본과 정상 상태 모두 `?mock=1`로 확인, 테스트 86개 통과.

- (2026-11-24) 검증 기록(README, `docs/verification.md`)에 실패 상황 2줄 추가(서버 연결 끊김, 배경 지도 서버 접속 불가)와 캡처 `docs/evidence/16·17-*`. README 단위 테스트 개수를 86개로 갱신.

## 다음에 할 일
- 확장 목표(`docs/ai-log.md`): 쉬는 날 경고, 식사 시간대, 지하철 배차 간격 공공데이터, 여러 날 일정. 하나씩 설계부터 정하기.
- 로컬에서 실제 검색을 돌리려면 `.env.local`에 키 3개를 직접 채우기(배포 사이트는 이미 정상).
- 새 컴퓨터에서는 `.env.local` 만들기, Node와 Git 설치 필요.
- 타일 몇 장만 실패하는 경우(스타일은 정상)는 안내하지 않음. 필요하면 보강.
