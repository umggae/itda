// 내 컴퓨터에서 Vercel처럼 돌려 보는 개발 서버. (배포용이 아님)
//   node --env-file=.env.local scripts/dev-server.mjs      → http://localhost:8765
// 화면 파일(index.html, css/, js/)과 /api/* 서버 함수만 내보낸다. .env 같은 파일은 절대 내보내지 않는다.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8765);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const API_NAMES = new Set(['search', 'detail', 'matrix', 'leg']);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const apiName = /^\/api\/([a-z]+)$/.exec(url.pathname)?.[1];
    if (apiName) {
      if (!API_NAMES.has(apiName)) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const module = await import(pathToFileURL(join(ROOT, 'api', apiName + '.js')));
      await module.default(req, res);
      return;
    }

    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const allowed = path === '/index.html' || path.startsWith('/css/') || path.startsWith('/js/');
    const file = normalize(join(ROOT, path));
    if (!allowed || !file.startsWith(ROOT) || path.includes('..')) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    try {
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store'); // 개발 중에는 브라우저가 옛 파일을 기억하지 않게
      res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  })
  .listen(PORT, () => console.log('http://localhost:' + PORT + ' 에서 실행 중 (끄려면 Ctrl+C)'));
