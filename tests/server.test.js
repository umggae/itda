// 서버 쪽 순수 함수 테스트. 응답 자료는 실제 API를 부른 결과(2026-10-15)를 줄여 옮긴 것이다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../server/lib/errors.js';
import { dedupeSameName, rankPlaces } from '../server/lib/ranking.js';
import { parseQuery, parseMode, parsePlaceId, parsePoints, parseWhen } from '../server/lib/validate.js';
import { cacheGet, cacheSet, cached } from '../server/lib/cache.js';
import { parseTourItems, toPlace, parseDetail, parseCommon } from '../server/clients/tourApi.js';
import { parseKakaoPlaces, kakaoCategory } from '../server/clients/kakaoLocal.js';
import { parseCarRoute } from '../server/clients/kakaoMobility.js';
import { parseTransitMatrix, parseTransitRides, nextDepartureGapMinutes } from '../server/clients/googleRoutes.js';

const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof ApiError && e.code === code);

// ---------- 입력 검사 ----------
test('parseQuery: 공백 정리, 빈 값·너무 긴 값 거부', () => {
  assert.equal(parseQuery('  감천  '), '감천');
  throwsCode(() => parseQuery(''), 'BAD_REQUEST');
  throwsCode(() => parseQuery('   '), 'BAD_REQUEST');
  throwsCode(() => parseQuery('가'.repeat(31)), 'BAD_REQUEST');
});
test('parseMode', () => {
  assert.equal(parseMode('car'), 'car');
  throwsCode(() => parseMode('walk'), 'BAD_REQUEST');
});
test('parsePlaceId: TourAPI·카카오 형식만 허용', () => {
  assert.deepEqual(parsePlaceId('tour-12-294452'), { source: 'tour', typeId: '12', contentId: '294452' });
  assert.deepEqual(parsePlaceId('kakao-8329752'), { source: 'kakao', id: '8329752' });
  for (const bad of ['tour-15-1', 'tour-12-abc', '../etc', 'kakao-', '', undefined]) {
    throwsCode(() => parsePlaceId(bad), 'BAD_REQUEST');
  }
});
test('parsePoints: 서비스 지역(서울) 안 좌표 2~8개', () => {
  const points = parsePoints('37.5547,126.9707;37.4979,127.0276');
  assert.equal(points.length, 2);
  assert.deepEqual(points[0], { lat: 37.5547, lng: 126.9707 });
  throwsCode(() => parsePoints('37.5547,126.9707'), 'BAD_REQUEST'); // 1개
  throwsCode(() => parsePoints(Array(9).fill('37.5,127.0').join(';')), 'BAD_REQUEST'); // 9개
  throwsCode(() => parsePoints('37.5,127.0;35.1,129.0'), 'BAD_REQUEST'); // 부산 좌표는 지역 밖
  throwsCode(() => parsePoints('abc,127;37.5,127.0'), 'BAD_REQUEST');
  throwsCode(() => parsePoints('37.5;37.5,127.0'), 'BAD_REQUEST');
});
test('parseWhen: 한국시간을 UTC 시각으로, 범위 밖은 DATE_RANGE', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  assert.equal(parseWhen('2026-10-16', '10:00', now), '2026-10-16T01:00:00.000Z');
  throwsCode(() => parseWhen('2026-10-01', '10:00', now), 'DATE_RANGE'); // 너무 과거
  throwsCode(() => parseWhen('2027-06-01', '10:00', now), 'DATE_RANGE'); // 100일 넘게 미래
  throwsCode(() => parseWhen('내일', '10:00', now), 'BAD_REQUEST');
  throwsCode(() => parseWhen('2026-13-45', '10:00', now), 'BAD_REQUEST');
});

// ---------- 캐시 ----------
test('cached: 같은 키는 한 번만 실행', async () => {
  let calls = 0;
  const work = async () => ++calls;
  assert.equal(await cached('k1', 60, work), 1);
  assert.equal(await cached('k1', 60, work), 1);
  assert.equal(calls, 1);
});
test('cache: null(경로 없음)도 저장하고, 만료된 것은 버린다', () => {
  cacheSet('nullkey', null, 60);
  assert.equal(cacheGet('nullkey'), null);
  cacheSet('old', 'x', -1);
  assert.equal(cacheGet('old'), undefined);
});

// ---------- TourAPI ----------
const tourBody = (items) =>
  JSON.stringify({ response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items, totalCount: 1 } } });

test('parseTourItems: 정상 / 결과 없음("") / 1건(객체)', () => {
  const item = { contentid: '294452', contenttypeid: '12', title: '감천사(부산)', mapx: '129.0912632411', mapy: '35.1833036953', addr1: '부산광역시 연제구 묘봉산로 40' };
  assert.equal(parseTourItems(tourBody({ item: [item] })).length, 1);
  assert.deepEqual(parseTourItems(tourBody('')), []);
  assert.equal(parseTourItems(tourBody({ item })).length, 1);
});
test('parseTourItems: 오류 응답은 이유별 오류로', () => {
  throwsCode(() => parseTourItems('<xml>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</xml>'), 'RATE_LIMIT');
  throwsCode(() => parseTourItems('<xml>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</xml>'), 'NOT_CONFIGURED');
  throwsCode(() => parseTourItems('<html>?</html>'), 'UPSTREAM');
  throwsCode(() => parseTourItems(JSON.stringify({ response: { header: { resultCode: '9999' } } })), 'UPSTREAM');
});
test('toPlace: 경도(mapx)·위도(mapy), 관광지/음식점 구분, 지역 밖·다른 종류는 제외', () => {
  const base = { contentid: '1', title: '가', addr1: '주소', mapx: '127.0', mapy: '37.5' };
  assert.deepEqual(toPlace({ ...base, contenttypeid: '12' }), {
    id: 'tour-12-1', name: '가', category: 'attraction', lat: 37.5, lng: 127.0, address: '주소', source: 'tourapi',
  });
  assert.equal(toPlace({ ...base, contenttypeid: '39' }).category, 'restaurant');
  assert.equal(toPlace({ ...base, contenttypeid: '32' }), null); // 숙박은 이 서비스 범위 밖
  assert.equal(toPlace({ ...base, contenttypeid: '12', mapy: '35.1', mapx: '129.0' }), null); // 부산 좌표는 지역 밖
  assert.equal(toPlace({ ...base, contenttypeid: '12', mapx: '' }), null);
});
test('parseDetail: 관광지(실제 응답)', () => {
  const detail = parseDetail('12', { restdate: '연중무휴', usetime: '상 시 개방', parking: '불가능', infocenter: '051-852-6904' });
  assert.deepEqual(detail, { closedDays: '연중무휴', hours: '상 시 개방', parking: '불가능', reservation: null, contact: '051-852-6904', homepage: null });
});
test('parseDetail: 음식점(실제 응답) — 빈 값은 null, 태그는 제거', () => {
  const detail = parseDetail('39', {
    restdatefood: '매주 월요일', opentimefood: '09:00~21:00', parkingfood: '가능', reservationfood: '', infocenterfood: '051-722-2995<br>',
  });
  assert.deepEqual(detail, { closedDays: '매주 월요일', hours: '09:00~21:00', parking: '가능', reservation: null, contact: '051-722-2995', homepage: null });
});

test('parseCommon: 실제 응답의 홈페이지 <a> 글자에서 주소만 꺼낸다 / 전화 / 안전하지 않은 값은 버린다', () => {
  const homepage = '<a href="https://www.yeonje.go.kr/tour/contents.do?mId=0202050000" target="_blank" title="새창 : 홈페이지로 이동">https://www.yeonje.go.kr</a>';
  assert.deepEqual(parseCommon({ tel: '051-000-0000', homepage }), { tel: '051-000-0000', homepage: 'https://www.yeonje.go.kr/tour/contents.do?mId=0202050000' });
  assert.deepEqual(parseCommon({ tel: '', homepage: '' }), { tel: null, homepage: null });
  assert.equal(parseCommon({ homepage: '<a href="javascript:alert(1)">x</a>' }).homepage, null);
  assert.equal(parseCommon(undefined).homepage, null);
});

// ---------- 카카오 로컬 ----------
// 응답의 모양(필드 이름)은 실제 카카오 응답이고, 좌표·이름은 서울 값으로 바꾼 자료다.
test('parseKakaoPlaces: x=경도 y=위도, 지하철역은 거점, 음식점 구분, 지역 밖(부산)은 제외', () => {
  const body = JSON.stringify({
    documents: [
      { id: '8329752', place_name: '서울역', x: '126.97079', y: '37.55469', road_address_name: '서울 용산구 한강대로 405', category_group_code: '' },
      { id: '21160487', place_name: '서울역 1호선', x: '126.97236', y: '37.55589', address_name: '서울 중구 봉래동2가', category_group_code: 'SW8', phone: '1544-7788' },
      { id: '999', place_name: '부산역', x: '129.0415', y: '35.1152' },
      { id: '5', place_name: '식당', x: '126.98', y: '37.57', category_group_code: 'FD6' },
    ],
  });
  const places = parseKakaoPlaces(body);
  assert.equal(places.length, 3);
  assert.equal(places[0].id, 'kakao-8329752');
  assert.equal(places[0].lat, 37.55469);
  assert.equal(places[0].category, 'hub');
  assert.equal(places[0].phone, null); // 전화번호가 없으면 null
  assert.equal(places[1].phone, '1544-7788');
  assert.equal(places[2].category, 'restaurant');
});

// ---------- 카카오모빌리티 ----------
test('parseCarRoute: 실제 응답(부산역→해운대 1638초, 17152m)', () => {
  const body = JSON.stringify({ routes: [{ result_code: 0, result_msg: '길찾기 성공', summary: { distance: 17152, duration: 1638 } }] });
  assert.deepEqual(parseCarRoute(body), { minutes: 27, distanceKm: 17.2 });
});
test('parseCarRoute: 경로 없음(result_code ≠ 0)은 null', () => {
  assert.equal(parseCarRoute(JSON.stringify({ routes: [{ result_code: 104, result_msg: '출발지와 도착지가 너무 가깝습니다' }] })), null);
  assert.equal(parseCarRoute(JSON.stringify({})), null);
});

// ---------- Google 대중교통 ----------
test('parseTransitMatrix: 실제 응답 — 순서가 뒤섞여도 index로 맞추고, 같은 지점·경로 없음은 null', () => {
  const body = JSON.stringify([
    { originIndex: 1, destinationIndex: 0, status: {}, condition: 'ROUTE_NOT_FOUND' },
    { originIndex: 0, destinationIndex: 1, status: {}, distanceMeters: 9118, duration: '2850s', condition: 'ROUTE_EXISTS' },
    { originIndex: 0, destinationIndex: 0, status: {}, distanceMeters: 15535, duration: '2607s', condition: 'ROUTE_EXISTS' },
  ]);
  const { minutes, distanceKm } = parseTransitMatrix(body, 2);
  assert.equal(minutes[0][1], 48); // 2850초
  assert.equal(distanceKm[0][1], 9.1);
  assert.equal(minutes[1][0], null); // ROUTE_NOT_FOUND
  assert.equal(minutes[0][0], null); // 대각선은 쓰지 않음
});
test('parseTransitMatrix: 오류 응답은 이유별 오류로', () => {
  throwsCode(() => parseTransitMatrix(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }), 2), 'RATE_LIMIT');
  throwsCode(() => parseTransitMatrix(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), 2), 'NOT_CONFIGURED');
  throwsCode(() => parseTransitMatrix('not json', 2), 'UPSTREAM');
});
test('parseTransitRides: 실제 응답 — 탑승 40분(승·하차 시각 차), 배차 20분, 25개 정류장, 노선 색', () => {
  const body = JSON.stringify({
    routes: [{ legs: [{ steps: [
      { travelMode: 'WALK' },
      { travelMode: 'TRANSIT', transitDetails: {
        stopDetails: {
          arrivalStop: { name: '해운대해수욕장' }, departureStop: { name: '부산역' },
          arrivalTime: '2026-10-14T16:16:04Z', departureTime: '2026-10-14T15:35:58Z' },
        headway: '1200s',
        transitLine: { name: '부산 급행버스', nameShort: '1003(심야)', color: '#cf4900', textColor: '#ffffff', vehicle: { type: 'BUS' } },
        stopCount: 25 } },
      { travelMode: 'WALK' },
    ] }] }],
  });
  assert.deepEqual(parseTransitRides(body), [{
    vehicle: '버스', line: '1003(심야)', from: '부산역', to: '해운대해수욕장', stopCount: 25,
    boardAt: '2026-10-14T15:35:58Z', fromLoc: null, toLoc: null, rideMinutes: 40, headwayMinutes: 20, headwayEstimated: false,
    color: '#cf4900', textColor: '#ffffff',
  }]);
});
test('parseTransitRides: 환승이면 여러 개, 배차 간격이 없으면 null, 이상한 색은 버린다', () => {
  const ride = (type, short, headway, color) => ({ transitDetails: {
    stopDetails: { departureStop: { name: 'A' }, arrivalStop: { name: 'B' } },
    ...(headway ? { headway } : {}),
    transitLine: { nameShort: short, color, vehicle: { type } }, stopCount: 8 } });
  const rides = parseTransitRides(JSON.stringify({ routes: [{ legs: [{ steps: [
    ride('SUBWAY', '1호선', '300s', '#f06a00'), ride('BUS', '10', undefined, 'red; background:url(x)'),
  ] }] }] }));
  assert.equal(rides.length, 2);
  assert.equal(rides[0].vehicle, '지하철');
  assert.equal(rides[0].headwayMinutes, 5);
  assert.equal(rides[1].headwayMinutes, null);
  assert.equal(rides[1].color, null);
  assert.equal(rides[1].rideMinutes, null); // 시각 정보가 없으면 null
});
test('parseTransitRides: 도보뿐이면 빈 배열, 해석 불가면 null', () => {
  assert.deepEqual(parseTransitRides(JSON.stringify({ routes: [{ legs: [{ steps: [{ travelMode: 'WALK' }] }] }] })), []);
  assert.equal(parseTransitRides(JSON.stringify({})), null);
});

test('nextDepartureGapMinutes: 실제 응답(서울 4호선 승차 서울역) — 같은 노선 다음 차와의 시각 차이', () => {
  const ride = (line, from, boardAt) => ({ line, from, boardAt });
  const first = ride('4호선', '서울', '2026-10-18T01:07:00Z');
  assert.equal(nextDepartureGapMinutes([ride('4호선', '서울', '2026-10-18T01:12:00Z')], first), 5);
  // 다른 노선·다른 정류장은 믿지 않는다
  assert.equal(nextDepartureGapMinutes([ride('1호선', '서울', '2026-10-18T01:12:00Z')], first), null);
  assert.equal(nextDepartureGapMinutes([ride('4호선', '사당', '2026-10-18T01:12:00Z')], first), null);
  // 같은 차(0분)이거나 너무 멀면(60분 초과) 버린다
  assert.equal(nextDepartureGapMinutes([ride('4호선', '서울', '2026-10-18T01:07:00Z')], first), null);
  assert.equal(nextDepartureGapMinutes([ride('4호선', '서울', '2026-10-18T02:30:00Z')], first), null);
  assert.equal(nextDepartureGapMinutes([], first), null);
});

test('parseTransitRides: 승·하차 정류장 좌표를 뽑는다(환승 뒤 배차 간격 어림에 사용)', () => {
  const body = JSON.stringify({ routes: [{ legs: [{ steps: [{ transitDetails: {
    stopDetails: {
      departureStop: { name: '사당', location: { latLng: { latitude: 37.4768, longitude: 126.9817 } } },
      arrivalStop: { name: '강남', location: { latLng: { latitude: 37.49795, longitude: 127.027637 } } },
      departureTime: '2026-10-19T01:30:00Z', arrivalTime: '2026-10-19T01:39:00Z' },
    transitLine: { nameShort: '2호선', vehicle: { type: 'SUBWAY' } }, stopCount: 4 } }] }] }] });
  const [ride] = parseTransitRides(body);
  assert.deepEqual(ride.fromLoc, { lat: 37.4768, lng: 126.9817 });
  assert.deepEqual(ride.toLoc, { lat: 37.49795, lng: 127.027637 });
  assert.equal(ride.rideMinutes, 9);
});

test('kakaoCategory: 관광명소·문화시설은 여행지, 음식점·카페는 음식점, 나머지는 거점', () => {
  assert.equal(kakaoCategory('AT4'), 'attraction');
  assert.equal(kakaoCategory('CT1'), 'attraction');
  assert.equal(kakaoCategory('FD6'), 'restaurant');
  assert.equal(kakaoCategory('CE7'), 'restaurant');
  for (const other of ['SW8', 'AD5', 'HP8', '', undefined]) assert.equal(kakaoCategory(other), 'hub');
});

const place = (name, lat = 37.55, lng = 126.97) => ({ name, lat, lng });
test('rankPlaces: 검색어와 같은 이름 → 검색어로 시작 → 포함 → 나머지, 같은 점수는 원래 순서(실제 사례: "서울역")', () => {
  const ranked = rankPlaces(
    [place('서울역 옥상정원(The Roof)'), place('브릭샌드 서울역점'), place('서울역'), place('서울 1호선')],
    '서울역',
  ).map((p) => p.name);
  assert.deepEqual(ranked, ['서울역', '서울역 옥상정원(The Roof)', '브릭샌드 서울역점', '서울 1호선']);
});
test('rankPlaces: 같은 이름 둘이면 먼저 온 것(TourAPI)이 앞', () => {
  const a = { ...place('경복궁'), id: 'tour' };
  const b = { ...place('경복궁'), id: 'kakao' };
  assert.deepEqual(rankPlaces([a, b], '경복궁').map((p) => p.id), ['tour', 'kakao']);
});
test('dedupeSameName: 이름이 같고 500m 안이면 먼저 온 것만, 멀리 있거나 이름이 다르면 둘 다', () => {
  const a = { ...place('경복궁', 37.5796, 126.977), id: 'tour' };
  const near = { ...place('경복궁', 37.5800, 126.9772), id: 'kakao' };
  const far = { ...place('경복궁', 37.6500, 127.1), id: 'other' };
  const diff = { ...place('경복궁 주차장', 37.5797, 126.9771), id: 'parking' };
  assert.deepEqual(dedupeSameName([a, near, far, diff]).map((p) => p.id), ['tour', 'other', 'parking']);
});
