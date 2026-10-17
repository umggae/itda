// 서버 함수가 하는 일. api/ 폴더의 파일은 이 함수들을 부르기만 한다.
import { cached } from './lib/cache.js';
import { ApiError } from './lib/errors.js';
import { parseQuery, parseMode, parsePlaceId, parsePoints, parseWhen } from './lib/validate.js';
import { searchTour, tourDetail } from './clients/tourApi.js';
import { searchKakao } from './clients/kakaoLocal.js';
import { carMatrix } from './clients/kakaoMobility.js';
import { transitMatrix, transitRides } from './clients/googleRoutes.js';

const EMPTY_DETAIL = { closedDays: null, hours: null, parking: null, reservation: null, contact: null, homepage: null };

// /api/search?q=...  → TourAPI(관광지·음식점) + 카카오 로컬(역·터미널·숙소 등)을 합쳐 돌려준다.
// 한쪽이 실패해도 다른 쪽 결과는 주고 partial: true 로 알린다. 둘 다 실패하면 오류.
export async function search(params) {
  const query = parseQuery(params.get('q'));
  return cached('search:' + query, 10 * 60, async () => {
    const [tour, kakao] = await Promise.allSettled([searchTour(query), searchKakao(query)]);
    if (tour.status === 'rejected' && kakao.status === 'rejected') throw tour.reason;
    // 같은 이름·같은 자리의 중복은 TourAPI 쪽을 남긴다.
    const places = [...(tour.value ?? []), ...(kakao.value ?? [])];
    const seen = new Set();
    const unique = places.filter((place) => {
      const key = place.name + '@' + place.lat.toFixed(3) + ',' + place.lng.toFixed(3);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { places: unique, partial: tour.status === 'rejected' || kakao.status === 'rejected' };
  });
}

// /api/detail?id=tour-12-294452 → "가기 전 확인할 것". 카카오 장소는 상세 정보가 없다.
export async function detail(params) {
  const id = parsePlaceId(params.get('id'));
  if (id.source === 'kakao') return { detail: EMPTY_DETAIL };
  return cached('detail:' + id.typeId + ':' + id.contentId, 6 * 60 * 60, async () => ({
    detail: await tourDetail(id.typeId, id.contentId),
  }));
}

// /api/matrix?mode=transit&points=lat,lng;lat,lng&date=2026-10-20&time=09:00
// → { minutes[i][j], distanceKm[i][j] }  (null = 경로 없음)
export async function matrix(params) {
  const mode = parseMode(params.get('mode'));
  const points = parsePoints(params.get('points'));
  const pointKey = points.map((p) => p.lat + ',' + p.lng).join(';');

  if (mode === 'car') {
    // 자동차는 날짜·시각을 쓰지 않는다(카카오모빌리티는 현재 교통 기준).
    return cached('matrix:car:' + pointKey, 30 * 60, async () => {
      const legs = await carMatrix(points);
      return {
        minutes: legs.map((row) => row.map((leg) => leg?.minutes ?? null)),
        distanceKm: legs.map((row) => row.map((leg) => leg?.distanceKm ?? null)),
      };
    });
  }
  const when = parseWhen(params.get('date'), params.get('time'));
  return cached('matrix:transit:' + when + ':' + pointKey, 30 * 60, () => transitMatrix(points, when));
}

// /api/leg?from=lat,lng&to=lat,lng&date=...&time=... → { rides: [탑승 교통수단들] } (노선·탑승 시간·배차 간격). 화면에 나오는 구간만 부른다.
export async function leg(params) {
  const [from, to] = parsePoints(params.get('from') + ';' + params.get('to'));
  const when = parseWhen(params.get('date'), params.get('time'));
  const key = 'leg:' + when + ':' + from.lat + ',' + from.lng + '>' + to.lat + ',' + to.lng;
  return cached(key, 30 * 60, async () => ({ rides: await transitRides(from, to, when) }));
}

export { ApiError };
