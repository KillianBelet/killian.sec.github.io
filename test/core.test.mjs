// Tests des points sensibles : validation des identifiants, rendu Markdown, en-têtes d'articles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, isValidSlug, safeUrl, renderMarkdown, parseArticle, serializeArticle, articlePath, validateConfig, loadConfig, articleStatus } from '../lib/core.mjs';
import { resolveInside } from '../lib/serve.mjs';
import { PATHS } from '../lib/core.mjs';

test('slugify produit des identifiants sûrs', () => {
  assert.equal(slugify('Sécuriser sa pipeline CI/CD : 6 contrôles'), 'securiser-sa-pipeline-ci-cd-6-controles');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
});

test('isValidSlug refuse tout ce qui pourrait sortir du dossier des articles', () => {
  for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'A', 'a b', 'a.md', '-a', 'a-', 'a--b', 'x'.repeat(121), null, 42]) assert.equal(isValidSlug(bad), false, String(bad));
  for (const good of ['a', 'mon-article', 'k8s-2026']) assert.equal(isValidSlug(good), true, good);
  assert.throws(() => articlePath('../../package'));
});

test('safeUrl ne laisse passer que http(s), mailto et les chemins relatifs', () => {
  assert.equal(safeUrl('https://example.org/a'), 'https://example.org/a');
  assert.equal(safeUrl('mailto:a@b.fr'), 'mailto:a@b.fr');
  assert.equal(safeUrl('/assets/cv.pdf'), '/assets/cv.pdf');
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example']) assert.equal(safeUrl(bad), '', bad);
});

test('le rendu Markdown neutralise les liens dangereux et échappe le code', () => {
  const { html } = renderMarkdown('[clic](javascript:alert(1))\n\n```html\n<script>alert(1)</script>\n```\n');
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;') || html.includes('hljs-tag'));
});

test('le rendu Markdown construit le sommaire avec des ancres uniques', () => {
  const { html, headings } = renderMarkdown("## Qu'est-ce que c'est ?\n\n## Qu'est-ce que c'est ?\n\n### Détail\n");
  assert.deepEqual(headings.map((h) => h.id), ['qu-est-ce-que-c-est', 'qu-est-ce-que-c-est-2', 'detail']);
  assert.equal(headings[0].text, "Qu'est-ce que c'est ?");
  assert.ok(html.includes('id="qu-est-ce-que-c-est-2"'));
});

test('les liens externes s\'ouvrent sans donner accès à la page d\'origine', () => {
  const { html } = renderMarkdown('[doc](https://example.org) et [interne](/blog/)');
  assert.ok(html.includes('href="https://example.org" target="_blank" rel="noopener noreferrer"'));
  assert.ok(html.includes('<a href="/blog/">interne</a>'));
});

test('les images du site reçoivent le préfixe de la page', () => {
  const { html } = renderMarkdown('![schéma](/assets/uploads/schema.png)', { assetRoot: '../../' });
  assert.ok(html.includes('src="../../assets/uploads/schema.png"'));
});

test('un en-tête exécutable (---js) est refusé', () => {
  assert.throws(() => parseArticle('---js\n{ title: (() => { globalThis.__pwned = true; return "x"; })() }\n---\ncorps', 'x'));
  assert.equal(globalThis.__pwned, undefined);
});

test('un article survit à un aller-retour écriture puis lecture', () => {
  const src = { title: 'Titre avec "guillemets" : et deux-points', date: '2026-11-14', category: 'CI/CD', tags: ['ci-cd', 'yaml: piège'], summary: "Résumé avec # dièse et 'apostrophe'", cover: '', draft: true, body: 'Corps\n\n## Titre\n' };
  const a = parseArticle(serializeArticle(src), 'aller-retour');
  assert.equal(a.title, src.title);
  assert.deepEqual(a.tags, src.tags);
  assert.equal(a.summary, src.summary);
  assert.equal(a.category, 'CI/CD');
  assert.equal(a.draft, true);
  assert.equal(a.body.trim(), src.body.trim());
  assert.equal(a.date.toISOString().slice(0, 10), '2026-11-14');
});

test('serializeArticle refuse une date mal formée', () => {
  assert.throws(() => serializeArticle({ title: 'x', date: '14/11/2026', body: '' }));
  assert.throws(() => serializeArticle({ title: 'x', date: '2026-11-14\ndraft: false', body: '' }));
});

test('un article daté dans le futur est planifié, pas publié', () => {
  const now = Date.parse('2026-11-14T10:00:00Z');
  assert.equal(articleStatus({ draft: false, date: new Date('2026-11-15') }, now), 'scheduled');
  assert.equal(articleStatus({ draft: false, date: new Date('2026-11-14') }, now), 'published');
  assert.equal(articleStatus({ draft: true, date: new Date('2026-01-01') }, now), 'draft');
});

test('la configuration livrée est valide, une configuration piégée est refusée', () => {
  assert.deepEqual(validateConfig(loadConfig()), []);
  const bad = loadConfig();
  bad.links.linkedin = 'javascript:alert(1)';
  bad.site.url = 'ftp://x';
  assert.equal(validateConfig(bad).length, 2);
  assert.ok(validateConfig([]).length > 0);
});

test('le service de fichiers ne sort jamais de sa racine', () => {
  for (const p of ['/../package.json', '/..%2f..%2fpackage.json', '/assets/../../package.json', '/%2e%2e/package.json', '/assets/css/site.css%00.png']) {
    assert.equal(resolveInside(PATHS.static, p), null, p);
  }
  assert.ok(resolveInside(PATHS.static, '/assets/css/site.css'));
});
