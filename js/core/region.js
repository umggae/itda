// 서비스 지역 설정. 지역에 묶인 값은 모두 여기에만 둔다. (서버와 화면이 같이 읽는다)
//   box          : 이 범위 밖의 좌표는 받지 않는다 (남북 위도, 동서 경도). 대한민국을 감싸는 직사각형이다.
//   view         : 장소를 고르기 전에 지도에 다 보이게 할 범위 [[서쪽 경도, 남쪽 위도], [동쪽 경도, 북쪽 위도]]
//   transitCheck : 이 범위를 벗어난 대중교통 일정에는 "시간이 실제와 크게 다를 수 있다"는 경고를 띄운다.
//                  원래 서비스 범위였던 서울 직사각형이라 경기 일부도 안에 들어간다.
//                  전국의 일부 구간을 다른 지도와 비교해 보니 차이가 큰 곳이 있어서 둔 경고다(docs/verification.md).
export const REGION = {
  id: 'korea',
  name: '대한민국',
  box: { minLat: 33.0, maxLat: 38.7, minLng: 124.5, maxLng: 131.9 },
  view: [[126.0, 33.2], [129.6, 38.4]], // 제주부터 강원 북부까지
  transitCheck: { name: '서울', box: { minLat: 37.4, maxLat: 37.73, minLng: 126.73, maxLng: 127.28 } },
};

export function isInBox({ lat, lng }, box) {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;
}

// 대중교통 일정의 장소 중 하나라도 경고 기준 범위 밖이면 true. 자동차에는 쓰지 않는다.
export function needsTransitWarning(mode, places) {
  return mode === 'transit' && places.some((place) => !isInBox(place, REGION.transitCheck.box));
}
