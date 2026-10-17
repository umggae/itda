import test from 'node:test';
import assert from 'node:assert/strict';

import { savePlan, loadPlan, deletePlan, listPlans, STORAGE_KEY } from '../js/core/savedPlans.js';

// localStorage 흉내: 메모리에만 저장한다.
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    raw: () => data.get(STORAGE_KEY),
  };
}

const places = {
  O: { name: '서울역', lat: 37.5547, lng: 126.9707 },
  D: { name: '강남역', lat: 37.4979, lng: 127.0276 },
  A: { name: '경복궁', lat: 37.5796, lng: 126.977 },
};
const plan = (date, stops = [{ placeId: 'A', stayMin: 60 }]) => ({
  mode: 'transit', date, originId: 'O', destinationId: 'D', startTime: '09:00', endTime: '21:00', stops,
});

test('저장하고 불러오면 같은 일정', () => {
  const storage = fakeStorage();
  assert.deepEqual(savePlan(storage, plan('2026-10-20'), places), { ok: true, replaced: false });
  const loaded = loadPlan(storage, '2026-10-20');
  assert.equal(loaded.date, '2026-10-20');
  assert.deepEqual(loaded.stops, [{ placeId: 'A', stayMin: 60 }]);
  assert.equal(loaded.places.find((p) => p.id === 'A').name, '경복궁');
});

test('같은 날짜에 저장하면 덮어쓰고 replaced: true', () => {
  const storage = fakeStorage();
  savePlan(storage, plan('2026-10-20'), places);
  const result = savePlan(storage, plan('2026-10-20', []), places);
  assert.equal(result.replaced, true);
  assert.equal(loadPlan(storage, '2026-10-20').stops.length, 0);
  assert.equal(listPlans(storage).length, 1);
});

test('목록은 날짜 순이고 제목·경유지 수가 나온다', () => {
  const storage = fakeStorage();
  savePlan(storage, plan('2026-11-02'), places);
  savePlan(storage, plan('2026-10-20', []), places);
  const list = listPlans(storage);
  assert.deepEqual(list.map((item) => item.date), ['2026-10-20', '2026-11-02']);
  assert.equal(list[1].title, '서울역 → 강남역');
  assert.equal(list[1].stopCount, 1);
});

test('삭제', () => {
  const storage = fakeStorage();
  savePlan(storage, plan('2026-10-20'), places);
  assert.equal(deletePlan(storage, '2026-10-20'), true);
  assert.equal(loadPlan(storage, '2026-10-20'), null);
  assert.equal(deletePlan(storage, '2026-10-20'), false); // 이미 없음
});

test('깨진 저장 내용은 빈 목록으로 보고, 깨진 항목만 건너뛴다', () => {
  assert.deepEqual(listPlans(fakeStorage({ [STORAGE_KEY]: '이건 JSON이 아님' })), []);
  assert.deepEqual(listPlans(fakeStorage({ [STORAGE_KEY]: '[1,2]' })), []);
  const storage = fakeStorage();
  savePlan(storage, plan('2026-10-20'), places);
  const all = JSON.parse(storage.raw());
  all['2026-10-21'] = { encoded: 'm=walk&oops' };
  storage.setItem(STORAGE_KEY, JSON.stringify(all));
  assert.deepEqual(listPlans(storage).map((item) => item.date), ['2026-10-20']);
  assert.equal(loadPlan(storage, '2026-10-21'), null);
});

test('저장소가 막혀 있어도(시크릿 모드 등) 오류 없이 ok: false / 빈 목록', () => {
  const blocked = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(savePlan(blocked, plan('2026-10-20'), places).ok, false);
  assert.deepEqual(listPlans(blocked), []);
  assert.equal(loadPlan(blocked, '2026-10-20'), null);
});
