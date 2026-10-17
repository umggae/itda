// 서울 전환 확인용: 서울 좌표로 각 API가 실제로 응답하는지, 새로 의존하는 부분이 동작하는지 본다.
// 서비스에는 쓰이지 않는다.
//   node --env-file=.env.local scripts/check-seoul.mjs
// 키는 출력에서 *** 로 가려진다. 결과(출력)를 Claude에게 붙여 주세요.

const KEYS = {
  TOURAPI_KEY: process.env.TOURAPI_KEY,
  KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY,
  GOOGLE_ROUTES_API_KEY: process.env.GOOGLE_ROUTES_API_KEY,
};

const SEOUL_STATION = { lat: 37.5547, lng: 126.9707 };
const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const GYEONGBOK = { lat: 37.5796, lng: 126.977 };
const REGION_BOX = { minLat: 37.4, maxLat: 37.73, minLng: 126.73, maxLng: 127.28 };

// 내일 낮 10시(한국시간)를 출발 시각으로 — 날짜는 실행하는 날 기준으로 자동 계산
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(tomorrow);
const departure = new Date(day + 'T10:00:00+09:00').toISOString();

function redact(text) {
  let out = String(text);
  for (const value of Object.values(KEYS)) {
    if (value) out = out.split(value).join('***').split(encodeURIComponent(value)).join('***');
  }
  return out;
}

async function show(title, url, options, maxChars = 1400) {
  console.log('\n=== ' + title + ' ===');
  try {
    const res = await fetch(url, options);
    console.log('HTTP', res.status);
    console.log(redact(await res.text()).slice(0, maxChars));
  } catch (error) {
    console.log('요청 실패:', redact(error.message));
  }
}

const wp = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
const google = (url, mask, body) => [
  url,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEYS.GOOGLE_ROUTES_API_KEY, 'X-Goog-FieldMask': mask },
    body: JSON.stringify(body),
  },
];
const tourUrl = (operation, params) =>
  'https://apis.data.go.kr/B551011/KorService2/' + operation + '?' +
  new URLSearchParams({ serviceKey: KEYS.TOURAPI_KEY, MobileOS: 'ETC', MobileApp: 'Itda', _type: 'json', ...params });

console.log('출발 시각(한국 시간 내일 10:00):', departure);

// 1) Google 대중교통 매트릭스: 서울역·강남역·경복궁 3×3
if (KEYS.GOOGLE_ROUTES_API_KEY) {
  const points = [SEOUL_STATION, GANGNAM, GYEONGBOK];
  await show(
    'Google 대중교통 매트릭스 3×3 (서울역·강남역·경복궁)',
    ...google('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      'originIndex,destinationIndex,duration,distanceMeters,condition',
      { origins: points.map((p) => ({ waypoint: wp(p) })), destinations: points.map((p) => ({ waypoint: wp(p) })), travelMode: 'TRANSIT', departureTime: departure }),
    2200,
  );
  // 2) 지하철 환승 경로에서 탑승 시간·배차 간격(headway)이 오는지 — 배차 간격 표시의 핵심
  await show(
    'Google 경로 1건 — 서울역→강남역 (지하철: stopCount·headway·시각·노선 색이 오는지)',
    ...google('https://routes.googleapis.com/directions/v2:computeRoutes',
      'routes.duration,routes.legs.steps.travelMode,routes.legs.steps.transitDetails',
      { origin: wp(SEOUL_STATION), destination: wp(GANGNAM), travelMode: 'TRANSIT', departureTime: departure, languageCode: 'ko' }),
    3500,
  );
} else console.log('\n(건너뜀) GOOGLE_ROUTES_API_KEY 없음');

// 3) 카카오 로컬: rect(서울 범위 제한)가 정상 동작하는지 — 부산 결과가 섞이면 안 됨
if (KEYS.KAKAO_REST_API_KEY) {
  const rect = [REGION_BOX.minLng, REGION_BOX.minLat, REGION_BOX.maxLng, REGION_BOX.maxLat].join(',');
  await show(
    '카카오 로컬 — "시청역" rect=서울 범위 (다른 도시 결과가 없어야 함)',
    'https://dapi.kakao.com/v2/local/search/keyword.json?' + new URLSearchParams({ query: '시청역', rect, size: '5' }),
    { headers: { Authorization: 'KakaoAK ' + KEYS.KAKAO_REST_API_KEY } },
    2000,
  );
  await show(
    '카카오모빌리티 길찾기 — 자동차 서울역→강남역',
    'https://apis-navi.kakaomobility.com/v1/directions?' + new URLSearchParams({
      origin: SEOUL_STATION.lng + ',' + SEOUL_STATION.lat, destination: GANGNAM.lng + ',' + GANGNAM.lat, summary: 'true' }),
    { headers: { Authorization: 'KakaoAK ' + KEYS.KAKAO_REST_API_KEY } },
    900,
  );
} else console.log('\n(건너뜀) KAKAO_REST_API_KEY 없음');

// 4) TourAPI: 서울(areaCode 1) 키워드 검색 — 관광지(12)·음식점(39) 필터가 동작하는지, 서울 장소만 오는지
if (KEYS.TOURAPI_KEY) {
  for (const [label, typeId, keyword] of [['관광지', '12', '경복궁'], ['음식점', '39', '설렁탕']]) {
    await show(
      'TourAPI searchKeyword2 — ' + label + ' "' + keyword + '" (areaCode=1, contentTypeId=' + typeId + ')',
      tourUrl('searchKeyword2', { keyword, areaCode: '1', contentTypeId: typeId, numOfRows: '3' }),
      undefined,
      1600,
    );
  }
} else console.log('\n(건너뜀) TOURAPI_KEY 없음');

console.log('\n끝. 위 출력(키는 가려져 있음)을 Claude에게 붙여 주세요.');
