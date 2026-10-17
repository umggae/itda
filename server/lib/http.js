// 서버 함수 공통 틀. api/ 폴더의 파일은 이걸로 감싸서 쓴다.
// 오류 메시지에는 인증키나 외부 API 주소가 절대 들어가지 않게, 우리가 만든 문장만 내보낸다.
import { ApiError } from './errors.js';

export function sendJson(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 성공 응답만 CDN(Vercel)에 잠깐 캐시해 같은 요청의 외부 API 호출을 줄인다.
  const cache =
    status === 200 && cacheSeconds > 0
      ? 'public, s-maxage=' + cacheSeconds + ', stale-while-revalidate=' + cacheSeconds
      : 'no-store';
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

// work(params) → 응답 객체. params는 주소의 ?뒤 값들(URLSearchParams).
export function makeHandler(work, cacheSeconds) {
  return async function handler(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { code: 'BAD_REQUEST', message: 'GET 요청만 받습니다.' } });
      return;
    }
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      sendJson(res, 200, await work(params), cacheSeconds);
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, { error: { code: error.code, message: error.message } });
      } else {
        // 예상 못 한 오류: 원인 문장에 주소·키가 섞일 수 있으니 종류(name)만 남긴다.
        console.error('예상하지 못한 서버 오류:', error?.name);
        sendJson(res, 500, { error: { code: 'INTERNAL', message: '서버에서 알 수 없는 오류가 났습니다.' } });
      }
    }
  };
}
