// Vercel 서버 함수: /api/matrix  (실제 일은 server/services.js 의 matrix)
import { makeHandler } from '../server/lib/http.js';
import { matrix } from '../server/services.js';

export default makeHandler(matrix, 1800);
