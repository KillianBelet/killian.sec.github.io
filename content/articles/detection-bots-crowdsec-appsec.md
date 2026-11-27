---
title: "Détection de bots avec le challenge CrowdSec AppSec : essai encadré d'une fonction alpha"
date: 2026-12-14
category: WAF
tags: [crowdsec, waf, bots, traefik]
summary: "Le challenge anti-bot de CrowdSec refuse Playwright et accepte Chrome et Firefox. Voici comment je l'ai testé sans risque, et les pannes silencieuses à connaître."
draft: true
---

CrowdSec propose depuis peu une détection de bots intégrée à son WAF AppSec. La fonction est marquée **Alpha** et, côté Traefik, n'est prise en charge que par une préversion du plugin bouncer. Ce n'est pas une raison pour l'ignorer, mais c'en est une pour l'essayer dans un périmètre très encadré. Voici comment je m'y suis pris.

## Comment fonctionne le challenge

Une requête sans cookie reçoit une page de challenge. Le navigateur y calcule une preuve de travail et transmet une empreinte : signes d'automatisation, résolution d'écran, langue, fuseau horaire... Chaque signal suspect ajoute des points. Au-delà d'un seuil (75 avec le profil « équilibré »), la soumission est rejetée. Sinon, un cookie laisse passer les requêtes suivantes.

## Pourquoi un périmètre minuscule

Le middleware Traefik et la configuration AppSec sont communs à tout le cluster. Sans restriction, le challenge s'appliquerait à toutes les routes protégées. Or beaucoup de clients légitimes **ne savent pas résoudre un challenge** :

- les appels XHR du frontend vers un hôte backend distinct (le cookie est propre à chaque hôte) ;
- une application mobile ;
- le fournisseur d'identité et ses redirections ;
- les services collaboratifs en WebSocket ;
- les sondes de supervision.

L'exclusion des API fournie par le Hub ne couvre que des préfixes génériques (`/api/`, `/v1/`), pas les routes propres à chaque framework. J'ai donc inversé la logique : **aucun hôte par défaut**, et seul l'hôte de test reçoit le challenge.

```yaml
name: custom/app-bot-scope
inband:
  pre_eval:
    # BOT-001 : seul l'hôte de test reçoit le challenge
    - filter: '!(req.Host == "waf-test.internal" || req.Host startsWith "waf-test.internal:")'
      apply:
        - ExemptFromChallenge("hors-perimetre")
```

Chaque élargissement futur suivra le même chemin que les exceptions du WAF : un identifiant `BOT-xxx` dans le registre, hôte par hôte, en commençant par un frontend de test, jamais par un backend ou le fournisseur d'identité.

## Un essai avec des critères de retour arrière écrits à l'avance

La préversion du plugin est sur le chemin de **toutes** les requêtes des routes protégées, même hors du périmètre du challenge. Avant de l'installer, j'ai écrit les critères qui déclenchent le retour à la version stable :

| Contrôle | Critère de retour arrière |
|----------|---------------------------|
| Chargement | Pas de ligne `Plugins loaded.` dans les logs du nouveau pod Traefik |
| Routes | Erreurs `middleware ... does not exist` qui persistent |
| WAF | `/.env` non bloqué, ou tests de non-régression sous les seuils |
| Trafic | Hausse des 500 ou de 403 inexpliqués |

Ordre important : non-régression complète du WAF **avant** d'activer le challenge. Une fois actif sur l'hôte de test, toute requête sans cookie reçoit la page de challenge, ce qui fausse les mesures GoTestWAF sur cet hôte.

## Résultats

| Client | Résultat |
|--------|----------|
| Chrome, Windows | Challenge résolu, cookie délivré |
| Firefox, Windows | Challenge résolu, cookie délivré |
| Playwright, Chromium sans interface | Refusé (« Verification rejected ») |
| Playwright, Chromium avec interface | Refusé |
| Fichier statique exempté | 200 sans challenge |
| Hôte hors périmètre | Aucun challenge |

Le test Playwright tient en quelques lignes et enregistre une capture de la page finale : un navigateur piloté par le protocole DevTools est détecté, même en mode fenêtré. Limite honnête : un automate qui masque soigneusement ses traces peut passer. La détection **augmente le coût** d'une attaque automatisée, elle ne la rend pas impossible.

## Ce que ça coûte

La mémoire de l'AppSec passe d'environ 100 Mi pour le WAF seul à 280 à 430 Mi au repos avec la détection de bots. Ma première limite à 250 Mi a provoqué des `OOMKilled` : le rollout s'est bloqué, mais les anciens pods ont continué à servir, donc aucun impact. Réglage retenu : 384 Mi demandés, 640 Mi de limite.

## Le secret maître partagé, obligatoire à partir de deux réplicas

Sans secret maître configuré, chaque pod AppSec génère le sien au démarrage. Un cookie émis par un pod est alors refusé par l'autre, et l'utilisateur repasse le challenge à chaque changement de pod. Le secret est généré aléatoirement, stocké dans Vault et monté dans les deux pods par le Vault Secrets Operator. Le changer invalide tous les cookies, ce qui peut servir de bouton d'urgence.

## Les pannes silencieuses

Ce sont les plus dangereuses, car l'utilisateur reste bloqué sans aucune erreur côté serveur :

- **Une route qui ne laisse pas passer `/crowdsec-internal/challenge/*`** bloque le client sur la page de challenge.
- **Une Content-Security-Policy** qui interdit les scripts inline ou les workers `blob:` rend le challenge insoluble (page blanche). Un middleware qui pose une CSP doit venir après le bouncer.
- **Une limite de corps à 0** empêche la réponse au challenge d'atteindre l'AppSec : le client boucle.
- **Certains postes durcis ou anciens** ne peuvent pas résoudre le challenge (il exige SSE4.1 et de la mémoire inscriptible et exécutable).

Et un piège de configuration : n'installer qu'une seule variante du seuil. Avec les variantes `-strict` et `-permissive` installées ensemble, les seuils se cumulent et le plus strict l'emporte.

## Bilan

La fonction est prometteuse et a fait ce qu'elle annonçait sur l'hôte de test. Elle restera sur ce périmètre tant que le plugin n'est pas en version stable, et les navigateurs mobiles restent à tester. Une fonction alpha peut tout à fait entrer dans une infrastructure sérieuse, à condition de savoir exactement comment la retirer.
