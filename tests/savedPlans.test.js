import test from 'node:test';
import assert from 'node:assert/strict';

import { savePlan, overwritePlan, loadPlan, deletePlan, listPlans, STORAGE_KEY, MAX_SAVED } from '../js/core/savedPlans.js';

// localStorage 흉내: 메모리에만 저장한다.
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    raw: (key = STORAGE_KEY) => data.get(key),
  };
}

const places = {
  O: { name: '서울역', lat: 37.5547, lng: 126.9707 },
  D: { name: '강남역', lat: 37.4979, lng: 127.0276 },
  A: { name: '경복궁', lat: 37.5796, lng: 126.977 },
  B: { name: '북촌한옥마을', lat: 37.5826, lng: 126.983 },
};
const plan = (date, stops = [{ placeId: 'A', stayMin: 60 }]) => ({
  mode: 'transit', date, originId: 'O', destinationId: 'D', startTime: '09:00', endTime: '21:00', stops,
});
const at = (minute) => new Date(Date.UTC(2026, 9, 17, 0, minute));

test('저장하고 불러오면 같은 일정', () => {
  const storage = fakeStorage();
  const saved = savePlan(storage, plan('2026-10-20'), places, at(0));
  assert.equal(saved.ok, true);
  assert.equal(saved.duplicate, false);
  const loaded = loadPlan(storage, saved.id);
  assert.equal(loaded.date, '2026-10-20');
  assert.deepEqual(loaded.stops, [{ placeId: 'A', stayMin: 60 }]);
  assert.equal(loaded.places.find((p) => p.id === 'A').name, '경복궁');
});

test('같은 날짜에 다른 일정을 저장하면 덮어쓰지 않고 둘 다 남는다', () => {
  const storage = fakeStorage();
  const first = savePlan(storage, plan('2026-10-20'), places, at(0));
  const second = savePlan(storage, plan('2026-10-20', [{ placeId: 'B', stayMin: 90 }]), places, at(1));
  assert.notEqual(first.id, second.id);
  const list = listPlans(storage);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((item) => item.stopNames), [['경복궁'], ['북촌한옥마을']]); // 같은 날짜는 저장한 순
  assert.equal(loadPlan(storage, first.id).stops[0].placeId, 'A');
  assert.equal(loadPlan(storage, second.id).stops[0].placeId, 'B');
});

test('내용이 똑같은 일정은 또 저장하지 않는다(duplicate)', () => {
  const storage = fakeStorage();
  const first = savePlan(storage, plan('2026-10-20'), places, at(0));
  const again = savePlan(storage, plan('2026-10-20'), places, at(5));
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
  assert.equal(listPlans(storage).length, 1);
});

test('overwritePlan: 저장해 둔 일정의 내용을 바꾼다(다른 일정은 그대로)', () => {
  const storage = fakeStorage();
  const a = savePlan(storage, plan('2026-10-20'), places, at(0));
  const b = savePlan(storage, plan('2026-10-20', [{ placeId: 'B', stayMin: 30 }]), places, at(1));
  assert.deepEqual(overwritePlan(storage, a.id, plan('2026-10-21', [{ placeId: 'A', stayMin: 45 }]), places, at(2)), { ok: true, found: true });
  assert.equal(loadPlan(storage, a.id).date, '2026-10-21');
  assert.equal(loadPlan(storage, a.id).stops[0].stayMin, 45);
  assert.equal(loadPlan(storage, b.id).stops[0].stayMin, 30);
  assert.deepEqual(overwritePlan(storage, 'nope', plan('2026-10-20'), places), { ok: false, found: false });
});

test('덮어써도 같은 날짜 안의 순서(처음 만든 순)는 바뀌지 않는다', () => {
  const storage = fakeStorage();
  const a = savePlan(storage, plan('2026-10-20'), places, at(0));
  const b = savePlan(storage, plan('2026-10-20', [{ placeId: 'B', stayMin: 30 }]), places, at(1));
  overwritePlan(storage, a.id, plan('2026-10-20', [{ placeId: 'A', stayMin: 90 }]), places, at(5));
  assert.deepEqual(listPlans(storage).map((item) => item.id), [a.id, b.id]);
});

test('목록은 날짜 순이고 제목·경유지 이름이 나온다', () => {
  const storage = fakeStorage();
  savePlan(storage, plan('2026-11-02'), places, at(0));
  savePlan(storage, plan('2026-10-20', []), places, at(1));
  const list = listPlans(storage);
  assert.deepEqual(list.map((item) => item.date), ['2026-10-20', '2026-11-02']);
  assert.equal(list[1].title, '서울역 → 강남역');
  assert.equal(list[1].stopCount, 1);
  assert.deepEqual(list[1].stopNames, ['경복궁']);
});

test('삭제는 그 일정만 지운다', () => {
  const storage = fakeStorage();
  const a = savePlan(storage, plan('2026-10-20'), places, at(0));
  const b = savePlan(storage, plan('2026-10-20', []), places, at(1));
  assert.equal(deletePlan(storage, a.id), true);
  assert.equal(loadPlan(storage, a.id), null);
  assert.notEqual(loadPlan(storage, b.id), null);
  assert.equal(deletePlan(storage, a.id), false); // 이미 없음
});

test(MAX_SAVED + '개를 넘으면 저장하지 않고 full: true', () => {
  const storage = fakeStorage();
  for (let i = 0; i < MAX_SAVED; i++) {
    assert.equal(savePlan(storage, plan('2026-10-20', [{ placeId: 'A', stayMin: i + 1 }]), places, at(i)).ok, true);
  }
  const over = savePlan(storage, plan('2026-10-20', [{ placeId: 'A', stayMin: 999 }]), places, at(99));
  assert.equal(over.ok, false);
  assert.equal(over.full, true);
});

test('예전 방식(날짜당 1개) 저장 내용을 새 방식으로 옮겨 온다', () => {
  const probe = fakeStorage(); // 올바른 인코딩 문자열을 얻으려고 새 방식으로 한 번 저장해 본다
  savePlan(probe, plan('2026-10-20'), places, at(0));
  const entry = JSON.parse(probe.raw())[0];
  const oldStore = fakeStorage({ 'itda.savedPlans.v1': JSON.stringify({ '2026-10-20': { encoded: entry.encoded, savedAt: entry.savedAt } }) });
  const list = listPlans(oldStore);
  assert.equal(list.length, 1);
  assert.equal(list[0].date, '2026-10-20');
  assert.equal(list[0].title, '서울역 → 강남역');
  assert.ok(oldStore.raw(), '새 방식으로 저장됨');
});

test('깨진 저장 내용은 빈 목록으로 보고, 깨진 항목만 건너뛴다', () => {
  assert.deepEqual(listPlans(fakeStorage({ [STORAGE_KEY]: '이건 JSON이 아님' })), []);
  assert.deepEqual(listPlans(fakeStorage({ [STORAGE_KEY]: '{"a":1}' })), []);
  const storage = fakeStorage();
  const good = savePlan(storage, plan('2026-10-20'), places, at(0));
  const all = JSON.parse(storage.raw());
  all.push({ id: 'bad', date: '2026-10-21', encoded: 'm=walk&oops', savedAt: null });
  all.push({ nonsense: true });
  storage.setItem(STORAGE_KEY, JSON.stringify(all));
  assert.deepEqual(listPlans(storage).map((item) => item.id), [good.id]);
  assert.equal(loadPlan(storage, 'bad'), null);
});

test('저장소가 막혀 있어도(시크릿 모드 등) 오류 없이 ok: false / 빈 목록', () => {
  const blocked = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(savePlan(blocked, plan('2026-10-20'), places).ok, false);
  assert.deepEqual(listPlans(blocked), []);
  assert.equal(loadPlan(blocked, 'x'), null);
});
