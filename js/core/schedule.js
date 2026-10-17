// 일정 계산 로직. 모두 "순수 함수"다.
// 순수 함수 = 같은 입력이면 항상 같은 결과를 내고, 화면·네트워크·데이터 파일을 건드리지 않는다.
// 그래서 데이터가 목업이든 JSON이든 서버든 이 파일은 바뀌지 않는다.

import { parseTime } from './time.js';

export const MAX_STOPS = 6;
export const MAX_STAY_MINUTES = 720;

// 체류시간 기본값: 음식점 30분, 그 외 1시간.
export function defaultStayMinutes(category) {
  return category === 'restaurant' ? 30 : 60;
}

// 입력 검사. 문제가 없으면 빈 배열, 있으면 [{ field, message }].
// plan = { mode, originId, destinationId, startTime, endTime, stops: [{ placeId, stayMin }] }
export function validatePlan(plan) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  if (plan.mode !== 'transit' && plan.mode !== 'car') {
    add('mode', '이동수단을 대중교통 또는 자동차 중에서 선택해 주세요.');
  }
  if (!plan.originId) {
    add('origin', '출발지가 없습니다. 거점 목록에서 출발지를 선택해 주세요.');
  }
  if (!plan.destinationId) {
    add('destination', '도착지가 없습니다. 거점 목록에서 도착지를 선택해 주세요.');
  }

  const start = parseTime(plan.startTime);
  const end = parseTime(plan.endTime);
  if (start === null) add('startTime', '시작 시각을 "09:00"처럼 입력해 주세요.');
  if (end === null) add('endTime', '종료 시각을 "21:00"처럼 입력해 주세요.');
  if (start !== null && end !== null && start >= end) {
    add('endTime', '시작 시각이 종료 시각보다 늦거나 같습니다. 종료 시각을 시작보다 뒤로 바꿔 주세요.');
  }

  const stops = plan.stops ?? [];
  if (stops.length === 0) {
    add('stops', '들를 장소가 0곳입니다. 장소를 한 곳 이상 추가해 주세요.');
  }
  if (stops.length > MAX_STOPS) {
    add('stops', '장소는 하루 최대 ' + MAX_STOPS + '곳까지 추가할 수 있습니다. 일부를 빼 주세요.');
  }
  const seen = new Set();
  stops.forEach((stop, index) => {
    const label = (index + 1) + '번째 장소';
    if (seen.has(stop.placeId)) add('stops', label + '가 이미 추가한 장소와 같습니다. 중복을 빼 주세요.');
    seen.add(stop.placeId);
    const stay = stop.stayMin;
    if (typeof stay !== 'number' || !Number.isInteger(stay) || stay < 1 || stay > MAX_STAY_MINUTES) {
      add('stay-' + index, label + '의 체류시간은 1~' + MAX_STAY_MINUTES + ' 사이의 숫자(분)로 입력해 주세요.');
    }
  });

  return errors;
}

// 시간표 계산.
// route: 장소 id 순서 [출발지, 장소1, 장소2, ..., 도착지]
// stays: 장소별 체류시간(분). { 장소id: 분 }  (출발지·도착지는 체류 없음)
// legMinutes: 함수 (fromId, toId) => 이동 분. 정보가 없으면 null
export function buildTimetable({ route, stays, startTime, endTime, legMinutes }) {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const rows = [{ id: route[0], arrive: null, depart: start }];
  const legs = [];
  let clock = start;
  let problemLegIndex = null;

  for (let i = 0; i < route.length - 1; i++) {
    const from = route[i];
    const to = route[i + 1];
    const minutes = legMinutes(from, to);
    if (minutes === null || minutes === undefined) {
      return { error: 'missing-leg', from, to };
    }
    const departAt = clock;
    const arriveAt = departAt + minutes;
    legs.push({ from, to, minutes, departAt, arriveAt });
    if (problemLegIndex === null && arriveAt > end) problemLegIndex = i;

    const isLast = i === route.length - 2;
    if (isLast) {
      rows.push({ id: to, arrive: arriveAt, depart: null });
      clock = arriveAt;
    } else {
      const stay = stays[to] ?? 0;
      rows.push({ id: to, arrive: arriveAt, depart: arriveAt + stay });
      clock = arriveAt + stay;
    }
  }

  const overMinutes = Math.max(0, clock - end);
  return {
    rows,
    legs,
    finishAt: clock,
    feasible: overMinutes === 0,
    overMinutes,
    problemLegIndex,
    totalTravel: legs.reduce((sum, leg) => sum + leg.minutes, 0),
  };
}

// 배열의 모든 순열(순서 바꾸기)을 만든다. 6개면 720가지라 다 계산해도 충분하다.
export function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const result = [];
  items.forEach((item, index) => {
    const rest = items.filter((_, i) => i !== index);
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  });
  return result;
}

// 총 이동시간. 정보가 없는 구간이 있으면 null.
export function totalTravelMinutes(route, legMinutes) {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const minutes = legMinutes(route[i], route[i + 1]);
    if (minutes === null || minutes === undefined) return null;
    total += minutes;
  }
  return total;
}

// 순서 제안. 출발지·도착지는 고정하고 중간 장소 순서만 바꿔 총 이동시간이 가장 짧은 순서를 찾는다.
// 현재 순서보다 더 짧을 때만 improved: true.
export function suggestBetterOrder({ originId, destinationId, stopIds, legMinutes }) {
  const currentRoute = [originId, ...stopIds, destinationId];
  const currentTravel = totalTravelMinutes(currentRoute, legMinutes);
  if (currentTravel === null) return { improved: false, reason: 'missing-leg' };

  let bestOrder = stopIds;
  let bestTravel = currentTravel;
  for (const order of permutations(stopIds)) {
    const travel = totalTravelMinutes([originId, ...order, destinationId], legMinutes);
    // 같은 시간이면 현재 순서를 유지하려고 "더 짧을 때만" 바꾼다.
    if (travel !== null && travel < bestTravel) {
      bestTravel = travel;
      bestOrder = order;
    }
  }

  return {
    improved: bestTravel < currentTravel,
    bestOrder,
    currentTravel,
    bestTravel,
    savedMinutes: currentTravel - bestTravel,
  };
}
