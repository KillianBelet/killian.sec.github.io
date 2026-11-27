---
title: "Géoblocage, listes d'IP et limitation de débit dans Traefik : l'ordre des middlewares compte"
date: 2026-12-21
category: Réseau
tags: [traefik, geoblocage, rate-limit, crowdsec]
summary: "Bloquer par pays, réserver l'administration à un VPN, limiter le débit : trois protections simples dans Traefik, à condition de les chaîner dans le bon ordre."
draft: true
---

Un WAF analyse le contenu des requêtes. Une partie du travail peut être faite bien avant, et pour bien moins cher : refuser un pays entier, réserver une console d'administration au VPN de l'équipe, couper une rafale de requêtes. Dans Traefik, chacune de ces mesures est un middleware. Le plus important n'est pas leur configuration, c'est l'ordre dans lequel on les enchaîne.

## Bloquer par pays

J'utilise le plugin [traefik-plugin-geoblock](https://github.com/nscuro/traefik-plugin-geoblock), sous licence Apache 2.0, avec la base IP2Location LITE fournie au même tag. Un conteneur d'initialisation télécharge la base au démarrage de Traefik.

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: geoblock-cn-ru
  namespace: traefik
spec:
  plugin:
    geoblock:
      enabled: true
      databaseFilePath: /geoblock/IP2LOCATION-LITE-DB1.IPV6.BIN
      blockedCountries: [CN, RU]
      defaultAllow: true    # un pays non listé est autorisé
      allowPrivate: true    # pods, sondes, load balancer : jamais bloqués
      disallowedStatusCode: 403
```

La base est sous licence CC BY-SA 4.0 : la mention d'attribution est obligatoire, je l'ai placée dans la documentation du dépôt.

**Comment tester sans VPN chinois ?** En bloquant temporairement son propre pays sur l'hôte de test. Un second middleware identique avec `blockedCountries: [FR]` le temps du test : 200 avant, 403 pendant (log `blocked request from FR`), 200 après le retour à la normale.

**Ce qu'il faut savoir** : si la base ne se télécharge pas, seules les routes qui utilisent le géoblocage sont en erreur, pas tout Traefik. En revanche, un plugin introuvable au démarrage désactive **tous** les plugins, WAF compris. D'où la vérification du tag dans le catalogue avant chaque montée de version.

## Réserver l'administration à une liste d'IP

ArgoCD, Prometheus ou la console d'un fournisseur d'identité n'ont pas à être joignables depuis Internet. Le middleware natif `ipAllowList` de Traefik les réserve aux passerelles VPN de l'équipe. Tout autre client reçoit un 403.

Test de validation : 200 depuis le VPN, 403 depuis une connexion mobile 4G.

**Piège : Traefik ne sait pas faire de OU entre deux listes.** Deux middlewares `ipAllowList` chaînés s'appliquent l'un après l'autre : une requête doit passer les deux. C'est une intersection. Un hôte qui doit accepter plusieurs groupes d'adresses demande donc un middleware unique contenant l'union des adresses.

## Limiter le débit

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: ratelimit-auth
  namespace: traefik
spec:
  rateLimit:
    average: 60     # 60 requêtes par minute et par IP en moyenne
    period: 1m
    burst: 30
```

Test : 200 requêtes en parallèle avec `curl --parallel`, 33 acceptées et 167 refusées en 429.

Deux nuances à connaître. Les compteurs sont propres à chaque pod Traefik : avec deux réplicas, une IP peut atteindre jusqu'à deux fois le seuil. Et un client derrière un NAT d'entreprise partage une seule IP pour tous ses utilisateurs : les seuils de départ sont à ajuster d'après les access logs.

## L'ordre : géoblocage, débit, puis WAF

Mon premier essai plaçait la limitation de débit après le WAF. Résultat : **aucun 429**, quelle que soit la rafale. Le bouncer CrowdSec répondait lui-même (page de challenge anti-bot) sans jamais passer la main au middleware suivant. La limitation n'était jamais atteinte.

L'ordre correct va du test le moins coûteux au plus coûteux :

1. **Géoblocage** : une simple recherche dans une base locale.
2. **Liste d'IP ou limitation de débit** : un compteur en mémoire.
3. **WAF** : une analyse complète de la requête.

Une rafale ou une IP refusée ne coûte ainsi aucune analyse AppSec. Pour les flux sensibles, j'ai regroupé tout ça dans des chaînes prêtes à l'emploi, pour qu'une route n'ait qu'un middleware à référencer :

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: flux-sensible-auth
  namespace: traefik
spec:
  chain:
    middlewares:
      - name: geoblock-cn-ru
      - name: ratelimit-auth
      - name: crowdsec-bouncer-strict   # WAF fail-closed
```

## Le prérequis de tout ça : voir la vraie IP

Ces trois mesures reposent sur l'adresse du client. Le load balancer la transmet par le proxy protocol, et Traefik ne fait confiance à aucun en-tête envoyé par le client.

**Derrière un CDN, tout s'écroule.** Traefik voit l'IP du CDN, pas celle du visiteur. Je l'ai constaté en appliquant une liste d'IP sur un hôte encore proxifié : 403 pour tout le monde, VPN compris. Retour arrière Helm sans redémarrage, désactivation du proxy CDN pour cet hôte, puis réapplication réussie. Sur un hôte derrière un CDN, le géoblocage, la limitation de débit et les bans viseraient des IP partagées par des milliers d'utilisateurs.

On pourrait être tenté de lire l'en-tête du CDN (`CF-Connecting-IP` par exemple). C'est dangereux si l'origine reste joignable en direct : n'importe qui peut forger cet en-tête et usurper une autre IP. Ce n'est envisageable qu'avec, en amont, un middleware qui n'accepte que les plages d'adresses du CDN.

Avant de sortir un hôte d'un CDN, je vérifie aussi que le certificat de Traefik le couvre, avec `curl --resolve` vers l'IP directe et sans `-k`.

## À retenir

- Les protections les plus rentables sont souvent les plus simples, à condition de les placer avant le WAF.
- Deux listes d'IP chaînées font une intersection, pas une union.
- Toute protection fondée sur l'IP suppose que Traefik voie l'IP réelle : à vérifier hôte par hôte.
