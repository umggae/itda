// 구간별 "지도 앱에서 길찾기" 링크.
// 형식은 카카오맵 공식 문서(apis.map.kakao.com/web/guide, URL 스킴)를 따른다:
//   https://map.kakao.com/link/by/{이동수단}/이름,위도,경도/이름,위도,경도
//   이동수단: car(자동차), traffic(대중교통). 좌표는 위도 다음 경도 순서.
//
// 네이버 지도는 공식 문서(guide.ncloud-docs.com의 지도 URL Scheme)에 길찾기용 웹 주소가 없고 앱 전용 주소(nmap://)만 있다.
// 그래서 안드로이드에서만, 문서의 모바일 웹 방식인 intent 주소로 연결한다(앱이 없으면 Play 스토어로 이동한다).

// 이름에 쉼표나 슬래시가 있으면 주소 형식이 깨지므로 빼고, 한글은 주소용으로 인코딩한다.
function part(place) {
  const name = String(place.name).replace(/[,/]/g, ' ');
  return encodeURIComponent(name) + ',' + place.lat + ',' + place.lng;
}

export function kakaoRouteUrl(mode, from, to) {
  const by = mode === 'car' ? 'car' : 'traffic';
  return 'https://map.kakao.com/link/by/' + by + '/' + part(from) + '/' + part(to);
}

export function isAndroid(userAgent) {
  return /Android/i.test(String(userAgent ?? ''));
}

// appName: 문서가 모바일 웹에는 웹페이지 주소를 넣으라고 한 필수 값.
export function naverAndroidRouteUrl(mode, from, to, appName) {
  const query = Object.entries({
    slat: from.lat, slng: from.lng, sname: from.name,
    dlat: to.lat, dlng: to.lng, dname: to.name,
    appname: appName,
  })
    .map(([key, value]) => key + '=' + encodeURIComponent(String(value)))
    .join('&');
  return 'intent://route/' + (mode === 'car' ? 'car' : 'public') + '?' + query +
    '#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end';
}
