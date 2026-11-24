// 영업시간 판단. 모두 순수 함수다(화면·네트워크를 건드리지 않는다).
// 한국관광공사의 "이용시간"도 정해진 형식이 없는 자유 텍스트라서, 확실히 읽을 수 있는 모양만 읽고
// 나머지는 'unknown'(원문만 보여 주기)으로 둔다. 읽을 수 있는 모양:
//   - "09:00~18:00", "10:00~22:00 (마지막 주문 21:30)"  (한 구간 + 입장마감·마지막 주문)
//   - "상시 개방"
//   - "[3월~5월/9월~10월] 09:00~18:00 (입장마감 17:00)[6월~8월] …"  (달별)
//   - "[월요일~목요일/일요일] 10:00~21:00[금요일~토요일] …"  (요일별)
//   - "평일 10:00~22:30 주말 10:00~23:00"
// 구역별([주제원] …), 하절기·동절기, 브레이크타임, 점포·시설별 상이, 익일(밤 12시 넘김)은 판단하지 않는다.

import { parseYmd } from './closedDays.js';

const DAY_CHARS = '일월화수목금토';

const toMin = (h, m) => Number(h) * 60 + Number(m);

// 일요일(0)~토요일(6) 번호 목록. 끝이 시작보다 앞이면 한 바퀴 돈 것으로 본다(예: 수~일).
function weekdayRange(from, to) {
  const out = [];
  for (let d = from; ; d = (d + 1) % 7) {
    out.push(d);
    if (d === to) break;
  }
  return out;
}

function monthRange(from, to) {
  const out = [];
  for (let m = from; ; m = (m % 12) + 1) {
    out.push(m);
    if (m === to) break;
  }
  return out;
}

// "[…]" 안의 글자 → { months } 또는 { weekdays }. 구역 이름 같은 것이면 null.
function parseCondition(label) {
  const parts = label.split(/[/,·]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // 모든 조각이 "N월" 또는 "N월~M월"이면 달 조건
  const monthMatches = parts.map((part) => /^(\d{1,2})월(?:~(\d{1,2})월)?$/.exec(part));
  if (monthMatches.every(Boolean)) {
    const months = new Set();
    for (const m of monthMatches) {
      const from = Number(m[1]);
      const to = m[2] === undefined ? from : Number(m[2]);
      if (from < 1 || from > 12 || to < 1 || to > 12) return null;
      monthRange(from, to).forEach((month) => months.add(month));
    }
    return { months };
  }

  // 모든 조각이 "X요일" 또는 "X요일~Y요일"이면 요일 조건
  const dayMatches = parts.map((part) => /^([월화수목금토일])요일(?:~([월화수목금토일])요일)?$/.exec(part));
  if (dayMatches.every(Boolean)) {
    const weekdays = new Set();
    for (const m of dayMatches) {
      const from = DAY_CHARS.indexOf(m[1]);
      const to = m[2] === undefined ? from : DAY_CHARS.indexOf(m[2]);
      weekdayRange(from, to).forEach((day) => weekdays.add(day));
    }
    return { weekdays };
  }

  return null; // 구역 이름 등
}

// 한 덩어리 글자 → { open, close, lastEntry, lastLabel }(분 단위). 시간 구간이 정확히 하나가 아니면 null.
function parseRange(body) {
  if (/(익일|다음 ?날|새벽)/.test(body)) return null;
  const ranges = [...body.matchAll(/(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/g)];
  if (ranges.length !== 1) return null;
  const [, oh, om, ch, cm] = ranges[0];
  const open = toMin(oh, om);
  const close = toMin(ch, cm);
  if (Number(om) > 59 || Number(cm) > 59 || open > 1440 || close > 1440 || close <= open) return null;

  let lastEntry = null;
  let lastLabel = null;
  const last = /(입장\s*마감|마지막\s*입장|마지막\s*주문|라스트\s*오더)\D{0,6}(\d{1,2}):(\d{2})/.exec(body);
  if (last) {
    const minutes = toMin(last[2], last[3]);
    if (minutes >= open && minutes <= close) {
      lastEntry = minutes;
      lastLabel = /주문|오더/.test(last[1]) ? '마지막 주문' : '입장마감';
    }
  }
  return { open, close, lastEntry, lastLabel };
}

// 이용시간 글자 → { kind, raw, rules? }
//   kind: 'none'(등록 없음) | 'always'(상시 개방) | 'ranges'(시간 구간들) | 'unknown'(판단 불가)
export function parseHours(text) {
  const raw = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (raw === '') return { kind: 'none', raw: null };
  const unknown = { kind: 'unknown', raw };

  // 하나로 판단할 수 없는 표기: 점포·시설별, 계절 이름만 있는 것, 쉬는 시간.
  if (/(상이|시설 ?별|점포 ?별|매장 ?별|하절기|동절기|하계|동계|브레이크|휴게|쉬는 ?시간)/i.test(raw)) return unknown;

  // ※ 뒤는 덧붙인 설명이라 앞부분만 본다.
  const head = raw.split('※')[0].trim();
  if (/^[-\s]*(상시 ?개방|24시간)/.test(head)) return { kind: 'always', raw };

  const rules = [];
  if (head.includes('[')) {
    // [조건] 본문 [조건] 본문 … 모양. 조건이 달·요일이 아니면(구역 이름 등) 판단하지 않는다.
    if (head.slice(0, head.indexOf('[')).trim() !== '') return unknown;
    for (const match of head.matchAll(/\[([^\]]*)\]([^[]*)/g)) {
      const condition = parseCondition(match[1]);
      const range = parseRange(match[2]);
      if (!condition || !range) return unknown;
      rules.push({ ...condition, ...range });
    }
  } else if (/(평일|주말)/.test(head)) {
    const chunks = head.split(/(?=평일|주말)/);
    if (!/^[\s-]*$/.test(chunks[0])) return unknown;
    for (const chunk of chunks.slice(1)) {
      const weekdays = new Set(chunk.startsWith('평일') ? [1, 2, 3, 4, 5] : [6, 0]);
      const range = parseRange(chunk.slice(2));
      if (!range) return unknown;
      rules.push({ weekdays, ...range });
    }
  } else {
    const range = parseRange(head);
    if (!range) return unknown;
    rules.push(range);
  }

  return rules.length > 0 ? { kind: 'ranges', raw, rules } : unknown;
}

// 방문 날짜·시각에 영업 중인지 판단한다. arrive/depart는 하루 중 분(0~). 모르면 null.
//   status: 'bad'(영업 시간과 안 맞음) | 'check'(자동 판단 불가) | 'ok'(등록 정보상 문제 없음) | 'none'(정보 없음)
//   problem: 'before-open' | 'after-close' | 'after-last' | 'stay-over'  (status가 'bad'일 때)
export function checkHours(parsed, ymd, { arrive = null, depart = null } = {}) {
  const { kind, raw } = parsed;
  if (kind === 'none') return { status: 'none', raw: null };
  if (kind === 'unknown') return { status: 'check', raw };

  const day = parseYmd(ymd);
  if (!day || arrive === null || arrive >= 1440) return { status: 'check', raw }; // 날짜나 도착 시각을 못 읽거나 자정을 넘기면 판단하지 않는다
  if (kind === 'always') return { status: 'ok', raw, always: true };

  const rule = parsed.rules.find(
    (r) => (!r.months || r.months.has(day.month)) && (!r.weekdays || r.weekdays.has(day.weekday)),
  );
  if (!rule) return { status: 'check', raw }; // 그 달·요일에 해당하는 구간이 없으면 판단하지 않는다

  const base = { raw, open: rule.open, close: rule.close, lastEntry: rule.lastEntry, lastLabel: rule.lastLabel };
  if (arrive < rule.open) return { status: 'bad', problem: 'before-open', ...base };
  if (arrive >= rule.close) return { status: 'bad', problem: 'after-close', ...base };
  if (rule.lastEntry !== null && arrive > rule.lastEntry) return { status: 'bad', problem: 'after-last', ...base };
  if (depart !== null && depart > rule.close) return { status: 'bad', problem: 'stay-over', ...base };
  return { status: 'ok', ...base };
}
