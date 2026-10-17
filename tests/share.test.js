import test from 'node:test';
import assert from 'node:assert/strict';

import { encodePlan, decodePlan } from '../js/core/share.js';
import { kakaoRouteUrl } from '../js/core/mapLinks.js';
import { mockProvider } from '../js/data/mockProvider.js';

const plan = () => ({
  mode: 'transit',
  date: '2026-10-20',
  originId: 'hub-seoul-station',
  destinationId: 'hub-gangnam',
  startTime: '09:00',
  endTime: '21:00',
  stops: [
    { placeId: 'p-gyeongbok', stayMin: 60 },
    { placeId: 'r-seolleongtang', stayMin: 30 },
  ],
});

const places = () => ({
  'hub-seoul-station': { name: '서울역', lat: 37.5547, lng: 126.9707 },
  'hub-gangnam': { name: '강남역', lat: 37.4979, lng: 127.0276 },
  'p-gyeongbok': { name: '경복궁', lat: 37.5796, lng: 126.977 },
  'r-seolleongtang': { name: '설렁탕집, 본점~', lat: 37.5705, lng: 126.9855 }, // 쉼표·물결표가 들어간 이름
});
const placeList = () =>
  Object.entries(places()).map(([id, p]) => ({ id, ...p, name: p.name.replace(/[,~]/g, ' ').trim() }));

test('공유 링크: 담았다가 풀면 같은 일정과 장소', () => {
  const decoded = decodePlan('#' + encodePlan(plan(), places()));
  const { places: decodedPlaces, ...rest } = decoded;
  assert.deepEqual(rest, plan());
  assert.deepEqual(
    [...decodedPlaces].sort((a, b) => a.id.localeCompare(b.id)),
    placeList().sort((a, b) => a.id.localeCompare(b.id)),
  );
});
test('공유 링크: 장소가 없어도 왕복한다', () => {
  const empty = { ...plan(), stops: [] };
  assert.equal(decodePlan(encodePlan(empty, places())).stops.length, 0);
});
test('공유 링크: 개인정보 항목(이름 등)이 없다 — 장소 정보(l)만 추가로 담긴다', () => {
  const keys = [...new URLSearchParams(encodePlan(plan(), places())).keys()].sort();
  assert.deepEqual(keys, ['d', 'e', 'l', 'm', 'o', 'p', 's', 't']);
});
test('공유 링크: 일정에 나오는 장소가 l에 없으면 null', () => {
  const good = encodePlan(plan(), places());
  const params = new URLSearchParams(good);
  params.set('l', params.get('l').split(',').slice(1).join(','));
  assert.equal(decodePlan(params.toString()), null);
});
test('공유 링크: 좌표·이름이 이상하면 null', () => {
  const params = new URLSearchParams(encodePlan(plan(), places()));
  assert.equal(decodePlan(new URLSearchParams({ ...Object.fromEntries(params), l: params.get('l').replace('37.5547', '99') }).toString()), null);
});
test('공유 링크: 고쳐진·깨진 주소는 null', () => {
  const good = encodePlan(plan(), places());
  assert.equal(decodePlan(''), null);
  assert.equal(decodePlan('#abc'), null);
  assert.equal(decodePlan(good.replace('m=transit', 'm=walk')), null);
  assert.equal(decodePlan(good.replace('s=09', 's=99')), null);
  assert.equal(decodePlan(good.replace('p-gyeongbok', '<script>')), null);
  assert.equal(decodePlan(good.replace('2026-10-20', 'tomorrow')), null);
});
test('공유 링크: 체류시간이 이상하거나 장소가 7곳이면 null', () => {
  const bad = { ...plan(), stops: [{ placeId: 'a', stayMin: 0 }] };
  assert.equal(decodePlan(encodePlan(bad, { ...places(), a: { name: 'a', lat: 35, lng: 129 } })), null);
  const many = { ...plan(), stops: Array.from({ length: 7 }, (_, i) => ({ placeId: 'p' + i, stayMin: 30 })) };
  assert.equal(decodePlan(encodePlan(many, { ...places(), ...Object.fromEntries(many.stops.map((x) => [x.placeId, { name: 'x', lat: 35, lng: 129 }])) })), null);
});

test('카카오맵 링크: 공식 형식(대중교통은 traffic, 자동차는 car, 위도→경도)', () => {
  const a = { name: '서울역', lat: 37.5547, lng: 126.9707 };
  const b = { name: '남산서울타워', lat: 37.5512, lng: 126.9882 };
  assert.equal(
    kakaoRouteUrl('transit', a, b),
    'https://map.kakao.com/link/by/traffic/' +
      encodeURIComponent('서울역') + ',37.5547,126.9707/' +
      encodeURIComponent('남산서울타워') + ',37.5512,126.9882',
  );
  assert.ok(kakaoRouteUrl('car', a, b).includes('/link/by/car/'));
});
test('카카오맵 링크: 이름의 쉼표·슬래시는 주소를 깨지 않게 뺀다', () => {
  const url = kakaoRouteUrl('car', { name: 'A,B/C', lat: 1, lng: 2 }, { name: 'D', lat: 3, lng: 4 });
  assert.equal(url.split('/').length, 'https://map.kakao.com/link/by/car/X,1,2/D,3,4'.split('/').length);
});

test('mockProvider.getMeta / getMatrix', async () => {
  assert.equal(typeof (await mockProvider.getMeta()).source, 'string');
  const places = await mockProvider.searchPlaces('서울역');
  const more = await mockProvider.searchPlaces('강남역');
  const table = await mockProvider.getMatrix({ places: [...places, ...more], mode: 'car' });
  assert.equal(table.size, 2); // 2곳 → 순서 있는 쌍 2개
  assert.ok(table.get('hub-seoul-station>hub-gangnam').minutes > 0);
});
