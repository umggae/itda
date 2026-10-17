// 한국관광공사 TourAPI (KorService2). 서비스 지역(js/core/region.js)의 관광지(12)·음식점(39)만 다룬다.
// 주의: 키워드 검색에 지역 필터(areaCode)를 걸면 경복궁처럼 일부 장소가 빠진다(실제 호출로 확인).
//       그래서 지역 필터 없이 검색하고, 서비스 지역 좌표 범위 안의 것만 남긴다(toPlace).
// 필드 이름은 실제 응답으로 확인한 것: contentid, contenttypeid, title, addr1, mapx(경도), mapy(위도).
import { upstream, rateLimit, notConfigured } from '../lib/errors.js';
import { REGION_BOX } from '../lib/validate.js';

const BASE = 'https://apis.data.go.kr/B551011/KorService2/';
const TYPE_ATTRACTION = '12';
const TYPE_RESTAURANT = '39';

// ---------- 응답 해석 (순수 함수) ----------

// 응답 글자 → 항목 배열. 항목이 없으면 items가 "" 로 오고, 1개면 배열이 아닐 수 있다.
export function parseTourItems(bodyText) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    // 인증 오류·한도 초과는 JSON이 아니라 XML 문구로 온다.
    if (/LIMITED_NUMBER|EXCEEDS/i.test(bodyText)) throw rateLimit();
    if (/SERVICE_KEY|UNREGISTERED|NOT_REGISTERED/i.test(bodyText)) throw notConfigured();
    throw upstream();
  }
  const header = json?.response?.header;
  if (header?.resultCode !== '0000') {
    if (/LIMITED/i.test(header?.resultMsg ?? '')) throw rateLimit();
    throw upstream();
  }
  const items = json.response.body?.items;
  if (!items || items === '') return [];
  const item = items.item;
  return Array.isArray(item) ? item : item ? [item] : [];
}

// TourAPI 항목 → 우리 장소 모양. 좌표가 없거나 서비스 지역 밖이면 null.
export function toPlace(item) {
  const type = String(item.contenttypeid);
  const lat = Number(item.mapy);
  const lng = Number(item.mapx);
  const inRegion =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= REGION_BOX.minLat && lat <= REGION_BOX.maxLat &&
    lng >= REGION_BOX.minLng && lng <= REGION_BOX.maxLng;
  if ((type !== TYPE_ATTRACTION && type !== TYPE_RESTAURANT) || !inRegion || !item.title) return null;
  return {
    id: 'tour-' + type + '-' + item.contentid,
    name: item.title,
    category: type === TYPE_RESTAURANT ? 'restaurant' : 'attraction',
    lat,
    lng,
    address: item.addr1 || '',
    source: 'tourapi',
  };
}

// 글자 정리: 빈 값은 null, <br> 같은 태그는 제거.
function clean(value) {
  const text = String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? null : text;
}

// detailCommon2 항목 → { tel, homepage }. 홈페이지는 <a href="..."> 글자로 오므로 주소만 꺼내고, http(s)만 받는다.
export function parseCommon(item) {
  const href = /href\s*=\s*["']?([^"'\s>]+)/i.exec(String(item?.homepage ?? ''))?.[1] ?? '';
  const homepage = /^https?:\/\//i.test(href) ? href : null;
  return { tel: clean(item?.tel), homepage };
}

// detailIntro2 항목 → "가기 전 확인할 것". 관광지와 음식점은 필드 이름이 다르다.
// (관광지에는 예약 필드가 없어 reservation은 null)
export function parseDetail(typeId, item) {
  if (typeId === TYPE_RESTAURANT) {
    return {
      closedDays: clean(item.restdatefood),
      hours: clean(item.opentimefood),
      parking: clean(item.parkingfood),
      reservation: clean(item.reservationfood),
      contact: clean(item.infocenterfood),
      homepage: null,
    };
  }
  return {
    closedDays: clean(item.restdate),
    hours: clean(item.usetime),
    parking: clean(item.parking),
    reservation: null,
    contact: clean(item.infocenter),
    homepage: null,
  };
}

// ---------- 호출 ----------

async function callTour(operation, params) {
  const key = process.env.TOURAPI_KEY;
  if (!key) throw notConfigured();
  // 인증키는 주소에 들어가므로, 이 주소는 오류 메시지·로그에 절대 내보내지 않는다.
  const url =
    BASE + operation + '?' +
    new URLSearchParams({ serviceKey: key, MobileOS: 'ETC', MobileApp: 'Itda', _type: 'json', ...params });
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw upstream('한국관광공사 서비스에 연결하지 못했습니다.');
  }
  if (res.status === 429) throw rateLimit();
  return parseTourItems(await res.text());
}

export async function searchTour(query) {
  const [attractions, restaurants] = await Promise.all(
    [TYPE_ATTRACTION, TYPE_RESTAURANT].map((typeId) =>
      // 전국에서 찾은 뒤 서울만 남기므로 넉넉히 받는다(같은 이름이 다른 지역에도 있을 수 있음)
      callTour('searchKeyword2', { keyword: query, contentTypeId: typeId, numOfRows: '30' }),
    ),
  );
  const places = [...attractions, ...restaurants].map(toPlace).filter(Boolean);
  return places.slice(0, 12);
}

// 소개 정보(쉬는 날·시간·주차·예약·문의)와 공통 정보(전화·홈페이지)를 함께 받아 합친다.
// 소개 정보에 문의처가 비어 있으면 공통 정보의 전화번호로 채운다.
export async function tourDetail(typeId, contentId) {
  const [intro, common] = await Promise.all([
    callTour('detailIntro2', { contentId, contentTypeId: typeId }),
    callTour('detailCommon2', { contentId }),
  ]);
  const detail = parseDetail(typeId, intro[0] ?? {});
  const { tel, homepage } = parseCommon(common[0]);
  return { ...detail, contact: detail.contact ?? tel, homepage };
}
