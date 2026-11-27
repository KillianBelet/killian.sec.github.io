// Générateur du site statique.
//   npm run build            génère ./dist (articles publiés uniquement)
//   npm run dev              prévisualisation sur http://localhost:3000, brouillons inclus, reconstruite à chaque modification
//   node build.mjs --drafts  génère ./dist en incluant brouillons et articles planifiés
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { ROOT, PATHS } from './lib/core.mjs';
import { buildSite } from './lib/site.mjs';
import { serveStatic } from './lib/serve.mjs';

const args = new Set(process.argv.slice(2));

function report(r) {
  for (const w of r.warnings) console.warn(`⚠  ${w}`);
  for (const c of r.checks) console.warn(`${c.level === 'warn' ? '⚠ ' : 'ℹ '} ${c.text}`);
  const c = r.counts;
  const extra = r.mode === 'preview' ? ` (dont ${c.draft} brouillon(s) et ${c.scheduled} planifié(s))` : '';
  console.log(`✔ Site généré : ${c.total} article(s)${extra}, ${c.tags} tag(s), en ${r.ms} ms`);
}

if (args.has('--serve')) {
  const out = PATHS.preview;
  const safeBuild = () => { try { report(buildSite({ outDir: out, mode: 'preview' })); } catch (e) { console.error('✖ Erreur de build :', e.message); } };
  safeBuild();
  let timer;
  for (const p of ['content', 'static', 'site.config.json']) {
    const target = path.join(ROOT, p);
    if (fs.existsSync(target)) fs.watch(target, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(safeBuild, 200); });
  }
  const port = Number(process.env.PORT) || 3000;
  http.createServer((req, res) => serveStatic(out, new URL(req.url, 'http://x').pathname, res, { notFound: path.join(out, '404.html') }))
    .listen(port, '127.0.0.1', () => console.log(`→ http://localhost:${port}`));
} else {
  try {
    report(buildSite({ outDir: PATHS.dist, mode: args.has('--drafts') ? 'preview' : 'production' }));
  } catch (e) {
    console.error('✖ Erreur de build :', e.message);
    process.exit(1);
  }
}
