---
title: "Un WAF CrowdSec devant Traefik sur Kubernetes : déployer par phases sans casser la prod"
date: 2026-11-23
category: WAF
tags: [crowdsec, waf, traefik, kubernetes]
summary: "Plugin bouncer, AppSec, réputation IP, agent comportemental : comment j'ai mis CrowdSec devant Traefik en quatre phases, et les pièges rencontrés en route."
draft: true
---

Mettre un WAF devant une application en service fait peur, et c'est sain : un mauvais réglage bloque des utilisateurs légitimes, une panne du WAF peut couper tout le trafic. Sur un cluster Kubernetes avec Traefik en entrée, j'ai déployé CrowdSec en plusieurs phases, chacune réversible. Voici l'architecture retenue et ce que j'en ai appris.

## Le bon composant de remédiation

Il existe deux façons de brancher CrowdSec sur Traefik. L'ancienne passe par un service `forwardAuth` séparé : elle est obsolète et ne sait pas faire d'analyse applicative. La recommandée est le plugin Traefik `crowdsec-bouncer-traefik-plugin`, qui interroge directement deux composants :

- la **LAPI**, qui détient les décisions (IP bannies, blocklist communautaire) ;
- l'**AppSec**, le moteur WAF qui analyse chaque requête et rend un verdict 200 ou 403.

Le flux devient : client, load balancer, Traefik (middleware `crowdsec-bouncer`), AppSec, puis application.

## Quatre phases, une seule variable à la fois

| Phase | Ce qui est activé | Bans automatiques |
|-------|-------------------|-------------------|
| 1 | WAF AppSec seul : virtual patching et OWASP CRS ajusté | Non |
| 2 | Réputation IP : blocklist communautaire et décisions manuelles (mode `stream`) | Non |
| 3a | Agent comportemental : analyse des access logs de Traefik | Non, alertes seulement |
| 3b | Bans issus des scénarios comportementaux | Oui |

Jusqu'à la phase 3b, le profil de la LAPI reste en `alerts_only` : un comportement suspect produit une alerte, jamais un ban. On observe d'abord ce que les scénarios auraient bloqué, on construit la liste blanche (passerelle VPN de l'équipe, nœuds du cluster), et seulement ensuite on laisse CrowdSec bannir.

## Fail-open par défaut, fail-closed là où ça compte

Que faire quand l'AppSec ne répond pas ? J'ai créé deux middlewares identiques, à une différence près :

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: crowdsec-bouncer
  namespace: traefik
spec:
  plugin:
    bouncer:
      enabled: true
      crowdsecMode: stream
      updateIntervalSeconds: 60
      updateMaxFailure: -1        # jamais de blocage massif si la LAPI tombe
      streamStartupBlock: false   # Traefik démarre sans attendre la LAPI
      crowdsecLapiKeyFile: /etc/traefik/crowdsec/BOUNCER_KEY_traefik
      crowdsecAppsecEnabled: true
      crowdsecAppsecFailureBlock: false      # fail-open
      crowdsecAppsecUnreachableBlock: false
```

La variante `crowdsec-bouncer-strict` passe les deux dernières options à `true` : si le WAF ne peut pas analyser la requête, elle est refusée. Elle est réservée aux flux sensibles (connexion, administration, envoi de fichiers). La contrepartie est assumée : si l'AppSec tombe, ces flux sont coupés. D'où deux réplicas AppSec, un PodDisruptionBudget et une mise à jour progressive.

## Une clé, deux namespaces, zéro copie

Le plugin s'authentifie auprès de la LAPI avec une clé. Elle vit dans Vault et le Vault Secrets Operator la matérialise dans les namespaces `crowdsec` et `traefik`. Traefik la lit depuis un fichier monté, jamais en clair dans un manifeste.

Un détail Vault m'a fait choisir une **policy dédiée** plutôt que d'ajouter le chemin à une policy existante : les policies Vault sont globales. La policy TLS de Traefik était aussi attachée au rôle d'un autre cluster ; y ajouter le chemin aurait donné à cet autre Traefik l'accès à la clé.

## Les pièges rencontrés

**Une version de plugin introuvable désactive tous les plugins.** Lors d'une montée de version, j'ai référencé un tag qui n'existait pas encore. Traefik a démarré quand même, mais sans aucun plugin, et toutes les routes qui référençaient le middleware ont cessé d'être servies. Retour arrière Helm en deux minutes. Depuis, la procédure vérifie le tag avant tout changement :

```bash
git ls-remote --tags https://github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin
```

**Comparer le rendu avant chaque `helm upgrade`.** Le fichier de values d'une branche peut être en retard sur celui déployé. Je compare systématiquement :

```bash
helm get manifest traefik -n traefik > avant.yaml
helm template traefik traefik/traefik -n traefik --version <version> \
  --api-versions monitoring.coreos.com/v1 -f values.yaml > apres.yaml
diff avant.yaml apres.yaml
```

Sans `--api-versions`, le rendu échoue sur le ServiceMonitor et le diff fait croire que tout va être supprimé. Ce contrôle m'a évité de retirer le proxy protocol par accident.

**La réputation IP suppose de voir la vraie IP.** Le load balancer transmet l'IP du client par le proxy protocol. Si cette remontée régresse, un ban viserait une IP interne partagée et bloquerait tout le monde. Même problème derrière un CDN : Traefik voit l'IP du CDN. Lire l'en-tête du CDN (`CF-Connecting-IP`) n'est pas une solution si l'origine reste joignable en direct, car n'importe qui peut forger cet en-tête.

**La rotation de clé a un piège fail-open.** La LAPI n'enregistre le bouncer qu'au démarrage, et seulement s'il n'existe pas déjà. Changer la clé dans Vault ne suffit pas : le plugin présenterait une clé inconnue, l'AppSec répondrait 401 et, en fail-open, les requêtes passeraient **sans inspection**, sans erreur visible. La procédure supprime donc le bouncer, redémarre la LAPI puis Traefik, et se termine par un test simple :

```bash
curl -sk -o /dev/null -w "%{http_code}\n" -H "Host: waf-test.internal" https://traefik.traefik.svc/.env
# 403 attendu. Un 200 signifie que le WAF ne voit plus rien.
```

Ce test `/.env` sur une application `whoami` (qui répond 200 à tout) est devenu mon contrôle de base : un 403 ne peut venir que du WAF.

## À retenir

- Activer une seule brique à la fois, et rester en `alerts_only` tant que la liste blanche n'est pas prête.
- Choisir consciemment fail-open ou fail-closed, route par route.
- Vérifier le rendu Helm et la version des plugins avant chaque upgrade de Traefik.
- Tester le WAF après chaque changement avec une requête qui doit être bloquée, pas seulement une requête qui doit passer.

Dans les prochains articles : comment j'ai mesuré l'efficacité de ce WAF avec GoTestWAF, puis comment je gère ses faux positifs.
