// 서울 2차 확인. 서비스에는 쓰이지 않는다.
//   node --env-file=.env.local scripts/check-seoul-2.mjs
// A) 우리 서버 코드(transitRides)로 지하철 배차 간격 어림이 되는지  B) TourAPI 관광지 검색이 왜 비는지
// 키는 출력에서 가려진다. 결과(출력)를 Claude에게 붙여 주세요.
import { transitRides } from '../server/clients/googleRoutes.js';

const KEY = process.env.TOURAPI_KEY;

// 다음 평일(월~금) 10:00 한국시간
const date = new Date(Date.now() + 24 * 3600 * 1000);
for (;;) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(date);
  if (label !== 'Sat' && label !== 'Sun') break;
  date.setTime(date.getTime() + 24 * 3600 * 1000);
}
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
const when = new Date(day + 'T10:00:00+09:00').toISOString();

const P = {
  서울역: { lat: 37.5547, lng: 126.9707 },
  강남역: { lat: 37.4979, lng: 127.0276 },
  경복궁: { lat: 37.5796, lng: 126.977 },
  홍대입구역: { lat: 37.5572, lng: 126.9245 },
};

console.log('=== A) 대중교통 탑승 정보 (평일 ' + day + ' 10:00 KST) ===');
for (const [a, b] of [['서울역', '강남역'], ['서울역', '경복궁'], ['홍대입구역', '강남역']]) {
  try {
    const rides = await transitRides(P[a], P[b], when);
    console.log('\n' + a + ' → ' + b);
    console.log(JSON.stringify(rides, null, 1).replace(/\n\s*/g, ' '));
  } catch (error) {
    console.log('\n' + a + ' → ' + b + ' 실패:', error.code ?? error.name);
  }
}

console.log('\n=== B) TourAPI 관광지 검색 진단 ===');
const url = (op, params) =>
  'https://apis.data.go.kr/B551011/KorService2/' + op + '?' +
  new URLSearchParams({ serviceKey: KEY, MobileOS: 'ETC', MobileApp: 'Itda', _type: 'json', ...params });
async function tour(label, op, params) {
  try {
    const res = await fetch(url(op, params));
    const text = await res.text();
    let summary;
    try {
      const body = JSON.parse(text).response.body;
      const items = body.items === '' ? [] : [].concat(body.items.item);
      summary = '총 ' + body.totalCount + '건: ' + items.map((i) => i.title + '(' + i.contenttypeid + ')').join(', ');
    } catch {
      summary = 'HTTP ' + res.status + ' ' + text.slice(0, 200);
    }
    console.log('- ' + label + ' → ' + summary.replace(KEY, '***'));
  } catch (error) {
    console.log('- ' + label + ' 실패');
  }
}
await tour('경복궁 (지역·유형 필터 없음)', 'searchKeyword2', { keyword: '경복궁', numOfRows: '5' });
await tour('경복궁 (areaCode=1만)', 'searchKeyword2', { keyword: '경복궁', areaCode: '1', numOfRows: '5' });
await tour('경복 (areaCode=1, 관광지12)', 'searchKeyword2', { keyword: '경복', areaCode: '1', contentTypeId: '12', numOfRows: '5' });
await tour('북촌 (areaCode=1, 관광지12)', 'searchKeyword2', { keyword: '북촌', areaCode: '1', contentTypeId: '12', numOfRows: '5' });
await tour('남산 (areaCode=1, 관광지12)', 'searchKeyword2', { keyword: '남산', areaCode: '1', contentTypeId: '12', numOfRows: '5' });
await tour('서울 전체 관광지 목록(areaBasedList2)', 'areaBasedList2', { areaCode: '1', contentTypeId: '12', numOfRows: '5' });
await tour('경복궁 좌표 반경 1km 관광지(locationBasedList2)', 'locationBasedList2', { mapX: '126.977', mapY: '37.5796', radius: '1000', contentTypeId: '12', numOfRows: '8' });
console.log('\n끝. 위 출력을 Claude에게 붙여 주세요.');
