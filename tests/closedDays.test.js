// 쉬는 날 판단 테스트. 문자열은 2026-11-24에 배포 사이트(TourAPI)에서 실제로 조회한 값이다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseClosedDays, checkClosed, dateWithWeekday } from '../js/core/closedDays.js';
import { findPhone } from '../js/core/phone.js';

// 2026-12-01은 화요일, 12-06 일요일, 12-07 월요일, 12-08 화요일. 2027-01-01은 금요일.
const TUE = '2026-12-01';
const SUN = '2026-12-06';
const MON = '2026-12-07';
const THU = '2026-12-03';

const GYEONGBOK = '매주 화요일 ※ 단, 정기휴일이 공휴일 및 대체공휴일과 겹칠 경우에는 개방하며, 그 다음의 첫 번째 비공휴일이 정기휴일임';
const CHANGDEOK = '매주 월요일 (단, 공휴일이 월요일인 경우 그 다음날 휴무)';
const ZONES = '[주제원(온실, 주제정원)] 매주 월요일[열린숲/ 호수원 / 습지원] 연중무휴※ 기타 휴관일은 서울식물원 홈페이지 참조';

test('연중무휴는 어느 날이든 문제 없음', () => {
  const parsed = parseClosedDays('연중무휴');
  assert.equal(parsed.kind, 'always');
  assert.equal(checkClosed(parsed, TUE).status, 'ok');
});

test('매주 화요일: 화요일이면 쉬는 날, 다른 요일이면 문제 없음', () => {
  const parsed = parseClosedDays(GYEONGBOK);
  assert.equal(parsed.kind, 'weekly');
  assert.deepEqual(parsed.weekdays, [2]);
  const closed = checkClosed(parsed, TUE);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedDay, '화');
  assert.equal(checkClosed(parsed, THU).status, 'ok');
});

test('공휴일 문구가 있으면 holidayCaveat가 켜진다(쉬는 날 계산은 그대로)', () => {
  assert.equal(parseClosedDays(GYEONGBOK).holidayCaveat, true);
  assert.equal(parseClosedDays(CHANGDEOK).holidayCaveat, true);
  assert.equal(parseClosedDays('매주 월요일').holidayCaveat, false);
  assert.equal(checkClosed(parseClosedDays(CHANGDEOK), MON).status, 'closed');
  assert.equal(checkClosed(parseClosedDays(CHANGDEOK), TUE).holidayCaveat, true); // 문제 없음이어도 주의 문구는 남는다
});

test('괄호 안의 요일은 휴무 요일로 읽지 않는다', () => {
  // "(단, 공휴일이 월요일인 경우 …)"에는 월요일이 있지만 휴무 요일은 화요일뿐이어야 한다.
  const parsed = parseClosedDays('매주 화요일 (단, 화요일이 공휴일인 경우 개방하며, 그 다음 첫 번째 평일에 휴관)');
  assert.deepEqual(parsed.weekdays, [2]);
  const parsed2 = parseClosedDays('매주 화요일 (단, 공휴일이 월요일인 경우 그 다음날 휴무)');
  assert.deepEqual(parsed2.weekdays, [2]);
});

test('일요일은 "요일"의 일 글자와 헷갈리지 않는다', () => {
  assert.deepEqual(parseClosedDays('매주 일요일').weekdays, [0]);
  assert.deepEqual(parseClosedDays('매주 화요일').weekdays, [2]); // 일요일(0)이 섞여 들어가면 안 된다
  assert.equal(checkClosed(parseClosedDays('[북촌한옥마을 골목길]-매주 일요일'), SUN).status, 'check'); // 대괄호 표기는 판단하지 않는다
  assert.equal(checkClosed(parseClosedDays('매주 일요일'), SUN).status, 'closed');
});

test('요일이 여러 개인 표기', () => {
  assert.deepEqual(parseClosedDays('매주 월요일, 화요일').weekdays, [1, 2]);
  assert.deepEqual(parseClosedDays('매주 월·화요일').weekdays, [1, 2]);
  assert.deepEqual(parseClosedDays('매주 토요일 및 일요일').weekdays, [6, 0]);
});

test('※ 뒤의 안내문구는 판단에 쓰지 않는다', () => {
  const parsed = parseClosedDays('매주 월요일※ 자세한 사항은 전화문의 요망');
  assert.equal(parsed.kind, 'weekly');
  assert.equal(checkClosed(parsed, MON).status, 'closed');
});

test('구역별·점포별로 다르면 판단하지 않고 확인 필요', () => {
  for (const text of [
    ZONES,
    '※ 점포 별로 상이함',
    '점포 별로 상이함',
    '※ 매장 별로 상이함',
    '연중무휴※ 시설별 쉬는날 상이하므로 홈페이지 참조',
    '1월 1일 / 설·추석 당일 ※ 시설 별로 상이하므로 자세한 사항은 홈페이지 참조',
    '[북촌한옥마을 골목길]-매주 일요일',
    '[사무실]매주 월요일',
  ]) {
    const parsed = parseClosedDays(text);
    assert.equal(parsed.kind, 'unknown', text);
    assert.equal(checkClosed(parsed, MON).status, 'check', text);
  }
});

test('고정 날짜: 1월 1일이면 쉬는 날, 설·추석은 계산하지 않고 안내만', () => {
  const parsed = parseClosedDays('1월 1일 / 설·추석 연휴 ※ 자세한 사항은 전화문의 요망');
  assert.equal(parsed.kind, 'dates');
  assert.deepEqual(parsed.fixedDates, [{ month: 1, day: 1 }]);
  assert.equal(parsed.lunar, true);
  const newYear = checkClosed(parsed, '2027-01-01');
  assert.equal(newYear.status, 'closed');
  assert.equal(newYear.closedDay, '1월 1일');
  const other = checkClosed(parsed, TUE);
  assert.equal(other.status, 'ok');
  assert.equal(other.lunarNote, true);
});

test('등록이 없으면 none', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.equal(checkClosed(parseClosedDays(value), TUE).status, 'none');
  }
});

test('읽을 수 없는 글자는 unknown, 읽을 수 없는 날짜는 확인 필요', () => {
  assert.equal(parseClosedDays('매월 둘째, 넷째 월요일').kind, 'unknown');
  assert.equal(parseClosedDays('휴무일 없음').kind, 'unknown');
  assert.equal(checkClosed(parseClosedDays('매주 화요일'), '2026-02-30').status, 'check'); // 없는 날짜
  assert.equal(checkClosed(parseClosedDays('매주 화요일'), '').status, 'check');
});

test('조회한 실제 문자열 34건이 모두 판단 가능한 상태로 나온다(오류 없이)', () => {
  const samples = [
    GYEONGBOK,
    '매주 화요일※ 단, 정기휴일이 공휴일 및 대체공휴일과 겹칠 경우에는 개방하며, 그 다음의 첫 번째 비공휴일이 정기휴일임',
    '매주 월요일※ 단, 정기휴일이 공휴일 및 대체공휴일과 겹칠 경우에는 개방하며, 그 다음의 첫 번째 비공휴일이 정기휴일임',
    CHANGDEOK,
    '1월 1일 / 설·추석 연휴 ※ 자세한 사항은 전화문의 요망',
    '연중무휴※ 시설별 쉬는날 상이하므로 홈페이지 참조',
    '매주 월요일',
    '연중무휴',
    '[북촌한옥마을 골목길]-매주 일요일',
    ZONES,
    '연중무휴※ 기상 상태에 따라 매직아일랜드 일부 어트랙션 중단 가능※ 기상 상태와 별개로 현장 상황에 따라 운휴하거나 중간 점검할 수 있음',
    '1월 1일 / 설·추석 당일 ※ 시설 별로 상이하므로 자세한 사항은 홈페이지 참조',
    '매주 화요일 (단, 화요일이 공휴일인 경우 개방하며, 그 다음 첫 번째 평일에 휴관)',
    '※ 점포 별로 상이함',
    '점포 별로 상이함',
    '매주 월요일※ 자세한 사항은 전화문의 요망',
    '[사무실]매주 월요일',
  ];
  const allowed = new Set(['closed', 'check', 'ok']);
  for (const text of samples) {
    assert.ok(allowed.has(checkClosed(parseClosedDays(text), TUE).status), text);
  }
  // 연중무휴에 "기상 상태…" 같은 설명이 붙어도 연중무휴로 읽는다
  assert.equal(parseClosedDays(samples[10]).kind, 'always');
});

test('날짜 표시: 월 일(요일)', () => {
  assert.equal(dateWithWeekday(TUE), '12월 1일(화)');
  assert.equal(dateWithWeekday(SUN), '12월 6일(일)');
  assert.equal(dateWithWeekday('엉터리'), '엉터리');
});

test('전화번호 찾기: 번호 모양만 꺼내고 tel 값은 숫자뿐', () => {
  assert.deepEqual(findPhone('02-3700-3900'), { display: '02-3700-3900', tel: '0237003900' });
  assert.deepEqual(findPhone('051-852-6904 (평일 9시~18시)'), { display: '051-852-6904', tel: '0518526904' });
  assert.deepEqual(findPhone('문의 1588-1234 로 전화'), { display: '1588-1234', tel: '15881234' });
  assert.equal(findPhone('홈페이지 참조'), null);
  assert.equal(findPhone(null), null);
  assert.equal(findPhone('javascript:alert(1)'), null);
});
