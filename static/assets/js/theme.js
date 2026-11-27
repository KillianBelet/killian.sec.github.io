// Applique le thème choisi avant le premier affichage, pour éviter tout clignotement.
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* stockage indisponible : le thème suit le réglage du système */ }
})();
