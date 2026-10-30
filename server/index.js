import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImportMiddleware } from './import-media.js';

const root=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.ttf':'font/ttf','.txt':'text/plain'};
const importer=createImportMiddleware();
const server=createServer((req,res) => importer(req,res,async () => {
  try {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const url=new URL(req.url,'http://localhost');
    const file=path.resolve(root,`.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!file.startsWith(root) || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Content-Length':body.length,'X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('Not found'); }
}));
server.requestTimeout=180000;
server.listen(Number(process.env.PORT || 5173),process.env.HOST || '127.0.0.1',() => console.log(`FreeMemes: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 5173}`));
