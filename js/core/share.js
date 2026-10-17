// 공유 링크: 일정 전체를 주소의 # 뒷부분(해시)에 담는다. 서버에 저장하지 않는다.
// 예: #m=transit&d=2026-10-20&o=hub-seoul-station&e=hub-seoul-station&s=09%3A00&t=21%3A00&p=p-gyeongbok%3A60%2Cr-gukbap%3A30
// 이름·연락처 같은 개인정보는 담지 않는다. 장소(id·이름·좌표)와 체류시간뿐이다.
// 장소 이름·좌표도 함께 담는 이유: 카카오 검색 장소는 id만으로 다시 불러올 수 없기 때문이다.

import { parseTime } from './time.js';
import { MAX_STOPS, MAX_STAY_MINUTES } from './schedule.js';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const COORD_BOX = { minLat: 33, maxLat: 39, minLng: 124, maxLng: 132 }; // 한국 전체 대략 범위

// plan = { mode, date, originId, destinationId, startTime, endTime, stops: [{ placeId, stayMin }] }
// places = { 장소id: { name, lat, lng } }  (plan에 나오는 모든 장소)
export function encodePlan(plan, places) {
  const params = new URLSearchParams();
  params.set('m', plan.mode);
  params.set('d', plan.date);
  params.set('o', plan.originId);
  params.set('e', plan.destinationId);
  params.set('s', plan.startTime);
  params.set('t', plan.endTime);
  params.set('p', plan.stops.map((stop) => stop.placeId + ':' + stop.stayMin).join(','));
  const ids = [...new Set([plan.originId, plan.destinationId, ...plan.stops.map((stop) => stop.placeId)])];
  // 장소 하나 = "id~위도~경도~이름". 이름 속 쉼표·물결표는 구분자와 겹치니 공백으로 바꾼다.
  params.set(
    'l',
    ids.map((id) => [id, places[id].lat, places[id].lng, String(places[id].name).replace(/[,~]/g, ' ')].join('~')).join(','),
  );
  return params.toString();
}

// 해시 문자열("#m=..." 또는 "m=...")을 일정으로 되돌린다.
// 주소는 누구나 고칠 수 있으므로 모양이 틀리면 null을 돌려준다. (그러면 화면은 빈 입력으로 시작한다)
export function decodePlan(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const mode = params.get('m');
  const date = params.get('d');
  const originId = params.get('o');
  const destinationId = params.get('e');
  const startTime = params.get('s');
  const endTime = params.get('t');
  const stopsText = params.get('p');
  const placesText = params.get('l');

  if (mode !== 'transit' && mode !== 'car') return null;
  if (!DATE_PATTERN.test(date ?? '')) return null;
  if (!ID_PATTERN.test(originId ?? '') || !ID_PATTERN.test(destinationId ?? '')) return null;
  if (parseTime(startTime) === null || parseTime(endTime) === null) return null;
  if (stopsText === null || placesText === null) return null;

  const stops = [];
  if (stopsText !== '') {
    for (const part of stopsText.split(',')) {
      const [placeId, stayText, extra] = part.split(':');
      const stayMin = Number(stayText);
      if (extra !== undefined || !ID_PATTERN.test(placeId ?? '')) return null;
      if (!/^\d+$/.test(stayText ?? '') || stayMin < 1 || stayMin > MAX_STAY_MINUTES) return null;
      stops.push({ placeId, stayMin });
    }
  }
  if (stops.length > MAX_STOPS) return null;

  // 장소 목록: 일정에 나오는 id가 모두 들어 있어야 한다. 이름은 화면에 글자로만 쓰이고, 좌표는 범위를 확인한다.
  const places = [];
  for (const part of placesText.split(',')) {
    const [id, latText, lngText, ...nameParts] = part.split('~');
    const lat = Number(latText);
    const lng = Number(lngText);
    const name = nameParts.join('~').trim();
    const inRange =
      latText !== '' && lngText !== '' &&
      lat >= COORD_BOX.minLat && lat <= COORD_BOX.maxLat && lng >= COORD_BOX.minLng && lng <= COORD_BOX.maxLng;
    if (!ID_PATTERN.test(id ?? '') || !inRange || name === '' || name.length > 60) return null;
    places.push({ id, name, lat, lng });
  }
  const known = new Set(places.map((place) => place.id));
  const needed = [originId, destinationId, ...stops.map((stop) => stop.placeId)];
  if (!needed.every((id) => known.has(id))) return null;

  return { mode, date, originId, destinationId, startTime, endTime, stops, places };
}
