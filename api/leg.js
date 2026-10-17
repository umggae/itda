// Vercel 서버 함수: /api/leg  (실제 일은 server/services.js 의 leg)
import { makeHandler } from '../server/lib/http.js';
import { leg } from '../server/services.js';

export default makeHandler(leg, 1800);
