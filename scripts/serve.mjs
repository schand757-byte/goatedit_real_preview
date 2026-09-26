// ============================================================
// Serves a local build (`npm run preview`): the gallery from dist/, and the
// templates' own files from templates/, the way the CDN serves them — open to
// any origin, and in byte ranges, which is how the editor seeks a video
// without fetching all of it.
//
// Point a local editor at it with VITE_PROJECT_TEMPLATES=http://localhost:4174.
// ============================================================

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4174);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
};

createServer(async (req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'range',
    'access-control-expose-headers': '*',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const base = path.startsWith('/templates/') ? ROOT : join(ROOT, 'dist');
  let file = join(base, path);
  if (path.endsWith('/')) file = join(file, 'index.html');

  let size;
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    size = s.size;
  } catch {
    res.writeHead(404, { ...cors, 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }

  const head = { ...cors, 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'accept-ranges': 'bytes' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { ...head, 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...head, 'content-length': size });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Gallery on http://localhost:${PORT}`);
  console.log(`Editor against it: VITE_PROJECT_TEMPLATES=http://localhost:${PORT} npm run dev`);
});
