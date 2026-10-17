// 일정 저장. 브라우저의 localStorage에 저장하므로 서버·계정이 필요 없고, 그 대신 "이 브라우저에서만" 보인다.
// 다른 기기로 옮기려면 공유 링크를 쓴다. 저장 형식은 공유 링크와 같다(encodePlan) → 같은 검사 코드로 읽는다.
//
// 일정마다 고유 번호(id)가 있어서, 같은 날짜에도 여러 개를 저장할 수 있다.
// storage는 localStorage처럼 getItem / setItem을 가진 것. 직접 넘겨 받아서 테스트에서는 가짜 저장소를 쓴다.
import { encodePlan, decodePlan } from './share.js';

export const STORAGE_KEY = 'itda.savedPlans.v2';
const OLD_STORAGE_KEY = 'itda.savedPlans.v1'; // 예전 방식(날짜당 1개). 처음 읽을 때 새 방식으로 옮긴다.
export const MAX_SAVED = 50; // 브라우저 저장 공간을 지키려는 상한

function newId(now) {
  return now.getTime().toString(36) + Math.random().toString(36).slice(2, 6);
}

const isEntry = (entry) =>
  entry && typeof entry.id === 'string' && typeof entry.date === 'string' && typeof entry.encoded === 'string';

function writeAll(storage, entries) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false; // 저장 공간이 가득 찼거나 막혀 있음
  }
}

// 저장소 읽기. 비어 있거나 깨졌거나 접근이 막혀(시크릿 모드 등) 있으면 빈 목록으로 본다.
function readAll(storage) {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (text !== null) {
      const data = JSON.parse(text);
      return Array.isArray(data) ? data.filter(isEntry) : [];
    }
    // 새 방식 데이터가 아직 없으면 예전 데이터({ 날짜: { encoded, savedAt } })를 옮겨 온다.
    const old = JSON.parse(storage.getItem(OLD_STORAGE_KEY) ?? '{}');
    if (!old || typeof old !== 'object' || Array.isArray(old)) return [];
    const moved = Object.keys(old)
      .map((date) => ({ id: 'old-' + date, date, encoded: old[date]?.encoded, savedAt: old[date]?.savedAt ?? null, createdAt: old[date]?.savedAt ?? null }))
      .filter(isEntry);
    if (moved.length > 0) writeAll(storage, moved);
    return moved;
  } catch {
    return [];
  }
}

// 새 일정으로 저장한다. 같은 날짜에 이미 있어도 덮어쓰지 않고 하나 더 만든다.
// 내용이 똑같은 일정이 이미 있으면 새로 만들지 않는다(duplicate).
// → { ok, id, duplicate, full }
export function savePlan(storage, plan, places, now = new Date()) {
  const entries = readAll(storage);
  const encoded = encodePlan(plan, places);
  const same = entries.find((entry) => entry.encoded === encoded);
  if (same) return { ok: true, id: same.id, duplicate: true, full: false };
  if (entries.length >= MAX_SAVED) return { ok: false, id: null, duplicate: false, full: true };

  const id = newId(now);
  entries.push({ id, date: plan.date, encoded, savedAt: now.toISOString(), createdAt: now.toISOString() });
  return { ok: writeAll(storage, entries), id, duplicate: false, full: false };
}

// 저장해 둔 일정(id)의 내용을 지금 일정으로 바꾼다(날짜도 바뀔 수 있음). → { ok, found }
export function overwritePlan(storage, id, plan, places, now = new Date()) {
  const entries = readAll(storage);
  const entry = entries.find((item) => item.id === id);
  if (!entry) return { ok: false, found: false };
  entry.date = plan.date;
  entry.encoded = encodePlan(plan, places);
  entry.savedAt = now.toISOString();
  return { ok: writeAll(storage, entries), found: true };
}

// 저장한 일정을 불러온다. 없거나 깨졌으면 null.
export function loadPlan(storage, id) {
  const entry = readAll(storage).find((item) => item.id === id);
  return entry ? decodePlan(entry.encoded) : null;
}

export function deletePlan(storage, id) {
  const entries = readAll(storage);
  const rest = entries.filter((entry) => entry.id !== id);
  if (rest.length === entries.length) return false;
  return writeAll(storage, rest);
}

// 목록: 날짜 순(같은 날짜는 처음 만든 순 — 덮어써도 자리가 바뀌지 않는다). 깨진 항목은 건너뛴다.
// → [{ id, date, title, stopNames, stopCount, savedAt }]
export function listPlans(storage) {
  return readAll(storage)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt ?? a.savedAt).localeCompare(String(b.createdAt ?? b.savedAt)))
    .map((entry) => {
      const plan = decodePlan(entry.encoded);
      if (!plan) return null;
      const nameOf = (id) => plan.places.find((place) => place.id === id)?.name ?? id;
      return {
        id: entry.id,
        date: entry.date,
        title: nameOf(plan.originId) + ' → ' + nameOf(plan.destinationId),
        stopNames: plan.stops.map((stop) => nameOf(stop.placeId)),
        stopCount: plan.stops.length,
        savedAt: entry.savedAt ?? null,
      };
    })
    .filter(Boolean);
}
