// 카카오모빌리티 길찾기(자동차). 한 번에 한 쌍만 되므로 구간마다 부르고, 같은 쌍은 캐시한다.
// (다중 목적지 API는 반경 10km 제한이라 도시 전체에는 쓸 수 없다.)
// 필드: routes[0].result_code(0이면 성공), routes[0].summary.distance(m), .duration(초)
import { upstream, rateLimit, notConfigured } from '../lib/errors.js';
import { cacheGet, cacheSet } from '../lib/cache.js';

const CONCURRENCY = 6; // 동시에 보내는 호출 수 (한도 보호)
const CACHE_SECONDS = 30 * 60;

// 응답 글자 → { minutes, distanceKm } 또는 null(경로 없음)
export function parseCarRoute(bodyText) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw upstream();
  }
  const route = json?.routes?.[0];
  if (!route || route.result_code !== 0 || !route.summary) return null;
  return {
    minutes: Math.max(1, Math.round(route.summary.duration / 60)),
    distanceKm: Math.round(route.summary.distance / 100) / 10,
  };
}

async function carLeg(from, to) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) throw notConfigured();
  const cacheKey = 'car:' + from.lat + ',' + from.lng + '>' + to.lat + ',' + to.lng;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) return hit;

  // 좌표는 경도,위도 순서
  const url =
    'https://apis-navi.kakaomobility.com/v1/directions?' +
    new URLSearchParams({
      origin: from.lng + ',' + from.lat,
      destination: to.lng + ',' + to.lat,
      summary: 'true',
    });
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + key }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw upstream('카카오모빌리티 서비스에 연결하지 못했습니다.');
  }
  if (res.status === 429) throw rateLimit();
  if (res.status === 401 || res.status === 403) throw notConfigured();
  // 400번대 나머지는 "출발·도착이 도로에서 먼 곳" 같은 경로 없음으로 본다.
  const leg = res.ok ? parseCarRoute(await res.text()) : null;
  cacheSet(cacheKey, leg, CACHE_SECONDS);
  return leg;
}

// points: [{lat,lng}] → 결과 배열 [i][j] (대각선과 경로 없음은 null)
export async function carMatrix(points) {
  const jobs = [];
  points.forEach((from, i) => points.forEach((to, j) => i !== j && jobs.push([i, j, from, to])));
  const table = points.map(() => points.map(() => null));

  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [i, j, from, to] = jobs[next++];
      table[i][j] = await carLeg(from, to);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return table;
}
