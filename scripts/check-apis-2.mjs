// 두 번째 확인: 남은 궁금증을 실제 호출로 푼다. 서비스에는 쓰이지 않는다.
//   node --env-file=.env.local scripts/check-apis-2.mjs
// 키는 출력에서 *** 로 가려진다.

const KEYS = {
  TOURAPI_KEY: process.env.TOURAPI_KEY,
  KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY,
  GOOGLE_ROUTES_API_KEY: process.env.GOOGLE_ROUTES_API_KEY,
};

const BUSAN_STATION = { lat: 35.115, lng: 129.0403 };
const HAEUNDAE = { lat: 35.1587, lng: 129.1604 };
const GAMCHEON = { lat: 35.0975, lng: 129.0107 };

function redact(text) {
  let out = String(text);
  for (const value of Object.values(KEYS)) {
    if (value) out = out.split(value).join('***').split(encodeURIComponent(value)).join('***');
  }
  return out;
}

async function fetchText(url, options) {
  try {
    const res = await fetch(url, options);
    return { status: res.status, body: await res.text() };
  } catch (error) {
    return { status: 0, body: '요청 실패: ' + error.message };
  }
}

function print(title, { status, body }, maxChars = 1200) {
  console.log('\n=== ' + title + ' ===');
  console.log('HTTP', status);
  console.log(redact(body).slice(0, maxChars));
}

const tourUrl = (operation, params) =>
  'https://apis.data.go.kr/B551011/KorService2/' + operation + '?' +
  new URLSearchParams({ serviceKey: KEYS.TOURAPI_KEY, MobileOS: 'ETC', MobileApp: 'Itda', _type: 'json', ...params });

const firstItem = (body) => {
  try {
    const item = JSON.parse(body).response.body.items.item;
    return Array.isArray(item) ? item[0] : item;
  } catch {
    return null;
  }
};

// 1) 카카오 로컬 (카카오맵 서비스를 켠 뒤에 되는지)
print(
  '카카오 로컬 — "부산역" 키워드 검색',
  await fetchText('https://dapi.kakao.com/v2/local/search/keyword.json?query=' + encodeURIComponent('부산역') + '&size=2', {
    headers: { Authorization: 'KakaoAK ' + KEYS.KAKAO_REST_API_KEY },
  }),
  1800,
);

// 2) Google 대중교통 매트릭스 — 내일 낮 10시(한국시간)로 출발 시각을 지정
const tomorrow10 = '2026-10-16T01:00:00Z';
const wp = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
const points = [BUSAN_STATION, HAEUNDAE, GAMCHEON];
print(
  'Google 대중교통 매트릭스 3×3, departureTime=내일 10:00 KST',
  await fetchText('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEYS.GOOGLE_ROUTES_API_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify({
      origins: points.map(wp),
      destinations: points.map(wp),
      travelMode: 'TRANSIT',
      departureTime: tomorrow10,
    }),
  }),
  2500,
);

// 3) 카카오모빌리티 "다중 목적지" — 출발지 1곳에서 여러 곳을 한 번에 받을 수 있는지
print(
  '카카오모빌리티 다중 목적지 길찾기 (부산역 → 해운대, 감천)',
  await fetchText('https://apis-navi.kakaomobility.com/v1/destinations/directions', {
    method: 'POST',
    headers: { Authorization: 'KakaoAK ' + KEYS.KAKAO_REST_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: { x: BUSAN_STATION.lng, y: BUSAN_STATION.lat },
      destinations: [
        { x: HAEUNDAE.lng, y: HAEUNDAE.lat, key: 'haeundae' },
        { x: GAMCHEON.lng, y: GAMCHEON.lat, key: 'gamcheon' },
      ],
      radius: 30000,
    }),
  }),
  1500,
);

// 4) TourAPI — 키워드 검색(부산), 결과 없음, 관광지·음식점 상세
const found = await fetchText(tourUrl('searchKeyword2', { keyword: '감천', areaCode: '6', numOfRows: '3' }));
print('TourAPI searchKeyword2 — "감천" (부산)', found, 1500);

print('TourAPI searchKeyword2 — 없는 이름', await fetchText(tourUrl('searchKeyword2', { keyword: 'zzzz없는이름', areaCode: '6', numOfRows: '3' })), 600);

const attraction = firstItem(found.body);
const foodList = await fetchText(tourUrl('areaBasedList2', { areaCode: '6', contentTypeId: '39', numOfRows: '1' }));
const restaurant = firstItem(foodList.body);
print('TourAPI areaBasedList2 — 음식점(39) 1건', foodList, 900);

for (const [label, item] of [['관광지', attraction], ['음식점', restaurant]]) {
  if (!item) {
    console.log('\n(건너뜀) ' + label + ' 상세: 위 검색에서 항목을 못 찾음');
    continue;
  }
  const ids = { contentId: item.contentid, contentTypeId: item.contenttypeid };
  print('TourAPI detailIntro2 — ' + label + ' "' + item.title + '"', await fetchText(tourUrl('detailIntro2', ids)), 1800);
  print('TourAPI detailCommon2 — ' + label, await fetchText(tourUrl('detailCommon2', { contentId: item.contentid })), 1200);
}

console.log('\n끝. 위 출력(키는 가려져 있음)을 Claude에게 붙여 주세요.');
