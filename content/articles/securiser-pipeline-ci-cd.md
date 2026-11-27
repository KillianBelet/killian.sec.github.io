---
title: "Sécuriser sa pipeline CI/CD : 6 contrôles à mettre en place dès le départ"
date: 2026-11-09
category: CI/CD
tags: [ci-cd, github-actions, supply-chain]
summary: "Une pipeline est une cible de choix : elle a accès au code, aux secrets et à la production. Voici six contrôles concrets pour la durcir sans ralentir les équipes."
draft: false
---

Une pipeline CI/CD concentre ce qu'un attaquant recherche : l'accès au code source, des secrets de déploiement et un chemin direct vers la production. La traiter comme un simple outil d'automatisation, c'est lui laisser la porte ouverte.

Voici six contrôles que je mets en place dès le début d'un projet. Aucun ne demande une refonte : ils s'ajoutent progressivement.

## 1. Donner le minimum de droits au jeton de la pipeline

Par défaut, le jeton fourni à un job peut avoir des droits d'écriture très larges selon la configuration du dépôt. On le restreint explicitement, puis on n'élargit que là où c'est nécessaire.

```yaml
# .github/workflows/ci.yml
permissions:
  contents: read        # lecture seule par défaut

jobs:
  deploy:
    permissions:
      contents: read
      id-token: write   # uniquement pour ce job (voir point 3)
```

## 2. Épingler les actions et dépendances de la CI

Une action référencée par un tag (`@v4`) est mutable : son auteur, ou quelqu'un qui compromet son compte, peut déplacer le tag vers un autre code. C'est ce qui s'est passé en mars 2025 avec `tj-actions/changed-files` : des tags ont été redirigés vers une version malveillante qui exposait des secrets dans les journaux de milliers de dépôts.

La parade : référencer l'action par le SHA complet du commit, avec le tag en commentaire.

```yaml
- uses: actions/checkout@<SHA-COMPLET-DU-COMMIT> # v4.x.x
```

Ne le faites pas à la main : un outil comme Dependabot ou Renovate propose les mises à jour de ces SHA, et des utilitaires dédiés savent convertir un workflow existant.

## 3. Supprimer les secrets longue durée avec OIDC

Une clé d'accès cloud stockée dans les secrets du dépôt est valable des mois et fuit tôt ou tard. Avec OIDC, la pipeline échange un jeton signé, propre à l'exécution, contre des identifiants temporaires.

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@<SHA-COMPLET> # v4.x.x
    with:
      role-to-assume: arn:aws:iam::123456789012:role/ci-deploy
      aws-region: eu-west-3
```

Côté cloud, la relation de confiance du rôle doit être limitée au dépôt et à la branche attendus. Un rôle qui accepte n'importe quel dépôt de l'organisation annule le bénéfice.

## 4. Détecter les secrets avant qu'ils ne soient poussés

Deux filets valent mieux qu'un : un hook `pre-commit` en local pour intercepter l'erreur au plus tôt, et un scan en CI pour rattraper ce qui est passé. Des outils comme Gitleaks ou TruffleHog font ce travail.

Si un secret a fuité, le supprimer du dépôt ne suffit pas : il reste dans l'historique et dans les clones. **Il faut le révoquer et le régénérer.**

## 5. Scanner le code, les dépendances et l'infrastructure

Trois familles d'analyses couvrent l'essentiel, chacune pour un type de risque différent :

| Analyse | Cherche | Exemples d'outils |
|---|---|---|
| SAST | Failles dans votre propre code | Semgrep, CodeQL, SonarQube |
| SCA | Vulnérabilités dans les dépendances | Trivy, Grype, Dependabot |
| IaC / images | Mauvaises configurations Terraform, Kubernetes, Dockerfile | Trivy, Checkov |

Un conseil pratique : commencez en mode **non bloquant** pour mesurer le bruit, corrigez les faux positifs, puis ne bloquez la merge request que sur les sévérités critiques et élevées. Une pipeline qui bloque tout le temps finit contournée.

## 6. Produire un SBOM et signer les artefacts

Un SBOM (inventaire des composants d'une image ou d'une application) permet de répondre vite à la question « sommes-nous touchés par cette faille ? ». La signature des images, par exemple avec Cosign, permet à l'environnement de production de refuser tout ce qui ne vient pas de votre pipeline.

## Par où commencer ?

Si vous n'avez qu'une heure : restreignez les permissions (1), puis épinglez vos actions (2). Ce sont les deux changements les plus rentables, et ils ne coûtent presque rien en confort pour les développeurs.

La sécurité d'une pipeline n'est pas un état final mais une hygiène : on la mesure, on la relit, et on la fait évoluer avec les équipes.
