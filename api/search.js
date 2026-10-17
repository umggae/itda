// Vercel 서버 함수: /api/search  (실제 일은 server/services.js 의 search)
import { makeHandler } from '../server/lib/http.js';
import { search } from '../server/services.js';

export default makeHandler(search, 600);
