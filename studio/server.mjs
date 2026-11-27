// Studio : interface locale pour écrire les articles, gérer le site et publier.
//   npm run studio   -> http://127.0.0.1:4000
//
// Modèle de sécurité (le Studio modifie des fichiers et lance git, il ne doit servir que son propriétaire) :
//   - écoute uniquement sur 127.0.0.1, jamais sur le réseau ;
//   - en-tête Host vérifié (protection contre le DNS rebinding) ;
//   - jeton aléatoire par session exigé sur toute l'API, et Origin vérifié sur les écritures (anti-CSRF) ;
//   - chemins de fichiers construits à partir d'identifiants validés, jamais à partir d'un chemin fourni ;
//   - images vérifiées par leur signature binaire, SVG refusé ;
//   - git appelé sans shell, avec des arguments fixes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROOT, PATHS, loadConfig, saveConfig, loadArticles, parseArticle, serializeArticle, articlePath,
  renderMarkdown, slugify, isValidSlug, isoDate, writeFileAtomic,
} from '../lib/core.mjs';
import { buildSite } from '../lib/site.mjs';
import { articlePage } from '../lib/theme.mjs';
import { ICON_SHAPES } from '../lib/icons.mjs';
import { resolveInside, sendFile } from '../lib/serve.mjs';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
const PORT = Number(process.env.STUDIO_PORT) || 4000;
const HOST = '127.0.0.1';
const TOKEN = crypto.randomBytes(24).toString('hex');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const MAX_JSON = 2 * 1024 * 1024;
const MAX_UPLOAD = 5 * 1024 * 1024;
const CONTENT_PATHS = ['content/articles', 'site.config.json', 'static/assets/uploads'];

const STUDIO_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ------------------------------------------------------------- prévisualisation */
let lastPreview = { ok: false, error: 'Pas encore généré.' };
function rebuildPreview() {
  try {
    lastPreview = { ok: true, at: new Date().toISOString(), ...buildSite({ outDir: PATHS.preview, mode: 'preview' }) };
  } catch (e) {
    lastPreview = { ok: false, at: new Date().toISOString(), error: e.message };
  }
  return lastPreview;
}

/* ------------------------------------------------------------------- requêtes */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Contenu trop volumineux.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Content-Type application/json attendu.');
  const buf = await readBody(req, MAX_JSON);
  try {
    const v = JSON.parse(buf.toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch { throw new HttpError(400, 'JSON invalide.'); }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

function tokenOk(req) {
  const given = Buffer.from(String(req.headers['x-studio-token'] || ''));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/* ------------------------------------------------------------------- articles */
const text = (v, max) => String(v ?? '').slice(0, max);

function articleMeta(a) {
  return {
    slug: a.slug, title: a.title, date: isoDate(a.date), category: a.category, tags: a.tags, summary: a.summary,
    draft: a.draft, cover: a.cover, status: a.status, words: a.words, minutes: a.minutes, problems: a.problems,
  };
}

function readArticle(slug) {
  const file = articlePath(slug);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Article introuvable.');
  const a = parseArticle(fs.readFileSync(file, 'utf8'), slug);
  return { ...articleMeta(a), body: a.body, extra: a.extra, mtime: fs.statSync(file).mtimeMs };
}

function cleanArticleInput(input, previous = {}) {
  const title = text(input.title, 200).trim();
  if (!title) throw new HttpError(400, 'Le titre est obligatoire.');
  const tags = Array.isArray(input.tags) ? input.tags : [];
  const cover = text(input.cover, 300).trim();
  if (cover && !/^\/assets\/uploads\/[A-Za-z0-9._-]+$/.test(cover)) throw new HttpError(400, 'L\'image de couverture doit provenir des médias du site.');
  return {
    title,
    date: text(input.date, 10),
    category: text(input.category, 60).trim() || 'Article',
    tags: [...new Set(tags.map((t) => text(t, 40).trim()).filter(Boolean))].slice(0, 12),
    summary: text(input.summary, 400).trim(),
    cover,
    draft: !!input.draft,
    body: text(input.body, 400_000),
    extra: previous.extra || {},
  };
}

function uniqueSlug(base) {
  const root = slugify(base).slice(0, 80).replace(/-+$/, '') || 'article';
  let slug = root;
  for (let n = 2; fs.existsSync(articlePath(slug)); n++) slug = `${root}-${n}`;
  return slug;
}

const NEW_BODY = `Posez le problème en deux ou trois phrases : à qui s'adresse l'article et ce que le lecteur saura faire à la fin.

## Premier point

Votre contenu.

\`\`\`bash
# un bloc de code est coloré selon le langage indiqué après les trois accents graves
echo "hello"
\`\`\`
`;

/* --------------------------------------------------------------------- médias */
const SIGNATURES = [
  { ext: 'png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', test: (b) => b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { ext: 'webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'avif', test: (b) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && ['avif', 'avis'].includes(b.subarray(8, 12).toString('latin1')) },
];
const MEDIA_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(png|jpg|gif|webp|avif)$/;

function mediaPath(name) {
  if (typeof name !== 'string' || !MEDIA_RE.test(name)) throw new HttpError(400, 'Nom de fichier invalide.');
  return path.join(PATHS.uploads, name);
}

function listMedia() {
  if (!fs.existsSync(PATHS.uploads)) return [];
  const articles = loadArticles({ mode: 'preview' });
  return fs.readdirSync(PATHS.uploads)
    .filter((n) => MEDIA_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(PATHS.uploads, name));
      const ref = `/assets/uploads/${name}`;
      return { name, path: ref, size: st.size, mtime: st.mtimeMs, usedIn: articles.filter((a) => a.cover === ref || a.body.includes(ref)).map((a) => a.slug) };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/* ------------------------------------------------------------------------ git */
function git(args, { timeout = 30_000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, out: String(stdout).trimEnd(), err: String(stderr).trimEnd() }));
  });
}

function samePath(a, b) {
  const norm = (p) => { let r = path.resolve(p); try { r = fs.realpathSync(r); } catch { /* chemin conservé tel quel */ } return process.platform === 'win32' ? r.toLowerCase() : r; };
  return norm(a) === norm(b);
}

const STATUS_LABEL = { M: 'modifié', A: 'ajouté', D: 'supprimé', R: 'renommé', '?': 'nouveau' };

async function gitInfo() {
  const inside = await git(['rev-parse', '--show-toplevel']);
  if (!inside.ok) return { repo: false, reason: /not a git repository/i.test(inside.err) ? 'Ce dossier n\'est pas encore un dépôt Git.' : 'Git est introuvable sur cette machine.' };
  // Si le projet vit dans un sous-dossier d'un dépôt plus grand, on le signale plutôt que de publier ailleurs.
  if (!samePath(inside.out, ROOT)) return { repo: false, reason: `Le dépôt Git détecté (${inside.out}) n'est pas à la racine du projet.` };
  const [branch, remote, status, upstream] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['remote', 'get-url', 'origin']),
    git(['status', '--porcelain=v1', '--untracked-files=all', '--', ...CONTENT_PATHS]),
    git(['rev-list', '--count', '@{u}..HEAD']),
  ]);
  const changes = status.out.split('\n').filter(Boolean).map((l) => {
    const code = l.slice(0, 2).trim()[0] || '?';
    return { file: l.slice(3).replace(/^"|"$/g, ''), state: STATUS_LABEL[code] || code };
  });
  return {
    repo: true,
    branch: branch.ok ? branch.out : '(aucun commit)',
    // Les identifiants éventuellement présents dans l'URL du dépôt ne sont jamais renvoyés à l'interface.
    remote: remote.ok ? remote.out.replace(/\/\/[^@/]+@/, '//') : '',
    hasUpstream: upstream.ok,
    ahead: upstream.ok ? Number(upstream.out) || 0 : 0,
    changes,
  };
}

async function publish({ message, push }) {
  const steps = [];
  const step = (name, r) => { steps.push({ name, ok: r.ok, output: [r.out, r.err].filter(Boolean).join('\n').slice(0, 4000) }); return r.ok; };

  let report;
  try { report = buildSite({ outDir: PATHS.dist, mode: 'production' }); }
  catch (e) { steps.push({ name: 'Build de production', ok: false, output: e.message }); return { ok: false, steps }; }
  steps.push({ name: 'Build de production', ok: true, output: `${report.counts.published} article(s) publié(s), ${report.counts.tags} tag(s), ${report.ms} ms` });

  const info = await gitInfo();
  if (!info.repo) { steps.push({ name: 'Dépôt Git', ok: false, output: info.reason }); return { ok: false, steps }; }

  const existing = CONTENT_PATHS.filter((p) => fs.existsSync(path.join(ROOT, p)));
  if (!step('Ajout des fichiers de contenu', await git(['add', '-A', '--', ...existing]))) return { ok: false, steps };

  const staged = await git(['diff', '--cached', '--quiet', '--', ...existing]);
  if (staged.code === 1) {
    if (!step('Commit', await git(['commit', '-m', message, '--', ...existing]))) return { ok: false, steps };
  } else {
    steps.push({ name: 'Commit', ok: true, output: 'Aucune modification de contenu à enregistrer.' });
  }

  if (push) {
    if (!info.remote) { steps.push({ name: 'Envoi vers le dépôt distant', ok: false, output: 'Aucun dépôt distant « origin » configuré.' }); return { ok: false, steps }; }
    const args = info.hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'];
    if (!step('Envoi vers le dépôt distant', await git(args, { timeout: 90_000 }))) return { ok: false, steps };
  }
  return { ok: true, steps };
}

/* ------------------------------------------------------------------------ API */
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const [resource, id, action] = parts;
  const m = req.method;

  if (resource === 'state' && m === 'GET') {
    const cfg = loadConfig();
    const articles = loadArticles({ mode: 'preview' });
    return json(res, 200, {
      site: { title: cfg.site.title, url: cfg.site.url, logo: cfg.site.logo, logoAccent: cfg.site.logoAccent || '' },
      preview: lastPreview,
      articles: articles.map(articleMeta),
      git: await gitInfo(),
    });
  }

  if (resource === 'meta' && m === 'GET') {
    const articles = loadArticles({ mode: 'preview' });
    return json(res, 200, {
      icons: ICON_SHAPES,
      categories: [...new Set(articles.map((a) => a.category))].sort((a, b) => a.localeCompare(b, 'fr')),
      tags: [...new Set(articles.flatMap((a) => a.tags))].sort((a, b) => a.localeCompare(b, 'fr')),
    });
  }

  if (resource === 'articles') {
    if (!id && m === 'GET') return json(res, 200, loadArticles({ mode: 'preview' }).map(articleMeta));
    if (!id && m === 'POST') {
      const input = await readJson(req);
      const title = text(input.title, 200).trim();
      if (!title) throw new HttpError(400, 'Le titre est obligatoire.');
      const slug = uniqueSlug(title);
      writeFileAtomic(articlePath(slug), serializeArticle({ title, date: isoDate(new Date()), category: text(input.category, 60).trim() || 'Sécurité', tags: [], summary: '', draft: true, body: NEW_BODY }));
      rebuildPreview();
      return json(res, 201, readArticle(slug));
    }
    if (id && !action && m === 'GET') return json(res, 200, readArticle(id));
    if (id && !action && m === 'PUT') {
      const input = await readJson(req);
      const current = readArticle(id);
      if (input.baseMtime && Math.abs(Number(input.baseMtime) - current.mtime) > 1 && !input.force) {
        throw new HttpError(409, 'Le fichier a été modifié en dehors du Studio depuis son ouverture.');
      }
      const data = cleanArticleInput(input, current);
      let slug = id;
      if (input.slug && input.slug !== id) {
        if (!isValidSlug(input.slug)) throw new HttpError(400, 'Adresse invalide : minuscules, chiffres et tirets uniquement.');
        if (fs.existsSync(articlePath(input.slug))) throw new HttpError(409, 'Un article utilise déjà cette adresse.');
        slug = input.slug;
      }
      writeFileAtomic(articlePath(slug), serializeArticle(data));
      if (slug !== id) fs.rmSync(articlePath(id));
      rebuildPreview();
      return json(res, 200, readArticle(slug));
    }
    if (id && !action && m === 'DELETE') {
      const file = articlePath(id);
      if (!fs.existsSync(file)) throw new HttpError(404, 'Article introuvable.');
      fs.rmSync(file);
      rebuildPreview();
      return json(res, 200, { ok: true });
    }
    if (id && action === 'duplicate' && m === 'POST') {
      const src = readArticle(id);
      const slug = uniqueSlug(`${id}-copie`);
      writeFileAtomic(articlePath(slug), serializeArticle({ ...src, title: `${src.title} (copie)`, date: isoDate(new Date()), draft: true }));
      rebuildPreview();
      return json(res, 201, readArticle(slug));
    }
  }

  if (resource === 'render' && m === 'POST') {
    const input = await readJson(req);
    const body = text(input.body, 400_000);
    const { html, headings } = renderMarkdown(body, { assetRoot: '/site/' });
    const words = body.split(/\s+/).filter(Boolean).length;
    return json(res, 200, { html, headings, words, minutes: Math.max(1, Math.ceil(words / 200)) });
  }

  if (resource === 'config') {
    if (m === 'GET') return json(res, 200, loadConfig());
    if (m === 'PUT') {
      saveConfig(await readJson(req));
      rebuildPreview();
      return json(res, 200, { ok: true, preview: lastPreview });
    }
  }

  if (resource === 'media') {
    if (!id && m === 'GET') return json(res, 200, listMedia());
    if (!id && m === 'POST') {
      const buf = await readBody(req, MAX_UPLOAD);
      const sig = SIGNATURES.find((s) => s.test(buf));
      if (!sig) throw new HttpError(415, 'Format refusé. Formats acceptés : PNG, JPEG, WebP, AVIF, GIF (le SVG est exclu car il peut contenir du script).');
      let original = '';
      try { original = decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { /* nom ignoré */ }
      const base = slugify(path.parse(path.basename(original)).name).slice(0, 60).replace(/-+$/, '') || 'image';
      let name = `${base}.${sig.ext}`;
      for (let n = 2; fs.existsSync(mediaPath(name)); n++) name = `${base}-${n}.${sig.ext}`;
      fs.mkdirSync(PATHS.uploads, { recursive: true });
      fs.writeFileSync(mediaPath(name), buf, { flag: 'wx' });
      return json(res, 201, { name, path: `/assets/uploads/${name}`, size: buf.length });
    }
    if (id && m === 'DELETE') {
      const file = mediaPath(id);
      if (!fs.existsSync(file)) throw new HttpError(404, 'Image introuvable.');
      fs.rmSync(file);
      rebuildPreview();
      return json(res, 200, { ok: true });
    }
  }

  if (resource === 'build' && m === 'POST') {
    try { return json(res, 200, { ok: true, ...buildSite({ outDir: PATHS.dist, mode: 'production' }) }); }
    catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }

  if (resource === 'git' && m === 'GET') return json(res, 200, await gitInfo());

  if (resource === 'publish' && m === 'POST') {
    const input = await readJson(req);
    const message = text(input.message, 200).replace(/[\r\n]+/g, ' ').trim();
    if (!message) throw new HttpError(400, 'Le message de publication est obligatoire.');
    return json(res, 200, { ...(await publish({ message, push: input.push !== false })), git: await gitInfo() });
  }

  throw new HttpError(404, 'Route inconnue.');
}

/* -------------------------------------------------------------------- serveur */
function previewFrame() {
  const cfg = loadConfig();
  const blank = { slug: 'apercu', title: '', date: new Date(), category: '', tags: [], summary: '', draft: false, cover: '', words: 0, minutes: 1, status: 'published' };
  // Le cadre d'aperçu est isolé (sandbox) : les scripts du site y sont inutiles, on les retire du gabarit.
  return articlePage(cfg, blank, { root: '/site/', rendered: { html: '', headings: [] } }).replace(/<script\b[^>]*src=[^>]*><\/script>\n?/g, '');
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host || '')) throw new HttpError(403, 'Hôte refusé.');
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      if (!tokenOk(req)) throw new HttpError(403, 'Jeton de session manquant ou invalide. Rechargez la page du Studio.');
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && !ALLOWED_ORIGINS.has(origin)) throw new HttpError(403, 'Origine refusée.');
        if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw new HttpError(403, 'Requête inter-sites refusée.');
      }
      return await api(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée.');

    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8').replace('__STUDIO_TOKEN__', TOKEN);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': STUDIO_CSP,
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin',
      });
      return res.end(html);
    }
    if (p === '/preview-frame') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'self'" });
      return res.end(previewFrame());
    }
    if (p.startsWith('/ui/')) {
      const f = resolveInside(UI_DIR, p.slice(3));
      if (!f) throw new HttpError(404, 'Introuvable.');
      return sendFile(res, f);
    }
    if (p === '/site' || p.startsWith('/site/')) {
      // Les fichiers de static/ sont servis directement (toujours à jour), le reste vient du site de prévisualisation.
      const rel = p.slice(5) || '/';
      const f = resolveInside(PATHS.static, rel) || resolveInside(PATHS.preview, rel);
      if (f) return sendFile(res, f);
      // La page 404 pointe vers la racine du site en ligne : ses liens sont ramenés sous /site/ pour l'aperçu.
      const nf = path.join(PATHS.preview, '404.html');
      const html = fs.existsSync(nf) ? fs.readFileSync(nf, 'utf8').replace(/(href|src)="\/(?!\/)[^"]*?(assets\/|blog\/|rss\.xml|#|")/g, (m, attr, tail) => `${attr}="/site/${tail === '"' ? '"' : tail}`) : 'Introuvable';
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    throw new HttpError(404, 'Introuvable.');
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error('✖', e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Erreur interne du Studio (détail dans le terminal).' : e.message });
    else res.end();
  }
});

rebuildPreview();
server.listen(PORT, HOST, () => {
  console.log(`\n  Studio prêt : http://${HOST}:${PORT}\n  Accessible uniquement depuis cette machine. Ctrl+C pour arrêter.\n`);
  if (!lastPreview.ok) console.error('✖ Prévisualisation :', lastPreview.error);
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `✖ Le port ${PORT} est déjà utilisé. Relancez avec STUDIO_PORT=4001 par exemple.` : e);
  process.exit(1);
});
