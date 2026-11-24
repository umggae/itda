// 쉬는 날 판단. 모두 순수 함수다(화면·네트워크를 건드리지 않는다).
// 한국관광공사의 "쉬는 날"은 정해진 형식이 없는 자유 텍스트라서, 확실히 읽을 수 있는 모양만 읽고
// 나머지는 'unknown'(원문만 보여 주기)으로 둔다. 틀린 안심이 틀린 경고보다 해롭기 때문이다.

const DAY_CHARS = '일월화수목금토'; // Date.getUTCDay() 순서(일요일이 0)

// 'YYYY-MM-DD' → { year, month, day, weekday }. 없는 날짜(2026-02-30 등)이면 null.
export function parseYmd(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, weekday: date.getUTCDay() };
}

// "12월 1일(화)" 모양의 날짜 표시. 읽을 수 없으면 받은 글자를 그대로 돌려준다.
export function dateWithWeekday(ymd) {
  const parsed = parseYmd(ymd);
  if (!parsed) return String(ymd ?? '');
  return parsed.month + '월 ' + parsed.day + '일(' + DAY_CHARS[parsed.weekday] + ')';
}

// 쉬는 날 글자 → { kind, raw, holidayCaveat, ... }
//   kind: 'none'(등록 없음) | 'always'(연중무휴) | 'weekly'(매주 X요일) | 'dates'(고정 날짜) | 'unknown'(판단 불가)
export function parseClosedDays(text) {
  const raw = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (raw === '') return { kind: 'none', raw: null, holidayCaveat: false };

  // 공휴일 문구가 있으면 공휴일 때문에 쉬는 날이 바뀔 수 있다(1단계에서는 계산하지 않고 알리기만 한다).
  const holidayCaveat = /공휴일/.test(raw);
  const base = { raw, holidayCaveat };

  // 구역·점포·시설마다 다르면 하나로 판단할 수 없다.
  if (/\[[^\]]*\]/.test(raw) || /(상이|시설 ?별|점포 ?별|매장 ?별)/.test(raw)) return { kind: 'unknown', ...base };

  // ※ 뒤는 덧붙인 설명이고, 괄호 안도 예외 설명이라 앞부분만 본다.
  const head = raw.split('※')[0].replace(/\s*\(.*$/, '').trim();

  if (/^연중 ?무휴$/.test(head)) return { kind: 'always', ...base };

  const weekly = /^매주 ?((?:[월화수목금토일](?:요일?)?(?: ?(?:,|·|ㆍ|\/|및|와|과) ?)?)+)$/.exec(head);
  if (weekly) {
    // "요일"에도 '일'이 들어 있으니 먼저 지운 뒤 요일 글자만 모은다.
    const weekdays = [...new Set([...weekly[1].replace(/요일/g, '')].filter((ch) => DAY_CHARS.includes(ch)).map((ch) => DAY_CHARS.indexOf(ch)))];
    if (weekdays.length > 0) return { kind: 'weekly', weekdays, ...base };
  }

  // "1월 1일 / 설·추석 연휴" 같은 고정 날짜. 설·추석은 음력이라 계산하지 않고 lunar로만 표시한다.
  const datePattern = /(\d{1,2}) ?월 ?(\d{1,2}) ?일/g;
  const fixedDates = [...head.matchAll(datePattern)].map((m) => ({ month: Number(m[1]), day: Number(m[2]) }));
  const leftover = head.replace(datePattern, '').replace(/[설추석날연휴당일및,·ㆍ/\s]/g, '');
  const lunar = /설|추석/.test(head);
  if (leftover === '' && (fixedDates.length > 0 || lunar)) return { kind: 'dates', fixedDates, lunar, ...base };

  return { kind: 'unknown', ...base };
}

// 방문 날짜에 쉬는 날인지 판단한다.
//   status: 'closed'(쉬는 날일 수 있음) | 'check'(자동 판단 불가, 확인 필요) | 'ok'(등록 정보상 문제 없음) | 'none'(정보 없음)
export function checkClosed(parsed, ymd) {
  const { kind, raw, holidayCaveat } = parsed;
  if (kind === 'none') return { status: 'none', raw: null, holidayCaveat: false };
  if (kind === 'unknown') return { status: 'check', raw, holidayCaveat };
  if (kind === 'always') return { status: 'ok', raw, holidayCaveat };

  const day = parseYmd(ymd);
  if (!day) return { status: 'check', raw, holidayCaveat }; // 날짜를 읽지 못하면 판단하지 않는다

  if (kind === 'weekly') {
    if (parsed.weekdays.includes(day.weekday)) {
      return { status: 'closed', raw, holidayCaveat, closedDay: DAY_CHARS[day.weekday] };
    }
    return { status: 'ok', raw, holidayCaveat };
  }

  // kind === 'dates'
  if (parsed.fixedDates.some((d) => d.month === day.month && d.day === day.day)) {
    return { status: 'closed', raw, holidayCaveat, closedDay: day.month + '월 ' + day.day + '일' };
  }
  return { status: 'ok', raw, holidayCaveat, lunarNote: parsed.lunar };
}
