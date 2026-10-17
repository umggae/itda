// 서버 함수가 받는 값 검사. 틀리면 badRequest 오류를 던진다. (순수 함수라 테스트 가능)
import { ApiError, badRequest } from './errors.js';
import { REGION } from '../../js/core/region.js';

// 서비스 지역(js/core/region.js)의 범위. 이 밖의 좌표는 거부한다.
export const REGION_BOX = REGION.box;
export const MAX_POINTS = 8; // 하루 최대 6곳 + 출발지 + 도착지

export function parseQuery(text) {
  const query = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (query.length < 1 || query.length > 30) throw badRequest('검색어는 1~30자로 입력해 주세요.');
  return query;
}

export function parseMode(text) {
  if (text !== 'transit' && text !== 'car') throw badRequest('이동수단은 transit 또는 car 이어야 합니다.');
  return text;
}

// 장소 id: tour-12-294452 (TourAPI 관광지/음식점 12·39), kakao-8329752 (카카오 로컬)
export function parsePlaceId(text) {
  const tour = /^tour-(12|39)-(\d{1,12})$/.exec(String(text ?? ''));
  if (tour) return { source: 'tour', typeId: tour[1], contentId: tour[2] };
  const kakao = /^kakao-(\d{1,12})$/.exec(String(text ?? ''));
  if (kakao) return { source: 'kakao', id: kakao[1] };
  throw badRequest('장소 id 형식이 올바르지 않습니다.');
}

function parsePoint(text) {
  const [latText, lngText, extra] = String(text).split(',');
  const lat = Number(latText);
  const lng = Number(lngText);
  const ok =
    extra === undefined &&
    latText?.trim() !== '' &&
    lngText?.trim() !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= REGION_BOX.minLat && lat <= REGION_BOX.maxLat &&
    lng >= REGION_BOX.minLng && lng <= REGION_BOX.maxLng;
  if (!ok) throw badRequest('좌표는 ' + REGION.name + ' 안의 "위도,경도" 형식이어야 합니다.');
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 }; // 소수 5자리(약 1m)
}

// "35.1,129.0;35.2,129.1" → [{lat,lng}, ...]  (2~8개)
export function parsePoints(text) {
  const parts = String(text ?? '').split(';').filter((part) => part !== '');
  if (parts.length < 2 || parts.length > MAX_POINTS) {
    throw badRequest('장소(출발지·도착지 포함)는 2~' + MAX_POINTS + '곳이어야 합니다.');
  }
  return parts.map(parsePoint);
}

// 한국시간 날짜·시각 → 시점(ISO). 대중교통은 Google이 과거 7일~미래 100일만 계산해 주므로 범위를 확인한다.
export function parseWhen(dateText, timeText, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText ?? '') || !/^\d{2}:\d{2}$/.test(timeText ?? '')) {
    throw badRequest('날짜(YYYY-MM-DD)와 시각(HH:MM)이 필요합니다.');
  }
  const time = new Date(dateText + 'T' + timeText + ':00+09:00');
  if (Number.isNaN(time.getTime())) throw badRequest('날짜 또는 시각이 올바르지 않습니다.');
  const day = 24 * 60 * 60 * 1000;
  if (time < now.getTime() - 6 * day || time > now.getTime() + 99 * day) {
    throw new ApiError('DATE_RANGE', 400, '대중교통 이동시간은 오늘 기준 약 6일 전부터 99일 뒤까지의 날짜만 조회할 수 있습니다.');
  }
  return time.toISOString();
}
