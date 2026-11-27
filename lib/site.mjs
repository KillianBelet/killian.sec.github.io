// Assemble le site complet dans un dossier de sortie.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS, loadConfig, loadArticles, renderMarkdown, siteChecks, copyDir, slugify, isoDate, baseUrl, esc } from './core.mjs';
import { CSP, homePage, blogIndexPage, tagPage, articlePage, notFoundPage, coverSvg } from './theme.mjs';

const xml = esc;
const cdata = (s) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

function assetVersions() {
  const v = {};
  for (const [key, rel] of [['site.css', 'assets/css/site.css'], ['site.js', 'assets/js/site.js'], ['theme.js', 'assets/js/theme.js']]) {
    const f = path.join(PATHS.static, rel);
    if (fs.existsSync(f)) v[key] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 10);
  }
  return v;
}

export function relatedTo(a, articles, n = 2) {
  return articles
    .filter((b) => b.slug !== a.slug)
    .map((b) => ({ b, score: b.tags.filter((t) => a.tags.includes(t)).length * 2 + (b.category === a.category ? 1 : 0) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || y.b.date - x.b.date)
    .slice(0, n)
    .map((x) => x.b);
}

export function tagIndex(articles) {
  const map = new Map();
  for (const a of articles) {
    for (const t of a.tags) {
      const key = slugify(t);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { tag: t, articles: [] });
      map.get(key).articles.push(a);
    }
  }
  return map;
}

// mode "production" : articles publiés seulement. mode "preview" : brouillons et articles planifiés inclus.
export function buildSite({ outDir = PATHS.dist, mode = 'production' } = {}) {
  const t0 = Date.now();
  const warnings = [];
  const cfg = loadConfig();
  const articles = loadArticles({ mode, warn: (m) => warnings.push(m) });
  const assets = assetVersions();
  const base = baseUrl(cfg);

  fs.rmSync(outDir, { recursive: true, force: true });
  copyDir(PATHS.static, outDir);
  const write = (rel, content) => {
    const f = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };

  write('index.html', homePage(cfg, articles, assets));
  write('blog/index.html', blogIndexPage(cfg, articles, assets));
  write('404.html', notFoundPage(cfg, assets));

  articles.forEach((a, i) => {
    const rendered = renderMarkdown(a.body, { assetRoot: '../../' });
    write(`blog/${a.slug}/index.html`, articlePage(cfg, a, { assets, rendered, newer: articles[i - 1], older: articles[i + 1], related: relatedTo(a, articles) }));
    write(`assets/covers/${a.slug}.svg`, coverSvg(a));
  });

  const tags = tagIndex(articles);
  for (const [key, { tag, articles: list }] of tags) write(`blog/tag/${key}/index.html`, tagPage(cfg, tag, list, assets));

  // Flux RSS avec le contenu complet (images en adresses absolues).
  const items = articles.map((a) => {
    const url = `${base}/blog/${a.slug}/`;
    const { html } = renderMarkdown(a.body, { assetRoot: `${base}/` });
    return `<item><title>${xml(a.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${a.date.toUTCString()}</pubDate>${[a.category, ...a.tags].map((c) => `<category>${xml(c)}</category>`).join('')}<description>${xml(a.summary)}</description><content:encoded>${cdata(html)}</content:encoded></item>`;
  });
  write('rss.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>${xml(cfg.site.title)}</title><link>${base}/</link><description>${xml(cfg.site.description)}</description><language>${xml(cfg.site.lang)}</language>
<atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
</channel></rss>
`);

  const today = isoDate(new Date());
  const latest = articles[0] ? isoDate(articles[0].date) : today;
  const urls = [['', today], ['blog/', latest], ...articles.map((a) => [`blog/${a.slug}/`, isoDate(a.date)]), ...[...tags.keys()].map((k) => [`blog/tag/${k}/`, latest])];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `<url><loc>${base}/${u}</loc><lastmod>${d}</lastmod></url>`).join('\n')}
</urlset>
`);
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);

  if (cfg.links.email) {
    const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    write('.well-known/security.txt', `Contact: mailto:${cfg.links.email}\nExpires: ${expires}\nPreferred-Languages: fr, en\nCanonical: ${base}/.well-known/security.txt\n`);
  }

  // En-têtes appliqués par Netlify et Cloudflare Pages (GitHub Pages ne lit que la CSP en balise <meta>).
  write('_headers', `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Content-Security-Policy: ${CSP}; frame-ancestors 'none'

/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
`);

  return {
    ms: Date.now() - t0,
    mode,
    counts: {
      total: articles.length,
      published: articles.filter((a) => a.status === 'published').length,
      draft: articles.filter((a) => a.status === 'draft').length,
      scheduled: articles.filter((a) => a.status === 'scheduled').length,
      tags: tags.size,
    },
    warnings,
    checks: siteChecks(cfg, articles),
  };
}
