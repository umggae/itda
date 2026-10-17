// MockProvider: 개발·테스트용 고정 데이터.
// 화면과 계산 로직은 아래 함수만 쓴다. (StaticProvider도 같은 모양으로 만든다)
//   searchPlaces(query)       → 장소 목록 (출발지·도착지·들를 곳 모두 이걸로 검색)
//   getPlaceDetail(id)        → "가기 전 확인할 것" 정보
//   getMatrix({places, mode, date, time}) → 장소 전체의 이동시간표 (Map "출발id>도착id" → { minutes, distanceKm, summary })
//   getLegRides(...)          → (선택) 대중교통 구간의 탑승 정보(노선·탑승 시간·배차 간격)
//   getMeta()                 → { source, updatedAt, live } (화면 하단 표기용)
// 아래 장소 이름은 서울 실제 장소를 빌렸지만, 좌표·상세 정보는 개발용 가짜 값이다.

const HUBS = [
  { id: 'hub-seoul-station', name: '서울역', category: 'hub', lat: 37.5547, lng: 126.9707 },
  { id: 'hub-gangnam', name: '강남역', category: 'hub', lat: 37.4979, lng: 127.0276 },
  { id: 'hub-hongdae', name: '홍대입구역', category: 'hub', lat: 37.5572, lng: 126.9245 },
];

const PLACES = [
  { id: 'p-gyeongbok', name: '경복궁', category: 'attraction', lat: 37.5796, lng: 126.977 },
  { id: 'p-namsan', name: '남산서울타워', category: 'attraction', lat: 37.5512, lng: 126.9882 },
  { id: 'p-hangang', name: '여의도한강공원', category: 'attraction', lat: 37.5284, lng: 126.9326 },
  { id: 'p-bukchon', name: '북촌한옥마을', category: 'attraction', lat: 37.5826, lng: 126.983 },
  { id: 'p-gwangjang', name: '광장시장', category: 'attraction', lat: 37.5701, lng: 126.9996 },
  { id: 'r-seolleongtang', name: '설렁탕집(목업)', category: 'restaurant', lat: 37.5705, lng: 126.9855 },
  { id: 'r-naengmyeon', name: '냉면집(목업)', category: 'restaurant', lat: 37.5614, lng: 126.9996 },
];

const DETAILS = {
  'p-gyeongbok': {
    closedDays: '연중무휴',
    hours: '09:00~18:00',
    parking: '마을 입구 공영주차장(소규모)',
    reservation: '필요 없음',
    contact: '051-000-0000',
  },
  'r-seolleongtang': {
    closedDays: '매주 월요일',
    hours: '10:00~21:00 (브레이크타임 15:00~17:00)',
    parking: '주차 불가, 근처 공영주차장 이용',
    reservation: '필요 없음',
    contact: '051-000-0001',
  },
};
const EMPTY_DETAIL = { closedDays: null, hours: null, parking: null, reservation: null, contact: null, homepage: null };

const ALL = [...HUBS, ...PLACES];
const byId = (id) => ALL.find((place) => place.id === id);

// 두 좌표 사이의 직선거리(km). 목업 이동시간을 만들 때만 쓴다.
function straightKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const mockProvider = {
  name: 'mock',

  async searchPlaces(query) {
    const text = String(query ?? '').trim();
    if (text === '') return [];
    return ALL.filter((place) => place.name.includes(text));
  },

  // 화면 하단에 보여 줄 데이터 출처와 갱신일.
  async getMeta() {
    return { source: '목업 데이터(개발용 가짜 값)', updatedAt: null, live: false };
  },

  async getPlaceDetail(id) {
    return DETAILS[id] ?? EMPTY_DETAIL;
  },

  // 같은 입력이면 항상 같은 값. 대중교통은 느리고(시속 약 18km + 대기 10분),
  // 자동차는 빠르다(시속 약 35km + 5분). 길 굽음을 반영해 직선거리의 1.3배로 본다.
  async getLeg(from, to, mode) {
    const a = byId(from);
    const b = byId(to);
    if (!a || !b || from === to) return null;
    const distanceKm = Math.round(straightKm(a, b) * 1.3 * 10) / 10;
    if (mode === 'car') {
      const minutes = Math.round((distanceKm / 35) * 60 + 5);
      return { minutes, distanceKm, summary: '자동차 ' + distanceKm + 'km' };
    }
    const minutes = Math.round((distanceKm / 18) * 60 + 10);
    return { minutes, distanceKm, summary: '대중교통 (목업) 버스 1회' };
  },

  // 장소 전체의 이동시간표. 실제 공급자는 한 번에 받고, 목업은 getLeg를 모든 쌍에 부른다.
  async getMatrix({ places, mode }) {
    const table = new Map();
    for (const from of places) {
      for (const to of places) {
        if (from.id !== to.id) table.set(from.id + '>' + to.id, await this.getLeg(from.id, to.id, mode));
      }
    }
    return table;
  },

  // 목업 탑승 정보: 구간마다 버스 1대, 배차 간격 12분(가짜 값).
  async getLegRides({ from, to, mode }) {
    if (mode !== 'transit') return null;
    const leg = await this.getLeg(from.id, to.id, mode);
    return [
      {
        vehicle: '버스', line: '목업' + (leg.minutes % 90), from: from.name, to: to.name,
        stopCount: Math.max(2, Math.round(leg.distanceKm * 1.5)), rideMinutes: Math.max(1, leg.minutes - 10),
        headwayMinutes: 12, color: '#1d6fd1', textColor: '#ffffff',
      },
    ];
  },
};
