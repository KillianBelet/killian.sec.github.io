// Socle commun au générateur (build.mjs) et au Studio (studio/server.mjs) :
// chemins, configuration, rendu Markdown, lecture et écriture des articles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = {
  config: path.join(ROOT, 'site.config.json'),
  articles: path.join(ROOT, 'content', 'articles'),
  static: path.join(ROOT, 'static'),
  uploads: path.join(ROOT, 'static', 'assets', 'uploads'),
  dist: path.join(ROOT, 'dist'),
  preview: path.join(ROOT, '.studio', 'preview'),
};

/* ------------------------------------------------------------------ utils */
export const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export const slugify = (s) =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isValidSlug = (s) => typeof s === 'string' && s.length <= 120 && SLUG_RE.test(s);

export const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const frDate = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const isoDate = (d) => d.toISOString().slice(0, 10);
export const baseUrl = (cfg) => cfg.site.url.replace(/\/+$/, '');

// N'autorise que les liens http(s), mailto et les chemins relatifs : un "javascript:" saisi
// par erreur dans la configuration ne se retrouve jamais dans un attribut href.
export function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^(https?:\/\/|mailto:)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return '';
  return s;
}

/* ----------------------------------------------------------------- config */
export function loadConfig() {
  return JSON.parse(fs.readFileSync(PATHS.config, 'utf8'));
}

const REQUIRED_SECTIONS = ['site', 'links', 'hero', 'expertise', 'skills', 'experience', 'education', 'projects', 'testimonials', 'blog', 'contact'];

export function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return ['La configuration doit être un objet JSON.'];
  for (const k of REQUIRED_SECTIONS) {
    if (!cfg[k] || typeof cfg[k] !== 'object') errors.push(`Section « ${k} » manquante.`);
  }
  if (errors.length) return errors;
  if (!/^https?:\/\/[^\s/]+/i.test(cfg.site.url || '')) errors.push('site.url doit commencer par http:// ou https://.');
  for (const k of ['title', 'description', 'logo']) {
    if (typeof cfg.site[k] !== 'string' || !cfg.site[k].trim()) errors.push(`site.${k} est obligatoire.`);
  }
  for (const k of ['linkedin', 'github']) {
    if (cfg.links[k] && !/^https:\/\//i.test(cfg.links[k])) errors.push(`links.${k} doit être une adresse https://.`);
  }
  if (cfg.links.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.links.email)) errors.push('links.email n\'est pas une adresse e-mail valide.');
  if (cfg.hero.cvUrl && !safeUrl(cfg.hero.cvUrl)) errors.push('hero.cvUrl doit être un chemin relatif ou une adresse http(s).');
  for (const k of ['expertise', 'experience', 'education', 'projects', 'testimonials']) {
    if (!Array.isArray(cfg[k].items)) errors.push(`${k}.items doit être une liste.`);
  }
  if (!Array.isArray(cfg.skills.groups)) errors.push('skills.groups doit être une liste.');
  if (JSON.stringify(cfg).length > 500_000) errors.push('Configuration trop volumineuse.');
  return errors;
}

export function saveConfig(cfg) {
  const errors = validateConfig(cfg);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
  writeFileAtomic(PATHS.config, JSON.stringify(cfg, null, 2) + '\n');
}

// Points à vérifier avant mise en ligne, affichés par le build et par le Studio.
export function siteChecks(cfg, articles) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  if (/example\.(com|org)/i.test(cfg.site.url)) add('warn', 'L\'adresse du site (site.url) est encore celle d\'exemple : liens canoniques, RSS et sitemap seront faux.');
  if (!cfg.links.email) add('info', 'Aucune adresse e-mail : le fichier security.txt ne sera pas généré et le bouton e-mail reste masqué.');
  if (!cfg.links.github) add('info', 'Lien GitHub vide : il n\'apparaît pas sur le site.');
  if ((cfg.site.description || '').length > 180) add('info', 'La description du site dépasse 180 caractères : elle sera tronquée par les moteurs de recherche.');
  (function walk(v, p) {
    if (typeof v === 'string' && v.includes('À COMPLÉTER')) add('warn', `Texte « À COMPLÉTER » restant : ${p}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, p ? `${p}.${k}` : k));
  })(cfg, '');
  for (const a of articles) {
    if (a.status === 'draft') continue;
    if (!a.summary) add('warn', `« ${a.title} » n'a pas de résumé (cartes et SEO).`);
    else if (a.summary.length > 200) add('info', `« ${a.title} » : résumé de plus de 200 caractères.`);
    if (!a.tags.length) add('info', `« ${a.title} » n'a aucun tag.`);
  }
  return out;
}

/* --------------------------------------------------------------- markdown */
let collector = null;

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      return esc(code);
    },
  }),
  { gfm: true, breaks: false }
);

marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      if (depth !== 2 && depth !== 3) return `<h${depth}>${inner}</h${depth}>\n`;
      const text = unesc(inner.replace(/<[^>]+>/g, ''));
      let id = slugify(text) || 'section';
      const base = id;
      for (let n = 2; collector.ids.has(id); n++) id = `${base}-${n}`;
      collector.ids.add(id);
      collector.headings.push({ depth, id, text });
      return `<h${depth} id="${id}">${inner} <a class="anchor" href="#${id}" aria-label="Lien direct vers cette section">#</a></h${depth}>\n`;
    },
    code({ text, lang, escaped }) {
      const language = (lang || '').trim().split(/\s+/)[0];
      const body = escaped ? text : esc(text);
      const cls = language ? `hljs language-${esc(language)}` : 'hljs';
      return `<figure class="code"><figcaption><span class="code-lang">${esc(language || 'texte')}</span></figcaption><pre><code class="${cls}">${body}\n</code></pre></figure>\n`;
    },
    table(token) {
      const cell = (c, tag) => `<${tag}${c.align ? ` class="ta-${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
      const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
      const rows = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('');
      return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
    },
    link({ href, title, tokens }) {
      const url = safeUrl(href);
      const inner = this.parser.parseInline(tokens);
      if (!url) return inner;
      const ext = /^https?:\/\//i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''}${ext}>${inner}</a>`;
    },
    image({ href, title, text }) {
      let url = safeUrl(href);
      if (!url) return esc(text);
      if (url.startsWith('/assets/')) url = collector.assetRoot + url.slice(1);
      const img = `<img src="${esc(url)}" alt="${esc(text)}" loading="lazy" decoding="async">`;
      return title ? `<figure class="image">${img}<figcaption>${esc(title)}</figcaption></figure>` : img;
    },
  },
});

// assetRoot : préfixe appliqué aux images écrites "/assets/..." (ex. "../../" pour une page d'article).
export function renderMarkdown(md, { assetRoot = '/' } = {}) {
  collector = { ids: new Set(), headings: [], assetRoot };
  const html = marked.parse(String(md || ''));
  const { headings } = collector;
  collector = null;
  return { html, headings };
}

/* ---------------------------------------------------------------- articles */
// gray-matter sait exécuter un en-tête "---js" via eval : ce moteur est neutralisé,
// un fichier Markdown ne doit jamais pouvoir exécuter du code au moment du build.
const disabledEngine = { parse() { throw new Error('en-tête exécutable refusé (seul YAML est accepté)'); }, stringify() { throw new Error('désactivé'); } };
const MATTER_OPTS = { engines: { javascript: disabledEngine, js: disabledEngine, coffee: disabledEngine, coffeescript: disabledEngine } };

export function articleStatus(a, now = Date.now()) {
  if (a.draft) return 'draft';
  return a.date.getTime() > now ? 'scheduled' : 'published';
}

export function parseArticle(raw, slug) {
  const { data, content } = matter(raw, MATTER_OPTS);
  const date = data.date instanceof Date ? data.date : new Date(data.date);
  const problems = [];
  if (!data.title) problems.push('titre manquant');
  if (!data.date || Number.isNaN(date.getTime())) problems.push('date manquante ou invalide');
  const words = content.split(/\s+/).filter(Boolean).length;
  const a = {
    slug,
    title: String(data.title || ''),
    date: Number.isNaN(date.getTime()) ? new Date(0) : date,
    category: String(data.category || 'Article'),
    tags: Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean) : [],
    summary: String(data.summary || ''),
    draft: !!data.draft,
    cover: typeof data.cover === 'string' ? data.cover : '',
    words,
    minutes: Math.max(1, Math.ceil(words / 200)),
    body: content.replace(/^\n+/, ''),
    extra: Object.fromEntries(Object.entries(data).filter(([k]) => !['title', 'date', 'category', 'tags', 'summary', 'draft', 'cover'].includes(k))),
    problems,
  };
  a.status = articleStatus(a);
  return a;
}

// mode "production" : articles publiés uniquement ; "preview" : tout (brouillons et planifiés).
export function loadArticles({ mode = 'production', warn = () => {} } = {}) {
  if (!fs.existsSync(PATHS.articles)) return [];
  const list = [];
  for (const file of fs.readdirSync(PATHS.articles).filter((f) => f.endsWith('.md'))) {
    const slug = file.replace(/\.md$/, '');
    if (!isValidSlug(slug)) { warn(`${file} ignoré : nom de fichier invalide (minuscules, chiffres et tirets uniquement).`); continue; }
    let a;
    try { a = parseArticle(fs.readFileSync(path.join(PATHS.articles, file), 'utf8'), slug); }
    catch (e) { warn(`${file} ignoré : ${e.message}`); continue; }
    if (a.problems.length) { warn(`${file} ignoré : ${a.problems.join(', ')}.`); if (mode === 'production') continue; }
    if (mode === 'production' && a.status !== 'published') continue;
    list.push(a);
  }
  return list.sort((x, y) => y.date - x.date || x.slug.localeCompare(y.slug));
}

export function articlePath(slug) {
  if (!isValidSlug(slug)) throw Object.assign(new Error('Identifiant d\'article invalide.'), { status: 400 });
  const f = path.join(PATHS.articles, `${slug}.md`);
  if (path.dirname(f) !== PATHS.articles) throw Object.assign(new Error('Chemin refusé.'), { status: 400 });
  return f;
}

export function serializeArticle(a) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || Number.isNaN(new Date(a.date).getTime())) {
    throw Object.assign(new Error('La date doit être au format AAAA-MM-JJ.'), { status: 400 });
  }
  const str = (v) => JSON.stringify(String(v ?? '').replace(/\r?\n/g, ' ').trim());
  const lines = [
    '---',
    `title: ${str(a.title)}`,
    `date: ${a.date}`,
    `category: ${str(a.category || 'Article')}`,
    `tags: [${(a.tags || []).map((t) => str(t)).join(', ')}]`,
    `summary: ${str(a.summary)}`,
  ];
  if (a.cover) lines.push(`cover: ${str(a.cover)}`);
  lines.push(`draft: ${a.draft ? 'true' : 'false'}`);
  for (const [k, v] of Object.entries(a.extra || {})) {
    if (/^[A-Za-z_][\w-]*$/.test(k)) lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push('---', '', String(a.body || '').replace(/\r\n/g, '\n').replace(/\s+$/, ''), '');
  return lines.join('\n');
}

export function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else if (e.isFile()) fs.copyFileSync(s, d);
  }
}
