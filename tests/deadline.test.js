import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePlan, buildTimetable } from '../js/core/schedule.js';
import { encodePlan, decodePlan } from '../js/core/share.js';
import { savePlan, loadPlan } from '../js/core/savedPlans.js';

// 도착 마감 시각은 선택이다. endTime: null = 마감 없음.
const plan = (endTime = null) => ({
  mode: 'transit', date: '2026-12-08', originId: 'O', destinationId: 'D', startTime: '09:00', endTime,
  stops: [{ placeId: 'A', stayMin: 60 }],
});
const places = { O: { name: '출발', lat: 37.5, lng: 127 }, A: { name: '경유', lat: 37.51, lng: 127.01 }, D: { name: '도착', lat: 37.52, lng: 127.02 } };
const run = (endTime, extra = {}) =>
  buildTimetable({ route: ['O', 'A', 'D'], stays: { A: 60 }, startTime: '09:00', endTime, legMinutes: () => 30, ...extra });

test('마감 없음: 입력 검사를 통과한다', () => {
  assert.deepEqual(validatePlan(plan(null)), []);
});
test('마감 없음: 21시 이후에 출발해도 입력 오류가 아니다', () => {
  assert.deepEqual(validatePlan({ ...plan(null), startTime: '23:00' }), []);
});
test('마감을 설정하고 시각을 비우면 입력 오류', () => {
  assert.ok(validatePlan(plan('')).some((e) => e.field === 'endTime'));
});
test('마감 없음: 가능/불가능을 판정하지 않고 도착 시각과 이동시간은 계산한다', () => {
  const result = run(null);
  assert.equal(result.feasible, null);
  assert.equal(result.overMinutes, 0);
  assert.equal(result.problemLegIndex, null);
  assert.equal(result.finishAt, 11 * 60);
  assert.equal(result.totalTravel, 60);
});
test('마감 없음: 자정을 넘겨도 문제 구간으로 표시하지 않는다', () => {
  const result = buildTimetable({ route: ['O', 'A', 'D'], stays: { A: 300 }, startTime: '22:00', endTime: null, legMinutes: () => 30 });
  assert.equal(result.finishAt, 28 * 60);
  assert.equal(result.feasible, null);
  assert.equal(result.problemLegIndex, null);
});
test('공유 링크: 마감이 없으면 t를 넣지 않고, 풀면 다시 null', () => {
  const encoded = encodePlan(plan(null), places);
  assert.equal(new URLSearchParams(encoded).has('t'), false);
  assert.equal(decodePlan('#' + encoded).endTime, null);
});
test('공유 링크: 마감이 있던 링크는 그대로 마감이 있는 일정으로 열린다', () => {
  assert.equal(decodePlan(encodePlan(plan('21:00'), places)).endTime, '21:00');
});
test('공유 링크: t가 있는데 비었거나 틀리면 null', () => {
  const params = new URLSearchParams(encodePlan(plan('21:00'), places));
  for (const bad of ['', '99:00', 'null']) {
    params.set('t', bad);
    assert.equal(decodePlan(params.toString()), null, 't=' + bad);
  }
});
test('저장: 마감 없는 일정도 저장했다가 그대로 불러온다', () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
  const { id } = savePlan(storage, plan(null), places);
  assert.equal(loadPlan(storage, id).endTime, null);
});
test('마감 있음: 판정은 전과 같다', () => {
  assert.equal(run('11:00').feasible, true);
  assert.equal(run('10:59').feasible, false);
  assert.equal(run('10:59').overMinutes, 1);
});
