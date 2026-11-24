// 캐시 정책 테스트. 구글 Routes API 결과(대중교통 이동시간·탑승 정보)는 약관상 캐시하면 안 되어서,
// 서버 메모리 캐시와 CDN 캐시(Cache-Control 헤더) 둘 다 끄고, 자동차(카카오모빌리티)만 캐시한다.
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeHandler } from '../server/lib/http.js';
import { matrix, leg, matrixCacheSeconds, legCacheSeconds } from '../server/services.js';

function fakeRes() {
  const headers = {};
  return {
    headers,
    statusCode: null,
    setHeader(key, value) {
      headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

async function run(handler, url) {
  const res = fakeRes();
  await handler({ method: 'GET', url }, res);
  return res;
}

test('makeHandler: 캐시 초가 숫자면 그대로, 0이면 no-store', async () => {
  const work = async () => ({ ok: true });
  const cachedRes = await run(makeHandler(work, 600), '/api/x');
  assert.equal(cachedRes.headers['Cache-Control'], 'public, s-maxage=600, stale-while-revalidate=600');
  const noCache = await run(makeHandler(work, 0), '/api/x');
  assert.equal(noCache.headers['Cache-Control'], 'no-store');
});

test('makeHandler: 캐시 초를 함수로 주면 요청마다 정한다', async () => {
  const work = async () => ({ ok: true });
  const handler = makeHandler(work, (params) => (params.get('mode') === 'car' ? 1800 : 0));
  assert.equal((await run(handler, '/api/x?mode=car')).headers['Cache-Control'], 'public, s-maxage=1800, stale-while-revalidate=1800');
  assert.equal((await run(handler, '/api/x?mode=transit')).headers['Cache-Control'], 'no-store');
});

test('makeHandler: 오류 응답은 캐시하지 않는다', async () => {
  const handler = makeHandler(async () => {
    throw new Error('실패');
  }, 1800);
  const res = await run(handler, '/api/x');
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('CDN 캐시: 구글 결과(대중교통, 구간 상세)는 0초, 자동차(카카오)만 30분', () => {
  assert.equal(matrixCacheSeconds(new URLSearchParams('mode=transit')), 0);
  assert.equal(matrixCacheSeconds(new URLSearchParams('mode=car')), 30 * 60);
  assert.equal(legCacheSeconds, 0);
});

test('서버 캐시: 대중교통 이동시간·구간 상세는 같은 요청을 두 번 보내면 구글을 두 번 부른다', async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.GOOGLE_ROUTES_API_KEY;
  const calls = [];
  const matrixBody = JSON.stringify([
    { originIndex: 0, destinationIndex: 1, duration: '600s', distanceMeters: 3000, condition: 'ROUTE_EXISTS' },
    { originIndex: 1, destinationIndex: 0, duration: '620s', distanceMeters: 3000, condition: 'ROUTE_EXISTS' },
  ]);
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { status: 200, text: async () => (String(url).includes('computeRouteMatrix') ? matrixBody : '{}') };
  };
  process.env.GOOGLE_ROUTES_API_KEY = 'test-key'; // 가짜 값. 실제 호출은 위에서 가로챈다
  try {
    const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // 한국 날짜 기준 오늘
    const matrixParams = () => new URLSearchParams({ mode: 'transit', points: '37.5547,126.9707;37.4979,127.0276', date, time: '12:00' });
    const first = await matrix(matrixParams());
    const second = await matrix(matrixParams());
    assert.deepEqual(first.minutes, [[null, 10], [10, null]]);
    assert.deepEqual(second, first);
    assert.equal(calls.filter((url) => url.includes('computeRouteMatrix')).length, 2, '같은 이동시간 요청이 구글에 두 번 나가야 한다');

    const legParams = () => new URLSearchParams({ from: '37.5547,126.9707', to: '37.4979,127.0276', date, time: '12:00' });
    await leg(legParams());
    await leg(legParams());
    assert.equal(calls.filter((url) => url.includes('computeRoutes')).length, 2, '같은 구간 상세 요청이 구글에 두 번 나가야 한다');
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GOOGLE_ROUTES_API_KEY;
    else process.env.GOOGLE_ROUTES_API_KEY = realKey;
  }
});
