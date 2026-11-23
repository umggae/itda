// 경계값 검증: "허용되는 가장 끝 값"과 "거부되는 바로 다음 값"을 한 쌍씩 확인한다.
// 검증 기록(README)의 "경계" 근거로 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePlan, buildTimetable, MAX_STOPS, MAX_STAY_MINUTES } from '../js/core/schedule.js';
import { parseWhen, parseQuery, parsePoints, MAX_POINTS } from '../server/lib/validate.js';
import { ApiError } from '../server/lib/errors.js';

const base = () => ({ mode: 'transit', originId: 'O', destinationId: 'D', startTime: '09:00', endTime: '21:00', stops: [{ placeId: 'A', stayMin: 60 }] });
const stopsN = (n) => Array.from({ length: n }, (_, i) => ({ placeId: 'P' + i, stayMin: 30 }));
const ok = (plan) => validatePlan(plan).length === 0;
const rejects = (fn, code) => assert.throws(fn, (e) => e instanceof ApiError && e.code === code);

test('경계: 체류시간 1분·720분은 허용, 0분·721분은 거부', () => {
  for (const m of [1, MAX_STAY_MINUTES]) assert.ok(ok({ ...base(), stops: [{ placeId: 'A', stayMin: m }] }), m + '분');
  for (const m of [0, MAX_STAY_MINUTES + 1]) assert.ok(!ok({ ...base(), stops: [{ placeId: 'A', stayMin: m }] }), m + '분');
});

test('경계: 경유지 0곳·1곳·6곳은 허용, 7곳은 거부', () => {
  for (const n of [0, 1, MAX_STOPS]) assert.ok(ok({ ...base(), stops: stopsN(n) }), n + '곳');
  assert.ok(!ok({ ...base(), stops: stopsN(MAX_STOPS + 1) }));
});

test('경계: 시작 시각이 종료 시각보다 1분 빠르면 허용, 같으면 거부', () => {
  assert.ok(ok({ ...base(), startTime: '09:00', endTime: '09:01' }));
  assert.ok(!ok({ ...base(), startTime: '09:00', endTime: '09:00' }));
  assert.ok(ok({ ...base(), startTime: '00:00', endTime: '23:59' }));
  assert.ok(!ok({ ...base(), startTime: '09:00', endTime: '24:00' })); // 24:00은 시각이 아님
});

test('경계: 도착이 종료 시각보다 1분 빠르거나 정확히 같으면 가능, 1분 늦으면 불가능', () => {
  // 09:00 출발 + 이동 30분 + 체류 60분 + 이동 30분 = 11:00 도착
  const legs = { 'O>A': 30, 'A>D': 30 };
  const run = (endTime) =>
    buildTimetable({ route: ['O', 'A', 'D'], stays: { A: 60 }, startTime: '09:00', endTime, legMinutes: (a, b) => legs[a + '>' + b] ?? null });
  assert.equal(run('11:01').feasible, true);
  assert.equal(run('11:00').feasible, true);
  const late = run('10:59');
  assert.equal(late.feasible, false);
  assert.equal(late.overMinutes, 1);
});

test('경계: 출발지=도착지는 경유지가 있으면(왕복) 허용, 없으면 거부', () => {
  assert.ok(ok({ ...base(), destinationId: 'O' }));
  assert.ok(!ok({ ...base(), destinationId: 'O', stops: [] }));
});

test('경계: 경유지가 출발지·도착지와 같은 장소면 거부(안내 문구에 이유가 있음)', () => {
  const sameAsOrigin = validatePlan({ ...base(), stops: [{ placeId: 'O', stayMin: 30 }] });
  assert.equal(sameAsOrigin.length, 1);
  assert.match(sameAsOrigin[0].message, /출발지와 같은 장소/);
  const sameAsDest = validatePlan({ ...base(), stops: [{ placeId: 'D', stayMin: 30 }] });
  assert.match(sameAsDest[0].message, /도착지와 같은 장소/);
});

test('경계: 대중교통 날짜는 6일 전·99일 뒤까지 허용, 7일 전·100일 뒤는 거부', () => {
  const now = new Date('2026-11-18T03:00:00Z'); // 한국시간 2026-11-18 12:00
  for (const date of ['2026-11-12', '2027-02-25']) assert.doesNotThrow(() => parseWhen(date, '12:00', now), date);
  for (const date of ['2026-11-11', '2027-02-26']) rejects(() => parseWhen(date, '12:00', now), 'DATE_RANGE');
});

test('경계: 검색어는 1~30글자, 좌표는 2~' + MAX_POINTS + '곳', () => {
  for (const n of [1, 30]) assert.doesNotThrow(() => parseQuery('가'.repeat(n)));
  for (const n of [0, 31]) rejects(() => parseQuery('가'.repeat(n)), 'BAD_REQUEST');
  for (const n of [2, MAX_POINTS]) assert.doesNotThrow(() => parsePoints(Array(n).fill('37.5,127.0').join(';')));
  for (const n of [1, MAX_POINTS + 1]) rejects(() => parsePoints(Array(n).fill('37.5,127.0').join(';')), 'BAD_REQUEST');
});

test('경계: 자정을 넘기는 일정은 종료 시각 초과로 계산된다', () => {
  const legs = { 'O>A': 30, 'A>D': 30 };
  const r = buildTimetable({ route: ['O', 'A', 'D'], stays: { A: 300 }, startTime: '22:00', endTime: '23:59', legMinutes: (a, b) => legs[a + '>' + b] ?? null });
  assert.equal(r.finishAt, 22 * 60 + 30 + 300 + 30); // 다음 날 04:00
  assert.equal(r.feasible, false);
});
