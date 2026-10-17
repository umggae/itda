// 실행: npm test   (Node 내장 테스트 도구 node:test 사용, 별도 설치 없음)
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTime, formatTime, formatDuration } from '../js/core/time.js';
import {
  defaultStayMinutes,
  validatePlan,
  buildTimetable,
  permutations,
  suggestBetterOrder,
} from '../js/core/schedule.js';
import { mockProvider } from '../js/data/mockProvider.js';

// 테스트용 이동시간표: A→B 30분, 그 외는 지정한 값. 없으면 null.
const table = (obj) => (from, to) => obj[from + '>' + to] ?? null;

const goodPlan = () => ({
  mode: 'transit',
  originId: 'O',
  destinationId: 'D',
  startTime: '09:00',
  endTime: '21:00',
  stops: [{ placeId: 'A', stayMin: 60 }],
});

// ---------- 시각 ----------
test('parseTime: 정상 시각은 분으로 바뀐다', () => {
  assert.equal(parseTime('09:30'), 570);
  assert.equal(parseTime('0:05'), 5);
});
test('parseTime: 잘못된 형식은 null', () => {
  for (const bad of ['', 'abc', '24:00', '12:60', '9', null, undefined]) {
    assert.equal(parseTime(bad), null, String(bad));
  }
});
test('formatTime / formatDuration', () => {
  assert.equal(formatTime(570), '09:30');
  assert.equal(formatTime(25 * 60 + 10), '25:10');
  assert.equal(formatDuration(45), '45분');
  assert.equal(formatDuration(120), '2시간');
  assert.equal(formatDuration(80), '1시간 20분');
});

// ---------- 기본 체류시간 ----------
test('defaultStayMinutes: 음식점 30분, 그 외 60분', () => {
  assert.equal(defaultStayMinutes('restaurant'), 30);
  assert.equal(defaultStayMinutes('attraction'), 60);
});

// ---------- 입력 검사 ----------
test('validatePlan: 올바른 입력은 오류 없음', () => {
  assert.deepEqual(validatePlan(goodPlan()), []);
});
test('validatePlan: 장소 0곳', () => {
  const errors = validatePlan({ ...goodPlan(), stops: [] });
  assert.ok(errors.some((e) => e.field === 'stops'));
});
test('validatePlan: 장소 7곳은 초과', () => {
  const stops = Array.from({ length: 7 }, (_, i) => ({ placeId: 'P' + i, stayMin: 30 }));
  assert.ok(validatePlan({ ...goodPlan(), stops }).some((e) => e.field === 'stops'));
});
test('validatePlan: 시작 시각이 종료 시각보다 늦음', () => {
  const errors = validatePlan({ ...goodPlan(), startTime: '22:00', endTime: '21:00' });
  assert.ok(errors.some((e) => e.field === 'endTime'));
});
test('validatePlan: 출발지·도착지 없음', () => {
  const errors = validatePlan({ ...goodPlan(), originId: '', destinationId: null });
  assert.ok(errors.some((e) => e.field === 'origin'));
  assert.ok(errors.some((e) => e.field === 'destination'));
});
test('validatePlan: 체류시간이 숫자가 아니거나 범위 밖', () => {
  for (const bad of ['abc', NaN, 0, -5, 1.5, 9999, undefined]) {
    const errors = validatePlan({ ...goodPlan(), stops: [{ placeId: 'A', stayMin: bad }] });
    assert.ok(errors.some((e) => e.field === 'stay-0'), String(bad));
  }
});
test('validatePlan: 같은 장소 중복', () => {
  const stops = [
    { placeId: 'A', stayMin: 30 },
    { placeId: 'A', stayMin: 30 },
  ];
  assert.ok(validatePlan({ ...goodPlan(), stops }).some((e) => e.field === 'stops'));
});
test('validatePlan: 이동수단이 이상하면 오류', () => {
  assert.ok(validatePlan({ ...goodPlan(), mode: 'walk' }).some((e) => e.field === 'mode'));
});

// ---------- 시간표 ----------
const legs = table({ 'O>A': 30, 'A>B': 20, 'B>D': 40, 'O>B': 50, 'A>D': 10, 'B>A': 20 });

test('buildTimetable: 도착·출발 시각을 순서대로 계산한다', () => {
  const result = buildTimetable({
    route: ['O', 'A', 'B', 'D'],
    stays: { A: 60, B: 30 },
    startTime: '09:00',
    endTime: '21:00',
    legMinutes: legs,
  });
  const [o, a, b, d] = result.rows;
  assert.equal(o.depart, 540); // 09:00
  assert.equal(a.arrive, 570); // 09:30
  assert.equal(a.depart, 630); // 10:30
  assert.equal(b.arrive, 650); // 10:50
  assert.equal(b.depart, 680); // 11:20
  assert.equal(d.arrive, 720); // 12:00
  assert.equal(result.totalTravel, 90);
  assert.equal(result.feasible, true);
  assert.equal(result.overMinutes, 0);
  assert.equal(result.problemLegIndex, null);
});

test('buildTimetable: 종료 시각을 넘기면 불가능 + 초과 시간 + 문제 구간', () => {
  const result = buildTimetable({
    route: ['O', 'A', 'B', 'D'],
    stays: { A: 60, B: 30 },
    startTime: '09:00',
    endTime: '11:30', // 도착 12:00 → 30분 초과
    legMinutes: legs,
  });
  assert.equal(result.feasible, false);
  assert.equal(result.overMinutes, 30);
  // 마지막 구간(B→D)에서 처음으로 종료 시각을 넘는다
  assert.equal(result.problemLegIndex, 2);
});

test('buildTimetable: 정확히 종료 시각에 도착하면 가능', () => {
  const result = buildTimetable({
    route: ['O', 'A', 'B', 'D'],
    stays: { A: 60, B: 30 },
    startTime: '09:00',
    endTime: '12:00',
    legMinutes: legs,
  });
  assert.equal(result.feasible, true);
});

test('buildTimetable: 이동시간 정보가 없는 구간은 오류로 알린다', () => {
  const result = buildTimetable({
    route: ['O', 'X', 'D'],
    stays: { X: 30 },
    startTime: '09:00',
    endTime: '21:00',
    legMinutes: legs,
  });
  assert.equal(result.error, 'missing-leg');
  assert.equal(result.from, 'O');
  assert.equal(result.to, 'X');
});

// ---------- 순열 ----------
test('permutations: 개수는 n!', () => {
  assert.equal(permutations([]).length, 1);
  assert.equal(permutations([1]).length, 1);
  assert.equal(permutations([1, 2, 3]).length, 6);
  assert.equal(permutations([1, 2, 3, 4, 5, 6]).length, 720);
});
test('permutations: 중복 없이 모두 다르다', () => {
  const keys = permutations(['a', 'b', 'c', 'd']).map((p) => p.join(''));
  assert.equal(new Set(keys).size, 24);
});

// ---------- 순서 제안 ----------
test('suggestBetterOrder: 더 짧은 순서가 있으면 줄어드는 시간과 함께 제안', () => {
  // O→B→A→D = 50+20+10 = 80,  O→A→B→D = 30+20+40 = 90
  const result = suggestBetterOrder({
    originId: 'O',
    destinationId: 'D',
    stopIds: ['A', 'B'],
    legMinutes: legs,
  });
  assert.equal(result.improved, true);
  assert.deepEqual(result.bestOrder, ['B', 'A']);
  assert.equal(result.currentTravel, 90);
  assert.equal(result.bestTravel, 80);
  assert.equal(result.savedMinutes, 10);
});

test('suggestBetterOrder: 이미 가장 짧으면 제안하지 않는다', () => {
  const result = suggestBetterOrder({
    originId: 'O',
    destinationId: 'D',
    stopIds: ['B', 'A'],
    legMinutes: legs,
  });
  assert.equal(result.improved, false);
  assert.equal(result.savedMinutes, 0);
});

test('suggestBetterOrder: 시간이 같으면 현재 순서를 유지한다', () => {
  const same = () => 10; // 어떤 순서든 같은 시간
  const result = suggestBetterOrder({
    originId: 'O',
    destinationId: 'D',
    stopIds: ['A', 'B', 'C'],
    legMinutes: same,
  });
  assert.equal(result.improved, false);
  assert.deepEqual(result.bestOrder, ['A', 'B', 'C']);
});

test('suggestBetterOrder: 출발지·도착지는 고정(결과 순서에 들어가지 않는다)', () => {
  const result = suggestBetterOrder({
    originId: 'O',
    destinationId: 'D',
    stopIds: ['A', 'B'],
    legMinutes: legs,
  });
  assert.ok(!result.bestOrder.includes('O'));
  assert.ok(!result.bestOrder.includes('D'));
});

test('suggestBetterOrder: 정보 없는 구간은 건너뛰고 계산한다', () => {
  // B→A 정보를 없애면 O→B→A→D 순서는 계산 불가 → 현재 순서 유지
  const partial = table({ 'O>A': 30, 'A>B': 20, 'B>D': 40, 'O>B': 50, 'A>D': 10 });
  const result = suggestBetterOrder({
    originId: 'O',
    destinationId: 'D',
    stopIds: ['A', 'B'],
    legMinutes: partial,
  });
  assert.equal(result.improved, false);
});

// ---------- MockProvider (인터페이스가 약속대로 동작하는지) ----------
test('mockProvider.searchPlaces: 이름으로 검색, 빈 검색어는 빈 배열', async () => {
  const found = await mockProvider.searchPlaces('경복');
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'p-gyeongbok');
  assert.deepEqual(await mockProvider.searchPlaces(''), []);
  assert.deepEqual(await mockProvider.searchPlaces('없는장소'), []);
});
test('mockProvider.getLeg: 자동차가 대중교통보다 빠르고, 같은 입력은 같은 결과', async () => {
  const transit = await mockProvider.getLeg('hub-seoul-station', 'p-bukchon', 'transit');
  const car = await mockProvider.getLeg('hub-seoul-station', 'p-bukchon', 'car');
  assert.ok(car.minutes < transit.minutes);
  assert.deepEqual(await mockProvider.getLeg('hub-seoul-station', 'p-bukchon', 'car'), car);
  assert.equal(typeof transit.distanceKm, 'number');
  assert.equal(typeof transit.summary, 'string');
});
test('mockProvider.getLeg: 모르는 장소나 같은 장소는 null', async () => {
  assert.equal(await mockProvider.getLeg('nope', 'p-bukchon', 'car'), null);
  assert.equal(await mockProvider.getLeg('p-bukchon', 'p-bukchon', 'car'), null);
});
test('mockProvider.getPlaceDetail: 정보가 없어도 같은 모양을 돌려준다', async () => {
  const detail = await mockProvider.getPlaceDetail('p-namsan');
  assert.deepEqual(Object.keys(detail).sort(), ['closedDays', 'contact', 'homepage', 'hours', 'parking', 'reservation']);
});
