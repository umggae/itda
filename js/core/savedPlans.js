// 날짜별 일정 저장. 브라우저의 localStorage에 저장하므로 서버·계정이 필요 없고, 그 대신 "이 브라우저에서만" 보인다.
// 다른 기기로 옮기려면 공유 링크를 쓴다. 저장 형식은 공유 링크와 같다(encodePlan) → 같은 검사 코드로 읽는다.
//
// storage는 localStorage처럼 getItem / setItem을 가진 것. 직접 넘겨 받아서 테스트에서는 가짜 저장소를 쓴다.
import { encodePlan, decodePlan } from './share.js';

export const STORAGE_KEY = 'itda.savedPlans.v1';

// 저장소 읽기. 비어 있거나 깨졌거나 접근이 막혀(시크릿 모드 등) 있으면 빈 목록으로 본다.
function readAll(storage) {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeAll(storage, data) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // 저장 공간이 가득 찼거나 막혀 있음
  }
}

// 날짜(plan.date) 하나에 일정 하나를 저장한다. 같은 날짜가 있으면 덮어쓴다.
// → { ok, replaced }
export function savePlan(storage, plan, places, now = new Date()) {
  const all = readAll(storage);
  const replaced = Object.hasOwn(all, plan.date);
  all[plan.date] = { encoded: encodePlan(plan, places), savedAt: now.toISOString() };
  return { ok: writeAll(storage, all), replaced };
}

// 저장한 일정을 불러온다. 없거나 깨졌으면 null.
export function loadPlan(storage, date) {
  const entry = readAll(storage)[date];
  return typeof entry?.encoded === 'string' ? decodePlan(entry.encoded) : null;
}

export function deletePlan(storage, date) {
  const all = readAll(storage);
  if (!Object.hasOwn(all, date)) return false;
  delete all[date];
  return writeAll(storage, all);
}

// 목록: 날짜 순. 깨진 항목은 건너뛴다. → [{ date, title, stopCount, savedAt }]
export function listPlans(storage) {
  const all = readAll(storage);
  return Object.keys(all)
    .sort()
    .map((date) => {
      const plan = loadPlan(storage, date);
      if (!plan) return null;
      const nameOf = (id) => plan.places.find((place) => place.id === id)?.name ?? id;
      return {
        date,
        title: nameOf(plan.originId) + ' → ' + nameOf(plan.destinationId),
        stopCount: plan.stops.length,
        savedAt: all[date].savedAt ?? null,
      };
    })
    .filter(Boolean);
}
