// Google Routes API: 대중교통만 쓴다. (자동차는 한국에서 ROUTE_NOT_FOUND라 카카오모빌리티로 대체)
// 매트릭스 응답 필드(실제 확인): originIndex, destinationIndex, duration("2493s"), distanceMeters, condition
import { upstream, rateLimit, notConfigured } from '../lib/errors.js';

const waypoint = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

const VEHICLE_NAME = {
  BUS: '버스',
  INTERCITY_BUS: '시외버스',
  SUBWAY: '지하철',
  TRAM: '트램',
  HEAVY_RAIL: '열차',
  COMMUTER_TRAIN: '열차',
  HIGH_SPEED_TRAIN: '고속열차',
  LONG_DISTANCE_TRAIN: '열차',
  RAIL: '열차',
  FERRY: '배',
};

// ---------- 응답 해석 (순수 함수) ----------

function latLng(stop) {
  const point = stop?.location?.latLng;
  return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) ? { lat: point.latitude, lng: point.longitude } : null;
}

const seconds = (text) => (typeof text === 'string' && /^\d+s$/.test(text) ? parseInt(text, 10) : null);

// 매트릭스 응답 글자 → { minutes[i][j], distanceKm[i][j] } (경로 없음·대각선은 null). 순서는 보장되지 않으므로 index로 맞춘다.
export function parseTransitMatrix(bodyText, size) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw upstream();
  }
  if (!Array.isArray(json)) throw classifyError(json);
  const minutes = Array.from({ length: size }, () => Array(size).fill(null));
  const distanceKm = Array.from({ length: size }, () => Array(size).fill(null));
  for (const element of json) {
    if (element.error) throw classifyError(element);
    const { originIndex: i, destinationIndex: j } = element;
    const sec = seconds(element.duration);
    if (i === j || element.condition !== 'ROUTE_EXISTS' || sec === null) continue;
    minutes[i][j] = Math.max(1, Math.round(sec / 60));
    distanceKm[i][j] = Math.round((element.distanceMeters ?? 0) / 100) / 10;
  }
  return { minutes, distanceKm };
}

function classifyError(json) {
  const status = json?.error?.status;
  if (status === 'RESOURCE_EXHAUSTED' || json?.error?.code === 429) return rateLimit();
  if (status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') return notConfigured();
  return upstream();
}

// 경로 1건 응답 → { rides, walkBeforeSec }. 해석 불가면 null.
//   rides: 탑승한 교통수단 목록(도보만이면 빈 배열)
//   walkBeforeSec: 첫 탑승 전에 걷는 시간(초). 알 수 없으면 null
// 구간 출발 시각이 일정에 따라 조금씩 달라지므로, "정확히 몇 시 차"보다
// "얼마나 타는지(탑승 시간)"와 "얼마나 자주 오는지(배차 간격)"를 보여 주려고 이 두 값을 뽑는다.
//   탑승 시간 = 하차 시각 - 승차 시각 (stopDetails.arrivalTime / departureTime)
//   배차 간격 = transitDetails.headway ("1200s"). 버스는 오지만 지하철은 오지 않는다 → 아래 estimateHeadway로 어림한다.
function parseRoute(bodyText) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw upstream();
  }
  const steps = json?.routes?.[0]?.legs?.[0]?.steps;
  if (!Array.isArray(steps)) return null;

  const rides = steps
    .filter((step) => step.transitDetails)
    .map((step) => {
      const ride = step.transitDetails;
      const line = ride.transitLine ?? {};
      const stops = ride.stopDetails ?? {};
      const boarded = Date.parse(stops.departureTime);
      const alighted = Date.parse(stops.arrivalTime);
      const headwaySec = seconds(ride.headway);
      return {
        vehicle: VEHICLE_NAME[line.vehicle?.type] ?? '대중교통',
        line: line.nameShort || line.name || '',
        from: stops.departureStop?.name ?? '',
        to: stops.arrivalStop?.name ?? '',
        stopCount: Number.isInteger(ride.stopCount) ? ride.stopCount : null,
        boardAt: Number.isFinite(boarded) ? stops.departureTime : null, // 승차 시각(어림 계산에만 쓰고 화면에는 보여 주지 않음)
        fromLoc: latLng(stops.departureStop), // 승·하차 정류장 좌표(환승 뒤 탑승의 배차 간격을 어림할 때만 씀)
        toLoc: latLng(stops.arrivalStop),
        rideMinutes: Number.isFinite(boarded) && Number.isFinite(alighted) ? Math.max(1, Math.round((alighted - boarded) / 60000)) : null,
        headwayMinutes: headwaySec === null ? null : Math.max(1, Math.round(headwaySec / 60)),
        headwayEstimated: false,
        color: /^#[0-9a-fA-F]{6}$/.test(line.color ?? '') ? line.color : null,
        textColor: /^#[0-9a-fA-F]{6}$/.test(line.textColor ?? '') ? line.textColor : null,
      };
    });

  // 첫 탑승 전 도보 시간: 걷는 단계들의 staticDuration("120s")을 더한다. 하나라도 없으면 알 수 없음(null).
  let walkBeforeSec = 0;
  for (const step of steps) {
    if (step.transitDetails) break;
    const sec = seconds(step.staticDuration);
    if (sec === null) {
      walkBeforeSec = null;
      break;
    }
    walkBeforeSec += sec;
  }
  return { rides, walkBeforeSec };
}

export function parseTransitRides(bodyText) {
  return parseRoute(bodyText)?.rides ?? null;
}

// 배차 간격 어림: 첫 열차(first)를 막 놓치는 시각에 한 번 더 조회해, 같은 노선의 다음 차와의 시각 차이를 구한다.
// 같은 노선·같은 승차 정류장이 아니거나, 간격이 1~60분을 벗어나면 믿지 않고 null.
export function nextDepartureGapMinutes(nextRides, first) {
  const next = nextRides.find((ride) => ride.line === first.line && ride.from === first.from && ride.boardAt);
  if (!next || !first.boardAt) return null;
  const gap = Math.round((Date.parse(next.boardAt) - Date.parse(first.boardAt)) / 60000);
  return gap >= 1 && gap <= 60 ? gap : null;
}

// ---------- 호출 ----------

async function post(url, fieldMask, body) {
  const key = process.env.GOOGLE_ROUTES_API_KEY;
  if (!key) throw notConfigured();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw upstream('Google 경로 서비스에 연결하지 못했습니다.');
  }
  if (res.status === 429) throw rateLimit();
  if (res.status === 401 || res.status === 403) throw notConfigured();
  return res.text();
}

// 8×8=64칸이라 대중교통 한도(100칸) 안에서 한 번에 받는다. when: ISO 시각
export async function transitMatrix(points, when) {
  const text = await post(
    'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
    'originIndex,destinationIndex,duration,distanceMeters,condition',
    {
      origins: points.map((p) => ({ waypoint: waypoint(p) })),
      destinations: points.map((p) => ({ waypoint: waypoint(p) })),
      travelMode: 'TRANSIT',
      departureTime: when,
    },
  );
  return parseTransitMatrix(text, points.length);
}

async function fetchRoute(from, to, when) {
  const text = await post(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    'routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails',
    { origin: waypoint(from), destination: waypoint(to), travelMode: 'TRANSIT', departureTime: when, languageCode: 'ko' },
  );
  return parseRoute(text);
}

// 배차 간격이 없는 탑승 하나의 간격을 어림한다. (어림 방법은 nextDepartureGapMinutes 설명 참고)
//   첫 탑승: 출발지에서 걷는 시간을 알고 있으므로, 첫 열차를 막 놓치는 시각에 출발하는 경로를 한 번 더 조회한다.
//   환승 뒤 탑승: 그 탑승의 승차 정류장 → 하차 정류장을 따로 조회한다. 정류장 안 걷는 시간을 알려고 먼저 한 번 보고,
//                걷는 시간이 있으면 그만큼 앞당겨 다시 조회한다.
async function estimateRideHeadway(ride, from, to, walkBeforeSec, isFirst) {
  const boardMs = Date.parse(ride.boardAt);
  const leave = (ms) => new Date(ms).toISOString();
  let again;
  if (isFirst) {
    again = await fetchRoute(from, to, leave(boardMs - walkBeforeSec * 1000 + 60 * 1000));
  } else {
    if (!ride.fromLoc || !ride.toLoc) return null;
    again = await fetchRoute(ride.fromLoc, ride.toLoc, leave(boardMs + 60 * 1000));
    if (again?.walkBeforeSec > 0) again = await fetchRoute(ride.fromLoc, ride.toLoc, leave(boardMs - again.walkBeforeSec * 1000 + 60 * 1000));
  }
  return again ? nextDepartureGapMinutes(again.rides, ride) : null;
}

// 구간의 탑승 정보. 배차 간격이 없는 탑승(주로 지하철)에는 어림값을 채우고 headwayEstimated: true로 표시한다.
// 호출 수를 줄이려고 구간당 최대 2개 탑승까지만 어림한다. 어림에 실패해도(한도·응답 이상 등) 원래 정보는 그대로 돌려준다.
const MAX_ESTIMATES = 2;

export async function transitRides(from, to, when) {
  const route = await fetchRoute(from, to, when);
  if (!route) return null;

  const targets = route.rides
    .map((ride, index) => ({ ride, index }))
    .filter(({ ride, index }) => ride.headwayMinutes === null && ride.boardAt && (index > 0 || route.walkBeforeSec !== null))
    .slice(0, MAX_ESTIMATES);

  await Promise.all(
    targets.map(async ({ ride, index }) => {
      try {
        const gap = await estimateRideHeadway(ride, from, to, route.walkBeforeSec, index === 0);
        if (gap !== null) {
          ride.headwayMinutes = gap;
          ride.headwayEstimated = true;
        }
      } catch {
        // 어림은 덤이므로 실패는 무시
      }
    }),
  );
  return route.rides.map(({ boardAt, fromLoc, toLoc, ...ride }) => ride); // 어림에만 쓴 값은 응답에 싣지 않는다
}
