// Vercel 서버 함수: /api/detail  (실제 일은 server/services.js 의 detail)
import { makeHandler } from '../server/lib/http.js';
import { detail } from '../server/services.js';

export default makeHandler(detail, 3600);
