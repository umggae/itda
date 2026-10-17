// 검색 결과 정리: 같은 장소의 중복 제거, 검색어와 잘 맞는 순서로 정렬. (순수 함수)

// 이름이 같고 500m 안에 있는 장소는 같은 곳으로 보고, 먼저 나온 것(TourAPI)만 남긴다.
// TourAPI 쪽이 쉬는 날·이용시간 같은 상세 정보를 가지고 있기 때문이다.
export function dedupeSameName(places) {
  const kept = [];
  for (const place of places) {
    const duplicate = kept.some(
      (other) =>
        other.name.trim() === place.name.trim() &&
        Math.abs(other.lat - place.lat) < 0.005 &&
        Math.abs(other.lng - place.lng) < 0.005,
    );
    if (!duplicate) kept.push(place);
  }
  return kept;
}

// 이름이 검색어와 같으면 0, 검색어로 시작하면 1, 포함하면 2, 그 밖에는 3. 점수가 같으면 원래 순서를 지킨다.
export function rankPlaces(places, query) {
  const q = query.trim();
  const score = (place) => {
    const name = place.name.trim();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    return name.includes(q) ? 2 : 3;
  };
  return places
    .map((place, index) => ({ place, index, score: score(place) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.place);
}
