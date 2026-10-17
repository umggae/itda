// 3단계 시작 전 "실제 호출" 확인용 스크립트. 서비스에는 쓰이지 않는다.
// 각 API가 부산에서 정말 응답하는지, 응답 모양이 어떤지를 눈으로 보려는 것이다.
//
// 실행 (키는 .env.local 파일에 적는다. 이 파일은 .gitignore 로 커밋되지 않는다):
//   node --env-file=.env.local scripts/check-apis.mjs
//
// 출력에서 키 값은 자동으로 *** 로 가린다. 그래도 결과를 남에게 보여 주기 전에 한 번 훑어보자.

const KEYS = {
  TOURAPI_KEY: process.env.TOURAPI_KEY,
  KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY,
  GOOGLE_ROUTES_API_KEY: process.env.GOOGLE_ROUTES_API_KEY,
};

// 부산역, 해운대해수욕장 근처, 감천문화마을 (위도, 경도)
const BUSAN_STATION = { lat: 35.1150, lng: 129.0403 };
const HAEUNDAE = { lat: 35.1587, lng: 129.1604 };
const GAMCHEON = { lat: 35.0975, lng: 129.0107 };

function redact(text) {
  let out = String(text);
  for (const value of Object.values(KEYS)) {
    if (value) out = out.split(value).join('***').split(encodeURIComponent(value)).join('***');
  }
  return out;
}

async function show(title, requestFn, maxChars = 1500) {
  console.log('\n=== ' + title + ' ===');
  try {
    const res = await requestFn();
    const body = await res.text();
    console.log('HTTP', res.status);
    console.log(redact(body).slice(0, maxChars));
  } catch (error) {
    console.log('요청 실패:', redact(error.message));
  }
}

function need(name) {
  if (KEYS[name]) return true;
  console.log('\n(건너뜀) ' + name + ' 이(가) .env.local 에 없습니다.');
  return false;
}

const waypoint = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

async function googleMatrix(travelMode) {
  return fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEYS.GOOGLE_ROUTES_API_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
    },
    body: JSON.stringify({
      origins: [waypoint(BUSAN_STATION), waypoint(HAEUNDAE)],
      destinations: [waypoint(HAEUNDAE), waypoint(GAMCHEON)],
      travelMode,
    }),
  });
}

async function googleRoute(travelMode) {
  return fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEYS.GOOGLE_ROUTES_API_KEY,
      'X-Goog-FieldMask':
        'routes.duration,routes.distanceMeters,routes.legs.steps.travelMode,routes.legs.steps.transitDetails',
    },
    body: JSON.stringify({
      ...{ origin: waypoint(BUSAN_STATION).waypoint, destination: waypoint(HAEUNDAE).waypoint },
      travelMode,
      languageCode: 'ko',
    }),
  });
}

// 1) Google Routes — 가장 중요한 질문: 한국에서 자동차/대중교통이 되는가?
if (need('GOOGLE_ROUTES_API_KEY')) {
  await show('Google 경로 매트릭스 — TRANSIT (부산역·해운대 → 해운대·감천)', () => googleMatrix('TRANSIT'));
  await show('Google 경로 매트릭스 — DRIVE', () => googleMatrix('DRIVE'));
  await show('Google 경로 1건 — TRANSIT (환승·노선 정보가 오는지)', () => googleRoute('TRANSIT'), 3000);
  await show('Google 경로 1건 — DRIVE', () => googleRoute('DRIVE'));
}

// 2) 카카오 로컬 키워드 검색 (출발지·도착지 검색용)
if (need('KAKAO_REST_API_KEY')) {
  await show('카카오 로컬 — "부산역" 키워드 검색', () =>
    fetch('https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent('부산역') + '&size=2', {
      headers: { Authorization: 'KakaoAK ' + KEYS.KAKAO_REST_API_KEY },
    }),
  );
  // 자동차 대체안: 카카오모빌리티 길찾기 (좌표는 경도,위도 순서)
  await show('카카오모빌리티 길찾기 — 자동차 (Google DRIVE가 안 될 때의 대체안)', () =>
    fetch(
      'https://apis-navi.kakaomobility.com/v1/directions?origin=' +
        BUSAN_STATION.lng + ',' + BUSAN_STATION.lat +
        '&destination=' + HAEUNDAE.lng + ',' + HAEUNDAE.lat + '&summary=true',
      { headers: { Authorization: 'KakaoAK ' + KEYS.KAKAO_REST_API_KEY } },
    ),
  );
}

// 3) 한국관광공사 TourAPI — 최신(KorService2)과 이전(KorService1) 둘 다 시험해 어느 쪽이 되는지 본다.
if (need('TOURAPI_KEY')) {
  for (const service of ['KorService2', 'KorService1']) {
    const operation = service === 'KorService2' ? 'areaBasedList2' : 'areaBasedList1';
    const params = new URLSearchParams({
      serviceKey: KEYS.TOURAPI_KEY,
      MobileOS: 'ETC',
      MobileApp: 'Itda',
      _type: 'json',
      areaCode: '6', // 부산 (확인용: 응답 주소가 부산인지 본다)
      numOfRows: '2',
      pageNo: '1',
    });
    await show('TourAPI ' + service + ' ' + operation + ' (부산 목록)', () =>
      fetch('https://apis.data.go.kr/B551011/' + service + '/' + operation + '?' + params),
    );
  }
}

console.log('\n끝. 위 출력(키는 가려져 있음)을 Claude에게 붙여 주세요.');
