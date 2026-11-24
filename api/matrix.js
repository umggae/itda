// Vercel 서버 함수: /api/matrix  (실제 일은 server/services.js 의 matrix)
import { makeHandler } from '../server/lib/http.js';
import { matrix, matrixCacheSeconds } from '../server/services.js';

// 자동차(카카오모빌리티)만 30분 캐시하고, 대중교통(구글 Routes) 응답은 캐시하지 않는다.
export default makeHandler(matrix, matrixCacheSeconds);
