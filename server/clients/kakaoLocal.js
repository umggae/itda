// 카카오 로컬 키워드 검색: 역·터미널·숙소 등 출발지·도착지 후보. 서비스 지역(서울) 안으로만 찾는다.
// 필드: place_name, x(경도), y(위도), road_address_name, address_name, id, category_group_code
import { upstream, rateLimit, notConfigured } from '../lib/errors.js';
import { REGION_BOX } from '../lib/validate.js';

export function parseKakaoPlaces(bodyText) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw upstream();
  }
  const documents = Array.isArray(json?.documents) ? json.documents : [];
  return documents
    .map((doc) => {
      const lat = Number(doc.y);
      const lng = Number(doc.x);
      const inRegion =
        lat >= REGION_BOX.minLat && lat <= REGION_BOX.maxLat && lng >= REGION_BOX.minLng && lng <= REGION_BOX.maxLng;
      if (!inRegion || !doc.place_name || !/^\d{1,12}$/.test(String(doc.id))) return null;
      return {
        id: 'kakao-' + doc.id,
        name: doc.place_name,
        // FD6 = 음식점. 나머지(역·터미널·숙소·기타)는 거점으로 둔다.
        category: doc.category_group_code === 'FD6' ? 'restaurant' : 'hub',
        lat,
        lng,
        address: doc.road_address_name || doc.address_name || '',
        phone: String(doc.phone ?? '').trim() || null, // "가기 전 확인할 것"의 문의처로 쓴다
        source: 'kakao',
      };
    })
    .filter(Boolean);
}

export async function searchKakao(query) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) throw notConfigured();
  const rect = [REGION_BOX.minLng, REGION_BOX.minLat, REGION_BOX.maxLng, REGION_BOX.maxLat].join(',');
  const url =
    'https://dapi.kakao.com/v2/local/search/keyword.json?' +
    new URLSearchParams({ query, rect, size: '8' });
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + key }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw upstream('카카오 로컬 서비스에 연결하지 못했습니다.');
  }
  if (res.status === 429) throw rateLimit();
  if (res.status === 401 || res.status === 403) throw notConfigured();
  if (!res.ok) throw upstream();
  return parseKakaoPlaces(await res.text());
}
