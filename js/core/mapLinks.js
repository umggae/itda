// 구간별 "지도 앱에서 길찾기" 링크.
// 형식은 카카오맵 공식 문서(apis.map.kakao.com/web/guide, URL 스킴)를 따른다:
//   https://map.kakao.com/link/by/{이동수단}/이름,위도,경도/이름,위도,경도
//   이동수단: car(자동차), traffic(대중교통). 좌표는 위도 다음 경도 순서.
// 네이버 지도는 웹 주소가 아니라 앱 전용 주소(nmap://)뿐이어서 쓰지 않는다.

// 이름에 쉼표나 슬래시가 있으면 주소 형식이 깨지므로 빼고, 한글은 주소용으로 인코딩한다.
function part(place) {
  const name = String(place.name).replace(/[,/]/g, ' ');
  return encodeURIComponent(name) + ',' + place.lat + ',' + place.lng;
}

export function kakaoRouteUrl(mode, from, to) {
  const by = mode === 'car' ? 'car' : 'traffic';
  return 'https://map.kakao.com/link/by/' + by + '/' + part(from) + '/' + part(to);
}
