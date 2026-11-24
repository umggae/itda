// Vercel 서버 함수: /api/leg  (실제 일은 server/services.js 의 leg)
import { makeHandler } from '../server/lib/http.js';
import { leg, legCacheSeconds } from '../server/services.js';

// 구글 Routes 결과라서 캐시하지 않는다(0).
export default makeHandler(leg, legCacheSeconds);
