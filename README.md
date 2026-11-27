# Portfolio DevSecOps, blog et Studio

Site statique (portfolio + blog) et son outil de gestion local, le **Studio**.

- Le site en ligne ne contient que des fichiers statiques : pas de serveur applicatif, pas de base de données, pas de cookie, aucun appel à un service tiers.
- Le Studio tourne uniquement sur le poste de travail (`127.0.0.1`). Il n'est jamais déployé : il n'ajoute donc aucune surface d'attaque au site.
- Le contenu vit dans Git : `site.config.json` pour les textes du site, `content/articles/*.md` pour les articles, `static/assets/uploads/` pour les images.

## Démarrage

Prérequis : Node.js 20 ou plus récent, Git.

```bash
npm ci --ignore-scripts
npm run studio      # http://127.0.0.1:4000
```

| Commande | Rôle |
| --- | --- |
| `npm run studio` | Lance le Studio (édition, aperçu, publication) |
| `npm run dev` | Aperçu seul sur http://localhost:3000, brouillons inclus, reconstruit à chaque modification |
| `npm run build` | Génère le site de production dans `dist/` |
| `npm run new -- "Titre" "Catégorie"` | Crée un brouillon depuis le terminal |
| `npm test` | Tests des points sensibles (identifiants, rendu Markdown, chemins) |

## Le Studio

| Écran | Ce qu'il permet |
| --- | --- |
| Tableau de bord | Compteurs (publiés, planifiés, brouillons), contenu en attente de publication, points à corriger avant mise en ligne |
| Articles | Liste filtrable, création, duplication, suppression, aperçu |
| Éditeur | Markdown avec barre d'outils et raccourcis (Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+S), aperçu fidèle en direct, réglages (statut, date, catégorie, tags, résumé, adresse, couverture), contrôles de qualité, images par glisser-déposer ou copier-coller |
| Médias | Envoi, réutilisation et suppression des images, avec indication des articles qui les utilisent |
| Réglages du site | Formulaires pour tout `site.config.json` : identité, liens, accueil, chaîne de sécurité, expertise, outils, parcours, réalisations, recommandations, blog, contact |
| Publication | Build de production, commit des seuls fichiers de contenu, envoi vers le dépôt distant, avec le journal de chaque étape |

### Cycle de vie d'un article

1. **Brouillon** : visible uniquement dans le Studio et l'aperçu.
2. **Publié** : passer le statut à « Publié » dans l'onglet Réglages de l'éditeur. L'article sera en ligne à la prochaine publication.
3. **Planifié** : statut « Publié » avec une date future. L'article est exclu du build de production jusqu'à sa date ; le workflow de déploiement se relance chaque jour pour le mettre en ligne.
4. **Mise en ligne** : écran Publication, bouton « Publier ».

### Format d'un article

```yaml
---
title: "Mon titre"
date: 2026-11-14
category: "CI/CD"
tags: ["ci-cd", "github-actions"]
summary: "Résumé court, affiché sur les cartes et utilisé par les moteurs de recherche."
cover: "/assets/uploads/schema.png"   # facultatif, sinon une vignette est générée
draft: false
---

Contenu en Markdown : titres ##, listes, tableaux, blocs de code colorés (```yaml, ```bash, ```python...).
```

Le nom du fichier donne l'adresse de l'article : `content/articles/mon-article.md` devient `/blog/mon-article/`.
Les fichiers restent modifiables à la main ; le Studio détecte une modification faite en dehors de lui avant d'écraser quoi que ce soit.

## Mise en ligne

1. Créer le dépôt et le pousser une première fois :
   ```bash
   git init -b main
   git add .
   git commit -m "Portfolio : version initiale"
   git remote add origin <adresse-du-dépôt>
   git push -u origin main
   ```
2. Cloudflare Pages : relier le dépôt (Workers & Pages > Pages > Import an existing Git repository), Framework preset `None`, Build command `npm run build`, Build output directory `dist`, variable `NODE_VERSION` = `22`. Chaque push sur `main` est déployé par Cloudflare, qui applique le fichier `_headers` (en-têtes de sécurité).
   Pour les articles planifiés : créer un deploy hook (projet Pages > Settings > Builds > Deploy hooks) et ranger son URL dans le secret GitHub `CLOUDFLARE_DEPLOY_HOOK`. Le workflow `.github/workflows/deploy.yml` l'appelle chaque matin, et lance les tests à chaque push.
3. Renseigner l'adresse réelle du site dans le Studio (Réglages du site > Identité). Elle sert aux liens canoniques, au flux RSS et au sitemap.

Le dossier `dist/` convient aussi à tout hébergement statique (Cloudflare Pages, Netlify, serveur web, stockage objet chez un hébergeur français) : commande de build `npm run build`, dossier publié `dist`.

À savoir : GitHub désactive les workflows planifiés d'un dépôt resté 60 jours sans activité. Un push suffit à les réactiver.

## Sécurité

### Site public

- Content-Security-Policy stricte, sans `unsafe-inline` : scripts, styles, images et polices viennent uniquement du site lui-même.
- Polices auto-hébergées, aucun traceur, aucune ressource tierce.
- Fichier `_headers` généré (HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`...) pour Netlify et Cloudflare Pages. GitHub Pages n'applique pas d'en-têtes personnalisés : seule la CSP en balise `<meta>` y est active.
- `/.well-known/security.txt` généré dès qu'une adresse e-mail est renseignée.
- Liens des articles et de la configuration filtrés : seuls `http(s)`, `mailto` et les chemins relatifs sont rendus.

### Studio

- Écoute sur `127.0.0.1` uniquement, en-tête `Host` vérifié (protection contre le DNS rebinding).
- Jeton aléatoire par session exigé sur toute l'API, origine vérifiée sur les écritures (anti-CSRF).
- Aucun chemin de fichier accepté tel quel : les articles et images sont désignés par des identifiants validés.
- Images contrôlées par leur signature binaire (PNG, JPEG, WebP, AVIF, GIF), 5 Mo maximum. Le SVG est refusé car il peut contenir du script.
- Git appelé sans shell, avec des arguments fixes. Les identifiants éventuellement présents dans l'adresse du dépôt ne sont pas affichés.
- L'aperçu de l'éditeur s'affiche dans un cadre isolé où aucun script ne s'exécute.

### Chaîne de build

- Quatre dépendances directes, toutes utilisées au build uniquement. Le moteur d'en-tête exécutable de `gray-matter` (`---js`) est désactivé : un fichier Markdown ne peut pas exécuter de code.
- Actions GitHub épinglées par SHA de commit, `npm ci --ignore-scripts`, `npm audit` et tests avant chaque déploiement, permissions du jeton réduites au minimum.
- Dependabot configuré pour les actions et les paquets npm.

## Structure

```
build.mjs               Génération du site (production ou aperçu)
lib/core.mjs            Configuration, Markdown, lecture et écriture des articles
lib/theme.mjs           Gabarits HTML du thème « Pipeline »
lib/site.mjs            Assemblage : pages, tags, RSS, sitemap, en-têtes
lib/icons.mjs           Icônes intégrées (Lucide, licence ISC)
studio/server.mjs       Serveur local du Studio (API, médias, Git)
studio/ui/              Interface du Studio
static/assets/          CSS, JS, polices et images du site
content/articles/       Articles en Markdown
site.config.json        Textes et rubriques du site
test/                   Tests automatisés
```

Pour faire évoluer l'apparence : les couleurs et polices sont des variables en tête de `static/assets/css/site.css`, la structure des pages est dans `lib/theme.mjs`.

## Licences

- Polices : Bricolage Grotesque, IBM Plex Sans et IBM Plex Mono, licence SIL OFL 1.1 (voir `static/assets/fonts/LICENCES.md`).
- Icônes : Lucide, licence ISC.
- Le thème est écrit pour ce projet : il ne dépend plus d'aucun thème commercial.
