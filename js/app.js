// 화면 담당. 데이터는 provider(config.js)에서만 받고, 계산은 core/ 의 순수 함수에 맡긴다.

import { provider } from './config.js';
import { formatTime, formatDuration } from './core/time.js';
import {
  MAX_STOPS,
  defaultStayMinutes,
  validatePlan,
  buildTimetable,
  suggestBetterOrder,
} from './core/schedule.js';
import { encodePlan, decodePlan } from './core/share.js';
import { kakaoRouteUrl } from './core/mapLinks.js';
import { savePlan, overwritePlan, loadPlan, deletePlan, listPlans, MAX_SAVED } from './core/savedPlans.js';
import { attachAutocomplete } from './ui/autocomplete.js';
import { REGION } from './core/region.js';

const $ = (id) => document.getElementById(id);

// DOM 요소 만들기 도우미: el('p', { class: 'hint' }, '글자')
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) node.append(child);
  return node;
}

// 화면이 기억하는 값. stops의 stayText는 사용자가 친 글자 그대로(숫자인지 검사하려고).
const state = {
  places: {}, // id → 장소 (이름·좌표를 보여 주려고 한 번 본 장소를 모아 둔다)
  stops: [], // [{ placeId, stayText }]
  lastCheck: null, // 마지막 검사의 입력(plan)
  editingId: null, // 불러온(또는 방금 저장한) 일정의 번호
};

let map = null;
let mapLayer = null;

function todayText() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function setStatus(message) {
  $('status').textContent = message;
}

function nameOf(id) {
  return state.places[id]?.name ?? id;
}

function remember(places) {
  for (const place of places) state.places[place.id] = place;
}

// ---------- 폼 읽기 ----------
function parseStay(text) {
  const trimmed = String(text).trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
}

function readPlan() {
  return {
    mode: document.querySelector('input[name="mode"]:checked')?.value ?? '',
    date: $('date').value || todayText(),
    originId: $('origin').value,
    destinationId: $('destination').value,
    startTime: $('start').value,
    endTime: $('end').value,
    stops: state.stops.map((stop) => ({ placeId: stop.placeId, stayMin: parseStay(stop.stayText) })),
  };
}

function fillForm(plan) {
  $('date').value = plan.date;
  document.querySelector('input[name="mode"][value="' + plan.mode + '"]').checked = true;
  setPlaceOption('origin', state.places[plan.originId]);
  setPlaceOption('destination', state.places[plan.destinationId]);
  $('start').value = plan.startTime;
  $('end').value = plan.endTime;
  state.stops = plan.stops.map((stop) => ({ placeId: stop.placeId, stayText: String(stop.stayMin) }));
  renderStops();
}

// ---------- 오류 표시 ----------
const FIELD_TARGET = {
  mode: 'mode',
  origin: 'origin',
  destination: 'destination',
  startTime: 'start',
  endTime: 'end',
  stops: 'place-query',
};

function targetId(field) {
  return field.startsWith('stay-') ? field : FIELD_TARGET[field];
}

function showErrors(errors) {
  const box = $('errors');
  box.replaceChildren();
  document.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
  if (errors.length === 0) {
    box.hidden = true;
    return;
  }
  const list = el('ul');
  for (const error of errors) {
    const id = targetId(error.field);
    list.append(el('li', {}, el('a', { href: '#' + id, 'data-focus': id }, error.message)));
    $(id)?.setAttribute('aria-invalid', 'true');
  }
  box.append(el('strong', {}, '입력을 확인해 주세요 (' + errors.length + '건)'), list);
  box.hidden = false;
  setStatus('입력에 문제가 ' + errors.length + '건 있습니다. 안내에 따라 고친 뒤 다시 검사해 주세요.');
}

// 오류 링크를 누르면 해당 입력칸으로 초점을 옮긴다.
$('errors').addEventListener('click', (event) => {
  const link = event.target.closest('a[data-focus]');
  if (!link) return;
  event.preventDefault();
  const target = $(link.dataset.focus);
  const focusable = target.matches('fieldset') ? target.querySelector('input') : target;
  focusable?.focus();
});

function showAppError(message, retry) {
  const box = $('app-error');
  box.replaceChildren(el('strong', {}, '문제가 생겼습니다'), el('p', {}, message));
  if (retry) {
    const button = el('button', { type: 'button' }, '다시 시도');
    button.addEventListener('click', retry);
    box.append(button);
  }
  box.hidden = false;
}

function hideAppError() {
  $('app-error').hidden = true;
}

// 데이터 공급자 오류 → 사용자에게 "이유와 할 일"을 알려 주는 문장.
function explainError(error) {
  switch (error?.code) {
    case 'NETWORK':
      return { message: '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.', retry: true };
    case 'RATE_LIMIT':
      return { message: '지도·교통 서비스의 호출 한도를 잠시 넘었습니다. 몇 분 기다렸다가 다시 시도해 주세요. 같은 일정은 잠시 저장되어 더 빨리 처리됩니다.', retry: true };
    case 'NOT_CONFIGURED':
      return { message: '서비스 설정에 문제가 있어 데이터를 가져오지 못했습니다. 제 쪽 문제이니 제작자에게 알려 주세요. 시간을 두고 다시 시도해 볼 수도 있습니다.', retry: true };
    case 'DATE_RANGE':
      return { message: '대중교통 이동시간은 오늘 기준 약 6일 전부터 99일 뒤까지의 날짜만 조회할 수 있습니다. 날짜를 바꿔 주세요.', retry: false };
    case 'UPSTREAM':
      return { message: '외부 지도·교통 서비스가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.', retry: true };
    case 'BAD_REQUEST':
      return { message: error.message + ' 입력을 확인해 주세요.', retry: false };
    default:
      return { message: '알 수 없는 오류가 생겼습니다. 잠시 뒤 다시 시도해 주세요.', retry: true };
  }
}

function failWith(error, retry) {
  console.error(error);
  setStatus('');
  const { message, retry: canRetry } = explainError(error);
  showAppError(message, canRetry ? retry : null);
  if (error?.code === 'DATE_RANGE') $('date').focus();
}

const KIND_LABEL = { attraction: '여행지', restaurant: '음식점', hub: '거점·기타' };

function placeLabel(place) {
  return place.name + (place.address ? ' · ' + place.address : '');
}

// 출발지·도착지 선택칸에 장소를 넣고 선택한다.
function setPlaceOption(role, place) {
  const select = $(role);
  if (![...select.options].some((option) => option.value === place.id)) {
    select.append(el('option', { value: place.id }, placeLabel(place)));
  }
  select.value = place.id;
  updateMap();
}

// 출발지·도착지 검색: 결과를 선택칸에 채우고 첫 번째를 선택해 둔다.
async function searchInto(role) {
  const label = role === 'origin' ? '출발지' : '도착지';
  const query = $(role + '-query').value.trim();
  if (query === '') {
    setStatus(label + '로 검색할 이름을 입력해 주세요.');
    $(role + '-query').focus();
    return;
  }
  hideAppError();
  setStatus(label + ' "' + query + '" 검색 중입니다…');
  try {
    const found = await provider.searchPlaces(query);
    remember(found);
    if (found.length === 0) {
      setStatus('"' + query + '"에 맞는 장소가 없습니다. 다른 이름(예: 역 이름, 동네 이름)으로 검색해 보세요.');
      return;
    }
    const select = $(role);
    select.replaceChildren(...found.map((place) => el('option', { value: place.id }, placeLabel(place) + ' (' + KIND_LABEL[place.category] + ')')));
    select.value = found[0].id;
    select.removeAttribute('aria-invalid');
    updateMap();
    setStatus(label + ' 검색 결과 ' + found.length + '곳. 첫 번째 "' + found[0].name + '"을(를) 선택했습니다. 다르면 목록에서 바꿔 주세요.');
  } catch (error) {
    failWith(error, () => searchInto(role));
  }
}

// ---------- 장소 검색 ----------
async function doSearch() {
  const query = $('place-query').value.trim();
  const list = $('search-results');
  list.replaceChildren();
  if (query === '') {
    setStatus('검색할 장소 이름을 입력해 주세요.');
    $('place-query').focus();
    return;
  }
  setStatus('"' + query + '" 검색 중입니다…');
  try {
    const found = await provider.searchPlaces(query);
    remember(found);
    if (found.length === 0) {
      list.append(el('li', {}, '"' + query + '"에 맞는 장소가 없습니다. 다른 이름이나 더 짧은 글자로 검색해 보세요.'));
      setStatus('검색 결과가 없습니다.');
      return;
    }
    for (const place of found) {
      const add = el('button', { type: 'button', 'aria-label': place.name + ' 추가' }, '추가');
      add.addEventListener('click', () => addStop(place));
      list.append(
        el(
          'li',
          {},
          el('span', {}, place.name + ' ', el('span', { class: 'tag' }, '(' + KIND_LABEL[place.category] + (place.address ? ' · ' + place.address : '') + ')')),
          add,
        ),
      );
    }
    setStatus(
      '검색 결과 ' + found.length + '곳. 원하는 장소의 "추가"를 눌러 주세요.' +
        (found.partial ? ' (일부 출처의 조회가 실패해 결과가 적을 수 있습니다.)' : ''),
    );
  } catch (error) {
    failWith(error, doSearch);
  }
}

// 경유지 추가가 막혔을 때의 안내. 맨 위 안내줄은 아래쪽에서 작업하면 안 보이므로 검색칸 바로 아래에도 보여 준다.
function showStopNote(message) {
  $('stops-note').textContent = message;
  $('stops-note').hidden = message === '';
  if (message) setStatus(message);
}

function addStop(place) {
  if (state.stops.length >= MAX_STOPS) {
    showStopNote('경유지는 하루 최대 ' + MAX_STOPS + '곳까지입니다. 목록에서 하나를 빼고 추가해 주세요.');
    return;
  }
  if (state.stops.some((stop) => stop.placeId === place.id)) {
    showStopNote(place.name + '은(는) 이미 추가했습니다. 다른 장소를 골라 주세요.');
    return;
  }
  showStopNote('');
  state.places[place.id] = place;
  state.stops.push({ placeId: place.id, stayText: String(defaultStayMinutes(place.category)) });
  renderStops();
  setStatus(place.name + ' 추가됨. 현재 ' + state.stops.length + '곳입니다.');
}

// ---------- 선택한 장소 목록 ----------
function renderStops(focusTarget) {
  const list = $('stops');
  list.replaceChildren();
  $('stops-empty').hidden = state.stops.length > 0;
  updateMap();

  state.stops.forEach((stop, index) => {
    const name = nameOf(stop.placeId);
    const stayId = 'stay-' + index;

    const up = el('button', { type: 'button', 'aria-label': name + ' 위로 이동', 'data-act': 'up' }, '▲');
    const down = el('button', { type: 'button', 'aria-label': name + ' 아래로 이동', 'data-act': 'down' }, '▼');
    const remove = el('button', { type: 'button', 'aria-label': name + ' 삭제', 'data-act': 'remove' }, '삭제');
    up.disabled = index === 0;
    down.disabled = index === state.stops.length - 1;

    up.addEventListener('click', () => moveStop(index, -1, 'up'));
    down.addEventListener('click', () => moveStop(index, 1, 'down'));
    remove.addEventListener('click', () => removeStop(index));

    const stay = el('input', { id: stayId, type: 'text', inputmode: 'numeric', value: stop.stayText });
    stay.addEventListener('input', () => {
      stop.stayText = stay.value;
      stay.removeAttribute('aria-invalid');
    });

    const controls = el(
      'div',
      { class: 'stop-controls' },
      el('div', { class: 'stay-field' }, el('label', { for: stayId }, '체류시간(분)'), stay),
      up,
      down,
      remove,
    );
    const label = el('span', { class: 'stop-name' }, el('span', { class: 'sr-only' }, '경유지 ' + (index + 1) + ': '), name);
    const dot = el('span', { class: 'dot dot-stop', 'aria-hidden': 'true' }, String(index + 1));
    list.append(el('li', { 'data-id': stop.placeId }, dot, el('div', { class: 'stop-body' }, label, controls)));
  });

  if (focusTarget) {
    // 순서를 바꾼 뒤에도 키보드 초점이 같은 장소의 같은 버튼에 남게 한다.
    const item = list.querySelector('li[data-id="' + focusTarget.placeId + '"]');
    const button = item?.querySelector('[data-act="' + focusTarget.act + '"]:not(:disabled)');
    (button ?? item?.querySelector('button:not(:disabled)'))?.focus();
  }
}

function moveStop(index, delta, act) {
  const target = index + delta;
  if (target < 0 || target >= state.stops.length) return;
  const moved = state.stops[index];
  [state.stops[index], state.stops[target]] = [state.stops[target], state.stops[index]];
  renderStops({ placeId: moved.placeId, act });
  setStatus(nameOf(moved.placeId) + '을(를) ' + (target + 1) + '번째로 옮겼습니다.');
}

function removeStop(index) {
  const [removed] = state.stops.splice(index, 1);
  showStopNote(''); // 자리가 났으니 막힘 안내는 지운다
  renderStops();
  setStatus(nameOf(removed.placeId) + '을(를) 뺐습니다. 현재 ' + state.stops.length + '곳입니다.');
  $('place-query').focus();
}

// ---------- 일정 검사 ----------
// 장소 전체의 이동시간표를 공급자에게 한 번에 받는다. 대중교통은 날짜·시작 시각 기준이다.
function fetchLegs(ids, plan) {
  const places = [...new Set(ids)].map((id) => state.places[id]);
  return provider.getMatrix({ places, mode: plan.mode, date: plan.date, time: plan.startTime });
}

// 시간표에 나오는 구간의 탑승 정보(노선·탑승 시간·배차 간격)를 받아 붙인다.
// 경유 일정은 시각이 조금씩 달라지므로 "정확히 몇 시 차"가 아니라 탑승 시간과 배차 간격을 보여 주는 것이 목적이다.
// 못 받아도 이동시간표의 기본 문구가 남으므로 실패는 무시한다.
async function addLegRides(plan, timetable, legInfo) {
  if (!provider.getLegRides) return;
  await Promise.all(
    timetable.legs.map(async (leg) => {
      if (leg.departAt >= 24 * 60) return; // 자정을 넘기면 조회하지 않음
      try {
        const rides = await provider.getLegRides({
          from: state.places[leg.from],
          to: state.places[leg.to],
          mode: plan.mode,
          date: plan.date,
          time: formatTime(leg.departAt),
        });
        if (rides) legInfo(leg.from, leg.to).rides = rides;
      } catch (error) {
        console.error(error);
      }
    }),
  );
}

async function runCheck() {
  hideAppError();
  const plan = readPlan();
  const errors = validatePlan(plan);
  showErrors(errors);
  $('result').hidden = true;
  if (errors.length > 0) {
    document.querySelector('#errors a')?.focus();
    return;
  }

  setStatus('이동시간을 계산하는 중입니다…');
  $('check-btn').disabled = true;
  try {
    const stopIds = plan.stops.map((stop) => stop.placeId);
    const route = [plan.originId, ...stopIds, plan.destinationId];
    const legTable = await fetchLegs(route, plan);
    const legInfo = (from, to) => legTable.get(from + '>' + to) ?? null;
    const legMinutes = (from, to) => legInfo(from, to)?.minutes ?? null;
    const stays = Object.fromEntries(plan.stops.map((stop) => [stop.placeId, stop.stayMin]));

    const timetable = buildTimetable({
      route,
      stays,
      startTime: plan.startTime,
      endTime: plan.endTime,
      legMinutes,
    });
    if (timetable.error) {
      showAppError(
        nameOf(timetable.from) + '에서 ' + nameOf(timetable.to) + '까지 가는 경로를 찾지 못했습니다. ' +
          '섬이거나 ' + (plan.mode === 'transit' ? '대중교통이 닿지 않는' : '자동차 길이 없는') + ' 곳일 수 있습니다. ' +
          '해당 장소를 빼거나 다른 장소, 다른 이동수단으로 바꿔 보세요.',
      );
      setStatus('경로를 찾지 못해 검사하지 못했습니다.');
      return;
    }
    await addLegRides(plan, timetable, legInfo);

    const suggestion =
      stopIds.length >= 2
        ? suggestBetterOrder({ originId: plan.originId, destinationId: plan.destinationId, stopIds, legMinutes })
        : { improved: false };
    const details = await Promise.all(stopIds.map((id) => provider.getPlaceDetail(id)));

    state.lastCheck = plan;
    renderResult({ plan, route, timetable, legInfo, suggestion, details });
    $('result').hidden = false;
    setStatus(
      timetable.feasible
        ? '검사 완료: 일정이 가능합니다.'
        : '검사 완료: 일정이 불가능합니다. ' + formatDuration(timetable.overMinutes) + ' 초과입니다.',
    );
    $('result-title').scrollIntoView({ block: 'start' });
  } catch (error) {
    failWith(error, runCheck);
  } finally {
    $('check-btn').disabled = false;
  }
}

// ---------- 결과 그리기 ----------
function renderResult({ plan, route, timetable, legInfo, suggestion, details }) {
  // 가능 여부
  const verdict = $('verdict');
  verdict.replaceChildren();
  if (timetable.feasible) {
    verdict.className = 'verdict ok';
    verdict.append(
      '가능합니다 — ' + formatTime(timetable.finishAt) + '에 도착지에 도착합니다.',
      el('small', {}, '종료 시각 ' + plan.endTime + ' 이전 · 총 이동 ' + formatDuration(timetable.totalTravel)),
    );
  } else {
    const problem = timetable.legs[timetable.problemLegIndex];
    verdict.className = 'verdict bad';
    verdict.append(
      '불가능합니다 — 종료 시각 ' + plan.endTime + '을(를) ' + formatDuration(timetable.overMinutes) + ' 넘깁니다.',
      el(
        'small',
        {},
        '처음 시간이 넘는 구간: ' + nameOf(problem.from) + ' → ' + nameOf(problem.to) +
          ' (도착 예정 ' + formatTime(problem.arriveAt) + '). 체류시간을 줄이거나 장소를 빼 보세요.',
      ),
    );
  }

  renderSuggestion(suggestion, plan);

  renderTimeline(plan, timetable, legInfo);

  // 가기 전 확인할 것
  const checklist = $('checklist');
  checklist.replaceChildren();
  const rows = [
    ['쉬는 날', 'closedDays'],
    ['이용·영업시간', 'hours'],
    ['주차', 'parking'],
    ['예약', 'reservation'],
    ['문의처', 'contact'],
  ];
  plan.stops.forEach((stop, i) => {
    checklist.append(renderChecklistItem(state.places[stop.placeId], details[i]));
  });

  updateMap();
  $('share-box').hidden = true;
}

// 일정 타임라인: 장소(점) — 구간 카드 — 장소 … 모양으로 그린다.
function renderTimeline(plan, timetable, legInfo) {
  const list = $('timeline');
  list.replaceChildren();
  const lastIndex = timetable.rows.length - 1;

  timetable.rows.forEach((row, i) => {
    const dot =
      i === 0
        ? el('span', { class: 'dot dot-origin', 'aria-hidden': 'true' }, '출')
        : i === lastIndex
          ? el('span', { class: 'dot dot-dest', 'aria-hidden': 'true' }, '도')
          : el('span', { class: 'dot dot-stop', 'aria-hidden': 'true' }, String(i));
    const times =
      i === 0
        ? formatTime(row.depart) + ' 출발'
        : i === lastIndex
          ? formatTime(row.arrive) + ' 도착'
          : formatTime(row.arrive) + ' 도착 · ' + formatTime(row.depart) + ' 출발 (체류 ' + formatDuration(row.depart - row.arrive) + ')';
    list.append(
      el('li', { class: 'node' }, dot, el('div', { class: 'node-name' }, nameOf(row.id)), el('div', { class: 'node-times' }, times)),
    );

    if (i < lastIndex) {
      const leg = timetable.legs[i];
      list.append(el('li', { class: 'leg' }, renderLegCard(plan, leg, legInfo(leg.from, leg.to), i === timetable.problemLegIndex)));
    }
  });
}

// 구간 카드: 굵은 소요시간, 거리, (대중교통) 노선 칩·탑승 시간·정류장 수·배차 간격, 길찾기 링크.
function renderLegCard(plan, leg, info, isProblem) {
  const from = state.places[leg.from];
  const to = state.places[leg.to];
  const card = el('div', { class: isProblem ? 'leg-card problem' : 'leg-card' });

  card.append(
    el(
      'div',
      {},
      el('strong', { class: 'leg-time' }, formatDuration(leg.minutes)),
      el('span', { class: 'leg-meta' }, ' · ' + info.distanceKm + 'km · ' + (plan.mode === 'car' ? '자동차' : '대중교통')),
    ),
  );

  if (plan.mode === 'transit' && Array.isArray(info.rides)) {
    if (info.rides.length === 0) {
      card.append(el('div', { class: 'leg-extra' }, '걸어서 이동하는 구간입니다.'));
    } else {
      const rides = el('ul', { class: 'rides' });
      for (const ride of info.rides) rides.append(renderRide(ride));
      card.append(rides);
      // 탑승 시간을 뺀 나머지는 걷기·환승·기다림이다.
      const known = info.rides.every((ride) => ride.rideMinutes !== null);
      if (known) {
        const rideTotal = info.rides.reduce((sum, ride) => sum + ride.rideMinutes, 0);
        if (leg.minutes >= rideTotal) {
          card.append(el('div', { class: 'leg-extra' }, '탑승 ' + formatDuration(rideTotal) + ' + 도보·환승·대기 ' + formatDuration(leg.minutes - rideTotal)));
        }
      }
    }
  } else {
    card.append(el('div', { class: 'leg-extra' }, info.summary));
  }

  if (isProblem) card.append(el('div', { class: 'badge-bad' }, '⚠ 이 구간에서 종료 시각을 넘깁니다'));
  card.append(
    el('a', { href: kakaoRouteUrl(plan.mode, from, to), target: '_blank', rel: 'noopener noreferrer' }, '카카오맵에서 길찾기 (새 창)'),
  );
  return card;
}

// 탑승 한 번: [노선 칩] 출발 → 도착 / 탑승 N분 · N개 정류장 · 배차 약 N분 간격
function renderRide(ride) {
  const chip = el('span', { class: 'chip' }, ride.vehicle + ' ' + ride.line);
  // 색은 서버가 #rrggbb 모양만 통과시킨 값이다. 없으면 기본색.
  chip.style.backgroundColor = ride.color ?? '#3050c8';
  chip.style.color = ride.textColor ?? '#ffffff';

  const unit = ride.vehicle === '버스' ? '정류장' : '역';
  const facts = el('div', { class: 'ride-facts' });
  facts.append(el('span', {}, ride.rideMinutes === null ? '탑승 시간 정보 없음' : el('strong', {}, '탑승 ' + formatDuration(ride.rideMinutes))));
  if (ride.stopCount !== null) facts.append(el('span', {}, ride.stopCount + '개 ' + unit));
  facts.append(
    el('span', {}, ride.headwayMinutes === null ? '배차 간격 정보 없음' : el('strong', {}, '배차 약 ' + formatDuration(ride.headwayMinutes) + ' 간격' + (ride.headwayEstimated ? '(추정)' : ''))),
  );

  return el('li', { class: 'ride' }, el('div', {}, chip, el('span', { class: 'ride-route' }, ride.from + ' → ' + ride.to)), facts);
}

// "가기 전 확인할 것" 한 곳. 정보는 한국관광공사(TourAPI)에 등록된 내용이라 비어 있는 항목이 있을 수 있다.
// 비어 있으면 "정보 없음"과 함께, 직접 확인할 수 있는 지도·검색 링크를 보여 준다.
function renderChecklistItem(place, detail) {
  const fromTour = place.id.startsWith('tour-');
  const rows = [
    ['쉬는 날', detail.closedDays],
    ['이용·영업시간', detail.hours],
    ['주차', detail.parking],
    ['예약', detail.reservation],
    ['문의처', detail.contact ?? place.phone ?? null], // 카카오 검색 결과의 전화번호도 쓴다
  ];
  const dl = el('dl');
  for (const [label, value] of rows) {
    dl.append(el('dt', {}, label), el('dd', {}, value ?? '정보 없음'));
  }

  const empty = rows.every(([, value]) => value === null);
  const source = fromTour
    ? empty
      ? '한국관광공사에 이 장소의 상세 정보가 등록되어 있지 않습니다.'
      : '출처: 한국관광공사. 등록되지 않은 항목은 "정보 없음"입니다.'
    : '카카오 검색으로 찾은 장소(역·터미널·숙소 등)라 쉬는 날·영업시간 정보가 없습니다.';

  const open = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  const links = el('p', { class: 'check-links' });
  const kakaoUrl = place.id.startsWith('kakao-')
    ? 'https://map.kakao.com/link/map/' + place.id.slice('kakao-'.length) // 카카오 장소 페이지
    : 'https://map.kakao.com/link/search/' + encodeURIComponent(place.name); // 이름으로 검색
  links.append(
    open(kakaoUrl, '카카오맵에서 보기'),
    open('https://search.naver.com/search.naver?query=' + encodeURIComponent(place.name + ' 영업시간'), '네이버에서 영업시간 검색'),
  );
  if (detail.homepage) links.prepend(open(detail.homepage, '공식 홈페이지'));

  return el('details', {}, el('summary', {}, place.name), dl, el('p', { class: 'hint' }, source), links);
}

function renderSuggestion(suggestion, plan) {
  const box = $('suggestion');
  box.replaceChildren();
  if (!suggestion.improved) return;

  const apply = el('button', { type: 'button' }, '이 순서로 적용');
  const keep = el('button', { type: 'button' }, '지금 순서 유지');
  apply.addEventListener('click', () => {
    const byId = new Map(state.stops.map((stop) => [stop.placeId, stop]));
    state.stops = suggestion.bestOrder.map((id) => byId.get(id));
    renderStops();
    runCheck();
  });
  keep.addEventListener('click', () => {
    box.replaceChildren();
    setStatus('지금 순서를 유지합니다.');
  });

  box.append(
    el(
      'div',
      { class: 'suggestion', role: 'group', 'aria-label': '더 효율적인 순서 제안' },
      el('strong', {}, '더 효율적인 순서가 있습니다 — 이동시간 ' + formatDuration(suggestion.savedMinutes) + ' 단축'),
      el('p', {}, suggestion.bestOrder.map(nameOf).join(' → ') + '  (총 이동 ' + formatDuration(suggestion.bestTravel) + ', 지금은 ' + formatDuration(suggestion.currentTravel) + ')'),
      el('p', { class: 'hint' }, '출발지와 도착지는 그대로 두고 중간 장소의 순서만 바꾼 것입니다.'),
      el('div', { class: 'actions' }, apply, keep),
    ),
  );
}

// ---------- 지도 ----------
// 지도는 처음부터 보이고, 출발지·경유지·도착지를 고를 때마다 핀이 바뀐다.
function pin(kind, text) {
  return L.divIcon({ className: '', html: '<div class="pin pin-' + kind + '">' + text + '</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
}

function ensureMap() {
  if (typeof L === 'undefined') {
    $('map').textContent = '지도를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요. (일정 검사는 지도 없이도 사용할 수 있습니다.)';
    return false;
  }
  if (!map) {
    map = L.map('map').setView(REGION.center, REGION.zoom); // 서비스 지역 중심
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }
  return true;
}

// 마지막으로 그린 핀들이 한 화면에 들어오게 지도를 맞춘다.
let lastPoints = [];
function fitMap() {
  if (!map) return;
  map.invalidateSize();
  if (lastPoints.length >= 2) map.fitBounds(lastPoints, { padding: [40, 40] });
  else if (lastPoints.length === 1) map.setView(lastPoints[0], 14);
  else map.setView(REGION.center, REGION.zoom);
}

// 지도 영역의 크기가 바뀌면(창 크기 조절, 휴대전화 회전, 숨겨져 있다가 나타남) 다시 맞춘다.
let resizeWatching = false;
function watchMapSize() {
  if (resizeWatching || typeof ResizeObserver === 'undefined') return;
  resizeWatching = true;
  new ResizeObserver(fitMap).observe($('map'));
}

// 지금 입력된 출발지 → 경유지 → 도착지를 지도에 그린다. (선택된 것만)
function updateMap() {
  if (!ensureMap()) return;
  if (mapLayer) mapLayer.remove();
  mapLayer = L.layerGroup().addTo(map);

  const entries = [];
  const origin = state.places[$('origin').value];
  const destination = state.places[$('destination').value];
  if (origin) entries.push({ place: origin, icon: pin('origin', '출') });
  state.stops.forEach((stop, i) => {
    const place = state.places[stop.placeId];
    if (place) entries.push({ place, icon: pin('stop', String(i + 1)) });
  });
  if (destination) entries.push({ place: destination, icon: pin('dest', '도') });

  const points = entries.map((entry) => [entry.place.lat, entry.place.lng]);
  entries.forEach((entry, i) => {
    L.marker(points[i], { icon: entry.icon, title: entry.place.name, keyboard: false }).addTo(mapLayer).bindPopup(entry.place.name);
  });
  if (points.length >= 2) L.polyline(points, { weight: 4, color: '#3050c8', opacity: 0.7, dashArray: '6 8' }).addTo(mapLayer);

  lastPoints = points;
  fitMap();
  watchMapSize();
}

// ---------- 공유 ----------
function makeShareLink() {
  if (!state.lastCheck) return;
  const url = location.origin + location.pathname + '#' + encodePlan(state.lastCheck, state.places);
  $('share-url').value = url;
  $('share-box').hidden = false;
  $('share-url').focus();
  $('share-url').select();
  setStatus('공유 링크를 만들었습니다. 복사해서 보내 주세요.');
}

async function copyShareLink() {
  const input = $('share-url');
  try {
    await navigator.clipboard.writeText(input.value);
    setStatus('링크를 복사했습니다.');
  } catch {
    input.focus();
    input.select();
    setStatus('자동 복사가 되지 않았습니다. 선택된 링크를 직접 복사해 주세요.');
  }
}

// ---------- 일정 저장 ----------
// 저장 장소는 이 브라우저의 localStorage. 막혀 있으면(시크릿 모드 등) 저장이 안 된다고 알려 준다.
// 일정마다 고유 번호가 있어서 같은 날짜에도 여러 개 저장할 수 있다.
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function dateLabel(date) {
  const day = new Date(date + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  return date.slice(0, 4) + '년 ' + day;
}

// 불러오거나 저장한 일정의 번호. 이 값이 있으면 "불러온 일정 덮어쓰기" 버튼이 나온다.
function setEditing(id) {
  state.editingId = id;
  $('update-btn').hidden = id === null;
}

function stopSummary(names) {
  if (names.length === 0) return '경유지 없음';
  return '경유: ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' 외 ' + (names.length - 3) + '곳' : '');
}

function renderSaved() {
  const list = $('saved-list');
  list.replaceChildren();
  const store = storage();
  const saved = store ? listPlans(store) : [];
  $('saved-empty').hidden = saved.length > 0;
  $('saved-count').textContent = String(saved.length);
  if (state.editingId !== null && !saved.some((item) => item.id === state.editingId)) setEditing(null); // 지워진 일정

  for (const item of saved) {
    const name = dateLabel(item.date) + ' ' + item.title;
    const load = el('button', { type: 'button', 'aria-label': name + ' 일정 불러오기' }, '불러오기');
    const remove = el('button', { type: 'button', 'aria-label': name + ' 일정 삭제' }, '삭제');
    load.addEventListener('click', () => loadSaved(item.id));
    remove.addEventListener('click', () => {
      if (!window.confirm(name + ' 일정을 삭제할까요? 되돌릴 수 없습니다.')) return;
      deletePlan(store, item.id);
      renderSaved();
      $('saved-status').textContent = name + ' 일정을 삭제했습니다.'; // 창 안의 안내(창이 열려 있는 동안 바깥 안내는 읽히지 않음)
      $('saved-close').focus();
    });
    const editing = item.id === state.editingId ? el('span', { class: 'badge-edit' }, ' 편집 중') : '';
    list.append(
      el(
        'li',
        {},
        el(
          'div',
          { class: 'saved-info' },
          el('strong', {}, dateLabel(item.date)),
          editing,
          el('div', {}, item.title),
          el('div', { class: 'tag' }, stopSummary(item.stopNames)),
        ),
        el('div', { class: 'saved-actions' }, load, remove),
      ),
    );
  }
}

// 입력 검사를 통과한 현재 일정을 돌려준다. 오류가 있으면 안내하고 null.
function planToSave() {
  const plan = readPlan();
  const errors = validatePlan(plan);
  showErrors(errors);
  if (errors.length > 0) {
    document.querySelector('#errors a')?.focus();
    setStatus('입력에 문제가 있어 저장하지 못했습니다. 안내에 따라 고친 뒤 다시 저장해 주세요.');
    return null;
  }
  return plan;
}

function showSaveProblem(result) {
  showAppError(
    result?.full
      ? '저장한 일정이 ' + MAX_SAVED + '개로 가득 찼습니다. "저장한 일정" 메뉴에서 쓰지 않는 일정을 삭제한 뒤 다시 저장해 주세요.'
      : '이 브라우저에서는 일정을 저장할 수 없습니다(시크릿 모드이거나 저장 공간이 막혀 있을 수 있습니다). 대신 "공유 링크 만들기"로 주소를 보관해 주세요.',
  );
}

// 지금 입력한 일정을 "새 일정"으로 저장한다. 같은 날짜가 있어도 덮어쓰지 않는다.
function saveCurrentPlan() {
  const plan = planToSave();
  if (!plan) return;
  const store = storage();
  const result = store ? savePlan(store, plan, state.places) : { ok: false };
  if (!result.ok) {
    showSaveProblem(result);
    return;
  }
  setEditing(result.id);
  renderSaved();
  setStatus(
    result.duplicate
      ? '똑같은 일정이 이미 저장되어 있습니다.'
      : dateLabel(plan.date) + ' 일정을 새로 저장했습니다. 위쪽 "저장한 일정" 메뉴에서 볼 수 있습니다.',
  );
}

// 불러온(또는 방금 저장한) 일정의 내용을 지금 입력한 내용으로 바꾼다.
function updateSavedPlan() {
  const plan = planToSave();
  if (!plan || state.editingId === null) return;
  const store = storage();
  const result = store ? overwritePlan(store, state.editingId, plan, state.places) : { ok: false };
  if (!result.ok) {
    if (result.found === false) {
      setEditing(null);
      setStatus('덮어쓸 일정을 찾지 못했습니다(이미 삭제됨). "새 일정으로 저장"을 눌러 주세요.');
    } else showSaveProblem(result);
    return;
  }
  renderSaved();
  setStatus('저장한 일정을 지금 내용으로 바꿨습니다(' + dateLabel(plan.date) + ').');
}

// 서랍 창 열기·닫기. 닫으면 브라우저가 열기 전에 있던 버튼으로 초점을 돌려 준다.
function openSaved() {
  renderSaved();
  $('saved-status').textContent = '';
  const dialog = $('saved-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', ''); // 아주 오래된 브라우저 대비
}

function closeSaved() {
  const dialog = $('saved-dialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function loadSaved(id) {
  const plan = storage() && loadPlan(storage(), id);
  if (!plan) {
    setStatus('저장된 일정을 읽지 못했습니다.');
    return;
  }
  closeSaved();
  remember(plan.places);
  fillForm(plan);
  setEditing(id);
  $('result').hidden = true;
  showErrors([]);
  setStatus(dateLabel(plan.date) + ' 일정을 불러왔습니다. "일정 검사하기"를 눌러 다시 확인하세요. 고쳐서 저장할 때는 "불러온 일정 덮어쓰기"나 "새 일정으로 저장"을 고르세요.');
  $('check-btn').focus();
}

// ---------- 시작 ----------
async function restoreFromHash() {
  if (!location.hash) return;
  const plan = decodePlan(location.hash);
  if (!plan) {
    setStatus('공유 링크의 내용을 읽지 못해 빈 입력으로 시작합니다.');
    return;
  }
  remember(plan.places); // 링크에 담긴 장소 이름·좌표
  fillForm(plan);
  await runCheck();
}

async function init() {
  hideAppError();
  setStatus('데이터를 불러오는 중입니다…');
  try {
    $('date').value = todayText();
    updateMap(); // 처음부터 서비스 지역 지도를 보여 준다
    renderSaved();

    const meta = await provider.getMeta();
    $('data-note').textContent =
      '데이터 출처: ' + meta.source + ' · ' + (meta.live ? '실시간 조회(갱신일 없음, 조회한 시점의 정보)' : '갱신일: ' + (meta.updatedAt ?? '해당 없음'));

    setStatus('');
    await restoreFromHash();
  } catch (error) {
    failWith(error, init);
  }
}

$('plan-form').addEventListener('submit', (event) => {
  event.preventDefault();
  runCheck();
});

// 검색칸 세 개(출발지·도착지·경유지)에 자동완성을 붙인다.
// 추천을 고르면 바로 반영하고, 검색 버튼·엔터는 전체 검색 결과를 보여 준다(그때 추천 목록은 닫힌다).
const searchPlacesAndRemember = async (query) => {
  const found = await provider.searchPlaces(query);
  remember(found);
  return found;
};
const announce = (message) => ($('ac-status').textContent = message);

const completers = {};
for (const role of ['origin', 'destination']) {
  const label = role === 'origin' ? '출발지' : '도착지';
  completers[role] = attachAutocomplete({
    input: $(role + '-query'),
    search: searchPlacesAndRemember,
    announce,
    onPick(place) {
      setPlaceOption(role, place);
      $(role + '-query').value = place.name;
      $(role).removeAttribute('aria-invalid');
      setStatus(label + '를 "' + place.name + '"(으)로 선택했습니다.');
    },
    onSubmit: () => searchInto(role),
  });
  $(role + '-search').addEventListener('click', () => {
    completers[role].close();
    searchInto(role);
  });
}
completers.stop = attachAutocomplete({
  input: $('place-query'),
  search: searchPlacesAndRemember,
  announce,
  onPick(place) {
    addStop(place);
    $('place-query').value = '';
    $('search-results').replaceChildren();
  },
  onSubmit: doSearch,
});
$('search-btn').addEventListener('click', () => {
  completers.stop.close();
  doSearch();
});
for (const role of ['origin', 'destination']) $(role).addEventListener('change', updateMap);
$('save-btn').addEventListener('click', saveCurrentPlan);
$('update-btn').addEventListener('click', updateSavedPlan);
$('menu-btn').addEventListener('click', openSaved);
$('saved-close').addEventListener('click', closeSaved);
// 어두운 배경(창 바깥)을 누르면 닫는다. 배경 클릭은 dialog 요소 자체가 target이 된다.
$('saved-dialog').addEventListener('click', (event) => {
  if (event.target === $('saved-dialog')) closeSaved();
});
$('share-btn').addEventListener('click', makeShareLink);
$('copy-btn').addEventListener('click', copyShareLink);

init();
