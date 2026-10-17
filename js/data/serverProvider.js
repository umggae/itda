// ServerProvider: 우리 서버 함수(/api/*)만 부른다. 외부 API(TourAPI, 카카오, Google)는 서버가 부르고,
// 이 파일에는 인증키가 전혀 없다. 인터페이스는 mockProvider와 같다.
import { ProviderError } from './providerError.js';

async function getJson(path, params) {
  let res;
  try {
    res = await fetch(path + '?' + new URLSearchParams(params));
  } catch {
    throw new ProviderError('NETWORK', '서버에 연결하지 못했습니다.');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // JSON이 아니면 아래에서 INTERNAL 처리
  }
  if (!res.ok || !body) {
    throw new ProviderError(body?.error?.code ?? 'INTERNAL', body?.error?.message ?? '서버 응답이 올바르지 않습니다.');
  }
  return body;
}

const point = (place) => place.lat + ',' + place.lng;

export const serverProvider = {
  name: 'server',

  // → 장소 목록 (관광지·음식점·역·터미널·숙소 등). partial이면 일부 출처만 성공한 것.
  async searchPlaces(query) {
    const body = await getJson('/api/search', { q: query });
    const places = body.places;
    places.partial = body.partial === true;
    return places;
  },

  async getPlaceDetail(id) {
    return (await getJson('/api/detail', { id })).detail;
  },

  // 장소 전체의 이동시간표를 한 번에 받는다. 키 "출발id>도착id" → { minutes, distanceKm, summary } 또는 null
  async getMatrix({ places, mode, date, time }) {
    const body = await getJson('/api/matrix', { mode, points: places.map(point).join(';'), date, time });
    const table = new Map();
    places.forEach((from, i) =>
      places.forEach((to, j) => {
        if (i === j) return;
        const minutes = body.minutes[i][j];
        const km = body.distanceKm[i][j];
        table.set(
          from.id + '>' + to.id,
          minutes === null
            ? null
            : {
                minutes,
                distanceKm: km,
                summary: mode === 'car' ? '자동차 ' + km + 'km' : '대중교통 약 ' + minutes + '분',
              },
        );
      }),
    );
    return table;
  },

  // 대중교통 구간의 탑승 정보: [{ vehicle, line, from, to, stopCount, rideMinutes, headwayMinutes, color, textColor }].
  // 도보뿐이면 빈 배열, 못 얻으면 null. 시간표에 실제로 나오는 구간만 부른다.
  async getLegRides({ from, to, mode, date, time }) {
    if (mode !== 'transit') return null;
    return (await getJson('/api/leg', { from: point(from), to: point(to), date, time })).rides;
  },

  async getMeta() {
    return {
      source: '한국관광공사 TourAPI · 카카오 로컬 · Google Routes API · 카카오모빌리티 길찾기',
      live: true,
      updatedAt: null,
    };
  },
};
