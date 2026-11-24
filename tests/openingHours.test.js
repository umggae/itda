// 영업시간 판단 테스트. 문자열은 2026-11-24에 배포 사이트(TourAPI)에서 실제로 조회한 이용시간 값이다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHours, checkHours } from '../js/core/openingHours.js';

// 2026-12-01 화, 12-04 금, 12-05 토, 12-06 일, 2026-07-15 수
const TUE = '2026-12-01';
const FRI = '2026-12-04';
const SAT = '2026-12-05';
const SUN = '2026-12-06';
const JULY = '2026-07-15';
const at = (h, m = 0) => h * 60 + m;

const GYEONGBOK =
  '[1월~2월/11월~12월]09:00~17:00 (입장마감 16:00)[3월~5월/9월~10월]09:00~18:00 (입장마감 17:00)[6월~8월] 09:00~18:30 (입장마감 17:30)';
const LOTTE = '[월요일~목요일/일요일]- 10:00~21:00 (입장 마감 20:00)[금요일~토요일]- 10:00~22:00 (입장 마감 21:00)';

// [글자, 기대하는 종류]
const SAMPLES = [
  [GYEONGBOK, 'ranges'],
  ['[11월~2월] - 09:00~17:00 - 입장마감 16:00 [3월~5월/9월~10월] - 09:00~18:00 - 입장마감 17:00 [6월~8월] - 09:00~18:30 - 입장마감 17:30', 'ranges'],
  ['[2월~5월] 09:00~18:00 (입장마감 17:00)[6월~8월] 09:00~18:30 (입장마감 17:30)[9월~10월] 09:00~18:00 (입장마감 17:00)[11월~1월] 09:00~17:30 (입장마감 16:30)', 'ranges'],
  ['[2월~5월/9월~10월]- 09:00~18:00- 입장 마감 17:00[6월~8월]- 09:00~18:30- 입장 마감 17:30[11월~1월]- 09:00~17:30- 입장 마감 16:30', 'ranges'],
  ['[일반관람] - 09:00~21:00 (입장마감 20:00)[전시관]- 석조전 09:30~17:30 (마지막 해설 16:30)- 돈덕전 09:00~17:30 (입장마감 17:00)- 중명전 09:30~17:30(입장마감 17:00)', 'unknown'],
  ['07:00~22:00 ※ 자세한 사항은 전화문의 요망', 'ranges'],
  ['상시 개방※ 시설별 이용시간 상이하므로 홈페이지 참조', 'unknown'],
  ['하절기 화~일 10:00~17:00 / 동절기 화~일 11:00~16:00', 'unknown'],
  ['- 평일 10:00~22:30- 주말 10:00~23:00', 'ranges'],
  ['10:00~17:00※ 방문 제한시간(특별관리지역-레드존) 17:00~익일 10:00', 'ranges'],
  ['상시 개방(보행자 전용 토요일, 일요일 10:00~17:00)', 'always'],
  ['[주제원(온실, 주제정원)]- 평시(3월~10월) 09:30~18:00 (입장마감 17:00)- 동절기(11월~2월) 09:30~17:00 (입장마감 16:00)', 'unknown'],
  ['상시 개방', 'always'],
  [LOTTE, 'ranges'],
  ['[일요일~목요일]10:30~22:00 (입장 마감 21:00)[금요일~토요일]10:30~23:00 (입장 마감 22:00)', 'ranges'],
  ['10:00~20:00 ※ 프로그램에 따라 일부공간 탄력운영', 'ranges'],
  ['점포 별로 상이함', 'unknown'],
  ['11:00~21:30', 'ranges'],
  ['상시 개방※ 우천 시, 안전상의 이유로 출입통제될 수 있음', 'always'],
  ['[공원]- 05:00~22:00[동물원]- 10:00~17:00[놀이동산]- 평일 10:00~18:30- 주말 10:00~19:30', 'unknown'],
  ['[월요일]- 10:00~22:00[화요일]- 06:00~24:00[수요일~일요일]- 00:00~24:00', 'ranges'],
  ['10:00~22:00 (마지막 주문 21:30)', 'ranges'],
  ['11:00~20:00 (마지막 주문 19:30)', 'ranges'],
  ['- 11:00~20:00- 마지막 주문 19:30', 'ranges'],
  ['- 11:30~21:30 - 마지막 주문 20:30', 'ranges'],
  ['- 11:00~24:00- 마지막 주문 23:00', 'ranges'],
  ['12:00~22:40 (마지막 주문 22:10)', 'ranges'],
  ['- 평일 11:30~19:30- 주말 11:00~19:30※ 시간 변동 가능성 있으므로 전화 문의 후 방문 요망', 'ranges'],
];

test('조회한 실제 이용시간 글자가 기대한 종류로 읽힌다(오류 없이)', () => {
  for (const [text, kind] of SAMPLES) {
    assert.equal(parseHours(text).kind, kind, text);
  }
});

test('등록이 없으면 none', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.equal(checkHours(parseHours(value), TUE, { arrive: at(10) }).status, 'none');
  }
});

test('한 구간: 영업 중이면 ok, 열기 전·닫은 뒤면 bad', () => {
  const parsed = parseHours('11:00~21:30');
  assert.equal(checkHours(parsed, TUE, { arrive: at(12), depart: at(13) }).status, 'ok');
  assert.equal(checkHours(parsed, TUE, { arrive: at(10, 30) }).problem, 'before-open');
  assert.equal(checkHours(parsed, TUE, { arrive: at(21, 30) }).problem, 'after-close'); // 닫는 시각 정각은 이미 닫힘
  assert.equal(checkHours(parsed, TUE, { arrive: at(22) }).problem, 'after-close');
});

test('입장마감·마지막 주문: 그 시각을 넘기면 bad, 이름도 맞게 붙는다', () => {
  const food = parseHours('10:00~22:00 (마지막 주문 21:30)');
  assert.equal(checkHours(food, TUE, { arrive: at(21, 30) }).status, 'ok'); // 정각은 가능
  const late = checkHours(food, TUE, { arrive: at(21, 45) });
  assert.equal(late.problem, 'after-last');
  assert.equal(late.lastLabel, '마지막 주문');
  assert.equal(late.lastEntry, at(21, 30));

  const palace = parseHours(GYEONGBOK);
  const closing = checkHours(palace, TUE, { arrive: at(16, 30) });
  assert.equal(closing.problem, 'after-last');
  assert.equal(closing.lastLabel, '입장마감');
});

test('체류 중에 문을 닫으면 stay-over', () => {
  const palace = parseHours(GYEONGBOK);
  const stay = checkHours(palace, TUE, { arrive: at(15, 30), depart: at(17, 30) });
  assert.equal(stay.problem, 'stay-over');
  assert.equal(stay.close, at(17));
  assert.equal(checkHours(palace, TUE, { arrive: at(15, 30), depart: at(16, 50) }).status, 'ok');
  // 도착지처럼 출발 시각이 없으면 도착만 본다
  assert.equal(checkHours(palace, TUE, { arrive: at(15, 30), depart: null }).status, 'ok');
});

test('달별 구간: 겨울(12월)과 여름(7월)의 닫는 시각이 다르다', () => {
  const palace = parseHours(GYEONGBOK);
  assert.equal(checkHours(palace, TUE, { arrive: at(17, 30) }).problem, 'after-close'); // 12월 17:00 마감
  assert.equal(checkHours(palace, JULY, { arrive: at(17, 30) }).status, 'ok'); // 7월 18:30 마감, 입장마감 17:30
  assert.equal(checkHours(palace, JULY, { arrive: at(17, 45) }).problem, 'after-last');
});

test('한 바퀴 도는 달 범위(11월~2월)', () => {
  const parsed = parseHours('[11월~2월] - 09:00~17:00 - 입장마감 16:00 [3월~5월/9월~10월] - 09:00~18:00 - 입장마감 17:00 [6월~8월] - 09:00~18:30 - 입장마감 17:30');
  assert.equal(checkHours(parsed, TUE, { arrive: at(16, 30) }).problem, 'after-last'); // 12월은 11~2월 구간
  assert.equal(checkHours(parsed, '2026-01-20', { arrive: at(16, 30) }).problem, 'after-last');
  assert.equal(checkHours(parsed, '2026-04-10', { arrive: at(16, 30) }).status, 'ok'); // 4월은 18:00 마감
});

test('요일별 구간: 금·토는 늦게까지, 한 바퀴 도는 요일 범위도 읽는다', () => {
  const lotte = parseHours(LOTTE);
  assert.equal(checkHours(lotte, TUE, { arrive: at(20, 30) }).problem, 'after-last'); // 화: 입장마감 20:00
  assert.equal(checkHours(lotte, FRI, { arrive: at(20, 30) }).status, 'ok'); // 금: 입장마감 21:00
  assert.equal(checkHours(lotte, SUN, { arrive: at(20, 30) }).problem, 'after-last'); // 일은 월~목과 같은 구간

  const restaurant = parseHours('[월요일]- 10:00~22:00[화요일]- 06:00~24:00[수요일~일요일]- 00:00~24:00');
  assert.equal(checkHours(restaurant, SUN, { arrive: at(3) }).status, 'ok'); // 수~일(한 바퀴): 24시간
  assert.equal(checkHours(restaurant, TUE, { arrive: at(5) }).problem, 'before-open');
});

test('평일·주말 구간', () => {
  const tower = parseHours('- 평일 10:00~22:30- 주말 10:00~23:00');
  assert.equal(checkHours(tower, TUE, { arrive: at(22, 45) }).problem, 'after-close');
  assert.equal(checkHours(tower, SAT, { arrive: at(22, 45) }).status, 'ok');
  assert.equal(checkHours(tower, SUN, { arrive: at(22, 45) }).status, 'ok');
});

test('상시 개방은 어느 시각이든 문제 없음', () => {
  const result = checkHours(parseHours('상시 개방'), TUE, { arrive: at(3) });
  assert.equal(result.status, 'ok');
  assert.equal(result.always, true);
});

test('판단할 수 없는 표기는 check로 두고 원문을 남긴다', () => {
  for (const [text, kind] of SAMPLES) {
    if (kind !== 'unknown') continue;
    const result = checkHours(parseHours(text), TUE, { arrive: at(12) });
    assert.equal(result.status, 'check', text);
    assert.ok(result.raw.length > 0);
  }
});

test('브레이크타임·익일이 있으면 판단하지 않는다', () => {
  assert.equal(parseHours('10:00~21:00 (브레이크타임 15:00~17:00)').kind, 'unknown');
  assert.equal(parseHours('18:00~익일 02:00').kind, 'unknown');
  assert.equal(parseHours('18:00~02:00').kind, 'unknown'); // 닫는 시각이 여는 시각보다 앞
});

test('날짜나 도착 시각을 읽을 수 없으면 check', () => {
  const parsed = parseHours('11:00~21:30');
  assert.equal(checkHours(parsed, '2026-02-30', { arrive: at(12) }).status, 'check');
  assert.equal(checkHours(parsed, TUE, { arrive: null }).status, 'check');
  assert.equal(checkHours(parsed, TUE, { arrive: 1500 }).status, 'check'); // 자정을 넘긴 시각
});

test('해당하는 달·요일 구간이 없으면 check(틀린 판정을 하지 않는다)', () => {
  const parsed = parseHours('[3월~5월] 09:00~18:00');
  assert.equal(checkHours(parsed, TUE, { arrive: at(12) }).status, 'check');
});

test('※ 뒤의 설명은 시간 판독에 쓰지 않는다', () => {
  const parsed = parseHours('10:00~17:00※ 방문 제한시간(특별관리지역-레드존) 17:00~익일 10:00');
  assert.equal(parsed.kind, 'ranges');
  assert.equal(checkHours(parsed, TUE, { arrive: at(16, 59) }).status, 'ok');
  assert.equal(checkHours(parsed, TUE, { arrive: at(17) }).problem, 'after-close');
});
