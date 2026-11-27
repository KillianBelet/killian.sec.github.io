---
title: "Mesurer un WAF avec GoTestWAF : de 0,44 % à 48 % d'attaques bloquées"
date: 2026-11-30
category: WAF
tags: [crowdsec, waf, gotestwaf, owasp]
summary: "Un WAF qu'on ne mesure pas est un WAF qu'on espère efficace. Voici comment j'ai comparé quatre profils CrowdSec avec GoTestWAF, et ce que les chiffres m'ont appris."
draft: true
---

Installer un WAF donne une impression de sécurité. Le mesurer donne une réponse. Avant d'activer CrowdSec AppSec sur des environnements utilisés, j'ai rejoué le corpus de [GoTestWAF](https://github.com/wallarm/gotestwaf) contre plusieurs profils de règles, avec la même commande et le même chemin réseau à chaque fois.

## Le banc de test

- **Cible** : une application `whoami` qui répond 200 à n'importe quel chemin. Un 403 ne peut donc venir que du WAF.
- **Corpus** : 675 requêtes malveillantes et 141 textes légitimes volontairement piégeux.
- **Deux indicateurs** : la part d'attaques bloquées (vrais positifs) et la part de requêtes légitimes acceptées (vrais négatifs).
- **Exécution depuis un pod du cluster**, à travers le Service Traefik : c'est le même chemin que le trafic réel, sans dépendre d'un poste.

## Les résultats

| Profil | Attaques bloquées | Légitimes acceptées | Faux positifs |
|--------|-------------------|---------------------|---------------|
| A : virtual patching + règles génériques | 0,44 % (3/675) | 100 % | 0 |
| B : A + OWASP CRS en blocage | 47,11 % (318/675) | 79,43 % | 20,6 % |
| B ajusté : B moins 3 règles bruyantes | 46,52 % (314/675) | 93,62 % | 6,4 % |
| C : B ajusté + 3 règles adaptées à la stack | 48,44 % (327/675) | 93,62 % | 6,4 % |

## Ce que ces chiffres disent vraiment

**Le profil A n'est pas inutile, il est hors sujet pour ce corpus.** Le virtual patching bloque l'exploitation de CVE connues (accès à `/.env`, chemins d'exploits publiés). GoTestWAF teste la détection générique d'injections, pas les CVE. D'où un score proche de zéro. Mon script de test vérifie donc le blocage de `/.env` séparément : un profil peut avoir un bon score GoTestWAF et laisser passer une CVE triviale, et inversement.

**Le CRS complet est inutilisable tel quel sur une vraie application.** Un faux positif sur cinq, c'est bloquer un utilisateur sur cinq qui écrit du texte libre. Trois règles (détection de commandes Unix comme `time`, `date` ou `find`) expliquaient l'essentiel du bruit. Les retirer a fait passer les faux positifs de 20,6 % à 6,4 % pour seulement 4 attaques bloquées en moins. Ce compromis est tracé dans un registre d'exceptions, sujet du prochain article.

**Le détail par catégorie montre les vrais angles morts.** Avec le CRS, les injections SQL et les inclusions de fichiers du corpus communautaire sont toutes bloquées, mais :

- injections NoSQL : 24 % seulement, alors que le backend repose sur MongoDB ;
- XML et XXE : 0 % ;
- variantes encodées du jeu OWASP : XSS à 42 %, SQLi à 29 %.

## Écrire des règles pour sa propre stack

Le CRS est générique. Une règle qui connaît l'application peut être bien plus stricte sans faux positif. J'en ai écrit trois :

| Règle | Ce qu'elle bloque | Pourquoi c'est sans risque ici |
|-------|-------------------|-------------------------------|
| APP-001 | Opérateurs MongoDB (`$ne`, `$gt`, `$where`, `$regex`...) dans les noms et valeurs de paramètres et les corps JSON | Le frontend n'envoie jamais de clé commençant par `$` (vérifié dans le code) |
| APP-002 | Corps `application/xml`, `text/xml`, `*+xml` | L'application n'a aucun point d'entrée XML |
| APP-003 | Encodage UTF-7 déclaré | Un corps en UTF-7 n'est pas décodé par l'AppSec et échappe à l'inspection |

La troisième vient directement d'une observation pendant les tests : une charge multipart déclarée en UTF-7 passait le WAF sans être analysée. Plutôt que d'espérer la décoder, on la refuse.

Extrait de la règle NoSQL, côté noms de paramètres (`user[$ne]=...`, `json.user.$ne`) :

```yaml
name: custom/app-nosql-operator
rules:
  - zones: [ARGS_NAMES, BODY_ARGS_NAMES]
    transform: [lowercase, urldecode]
    match:
      type: regex
      value: '(^|[.\[])\$(where|ne|eq|gt|gte|lt|lte|in|nin|regex|exists|expr|or|and|not)(\]|\.|$)'
```

Résultat : +1,92 point d'attaques bloquées, sans un seul faux positif supplémentaire. C'est le genre d'ajustement qu'une solution fermée permet rarement.

**Un piège de syntaxe qui coûte cher** : CrowdSec convertit ces règles en directives SecLang compilées par Coraza. Une apostrophe dans une description ou un guillemet dans une regex suffit à faire échouer la compilation, et le pod AppSec ne démarre plus. J'écris donc `\x22` et `\x27` dans les expressions, et aucune apostrophe dans les libellés.

## Des seuils, pas des impressions

Le script de non-régression rejoue le corpus, vérifie `/.env`, et **échoue** si les scores passent sous des seuils (45 % d'attaques bloquées, 90 % de requêtes légitimes acceptées par défaut). Il tourne avant chaque modification des règles, et chaque mesure est reportée avec sa date dans un fichier de résultats versionné. Un second script vérifie les règles maison sur des cas précis : 6 attaques qui doivent recevoir un 403, 4 requêtes légitimes qui doivent passer.

## Les limites à garder en tête

- **Le corpus de faux positifs est petit** et volontairement retors : le taux sur trafic réel est plus faible, mais il faut le suivre dans les access logs.
- **Un WAF n'inspecte que HTTP.** Sur une connexion WebSocket, seule la requête d'ouverture passe par l'AppSec. Si l'application envoie ses appels d'API sur WebSocket, ils échappent au WAF : la validation côté backend reste indispensable.
- **Les collections du Hub évoluent** sans changement dans Git (c'est voulu pour suivre les nouvelles CVE). Les tests de non-régression sont ce qui détecte une dégradation.

48 % d'attaques bloquées peut sembler modeste. C'est surtout un chiffre **connu**, avec ses angles morts identifiés et compensés ailleurs. C'est ce qui permet de défendre un choix de WAF devant une équipe ou un auditeur.
