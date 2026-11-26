// 서비스 지역과 "대중교통 시간 경고" 기준 확인
import test from 'node:test';
import assert from 'node:assert/strict';

import { REGION, isInBox, needsTransitWarning } from '../js/core/region.js';

const seoulStation = { lat: 37.5547, lng: 126.9707 };
const gangnam = { lat: 37.4979, lng: 127.0276 };
const suwon = { lat: 37.2872, lng: 127.0119 };
const jeju = { lat: 33.4587, lng: 126.9425 };

test('서비스 지역: 서울·수원·제주는 안, 도쿄는 밖', () => {
  for (const place of [seoulStation, suwon, jeju]) assert.ok(isInBox(place, REGION.box));
  assert.ok(!isInBox({ lat: 35.68, lng: 139.69 }, REGION.box));
});

test('대중교통 경고: 서울 안끼리는 없고, 한 곳이라도 밖이면 띄운다', () => {
  assert.equal(needsTransitWarning('transit', [seoulStation, gangnam]), false);
  assert.equal(needsTransitWarning('transit', [seoulStation, suwon, gangnam]), true);
  assert.equal(needsTransitWarning('transit', [jeju, jeju]), true);
});

test('대중교통 경고: 자동차에는 띄우지 않는다', () => {
  assert.equal(needsTransitWarning('car', [seoulStation, suwon]), false);
});

test('대중교통 경고 기준 범위의 경계값: 남쪽 끝 37.4는 안, 그보다 아래는 밖', () => {
  assert.equal(needsTransitWarning('transit', [{ lat: 37.4, lng: 127 }]), false);
  assert.equal(needsTransitWarning('transit', [{ lat: 37.39999, lng: 127 }]), true);
});
