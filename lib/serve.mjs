// Service de fichiers statiques partagé par la prévisualisation (npm run dev) et le Studio.
import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

// Résout un chemin d'URL dans rootDir ; renvoie null si le chemin tente d'en sortir ou n'existe pas.
export function resolveInside(rootDir, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel.includes('\0')) return null;
  let f = path.normalize(path.join(rootDir, rel));
  if (f !== rootDir && !f.startsWith(rootDir + path.sep)) return null;
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  return fs.existsSync(f) && fs.statSync(f).isFile() ? f : null;
}

export function sendFile(res, file, headers = {}) {
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  fs.createReadStream(file).pipe(res);
}

export function serveStatic(roots, urlPath, res, { notFound } = {}) {
  for (const root of [].concat(roots)) {
    const f = resolveInside(root, urlPath);
    if (f) return sendFile(res, f);
  }
  const page = notFound && fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Introuvable';
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(page);
}
