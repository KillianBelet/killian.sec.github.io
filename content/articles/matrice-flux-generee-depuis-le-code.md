---
title: "Une matrice de flux réseau générée depuis le code, et vérifiée en CI"
date: 2027-02-01
category: Réseau
tags: [kubernetes, networkpolicy, automatisation, ci-cd]
summary: "Une matrice de flux tenue à la main est fausse dès le premier commit. J'ai écrit un script qui la déduit des fichiers de déploiement, la confronte aux NetworkPolicy et échoue en CI quand elle dérive."
draft: true
---

Toute démarche de sécurité réseau finit par demander une matrice de flux : qui parle à qui, sur quel port, pourquoi, et quelle règle l'autorise. Elle est presque toujours tenue dans un tableur, et presque toujours fausse quelques semaines plus tard. Pour le périmètre Traefik et CrowdSec, j'ai pris le problème à l'envers : **la matrice n'est pas saisie, elle est générée**.

## Le principe

Un script Python lit les fichiers qui servent déjà à déployer : values Helm de Traefik, CrowdSec et Alloy, middlewares, objets Vault, values des environnements applicatifs. Il en déduit chaque flux avec :

- sa source et sa destination (namespaces compris) ;
- son protocole et son port, **lus dans la configuration** et non recopiés ;
- son déclencheur et sa fréquence ;
- son authentification ;
- son comportement si la destination est injoignable (fail-open, blocage, service indisponible) ;
- la règle réseau qui le couvre, ou son absence ;
- les lignes de code d'où il est tiré.

Quand un port, un hôte ou une annotation change dans le code, la matrice change. Les flux ont des identifiants stables (`CS-xx` pour CrowdSec, `TR-xx` pour le socle Traefik) : on ajoute à la suite, on ne renumérote jamais. Certains flux sont générés en boucle (un par environnement applicatif, un par Secret Vault) : un nouvel environnement apparaît dans la matrice sans toucher au script.

## Dire ce que le code prouve, et ce qu'il ne prouve pas

C'est la colonne qui rend la matrice honnête. Chaque flux porte un niveau de confiance :

| Confiance | Signification |
|-----------|---------------|
| Explicite | Valeur lue dans la configuration |
| Déduit | Comportement par défaut du chart, non surchargé dans le dépôt |
| Documenté | Affirmé par un README du dépôt |
| À confirmer | Port ou nom de domaine absent du code, à relever par capture avant d'écrire une règle |

Un flux sortant vers le Hub CrowdSec ou le catalogue de plugins Traefik n'apparaît dans aucun fichier : il est « À confirmer ». Écrire une règle de sortie sur une supposition, c'est couper un flux légitime en production. On capture d'abord les connexions réelles du pod, on corrige le script, et le flux passe en « Explicite ».

## Confronter aux règles réseau existantes

Le script parcourt aussi toutes les NetworkPolicy du dépôt et attribue un statut à chaque flux :

| Statut | Signification |
|--------|---------------|
| Couvert | Une NetworkPolicy autorise ce flux |
| Présente, contenu à vérifier | Une NetworkPolicy existe pour la destination, son contenu n'est pas analysé |
| Aucune NetworkPolicy | Aucune règle d'entrée : tout est autorisé par défaut |
| Aucune règle de sortie | Le flux sort sans filtre |
| Hors cluster | Règle portée par le load balancer ou les groupes de sécurité du fournisseur |

## Ce que la première génération a montré

C'est là que l'exercice prouve son intérêt. Sans que personne ne cherche, la première génération a fait ressortir des constats qu'aucun tableur n'aurait listés :

- des namespaces d'infrastructure sans aucune NetworkPolicy, où tout flux entrant est donc autorisé, alors que les namespaces applicatifs étaient couverts ;
- des sorties vers Internet non filtrées ;
- une vérification TLS désactivée vers un service interne ;
- un Secret dont le changement redémarre le reverse proxy, donc une rotation qui coupe le trafic si un seul réplica tourne.

Chaque constat est devenu une action, avec le flux concerné en référence.

Le script produit aussi une **proposition** de NetworkPolicy d'entrée pour le namespace CrowdSec, déduite de la matrice. C'est bien une proposition : elle refuse tout ce qu'elle n'autorise pas, donc elle se valide d'abord en préproduction. Elle vise le namespace entier plutôt que des pods précis, pour ne pas dépendre de labels non vérifiés.

## Les sorties

- un **CSV** (séparateur point-virgule, UTF-8 avec BOM, ouvrable directement dans Excel), qui sert de référence ;
- un **JSON** pour d'autres outils ;
- un **XLSX** avec la matrice, la couverture des hôtes, les écarts et les empreintes des fichiers lus ;
- un **schéma HTML interactif**, où les numéros de flux figurent sur les traits.

## Le contrôle de dérive en CI

Le mode `--check` régénère la matrice et la compare aux fichiers committés. S'ils diffèrent, il échoue :

```yaml
matrice-flux:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@<SHA-COMPLET> # v4
    - run: pip install pyyaml
    - run: python3 flux/generate_flux.py --check
```

Le contrôle porte sur le CSV et la proposition de NetworkPolicy, pas sur l'XLSX ni le HTML, qui contiennent des horodatages. Résultat : impossible de modifier un port ou d'exposer un nouvel hôte sans que la pull request montre aussi le changement de la matrice. La revue de sécurité se fait au même endroit que la revue de code.

## Les limites, écrites dans le README

- Les groupes de sécurité, le load balancer et le CNI ne sont pas décrits dans le dépôt : leurs flux restent « Hors cluster ».
- Une NetworkPolicy porte sur les **ports du pod** (par exemple 8000 et 8443 pour Traefik), pas sur les ports 80 et 443 du Service. Il faut les relever avant d'écrire une règle.
- La matrice décrit l'**intention** versionnée. L'état réel en cours d'exécution (hôtes et middlewares effectivement actifs) se lit dans l'API de Traefik, une piste pour détecter la dérive entre le dépôt et le cluster.

Ce projet rejoint ce que je fais ailleurs sur le pentest automatisé : ce qui est généré à partir de la source de vérité, puis vérifié automatiquement, ne dérive pas sans qu'on le voie.
