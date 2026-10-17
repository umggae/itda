// 아주 단순한 메모리 캐시. 서버 함수가 살아 있는 동안만 유지된다(절약용이지 보관용이 아님).
const store = new Map();
const MAX_ENTRIES = 1000;

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlSeconds) {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value); // 가장 오래된 것부터 버림
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

// 캐시에 있으면 그것을, 없으면 work()를 실행해 저장한다.
export async function cached(key, ttlSeconds, work) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await work();
  cacheSet(key, value, ttlSeconds);
  return value;
}
