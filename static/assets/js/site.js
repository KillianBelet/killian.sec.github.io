// Interactions du site public. Sans dépendance ; tout le contenu reste lisible si ce script ne se charge pas.
(function () {
  'use strict';
  var doc = document.documentElement;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* Thème clair / sombre */
  var toggle = $('.theme-toggle');
  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', function () {
      var current = doc.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = current === 'dark' ? 'light' : 'dark';
      doc.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* non bloquant */ }
    });
  }

  /* Rubrique active dans le menu (page d'accueil) */
  var spies = $$('.top-nav a[data-spy]');
  if (document.body.classList.contains('is-home') && spies.length && 'IntersectionObserver' in window) {
    var byId = {};
    spies.forEach(function (a) { byId[a.getAttribute('data-spy')] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        spies.forEach(function (a) { a.classList.remove('is-active'); });
        byId[e.target.id].classList.add('is-active');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) { var el = document.getElementById(id); if (el) spy.observe(el); });
  }

  /* Bouton « Copier » sur les blocs de code */
  $$('.code').forEach(function (fig) {
    var bar = $('figcaption', fig), code = $('pre code', fig);
    if (!bar || !code || !navigator.clipboard) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = 'Copier';
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(code.textContent.replace(/\n$/, '')).then(function () {
        btn.textContent = 'Copié';
        btn.classList.add('is-done');
        setTimeout(function () { btn.textContent = 'Copier'; btn.classList.remove('is-done'); }, 1800);
      });
    });
    bar.appendChild(btn);
  });

  /* Progression de lecture et titre actif du sommaire */
  var bar = $('.progress span'), prose = $('.prose');
  if (bar && prose) {
    var ticking = false;
    var update = function () {
      ticking = false;
      var r = prose.getBoundingClientRect();
      var total = r.height - window.innerHeight * 0.6;
      var done = Math.min(1, Math.max(0, -r.top / (total > 0 ? total : 1)));
      bar.style.transform = 'scaleX(' + done + ')';
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
  var tocLinks = $$('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[decodeURIComponent(a.hash.slice(1))] = a; });
    var tocSpy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || !map[e.target.id]) return;
        tocLinks.forEach(function (a) { a.classList.remove('is-active'); });
        map[e.target.id].classList.add('is-active');
      });
    }, { rootMargin: '-90px 0px -70% 0px' });
    Object.keys(map).forEach(function (id) { var h = document.getElementById(id); if (h) tocSpy.observe(h); });
  }

  /* Recherche et filtre par catégorie sur la page du blog */
  var filters = $('.filters');
  if (filters) {
    var posts = $$('.posts-list .post'), input = $('#post-search'), chips = $$('.chip[data-cat]', filters);
    var count = $('.filter-count'), none = $('#no-result'), cat = '';
    var norm = function (s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
    var apply = function () {
      var words = norm(input.value).split(/\s+/).filter(Boolean), shown = 0;
      posts.forEach(function (p) {
        var hay = norm(p.getAttribute('data-search') || '');
        var ok = (!cat || p.getAttribute('data-category') === cat) && words.every(function (w) { return hay.indexOf(w) !== -1; });
        p.hidden = !ok;
        if (ok) shown++;
      });
      var filtered = cat || words.length;
      count.hidden = !filtered;
      count.textContent = shown + (shown > 1 ? ' articles affichés' : ' article affiché') + ' sur ' + posts.length;
      none.hidden = shown > 0;
    };
    filters.hidden = false;
    input.addEventListener('input', apply);
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        cat = c.getAttribute('data-cat');
        chips.forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); });
        apply();
      });
    });
  }
})();
