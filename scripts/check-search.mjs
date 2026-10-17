// 수정한 "검색"(서버 코드 그대로)이 서울 명소를 제대로 찾는지, 상세 정보가 오는지 확인한다. 서비스에는 쓰이지 않는다.
//   node --env-file=.env.local scripts/check-search.mjs
import { search, detail } from '../server/services.js';

const labels = { attraction: '여행지', restaurant: '음식점', hub: '거점·기타' };

for (const q of ['경복궁', '북촌', '남산', '광장시장', '설렁탕', '서울역']) {
  try {
    const { places, partial } = await search(new URLSearchParams({ q }));
    console.log('\n검색 "' + q + '"' + (partial ? ' (일부 출처 실패)' : '') + ' → ' + places.length + '곳');
    for (const p of places.slice(0, 6)) {
      console.log('  - [' + labels[p.category] + '/' + p.source + '] ' + p.name + ' · ' + p.address + ' (' + p.id + ')');
    }
  } catch (error) {
    console.log('\n검색 "' + q + '" 실패:', error.code ?? error.name);
  }
}

// 경복궁(관광지)의 "가기 전 확인할 것"
try {
  const { places } = await search(new URLSearchParams({ q: '경복궁' }));
  const target = places.find((p) => p.id.startsWith('tour-12-'));
  if (!target) console.log('\n(경복궁 관광지가 TourAPI 결과에 없음)');
  else {
    const result = await detail(new URLSearchParams({ id: target.id }));
    console.log('\n상세 ' + target.name + ' (' + target.id + '):', JSON.stringify(result.detail));
  }
} catch (error) {
  console.log('\n상세 조회 실패:', error.code ?? error.name);
}
console.log('\n끝. 위 출력을 Claude에게 붙여 주세요.');
