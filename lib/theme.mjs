// Thème « Pipeline » : gabarits HTML du site public.
// Aucun style ni script en ligne : la CSP du site n'autorise que les fichiers servis par le site lui-même.
import { esc, slugify, hash, frDate, isoDate, baseUrl, safeUrl } from './core.mjs';
import { icon } from './icons.mjs';

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

const STATUS_LABEL = { draft: 'Brouillon', scheduled: 'Planifié' };
const CAT_ICON = { Pentest: 'crosshair', Audit: 'shield-check', Détection: 'eye', Runtime: 'activity', Vulnérabilités: 'package', 'Qualité web': 'gauge', Gouvernance: 'file-text', 'Cloud / Kubernetes': 'container', 'Sécurité offensive': 'target', IA: 'cpu' };

const ext = (href) => (/^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '');
const tagUrl = (root, t) => `${root}blog/tag/${slugify(t)}/`;

/* ------------------------------------------------------------------ layout */
function navItems(cfg, ctx) {
  const to = (id) => (ctx.home ? `#${id}` : `${ctx.root}#${id}`);
  const items = [
    { href: to('expertise'), label: 'Expertise', id: 'expertise' },
    { href: to('parcours'), label: 'Parcours', id: 'parcours' },
  ];
  if (cfg.projects.items.length) items.push({ href: to('projets'), label: 'Projets', id: 'projets' });
  items.push({ href: `${ctx.root}blog/`, label: 'Blog', current: ctx.section === 'blog' });
  items.push({ href: to('contact'), label: 'Contact', id: 'contact' });
  return items;
}

const logo = (cfg, ctx) =>
  `<a class="logo" href="${ctx.root}" aria-label="${esc(cfg.site.logo + (cfg.site.logoAccent || ''))}, retour à l'accueil">${esc(cfg.site.logo)}<span>${esc(cfg.site.logoAccent || '')}</span></a>`;

function header(cfg, ctx) {
  const linkedin = safeUrl(cfg.links.linkedin);
  return `
<header class="top">
  <div class="wrap top-in">
    ${logo(cfg, ctx)}
    <nav class="top-nav" aria-label="Navigation principale">
      <ul>${navItems(cfg, ctx).map((it) => `<li><a href="${it.href}"${it.current ? ' aria-current="page"' : ''}${it.id ? ` data-spy="${it.id}"` : ''}>${esc(it.label)}</a></li>`).join('')}</ul>
    </nav>
    <div class="top-actions">
      <button class="theme-toggle" type="button" aria-label="Basculer entre thème clair et thème sombre" hidden>${icon('sun', { cls: 'i-sun' })}${icon('moon', { cls: 'i-moon' })}</button>
      ${linkedin ? `<a class="btn btn-small" href="${esc(linkedin)}"${ext(linkedin)}>LinkedIn</a>` : ''}
    </div>
  </div>
</header>`;
}

function footer(cfg, ctx) {
  const links = [];
  for (const [k, label] of [['linkedin', 'LinkedIn'], ['github', 'GitHub']]) {
    const u = safeUrl(cfg.links[k]);
    if (u) links.push(`<a href="${esc(u)}"${ext(u)}>${label}</a>`);
  }
  if (cfg.links.email) links.push(`<a href="mailto:${esc(cfg.links.email)}">E-mail</a>`);
  links.push(`<a href="${ctx.root}rss.xml">Flux RSS</a>`);
  return `
<footer class="foot">
  <div class="wrap foot-in">
    <div>
      ${logo(cfg, ctx)}
      <p class="foot-role">${esc(cfg.hero.role)}</p>
    </div>
    <nav aria-label="Pied de page"><ul>${navItems(cfg, ctx).map((it) => `<li><a href="${it.href}">${esc(it.label)}</a></li>`).join('')}</ul></nav>
    <ul class="foot-links">${links.map((l) => `<li>${l}</li>`).join('')}</ul>
  </div>
  <div class="wrap foot-legal">
    <p>© ${new Date().getFullYear()} ${esc(cfg.site.copyrightName)}. Site statique, sans cookie ni traceur.</p>
  </div>
</footer>`;
}

export function page(cfg, ctx, { title, description, canonicalPath, body, ogType = 'website', jsonld, ogImage }) {
  const base = baseUrl(cfg);
  const canonical = `${base}/${canonicalPath}`;
  const v = ctx.assets || {};
  const q = (k) => (v[k] ? `?v=${v[k]}` : '');
  const image = ogImage || `${base}/assets/images/og-default.png`;
  return `<!DOCTYPE html>
<html lang="${esc(cfg.site.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${ctx.noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" type="image/svg+xml" href="${ctx.root}assets/images/favicon.svg">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.site.title)}" href="${ctx.root}rss.xml">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(cfg.site.title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="${esc(cfg.site.locale)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f2f4f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1420" media="(prefers-color-scheme: dark)">
<link rel="preload" href="${ctx.root}assets/fonts/bricolage-grotesque-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${ctx.root}assets/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<script src="${ctx.root}assets/js/theme.js${q('theme.js')}"></script>
<link rel="stylesheet" href="${ctx.root}assets/css/site.css${q('site.css')}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body${ctx.home ? ' class="is-home"' : ''}>
<a class="skip" href="#main">Aller au contenu</a>
${header(cfg, ctx)}
<main id="main">
${body}
</main>
${footer(cfg, ctx)}
<script src="${ctx.root}assets/js/site.js${q('site.js')}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------ illustrations */
// Vignette générée pour chaque article : une chaîne de contrôles dont l'état dépend du slug.
export function coverSvg(a) {
  const h = hash(a.slug);
  const nodes = 5;
  const running = 1 + (h % (nodes - 1));
  const y = 196;
  const xs = Array.from({ length: nodes }, (_, i) => 96 + i * 152);
  const bars = Array.from({ length: 4 }, (_, i) => {
    const w = 90 + ((hash(a.slug + i) % 6) * 44);
    return `<rect x="96" y="${286 + i * 26}" width="${w}" height="8" rx="4" fill="#8496ff" opacity="${0.16 + (i % 2) * 0.1}"/>`;
  }).join('');
  const chain = xs.map((x, i) => {
    const done = i < running;
    const cur = i === running;
    const link = i ? `<line x1="${xs[i - 1] + 26}" y1="${y}" x2="${x - 26}" y2="${y}" stroke="${done || cur ? '#43d397' : '#2b3b54'}" stroke-width="4" stroke-linecap="round"${cur || done ? '' : ' stroke-dasharray="2 10"'}/>` : '';
    const ring = `<circle cx="${x}" cy="${y}" r="24" fill="#0c1420" stroke="${done ? '#43d397' : cur ? '#8496ff' : '#2b3b54'}" stroke-width="4"/>`;
    const mark = done
      ? `<path d="M${x - 9} ${y + 1} l6 6 l12 -13" fill="none" stroke="#43d397" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
      : cur ? `<circle cx="${x}" cy="${y}" r="8" fill="#8496ff"/>` : '';
    return link + ring + mark;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
<rect width="800" height="450" fill="#0f1a2a"/>
<g fill="#1b2a40">${Array.from({ length: 8 }, (_, r) => Array.from({ length: 14 }, (_, c) => `<circle cx="${40 + c * 56}" cy="${32 + r * 56}" r="2"/>`).join('')).join('')}</g>
<text x="96" y="112" font-family="system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif" font-size="34" font-weight="700" fill="#e4eaf2">${esc(a.category)}</text>
${chain}
${bars}
</svg>
`;
}

/* ---------------------------------------------------------------- sections */
function hero(cfg) {
  const h = cfg.hero;
  const linkedin = safeUrl(cfg.links.linkedin);
  const cv = safeUrl(h.cvUrl);
  const facts = [
    h.role && ['briefcase', h.role],
    h.location && ['map-pin', h.location],
    ...(h.interests || []).map((t) => ['puzzle', t]),
  ].filter(Boolean);
  const steps = Array.isArray(h.pipeline) ? h.pipeline : [];
  const pipeline = steps.length ? `
  <figure class="pipeline" data-steps="${steps.length}">
    <figcaption>${esc(h.pipelineTitle || 'Ma chaîne de sécurité')}</figcaption>
    <ol>
      ${steps.map((s, i) => {
    const last = i === steps.length - 1;
    return `<li class="${last ? 'is-running' : 'is-passed'}">
        <span class="node">${last ? '' : icon('check', { size: 18 })}</span>
        <span class="step">
          <strong>${esc(s.stage)}</strong>
          <code>${esc(s.tool)}</code>
          ${s.detail ? `<span class="detail">${esc(s.detail)}</span>` : ''}
          <span class="sr-only">${last ? 'étape en cours, en continu' : 'étape validée'}</span>
        </span>
      </li>`;
  }).join('\n      ')}
    </ol>
  </figure>` : '';
  return `
<section class="hero" id="accueil">
  <div class="wrap">
    <h1>${esc(h.greeting)} ${esc(h.name)}.</h1>
    <p class="hero-bio">${esc(h.bio)}</p>
    <ul class="hero-facts">${facts.map(([i, t]) => `<li>${icon(i, { size: 18 })}<span>${esc(t)}</span></li>`).join('')}</ul>
    <p class="hero-cta">
      <a class="btn btn-primary" href="blog/">Lire mes articles</a>
      ${linkedin ? `<a class="btn" href="${esc(linkedin)}"${ext(linkedin)}>Me contacter sur LinkedIn</a>` : ''}
      ${cv ? `<a class="btn" href="${esc(cv)}"${ext(cv)}>Télécharger mon CV</a>` : ''}
    </p>
    ${pipeline}
  </div>
</section>`;
}

const band = (id, title, body, intro = '') => `
<section class="band" id="${id}">
  <div class="wrap split">
    <header class="split-head"><h2>${esc(title)}</h2>${intro ? `<p>${esc(intro)}</p>` : ''}</header>
    <div class="split-body">${body}</div>
  </div>
</section>`;

function expertise(cfg) {
  const e = cfg.expertise;
  if (!e.items.length) return '';
  return band('expertise', e.title, `
    <ul class="checks">
      ${e.items.map((it) => `<li>
        <span class="check-icon">${icon(it.icon, { size: 22 })}</span>
        <div><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>
      </li>`).join('\n      ')}
    </ul>`);
}

function skills(cfg) {
  const s = cfg.skills;
  if (!s.groups.length) return '';
  return band('outils', s.title, `
    <dl class="manifest">
      ${s.groups.map((g) => `<div><dt>${esc(g.title)}</dt><dd><ul class="tags">${g.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></dd></div>`).join('\n      ')}
    </dl>`);
}

const timeline = (items) => `
    <ol class="timeline">
      ${items.map((it) => `<li>
        <p class="tl-period">${esc(it.period)}</p>
        <h4>${esc(it.title)}</h4>
        <p class="tl-org">${esc(it.org)}${it.place ? `<span>${esc(it.place)}</span>` : ''}</p>
        ${it.text ? `<p class="tl-text">${esc(it.text)}</p>` : ''}
      </li>`).join('\n      ')}
    </ol>`;

function parcours(cfg) {
  const ex = cfg.experience, ed = cfg.education;
  return band('parcours', ex.heading || 'Mon parcours', `
    <div class="tracks">
      <div><h3>${icon('briefcase', { size: 18 })}${esc(ex.title)}</h3>${timeline(ex.items)}</div>
      <div><h3>${icon('graduation-cap', { size: 18 })}${esc(ed.title)}</h3>${timeline(ed.items)}</div>
    </div>`);
}

function projects(cfg) {
  const p = cfg.projects;
  if (!p.items.length) return '';
  return band('projets', p.title, `
    <ul class="cards">
      ${p.items.map((it) => `<li class="card">
        <p class="card-cat">${icon(it.icon || CAT_ICON[it.category] || 'code', { size: 16 })}${esc(it.category)}</p>
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.text)}</p>
        ${(it.tags || []).length ? `<ul class="tags">${it.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      </li>`).join('\n      ')}
    </ul>`, p.intro);
}

function testimonials(cfg) {
  const t = cfg.testimonials;
  if (!t || !t.items.length) return '';
  return band('recommandations', t.title, `
    <div class="quotes">
      ${t.items.map((q) => `<figure class="quote"><blockquote><p>${esc(q.text)}</p></blockquote><figcaption><strong>${esc(q.name)}</strong><span>${esc(q.role)}</span></figcaption></figure>`).join('\n      ')}
    </div>`);
}

const coverSrc = (a, root) => (a.cover && safeUrl(a.cover) ? (a.cover.startsWith('/') ? root + a.cover.slice(1) : a.cover) : `${root}assets/covers/${a.slug}.svg`);

export function postCard(a, root, level = 'h3') {
  const url = `${root}blog/${a.slug}/`;
  const search = [a.title, a.summary, a.category, ...a.tags].join(' ').toLowerCase();
  return `<li class="post" data-category="${esc(a.category)}" data-search="${esc(search)}">
      <a class="post-cover" href="${url}" tabindex="-1" aria-hidden="true"><img src="${esc(coverSrc(a, root))}" alt="" width="800" height="450" loading="lazy" decoding="async"></a>
      <div class="post-body">
        <p class="post-meta"><span class="post-cat">${esc(a.category)}</span><time datetime="${isoDate(a.date)}">${frDate(a.date)}</time><span>${a.minutes} min de lecture</span>${STATUS_LABEL[a.status] ? `<span class="badge badge-${a.status}">${STATUS_LABEL[a.status]}</span>` : ''}</p>
        <${level}><a href="${url}">${esc(a.title)}</a></${level}>
        <p class="post-summary">${esc(a.summary)}</p>
      </div>
    </li>`;
}

const EMPTY_BLOG = '<p class="empty">Aucun article publié pour le moment. Le premier arrive bientôt.</p>';

function blogSection(cfg, articles) {
  const b = cfg.blog;
  const shown = articles.slice(0, b.homeCount || 3);
  return band('blog', b.title, shown.length ? `
    <ul class="posts">
      ${shown.map((a) => postCard(a, './')).join('\n      ')}
    </ul>
    <p class="more"><a class="btn" href="blog/">Voir tous les articles</a></p>` : EMPTY_BLOG);
}

function contact(cfg) {
  const c = cfg.contact;
  const linkedin = safeUrl(cfg.links.linkedin);
  return `
<section class="band contact" id="contact">
  <div class="wrap">
    <h2>${esc(c.title)}</h2>
    <p>${esc(c.text)}</p>
    <p class="hero-cta">
      ${linkedin ? `<a class="btn btn-primary" href="${esc(linkedin)}"${ext(linkedin)}>Écrire sur LinkedIn</a>` : ''}
      ${cfg.links.email ? `<a class="btn" href="mailto:${esc(cfg.links.email)}">Envoyer un e-mail</a>` : ''}
    </p>
  </div>
</section>`;
}

/* ------------------------------------------------------------------- pages */
export function homePage(cfg, articles, assets) {
  const ctx = { root: './', home: true, assets };
  const knows = [...new Set(cfg.skills.groups.flatMap((g) => g.items))].slice(0, 20);
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: cfg.hero.name,
    jobTitle: cfg.hero.role,
    url: cfg.site.url,
    sameAs: [cfg.links.linkedin, cfg.links.github].map(safeUrl).filter(Boolean),
    knowsAbout: knows,
  };
  const body = [hero(cfg), expertise(cfg), skills(cfg), parcours(cfg), projects(cfg), testimonials(cfg), blogSection(cfg, articles), contact(cfg)].join('\n');
  return page(cfg, ctx, { title: cfg.site.title, description: cfg.site.description, canonicalPath: '', body, jsonld });
}

export function blogIndexPage(cfg, articles, assets) {
  const ctx = { root: '../', section: 'blog', assets };
  const b = cfg.blog;
  const cats = [...new Set(articles.map((a) => a.category))].sort((x, y) => x.localeCompare(y, 'fr'));
  const tags = [...new Set(articles.flatMap((a) => a.tags))].sort((x, y) => x.localeCompare(y, 'fr'));
  const body = `
<section class="page-head">
  <div class="wrap">
    <h1>${esc(b.pageTitle)}</h1>
    <p class="lead">${esc(b.pageIntro)}</p>
  </div>
</section>
<section class="wrap blog-list">
  ${articles.length ? `
  <div class="filters" hidden>
    <label class="search"><span class="sr-only">Rechercher un article</span>${icon('search', { size: 18 })}<input type="search" id="post-search" placeholder="Rechercher un article" autocomplete="off"></label>
    ${cats.length > 1 ? `<div class="filter-cats" role="group" aria-label="Filtrer par catégorie">
      <button type="button" class="chip" data-cat="" aria-pressed="true">Tout</button>
      ${cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('')}
    </div>` : ''}
  </div>
  <p class="filter-count" aria-live="polite" hidden></p>
  <ul class="posts posts-list">
    ${articles.map((a) => postCard(a, '../', 'h2')).join('\n    ')}
  </ul>
  <p class="empty" id="no-result" hidden>Aucun article ne correspond à cette recherche.</p>
  ${tags.length ? `<aside class="tag-cloud"><h2>Parcourir par tag</h2><ul class="tags">${tags.map((t) => `<li><a href="${tagUrl('../', t)}">#${esc(t)}</a></li>`).join('')}</ul></aside>` : ''}` : EMPTY_BLOG}
  <p class="rss-line">${icon('rss', { size: 16 })}<a href="../rss.xml">S'abonner au flux RSS</a></p>
</section>`;
  return page(cfg, ctx, { title: `${b.pageTitle} | ${cfg.site.title}`, description: b.pageIntro, canonicalPath: 'blog/', body });
}

export function tagPage(cfg, tag, articles, assets) {
  const ctx = { root: '../../../', section: 'blog', assets };
  const body = `
<section class="page-head">
  <div class="wrap">
    <nav class="crumbs" aria-label="Fil d'Ariane"><a href="../../../">Accueil</a><span aria-hidden="true">/</span><a href="../../">Blog</a></nav>
    <h1>#${esc(tag)}</h1>
    <p class="lead">${articles.length} article${articles.length > 1 ? 's' : ''} sur ce sujet.</p>
  </div>
</section>
<section class="wrap blog-list">
  <ul class="posts posts-list">
    ${articles.map((a) => postCard(a, '../../../', 'h2')).join('\n    ')}
  </ul>
  <p class="more"><a class="btn" href="../../">Voir tous les articles</a></p>
</section>`;
  return page(cfg, ctx, {
    title: `#${tag} | ${cfg.blog.pageTitle} | ${cfg.site.title}`,
    description: `Articles de ${cfg.hero.name} sur le sujet « ${tag} ».`,
    canonicalPath: `blog/tag/${slugify(tag)}/`, body,
  });
}

const toc = (headings) => {
  const list = headings.filter((h) => h.depth === 2 || h.depth === 3);
  if (list.length < 3) return '';
  return `<aside class="toc" aria-label="Sommaire"><p class="toc-title">Sommaire</p><ol>${list.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></aside>`;
};

// ctx.root vaut "../../" sur le site ; le Studio passe "/site/" pour sa prévisualisation.
export function articlePage(cfg, a, { root = '../../', assets, rendered, newer, older, related = [] } = {}) {
  const ctx = { root, section: 'blog', assets, noindex: a.status !== 'published' };
  const base = baseUrl(cfg);
  const url = `${base}/blog/${a.slug}/`;
  const share = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const tocHtml = toc(rendered.headings);
  const notice = a.status === 'draft'
    ? '<p class="notice">Brouillon : cette page n\'est visible qu\'en prévisualisation.</p>'
    : a.status === 'scheduled' ? `<p class="notice">Publication planifiée le ${frDate(a.date)}.</p>` : '';
  const body = `
<div class="progress" aria-hidden="true"><span></span></div>
<article class="article">
  <header class="page-head">
    <div class="wrap">
      <nav class="crumbs" aria-label="Fil d'Ariane"><a href="${root}">Accueil</a><span aria-hidden="true">/</span><a href="${root}blog/">Blog</a></nav>
      ${notice}
      <p class="post-meta"><span class="post-cat" data-preview="category">${esc(a.category)}</span><time datetime="${isoDate(a.date)}" data-preview="date">${frDate(a.date)}</time><span><span data-preview="minutes">${a.minutes}</span> min de lecture</span></p>
      <h1 data-preview="title">${esc(a.title)}</h1>
      <p class="lead" data-preview="summary">${esc(a.summary)}</p>
    </div>
  </header>
  <div class="wrap article-grid${tocHtml ? '' : ' no-toc'}">
    ${tocHtml}
    <div class="prose" data-preview="body">${a.cover && safeUrl(a.cover) ? `<img class="article-cover" src="${esc(coverSrc(a, root))}" alt="">` : ''}${rendered.html}</div>
  </div>
  <footer class="wrap article-foot">
    ${a.tags.length ? `<ul class="tags" data-preview="tags">${a.tags.map((t) => `<li><a href="${tagUrl(root, t)}">#${esc(t)}</a></li>`).join('')}</ul>` : '<ul class="tags" data-preview="tags"></ul>'}
    <p><a class="btn" href="${share}" target="_blank" rel="noopener noreferrer">Partager sur LinkedIn</a></p>
  </footer>
  ${related.length ? `<section class="wrap related"><h2>À lire aussi</h2><ul class="posts">${related.map((r) => postCard(r, root)).join('')}</ul></section>` : ''}
  <nav class="wrap article-nav" aria-label="Articles précédent et suivant">
    ${older ? `<a class="prev" href="${root}blog/${older.slug}/"><small>${icon('arrow-left', { size: 16 })}Article précédent</small><span>${esc(older.title)}</span></a>` : '<span></span>'}
    ${newer ? `<a class="next" href="${root}blog/${newer.slug}/"><small>Article suivant${icon('arrow-right', { size: 16 })}</small><span>${esc(newer.title)}</span></a>` : ''}
  </nav>
</article>`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: a.title,
    description: a.summary,
    datePublished: isoDate(a.date),
    author: { '@type': 'Person', name: cfg.hero.name, url: safeUrl(cfg.links.linkedin) || cfg.site.url },
    mainEntityOfPage: url,
    inLanguage: cfg.site.lang,
    keywords: a.tags.join(', '),
    wordCount: a.words,
  };
  return page(cfg, ctx, {
    title: `${a.title} | ${cfg.site.logo}${cfg.site.logoAccent || ''}`, description: a.summary || cfg.site.description,
    canonicalPath: `blog/${a.slug}/`, body, ogType: 'article', jsonld,
  });
}

export function notFoundPage(cfg, assets) {
  // Une page 404 peut être servie depuis n'importe quelle profondeur : ses liens partent du chemin du site.
  const root = new URL(cfg.site.url).pathname.replace(/\/*$/, '/');
  const ctx = { root, section: '', noindex: true, assets };
  const body = `
<section class="page-head not-found">
  <div class="wrap">
    <p class="code-404"><code>HTTP 404</code></p>
    <h1>Cette page n'existe pas, ou plus.</h1>
    <p class="lead">L'adresse a peut-être changé. Le blog et la page d'accueil, eux, répondent toujours.</p>
    <p class="hero-cta"><a class="btn btn-primary" href="${root}">Revenir à l'accueil</a><a class="btn" href="${root}blog/">Ouvrir le blog</a></p>
  </div>
</section>`;
  return page(cfg, ctx, { title: `Page introuvable | ${cfg.site.title}`, description: 'Page introuvable.', canonicalPath: '404.html', body });
}
