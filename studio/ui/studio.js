// Interface du Studio. Aucune dépendance ; le DOM est construit élément par élément (jamais de HTML assemblé
// à partir de données), à l'exception du rendu Markdown injecté dans le cadre de prévisualisation isolé.
const TOKEN = document.querySelector('meta[name="studio-token"]').content;
const app = document.getElementById('app');
const store = { site: {}, articles: [], git: {}, preview: {}, meta: { icons: {}, categories: [], tags: [] } };
let leaveGuard = null; // fonction renvoyant true si la vue courante a des modifications non enregistrées

/* ------------------------------------------------------------------ outils */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

function icon(name, size = 18) {
  const shapes = store.meta.icons[name];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) svg.setAttribute(k, v);
  if (shapes) {
    const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`, 'image/svg+xml');
    for (const n of [...parsed.documentElement.childNodes]) svg.append(document.importNode(n, true));
  }
  return svg;
}

async function api(method, path, body, { raw, headers } = {}) {
  const opts = { method, headers: { 'X-Studio-Token': TOKEN, ...(headers || {}) } };
  if (raw) opts.body = raw;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api/${path}`, opts); }
  catch { throw new Error('Le Studio ne répond plus. Vérifiez que « npm run studio » tourne toujours dans le terminal.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status });
  return data;
}

function toast(message, kind = 'ok') {
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status', text: message });
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3200);
}
const fail = (e) => toast(e.message, 'error');

function dialog({ title, body, confirm = 'Confirmer', danger = false, cancel = 'Annuler' }) {
  return new Promise((resolve) => {
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit', value: 'ok', text: confirm });
    const d = h('dialog', { class: 'dialog' },
      h('form', { method: 'dialog' },
        h('h2', { text: title }),
        typeof body === 'string' ? h('p', { text: body }) : body,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', text: cancel, onclick: () => d.close('cancel') }), ok)));
    d.addEventListener('close', () => { const v = d.returnValue === 'ok'; d.remove(); resolve(v); });
    document.body.append(d);
    d.showModal();
  });
}

const STATUS = { published: 'Publié', scheduled: 'Planifié', draft: 'Brouillon' };
const pill = (status) => h('span', { class: `pill pill-${status}`, text: STATUS[status] || status });
const frDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const today = () => new Date().toISOString().slice(0, 10);
const statusOf = (a) => (a.draft ? 'draft' : a.date > today() ? 'scheduled' : 'published');
const fileSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function refresh() {
  const s = await api('GET', 'state');
  Object.assign(store, s);
  const sorted = (list) => [...new Set(list)].sort((a, b) => a.localeCompare(b, 'fr'));
  store.meta.categories = sorted(s.articles.map((a) => a.category));
  store.meta.tags = sorted(s.articles.flatMap((a) => a.tags));
  return s;
}

/* ------------------------------------------------------------------ gabarit */
const NAV = [
  ['#/', 'Tableau de bord', 'gauge'],
  ['#/articles', 'Articles', 'file-text'],
  ['#/medias', 'Médias', 'layers'],
  ['#/site', 'Réglages du site', 'wrench'],
  ['#/publication', 'Publication', 'workflow'],
];

function shell(active, content, { wide = false } = {}) {
  const pending = (store.git.changes || []).length + (store.git.ahead || 0);
  app.replaceChildren(
    h('div', { class: 'shell' },
      h('aside', { class: 'side' },
        h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-logo' }, store.site.logo || 'site', h('b', { text: store.site.logoAccent || '' })), h('span', { class: 'brand-sub', text: 'Studio' })),
        h('nav', { 'aria-label': 'Studio' }, NAV.map(([href, label, ic]) =>
          h('a', { href, class: active === href ? 'is-active' : '', 'aria-current': active === href ? 'page' : null }, icon(ic), h('span', { text: label }),
            href === '#/publication' && pending ? h('span', { class: 'count', title: 'Modifications non publiées', text: String(pending) }) : null))),
        h('div', { class: 'side-foot' },
          h('a', { href: '/site/', target: '_blank', rel: 'noopener' }, icon('globe'), 'Voir le site (aperçu)'),
          h('p', { text: 'Local uniquement : 127.0.0.1' }))),
      h('main', { class: `main${wide ? ' main-wide' : ''}`, id: 'main' }, content)));
}

const pageHead = (title, intro, ...actions) =>
  h('header', { class: 'page-head' }, h('div', {}, h('h1', { text: title }), intro ? h('p', { text: intro }) : null), h('div', { class: 'page-actions' }, actions));

/* ----------------------------------------------------------- tableau de bord */
async function viewDashboard() {
  await refresh();
  const a = store.articles;
  const count = (s) => a.filter((x) => x.status === s).length;
  const checks = store.preview.ok ? [...(store.preview.warnings || []).map((t) => ({ level: 'warn', text: t })), ...(store.preview.checks || [])] : [{ level: 'warn', text: `La prévisualisation n'a pas pu être générée : ${store.preview.error}` }];
  const changes = store.git.changes || [];
  const gitLine = !store.git.repo ? store.git.reason
    : changes.length ? `${changes.length} fichier${changes.length > 1 ? 's' : ''} de contenu modifié${changes.length > 1 ? 's' : ''}, pas encore publié${changes.length > 1 ? 's' : ''}.`
      : store.git.ahead ? `${store.git.ahead} commit(s) en attente d'envoi vers le dépôt distant.` : 'Tout le contenu est publié.';

  shell('#/', [
    pageHead('Tableau de bord', store.site.title,
      h('button', { class: 'btn btn-primary', onclick: newArticle }, 'Écrire un article')),
    h('div', { class: 'stats' },
      [['published', 'Publiés', 'en ligne à la prochaine publication'], ['scheduled', 'Planifiés', 'en attente de leur date'], ['draft', 'Brouillons', 'visibles seulement ici']].map(([s, label, hint]) =>
        h('a', { class: 'stat', href: '#/articles' }, h('strong', { text: String(count(s)) }), h('span', { text: label }), h('small', { text: hint })))),
    h('div', { class: 'cols' },
      h('section', { class: 'panel' },
        h('h2', { text: 'Derniers articles' }),
        a.length ? h('ul', { class: 'rows' }, a.slice(0, 6).map((x) =>
          h('li', {}, h('a', { href: `#/articles/${x.slug}` }, h('span', { class: 'row-title', text: x.title || '(sans titre)' }), h('span', { class: 'row-meta' }, frDate(x.date), pill(x.status))))))
          : h('p', { class: 'empty', text: 'Aucun article pour le moment. Le bouton « Écrire un article » crée le premier brouillon.' }),
        a.length > 6 ? h('p', { class: 'panel-more' }, h('a', { href: '#/articles', text: `Voir les ${a.length} articles` })) : null),
      h('section', { class: 'panel' },
        h('h2', { text: 'Avant la prochaine publication' }),
        h('p', { class: `git-line${changes.length ? ' is-pending' : ''}` }, icon('git-branch'), gitLine, ' ', h('a', { href: '#/publication', text: 'Ouvrir la publication' })),
        checks.length ? h('ul', { class: 'checks' }, checks.map((c) => h('li', { class: `check check-${c.level}` }, icon(c.level === 'warn' ? 'shield-alert' : 'eye', 16), h('span', { text: c.text }))))
          : h('p', { class: 'check check-ok' }, icon('shield-check', 16), 'Aucun point à corriger.'))),
  ]);
}

async function newArticle() {
  const title = h('input', { type: 'text', required: true, maxLength: 200, placeholder: 'Ex. Durcir un cluster Kubernetes en cinq étapes', autofocus: true });
  const cat = h('input', { type: 'text', maxLength: 60, value: 'Sécurité', list: 'cats' });
  const ok = await dialog({
    title: 'Nouvel article', confirm: 'Créer le brouillon',
    body: h('div', { class: 'fields' },
      h('label', {}, h('span', { text: 'Titre' }), title),
      h('label', {}, h('span', { text: 'Catégorie' }), cat),
      h('datalist', { id: 'cats' }, store.meta.categories.map((c) => h('option', { value: c })))),
  });
  if (!ok || !title.value.trim()) return;
  try {
    const a = await api('POST', 'articles', { title: title.value, category: cat.value });
    location.hash = `#/articles/${a.slug}`;
  } catch (e) { fail(e); }
}

/* ------------------------------------------------------------------ articles */
async function viewArticles() {
  await refresh();
  const search = h('input', { type: 'search', placeholder: 'Filtrer par titre, catégorie ou tag', 'aria-label': 'Filtrer les articles' });
  const status = h('select', { 'aria-label': 'Filtrer par statut' }, h('option', { value: '', text: 'Tous les statuts' }), Object.entries(STATUS).map(([v, t]) => h('option', { value: v, text: t })));
  const tbody = h('tbody');
  const empty = h('p', { class: 'empty', hidden: true });

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const list = store.articles.filter((a) => (!status.value || a.status === status.value) && (!q || [a.title, a.category, ...a.tags].join(' ').toLowerCase().includes(q)));
    tbody.replaceChildren(...list.map((a) => h('tr', {},
      h('td', {}, h('a', { class: 'row-title', href: `#/articles/${a.slug}`, text: a.title || '(sans titre)' }), a.problems.length ? h('small', { class: 'problem', text: `À corriger : ${a.problems.join(', ')}` }) : h('small', { text: `/blog/${a.slug}/` })),
      h('td', {}, pill(a.status)),
      h('td', { text: a.category }),
      h('td', { class: 'nowrap', text: frDate(a.date) }),
      h('td', { class: 'nowrap', text: `${a.minutes} min` }),
      h('td', { class: 'actions' },
        h('a', { class: 'btn btn-small', href: `/site/blog/${a.slug}/`, target: '_blank', rel: 'noopener', text: 'Aperçu' }),
        h('button', { class: 'btn btn-small', onclick: () => duplicate(a), text: 'Dupliquer' }),
        h('button', { class: 'btn btn-small btn-ghost-danger', onclick: () => remove(a), text: 'Supprimer' })))));
    empty.hidden = list.length > 0;
    empty.textContent = store.articles.length ? 'Aucun article ne correspond à ce filtre.' : 'Aucun article pour le moment. Le bouton « Écrire un article » crée le premier brouillon.';
  };
  const duplicate = async (a) => { try { const c = await api('POST', `articles/${a.slug}/duplicate`); location.hash = `#/articles/${c.slug}`; } catch (e) { fail(e); } };
  const remove = async (a) => {
    if (!await dialog({ title: 'Supprimer cet article ?', body: `« ${a.title} » sera supprimé du dossier content/articles. S'il a déjà été publié, il reste récupérable dans l'historique Git.`, confirm: 'Supprimer', danger: true })) return;
    try { await api('DELETE', `articles/${a.slug}`); await refresh(); draw(); toast('Article supprimé'); } catch (e) { fail(e); }
  };
  search.addEventListener('input', draw);
  status.addEventListener('change', draw);

  shell('#/articles', [
    pageHead('Articles', `${store.articles.length} article${store.articles.length > 1 ? 's' : ''} dans content/articles`,
      h('button', { class: 'btn btn-primary', onclick: newArticle }, 'Écrire un article')),
    h('div', { class: 'toolbar' }, search, status),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Titre', 'Statut', 'Catégorie', 'Date', 'Lecture', ''].map((t) => h('th', { text: t })))), tbody)),
    empty,
  ]);
  draw();
}

/* ------------------------------------------------------------------- éditeur */
const TOOLS = [
  ['Gras', 'B', (ed) => ed.wrap('**', '**', 'texte en gras'), 'Ctrl+B'],
  ['Italique', 'I', (ed) => ed.wrap('*', '*', 'texte en italique'), 'Ctrl+I'],
  ['Titre', 'H2', (ed) => ed.prefix('## ')],
  ['Sous-titre', 'H3', (ed) => ed.prefix('### ')],
  ['Liste', '• Liste', (ed) => ed.prefix('- ')],
  ['Liste numérotée', '1. Liste', (ed) => ed.prefix('1. ')],
  ['Citation', '« »', (ed) => ed.prefix('> ')],
  ['Lien', 'Lien', (ed) => ed.wrap('[', '](https://)', 'texte du lien'), 'Ctrl+K'],
  ['Code en ligne', '`code`', (ed) => ed.wrap('`', '`', 'code')],
  ['Bloc de code', '{ } Bloc', (ed) => ed.block('```bash\n', '\n```', '# commande')],
  ['Tableau', 'Tableau', (ed) => ed.block('', '', '| Colonne A | Colonne B |\n| --- | --- |\n| valeur | valeur |')],
  ['Image', 'Image', (ed) => ed.image()],
];

function articleChecks(a, words) {
  const out = [];
  const add = (ok, text) => out.push({ ok, text });
  add(a.title.length >= 20 && a.title.length <= 70, `Titre de 20 à 70 caractères (actuellement ${a.title.length})`);
  add(a.summary.length >= 80 && a.summary.length <= 200, `Résumé de 80 à 200 caractères (actuellement ${a.summary.length})`);
  add(a.tags.length >= 1 && a.tags.length <= 6, `Entre 1 et 6 tags (actuellement ${a.tags.length})`);
  add(words >= 300, `Au moins 300 mots (actuellement ${words})`);
  add(/^##\s+\S/m.test(a.body), 'Au moins un intertitre (##) pour structurer la lecture');
  add(!/!\[\s*\]\(/.test(a.body), 'Toutes les images ont un texte alternatif');
  add(!/À COMPLÉTER|TODO|Votre contenu\./.test(a.body), 'Aucun texte provisoire restant (TODO, À COMPLÉTER)');
  return out;
}

async function viewEditor(slug) {
  let art;
  try { [art] = await Promise.all([api('GET', `articles/${slug}`), refresh()]); }
  catch (e) { fail(e); location.hash = '#/articles'; return; }

  let dirty = false;
  let saving = false;
  let words = art.words;
  const f = {
    title: h('input', { class: 'title-input', type: 'text', value: art.title, maxLength: 200, placeholder: 'Titre de l\'article', 'aria-label': 'Titre' }),
    body: h('textarea', { class: 'md', spellcheck: true, 'aria-label': 'Contenu en Markdown', placeholder: 'Écrivez en Markdown…' }),
    slug: h('input', { type: 'text', value: art.slug, maxLength: 120, pattern: '[a-z0-9]+(-[a-z0-9]+)*' }),
    date: h('input', { type: 'date', value: art.date, required: true }),
    category: h('input', { type: 'text', value: art.category, maxLength: 60, list: 'cat-list' }),
    tags: h('input', { type: 'text', value: art.tags.join(', '), placeholder: 'ci-cd, kubernetes, trivy' }),
    summary: h('textarea', { rows: 4, maxLength: 400 }),
    cover: h('input', { type: 'hidden', value: art.cover }),
    draft: h('select', {}, h('option', { value: '1', text: 'Brouillon' }), h('option', { value: '0', text: 'Publié' })),
  };
  f.body.value = art.body;
  f.summary.value = art.summary;
  f.draft.value = art.draft ? '1' : '0';

  const current = () => ({
    title: f.title.value.trim(), slug: f.slug.value.trim(), date: f.date.value, category: f.category.value.trim(),
    tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean), summary: f.summary.value.trim(),
    cover: f.cover.value, draft: f.draft.value === '1', body: f.body.value,
  });

  /* État et enregistrement */
  const statePill = h('span', { class: 'pill' });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', text: 'Enregistrer' });
  const counter = h('span', { class: 'counter' });
  const sumCount = h('small', { class: 'hint' });
  const checksBox = h('ul', { class: 'checks' });
  const checksBadge = h('span', { class: 'count', hidden: true });
  const coverBox = h('div', { class: 'cover-box' });
  const statusHint = h('small', { class: 'hint' });

  const drawState = () => {
    const c = current();
    const st = statusOf(c);
    statePill.className = `pill pill-${dirty ? 'dirty' : st}`;
    statePill.textContent = dirty ? 'Modifications non enregistrées' : STATUS[st];
    saveBtn.disabled = saving || !dirty;
    counter.textContent = `${words} mots, ${Math.max(1, Math.ceil(words / 200))} min de lecture`;
    sumCount.textContent = `${c.summary.length} caractères. Affiché sur les cartes et dans les moteurs de recherche.`;
    statusHint.textContent = st === 'draft' ? 'Visible uniquement dans le Studio et l\'aperçu.'
      : st === 'scheduled' ? `Sera mis en ligne par la première publication à partir du ${frDate(c.date)}.` : 'Sera en ligne à la prochaine publication.';
    const checks = articleChecks(c, words);
    const ko = checks.filter((x) => !x.ok).length;
    checksBox.replaceChildren(...checks.map((x) => h('li', { class: `check ${x.ok ? 'check-ok' : 'check-warn'}` }, icon(x.ok ? 'check' : 'shield-alert', 16), h('span', { text: x.text }))));
    checksBadge.hidden = !ko;
    checksBadge.textContent = String(ko);
  };

  const drawCover = () => {
    coverBox.replaceChildren(
      f.cover.value ? h('img', { src: `/site${f.cover.value}`, alt: '' }) : h('p', { class: 'hint', text: 'Sans image, une vignette est générée automatiquement.' }),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-small', type: 'button', text: f.cover.value ? 'Changer' : 'Choisir une image', onclick: async () => { const m = await pickMedia(); if (m) { f.cover.value = m.path; drawCover(); touch(); } } }),
        f.cover.value ? h('button', { class: 'btn btn-small', type: 'button', text: 'Retirer', onclick: () => { f.cover.value = ''; drawCover(); touch(); } }) : null));
  };

  const save = async (force = false) => {
    if (saving) return;
    const c = current();
    if (!c.title) { toast('Le titre est obligatoire.', 'error'); f.title.focus(); return; }
    if (!c.date) { toast('La date est obligatoire.', 'error'); return; }
    saving = true; drawState();
    try {
      const saved = await api('PUT', `articles/${art.slug}`, { ...c, baseMtime: art.mtime, force });
      const moved = saved.slug !== art.slug;
      art = saved; dirty = false;
      toast('Article enregistré');
      if (moved) { leaveGuard = null; location.replace(`#/articles/${saved.slug}`); return; }
    } catch (e) {
      if (e.status === 409 && /en dehors du Studio/.test(e.message)) {
        saving = false;
        if (await dialog({ title: 'Fichier modifié ailleurs', body: 'Ce fichier a été modifié en dehors du Studio (dans votre éditeur de code, par exemple) depuis son ouverture. Enregistrer remplacera ces modifications.', confirm: 'Remplacer', danger: true })) return save(true);
      } else fail(e);
    } finally { saving = false; drawState(); }
  };
  saveBtn.addEventListener('click', () => save());

  /* Prévisualisation : cadre isolé (aucun script ne s'y exécute), mis à jour sans perdre la position de lecture */
  const frame = h('iframe', { class: 'preview-frame', title: 'Aperçu de l\'article', src: '/preview-frame', sandbox: 'allow-same-origin' });
  let frameReady = false;
  frame.addEventListener('load', () => {
    // Un lien suivi dans l'aperçu quitte le gabarit : on y revient pour que la mise à jour en direct continue.
    if (frame.contentWindow.location.pathname !== '/preview-frame') { frameReady = false; frame.src = '/preview-frame'; return; }
    frameReady = true; renderPreview();
  });
  const renderPreview = debounce(async () => {
    if (!frameReady) return;
    const c = current();
    let r;
    try { r = await api('POST', 'render', { body: c.body }); } catch { return; }
    words = r.words;
    const doc = frame.contentDocument;
    if (!doc) return;
    const set = (key, value) => { const el = doc.querySelector(`[data-preview="${key}"]`); if (el) el.textContent = value; };
    set('title', c.title || 'Titre de l\'article');
    set('summary', c.summary);
    set('category', c.category || 'Article');
    set('date', c.date ? new Date(`${c.date}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
    set('minutes', String(r.minutes));
    const tags = doc.querySelector('[data-preview="tags"]');
    if (tags) tags.replaceChildren(...c.tags.map((t) => { const li = doc.createElement('li'); li.textContent = `#${t}`; return li; }));
    const body = doc.querySelector('[data-preview="body"]');
    if (body) body.innerHTML = (c.cover ? `<img class="article-cover" src="/site${encodeURI(c.cover)}" alt="">` : '') + r.html;
    drawState();
  }, 300);

  const touch = () => { dirty = true; drawState(); renderPreview(); };
  for (const el of Object.values(f)) el.addEventListener('input', touch);
  f.draft.addEventListener('change', touch);

  /* Barre d'outils Markdown */
  const insert = (textValue, selStart, selEnd) => {
    f.body.focus();
    const start = f.body.selectionStart;
    if (!document.execCommand('insertText', false, textValue)) { f.body.setRangeText(textValue, start, f.body.selectionEnd, 'end'); }
    if (selStart != null) f.body.setSelectionRange(start + selStart, start + selEnd);
    touch();
  };
  const ed = {
    sel: () => f.body.value.slice(f.body.selectionStart, f.body.selectionEnd),
    wrap(before, after, placeholder) { const s = ed.sel() || placeholder; insert(before + s + after, before.length, before.length + s.length); },
    prefix(p) {
      const v = f.body.value, a = v.lastIndexOf('\n', f.body.selectionStart - 1) + 1;
      let b = v.indexOf('\n', f.body.selectionEnd); if (b === -1) b = v.length;
      f.body.setSelectionRange(a, b);
      insert(v.slice(a, b).split('\n').map((l) => (l.startsWith(p) ? l.slice(p.length) : p + l)).join('\n'));
    },
    block(before, after, placeholder) {
      const s = ed.sel() || placeholder;
      const lead = f.body.selectionStart > 0 && f.body.value[f.body.selectionStart - 1] !== '\n' ? '\n\n' : '';
      insert(`${lead}${before}${s}${after}\n`, lead.length + before.length, lead.length + before.length + s.length);
    },
    async image() { const m = await pickMedia(); if (m) ed.insertImage(m); },
    insertImage(m) { const alt = 'Description de l\'image'; insert(`![${alt}](${m.path})`, 2, 2 + alt.length); },
  };
  const uploadInto = async (files) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try { ed.insertImage(await upload(file)); toast('Image ajoutée aux médias'); } catch (e) { fail(e); }
    }
  };
  f.body.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); uploadInto(files); } });
  f.body.addEventListener('drop', (e) => { const files = [...(e.dataTransfer?.files || [])]; if (files.length) { e.preventDefault(); uploadInto(files); } });
  f.body.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); TOOLS[0][2](ed); }
    if (k === 'i') { e.preventDefault(); TOOLS[1][2](ed); }
    if (k === 'k') { e.preventDefault(); TOOLS[7][2](ed); }
  });
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); } };
  document.addEventListener('keydown', onKey);
  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);
  leaveGuard = Object.assign(() => dirty, { dispose() { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); } });

  /* Panneau de droite : aperçu ou réglages */
  const settings = h('div', { class: 'settings', hidden: true },
    h('div', { class: 'fields' },
      h('label', {}, h('span', { text: 'Statut' }), f.draft, statusHint),
      h('label', {}, h('span', { text: 'Date de publication' }), f.date, h('small', { class: 'hint', text: 'Une date future planifie l\'article.' })),
      h('label', {}, h('span', { text: 'Catégorie' }), f.category),
      h('datalist', { id: 'cat-list' }, store.meta.categories.map((c) => h('option', { value: c }))),
      h('label', {}, h('span', { text: 'Tags, séparés par des virgules' }), f.tags, store.meta.tags.length ? h('small', { class: 'hint', text: `Déjà utilisés : ${store.meta.tags.join(', ')}` }) : null),
      h('label', {}, h('span', { text: 'Résumé' }), f.summary, sumCount),
      h('label', {}, h('span', { text: 'Adresse de l\'article' }), h('div', { class: 'affix' }, h('span', { text: '/blog/' }), f.slug), h('small', { class: 'hint', text: 'Changer l\'adresse d\'un article déjà partagé casse les liens existants.' })),
      h('div', { class: 'field' }, h('span', { text: 'Image de couverture' }), coverBox, f.cover)),
    h('h3', { text: 'Contrôles avant publication' }), checksBox);
  const previewPane = h('div', { class: 'preview-pane' }, frame);
  const tabs = [['Aperçu', previewPane], ['Réglages', settings]].map(([label, pane], i) => {
    const b = h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(i === 0) }, label, i === 1 ? checksBadge : null);
    b.addEventListener('click', () => { tabs.forEach((t) => { t.b.setAttribute('aria-selected', String(t.b === b)); t.pane.hidden = t.pane !== pane; }); });
    return { b, pane };
  });

  shell('#/articles', h('div', { class: 'editor' },
    h('header', { class: 'editor-head' },
      h('a', { class: 'back', href: '#/articles' }, icon('arrow-left', 16), 'Articles'),
      f.title,
      h('div', { class: 'page-actions' }, statePill,
        h('a', { class: 'btn', href: `/site/blog/${art.slug}/`, target: '_blank', rel: 'noopener', title: 'Ouvre la dernière version enregistrée dans un nouvel onglet', text: 'Ouvrir l\'aperçu' }), saveBtn)),
    h('div', { class: 'editor-body' },
      h('section', { class: 'write', 'aria-label': 'Rédaction' },
        h('div', { class: 'md-tools', role: 'toolbar', 'aria-label': 'Mise en forme' }, TOOLS.map(([label, short, fn, key]) =>
          h('button', { type: 'button', class: 'tool', title: key ? `${label} (${key})` : label, 'aria-label': label, onclick: () => fn(ed), text: short }))),
        f.body,
        h('footer', { class: 'write-foot' }, counter, h('span', { text: 'Ctrl+S pour enregistrer. Glissez ou collez une image pour l\'ajouter.' }))),
      h('section', { class: 'side-pane', 'aria-label': 'Aperçu et réglages' },
        h('div', { class: 'tabs', role: 'tablist' }, tabs.map((t) => t.b)), previewPane, settings))), { wide: true });
  drawCover();
  drawState();
}

/* -------------------------------------------------------------------- médias */
async function upload(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error(`« ${file.name} » dépasse 5 Mo. Réduisez l'image avant de l'envoyer.`);
  return api('POST', 'media', undefined, { raw: file, headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) } });
}

function uploadButton(onDone, label = 'Ajouter des images') {
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/avif,image/gif', multiple: true, hidden: true });
  input.addEventListener('change', async () => {
    let last;
    for (const file of input.files) { try { last = await upload(file); } catch (e) { fail(e); } }
    input.value = '';
    if (last) { toast('Image ajoutée'); onDone(last); }
  });
  return h('span', {}, input, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => input.click(), text: label }));
}

function pickMedia() {
  return new Promise((resolve) => {
    const grid = h('div', { class: 'media-grid media-pick' });
    const d = h('dialog', { class: 'dialog dialog-wide' });
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    const draw = async () => {
      const list = await api('GET', 'media').catch(() => []);
      grid.replaceChildren(...(list.length ? list.map((m) => h('button', { type: 'button', class: 'media', onclick: () => close(m) }, h('img', { src: `/site${m.path}`, alt: '', loading: 'lazy' }), h('span', { text: m.name })))
        : [h('p', { class: 'empty', text: 'Aucune image pour le moment. Ajoutez-en une avec le bouton ci-dessus.' })]));
    };
    d.append(h('div', { class: 'dialog-head' }, h('h2', { text: 'Choisir une image' }), h('div', { class: 'row-actions' }, uploadButton(close, 'Envoyer une image'), h('button', { class: 'btn', type: 'button', onclick: () => close(null), text: 'Fermer' }))), grid);
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(d);
    d.showModal();
    draw();
  });
}

async function viewMedia() {
  await refresh();
  const grid = h('div', { class: 'media-grid' });
  const draw = async () => {
    const list = await api('GET', 'media');
    grid.replaceChildren(...(list.length ? list.map((m) => h('figure', { class: 'media' },
      h('img', { src: `/site${m.path}`, alt: '', loading: 'lazy' }),
      h('figcaption', {}, h('strong', { text: m.name }), h('small', { text: `${fileSize(m.size)}${m.usedIn.length ? `, utilisée dans ${m.usedIn.length} article${m.usedIn.length > 1 ? 's' : ''}` : ', non utilisée'}` }),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-small', type: 'button', text: 'Copier le Markdown', onclick: () => navigator.clipboard.writeText(`![Description de l'image](${m.path})`).then(() => toast('Markdown copié')) }),
          h('button', { class: 'btn btn-small btn-ghost-danger', type: 'button', text: 'Supprimer', onclick: async () => {
            const used = m.usedIn.length ? ` Elle est utilisée dans : ${m.usedIn.join(', ')}. Ces articles afficheront une image manquante.` : '';
            if (!await dialog({ title: 'Supprimer cette image ?', body: `${m.name} sera supprimée de static/assets/uploads.${used}`, confirm: 'Supprimer', danger: true })) return;
            try { await api('DELETE', `media/${m.name}`); toast('Image supprimée'); draw(); } catch (e) { fail(e); }
          } })))))
      : [h('p', { class: 'empty', text: 'Aucune image pour le moment. Les images ajoutées ici peuvent être insérées dans un article ou servir de couverture.' })]));
  };
  shell('#/medias', [
    pageHead('Médias', 'Images du dossier static/assets/uploads. PNG, JPEG, WebP, AVIF ou GIF, 5 Mo maximum.', uploadButton(draw)),
    grid,
  ]);
  draw().catch(fail);
}

/* ---------------------------------------------------------- réglages du site */
const T = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
const SCHEMA = [
  { key: 'site', title: 'Identité', fields: [T('url', 'Adresse du site en ligne', 'url', { hint: 'Utilisée pour les liens canoniques, le flux RSS et le sitemap.' }), T('title', 'Titre (onglet du navigateur, moteurs de recherche)'), T('description', 'Description', 'textarea', { hint: '160 caractères environ.' }), T('logo', 'Logo : partie principale'), T('logoAccent', 'Logo : partie colorée'), T('copyrightName', 'Nom affiché dans le copyright')] },
  { key: 'links', title: 'Liens', fields: [T('linkedin', 'Profil LinkedIn', 'url'), T('github', 'Profil GitHub', 'url', { hint: 'Laissez vide pour ne pas l\'afficher.' }), T('email', 'Adresse e-mail', 'email', { hint: 'Active le bouton e-mail et le fichier security.txt.' })] },
  { key: 'hero', title: 'Accueil', fields: [T('greeting', 'Accroche'), T('name', 'Prénom ou nom'), T('bio', 'Présentation', 'textarea'), T('role', 'Rôle'), T('location', 'Localisation'), T('cvUrl', 'Lien vers le CV', 'text', { hint: 'Chemin ou adresse https. Vide = bouton masqué.' }), T('interests', 'Centres d\'intérêt', 'list'), T('pipelineTitle', 'Chaîne de sécurité : légende'),
    T('pipeline', 'Chaîne de sécurité : étapes', 'repeat', { hint: 'La dernière étape est affichée « en cours ». Huit étapes au maximum.', max: 8, of: [T('stage', 'Étape'), T('tool', 'Outil'), T('detail', 'Précision')] })] },
  { key: 'expertise', title: 'Expertise', fields: [T('title', 'Titre de la rubrique'), T('items', 'Domaines', 'repeat', { of: [T('title', 'Titre'), T('icon', 'Icône', 'icon'), T('text', 'Description', 'textarea')] })] },
  { key: 'skills', title: 'Outils', fields: [T('title', 'Titre de la rubrique'), T('groups', 'Groupes', 'repeat', { of: [T('title', 'Nom du groupe'), T('items', 'Outils et technologies', 'list')] })] },
  { key: 'experience', title: 'Expérience', fields: [T('heading', 'Titre de la rubrique Parcours'), T('title', 'Titre de la colonne'), T('items', 'Postes (du plus récent au plus ancien)', 'repeat', { of: [T('title', 'Poste'), T('period', 'Période'), T('org', 'Entreprise'), T('place', 'Lieu'), T('text', 'Description', 'textarea')] })] },
  { key: 'education', title: 'Formation', fields: [T('title', 'Titre de la colonne'), T('items', 'Diplômes (du plus récent au plus ancien)', 'repeat', { of: [T('title', 'Diplôme'), T('period', 'Période'), T('org', 'École'), T('text', 'Précision', 'textarea')] })] },
  { key: 'projects', title: 'Réalisations', fields: [T('title', 'Titre de la rubrique'), T('intro', 'Introduction', 'textarea'), T('items', 'Réalisations', 'repeat', { of: [T('title', 'Titre'), T('category', 'Catégorie'), T('text', 'Description', 'textarea'), T('tags', 'Tags', 'list')] })] },
  { key: 'testimonials', title: 'Recommandations', fields: [T('title', 'Titre de la rubrique'), T('items', 'Recommandations', 'repeat', { hint: 'Demandez l\'accord des personnes citées. Une liste vide masque la rubrique.', of: [T('name', 'Nom'), T('role', 'Fonction'), T('text', 'Citation', 'textarea')] })] },
  { key: 'blog', title: 'Blog', fields: [T('title', 'Titre sur la page d\'accueil'), T('homeCount', 'Nombre d\'articles sur l\'accueil', 'number'), T('pageTitle', 'Titre de la page Blog'), T('pageIntro', 'Introduction de la page Blog', 'textarea')] },
  { key: 'contact', title: 'Contact', fields: [T('title', 'Titre'), T('text', 'Texte', 'textarea')] },
];

function fieldInput(def, obj, changed) {
  const set = (v) => { obj[def.key] = v; changed(); };
  const val = obj[def.key];
  if (def.type === 'textarea') { const el = h('textarea', { rows: 3 }); el.value = val ?? ''; el.addEventListener('input', () => set(el.value)); return el; }
  if (def.type === 'number') { const el = h('input', { type: 'number', min: 1, max: 12, value: String(val ?? 3) }); el.addEventListener('input', () => set(Number(el.value) || 1)); return el; }
  if (def.type === 'list') { const el = h('input', { type: 'text', value: (val || []).join(', '), placeholder: 'Éléments séparés par des virgules' }); el.addEventListener('input', () => set(el.value.split(',').map((s) => s.trim()).filter(Boolean))); return el; }
  if (def.type === 'icon') {
    const preview = h('span', { class: 'icon-preview' }, icon(val || 'code', 20));
    const el = h('select', {}, Object.keys(store.meta.icons).map((n) => h('option', { value: n, text: n, selected: n === val })));
    el.addEventListener('change', () => { set(el.value); preview.replaceChildren(icon(el.value, 20)); });
    return h('div', { class: 'affix' }, preview, el);
  }
  const el = h('input', { type: def.type === 'url' ? 'url' : def.type === 'email' ? 'email' : 'text', value: val ?? '' });
  el.addEventListener('input', () => set(el.value.trim() === '' ? '' : el.value));
  return el;
}

function repeatField(def, obj, changed) {
  if (!Array.isArray(obj[def.key])) obj[def.key] = [];
  const list = obj[def.key];
  const box = h('div', { class: 'repeat' });
  const draw = (openIndex = -1) => {
    box.replaceChildren(
      ...list.map((item, i) => {
        const summary = h('summary', {}, h('span', { class: 'repeat-title', text: item[def.of[0].key] || `Élément ${i + 1}` }),
          h('span', { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn btn-small', disabled: i === 0, 'aria-label': 'Monter', title: 'Monter', text: '↑', onclick: (e) => { e.preventDefault(); [list[i - 1], list[i]] = [list[i], list[i - 1]]; changed(); draw(); } }),
            h('button', { type: 'button', class: 'btn btn-small', disabled: i === list.length - 1, 'aria-label': 'Descendre', title: 'Descendre', text: '↓', onclick: (e) => { e.preventDefault(); [list[i + 1], list[i]] = [list[i], list[i + 1]]; changed(); draw(); } }),
            h('button', { type: 'button', class: 'btn btn-small btn-ghost-danger', text: 'Retirer', onclick: (e) => { e.preventDefault(); list.splice(i, 1); changed(); draw(); } })));
        const title = summary.querySelector('.repeat-title');
        return h('details', { class: 'repeat-item', open: i === openIndex }, summary,
          h('div', { class: 'fields' }, def.of.map((sub) => h('label', {}, h('span', { text: sub.label }),
            fieldInput(sub, item, () => { title.textContent = item[def.of[0].key] || `Élément ${i + 1}`; changed(); })))));
      }),
      h('button', { type: 'button', class: 'btn btn-small', disabled: def.max && list.length >= def.max, text: 'Ajouter un élément', onclick: () => {
        list.push(Object.fromEntries(def.of.map((s) => [s.key, s.type === 'list' ? [] : s.type === 'icon' ? 'shield' : ''])));
        changed(); draw(list.length - 1);
      } }));
  };
  draw();
  return box;
}

// Les réglages modifiés sont conservés en passant d'une rubrique à l'autre, jusqu'à l'enregistrement.
let settingsDraft = null;

async function viewSettings(sectionKey) {
  if (!settingsDraft) {
    try { const [cfg] = await Promise.all([api('GET', 'config'), refresh()]); settingsDraft = { cfg, dirty: false }; } catch (e) { fail(e); return; }
  }
  const draft = settingsDraft;
  const { cfg } = draft;
  const section = SCHEMA.find((s) => s.key === sectionKey) || SCHEMA[0];
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: !draft.dirty, text: 'Enregistrer les réglages' });
  const changed = () => { draft.dirty = true; saveBtn.disabled = false; };
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try { await api('PUT', 'config', cfg); draft.dirty = false; toast('Réglages enregistrés'); await refresh(); }
    catch (e) { fail(e); saveBtn.disabled = false; }
  });
  const onUnload = (e) => { if (draft.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);
  leaveGuard = Object.assign(() => draft.dirty, { dispose() { window.removeEventListener('beforeunload', onUnload); } });

  const data = cfg[section.key] || (cfg[section.key] = {});
  shell('#/site', [
    pageHead('Réglages du site', 'Textes, liens et rubriques de la page d\'accueil (fichier site.config.json).',
      h('a', { class: 'btn', href: '/site/', target: '_blank', rel: 'noopener', text: 'Ouvrir l\'aperçu' }), saveBtn),
    h('div', { class: 'settings-layout' },
      h('nav', { class: 'subnav', 'aria-label': 'Rubriques' }, SCHEMA.map((s) => h('a', { href: `#/site/${s.key}`, class: s === section ? 'is-active' : '', text: s.title }))),
      h('section', { class: 'panel' }, h('h2', { text: section.title }),
        h('div', { class: 'fields' }, section.fields.map((def) => def.type === 'repeat'
          ? h('div', { class: 'field' }, h('span', { text: def.label }), def.hint ? h('small', { class: 'hint', text: def.hint }) : null, repeatField(def, data, changed))
          : h('label', {}, h('span', { text: def.label }), fieldInput(def, data, changed), def.hint ? h('small', { class: 'hint', text: def.hint }) : null))))),
  ]);
}

/* --------------------------------------------------------------- publication */
async function viewPublish(lastSteps) {
  await refresh();
  const g = store.git;
  const log = h('ol', { class: 'steps' });
  const drawSteps = (steps) => log.replaceChildren(...steps.map((s) => h('li', { class: s.ok ? 'step-ok' : 'step-ko' }, icon(s.ok ? 'check' : 'shield-alert', 16), h('div', {}, h('strong', { text: s.name }), s.output ? h('pre', { text: s.output }) : null))));

  const buildBtn = h('button', { class: 'btn', type: 'button', text: 'Vérifier le build de production' });
  buildBtn.addEventListener('click', async () => {
    buildBtn.disabled = true;
    try {
      const r = await api('POST', 'build');
      drawSteps([{ name: 'Build de production', ok: r.ok, output: r.ok ? [`${r.counts.published} article(s) publié(s), ${r.counts.tags} tag(s), ${r.ms} ms. Site généré dans dist/.`, ...r.warnings, ...r.checks.map((c) => c.text)].join('\n') : r.error }]);
    } catch (e) { fail(e); }
    buildBtn.disabled = false;
  });

  let body;
  if (!g.repo) {
    body = h('section', { class: 'panel' }, h('h2', { text: 'Dépôt Git requis' }), h('p', { text: g.reason }),
      h('p', { text: 'La publication enregistre le contenu dans Git puis l\'envoie vers le dépôt distant, où le workflow de déploiement met le site en ligne. Initialisez le dépôt une fois, depuis le dossier du projet :' }),
      h('pre', { class: 'cmd', text: 'git init -b main\ngit add .\ngit commit -m "Portfolio : version initiale"\ngit remote add origin <adresse-du-dépôt>\ngit push -u origin main' }),
      h('p', { class: 'row-actions' }, buildBtn));
  } else {
    const changed = g.changes.map((c) => c.file.replace(/^content\/articles\//, '').replace(/\.md$/, ''));
    const message = h('input', { type: 'text', maxLength: 200, value: g.changes.length === 1 ? `Contenu : ${changed[0]}` : 'Mise à jour du contenu' });
    const push = h('input', { type: 'checkbox', checked: !!g.remote, disabled: !g.remote });
    const go = h('button', { class: 'btn btn-primary', type: 'button', text: 'Publier', disabled: !g.changes.length && !g.ahead });
    go.addEventListener('click', async () => {
      go.disabled = true; buildBtn.disabled = true;
      try {
        const r = await api('POST', 'publish', { message: message.value, push: push.checked });
        drawSteps(r.steps);
        toast(r.ok ? (push.checked ? 'Publié : le déploiement démarre côté dépôt distant' : 'Contenu enregistré dans Git') : 'La publication s\'est arrêtée sur une erreur', r.ok ? 'ok' : 'error');
        if (r.ok) { await viewPublish(r.steps); return; }
      } catch (e) { fail(e); }
      go.disabled = false; buildBtn.disabled = false;
    });
    body = [
      h('section', { class: 'panel' }, h('h2', { text: 'Contenu en attente' }),
        h('dl', { class: 'facts' }, h('dt', { text: 'Branche' }), h('dd', { text: g.branch }), h('dt', { text: 'Dépôt distant' }), h('dd', { text: g.remote || 'aucun (le contenu sera enregistré localement)' }),
          g.ahead ? [h('dt', { text: 'En attente d\'envoi' }), h('dd', { text: `${g.ahead} commit(s)` })] : null),
        g.changes.length ? h('ul', { class: 'rows' }, g.changes.map((c) => h('li', {}, h('span', { class: 'row-file', text: c.file }), h('span', { class: 'pill pill-dirty', text: c.state }))))
          : h('p', { class: 'check check-ok' }, icon('shield-check', 16), 'Aucune modification de contenu en attente.')),
      h('section', { class: 'panel' }, h('h2', { text: 'Publier' }),
        h('p', { class: 'hint', text: 'Étapes : build de production, commit des seuls fichiers de contenu (articles, réglages, médias), puis envoi vers le dépôt distant. Le reste de votre copie de travail n\'est pas touché.' }),
        h('div', { class: 'fields' },
          h('label', {}, h('span', { text: 'Message de publication' }), message),
          h('label', { class: 'check-line' }, push, h('span', { text: 'Envoyer vers le dépôt distant (déclenche le déploiement)' }))),
        h('p', { class: 'row-actions' }, go, buildBtn)),
    ];
  }
  shell('#/publication', [pageHead('Publication', 'Mettre en ligne le contenu préparé dans le Studio.'), body, log]);
  if (Array.isArray(lastSteps)) drawSteps(lastSteps);
}

/* -------------------------------------------------------------------- routeur */
const ROUTES = [
  [/^\/?$/, viewDashboard], [/^\/articles$/, viewArticles], [/^\/articles\/([a-z0-9-]+)$/, viewEditor],
  [/^\/medias$/, viewMedia], [/^\/site(?:\/([a-z]+))?$/, viewSettings], [/^\/publication$/, viewPublish],
];
let currentHash = null;

async function route() {
  const hash = location.hash || '#/';
  if (hash === currentHash) return;
  const inSettings = (x) => (x || '').startsWith('#/site');
  const sameArea = inSettings(currentHash) && inSettings(hash);
  if (leaveGuard && leaveGuard() && !sameArea) {
    const target = hash;
    history.replaceState(null, '', currentHash);
    if (!await dialog({ title: 'Quitter sans enregistrer ?', body: 'Les modifications en cours seront perdues.', confirm: 'Quitter', danger: true, cancel: 'Rester' })) return;
    history.replaceState(null, '', target);
  }
  if (leaveGuard) { leaveGuard.dispose(); leaveGuard = null; }
  if (!sameArea) settingsDraft = null;
  currentHash = location.hash || '#/';
  const pathName = currentHash.slice(1);
  for (const [re, view] of ROUTES) {
    const m = pathName.match(re);
    if (m) { try { await view(...m.slice(1)); } catch (e) { fail(e); } window.scrollTo(0, 0); return; }
  }
  location.hash = '#/';
}

(async () => {
  try { store.meta = await api('GET', 'meta'); }
  catch (e) { app.replaceChildren(h('p', { class: 'boot', text: e.message })); return; }
  window.addEventListener('hashchange', route);
  route();
})();
