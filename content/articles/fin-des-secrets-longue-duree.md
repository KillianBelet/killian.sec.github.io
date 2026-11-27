---
title: "La fin des secrets longue durée : identifiants éphémères et rotation"
date: 2026-11-02
category: Secrets
tags: [secrets, oidc, vault, iam]
summary: "Un mot de passe ou une clé d'API qui ne change jamais est une dette de sécurité. Voici comment passer à des identifiants courts, ciblés et révocables."
draft: false
---

Un secret qui vit des années a une propriété désagréable : plus il dure, plus il y a de copies, de fichiers `.env`, de captures d'écran et d'anciens collègues qui le connaissent. Quand il fuite, on ne sait ni quand ni par où.

L'idée directrice est simple : **réduire la durée de vie et la portée de chaque secret**, jusqu'à ce que sa fuite devienne peu intéressante.

## Les trois niveaux de maturité

**Niveau 0, le secret statique partagé.** Une clé dans un fichier de configuration ou une variable de CI, utilisée par plusieurs services. La rotation est manuelle, donc rare.

**Niveau 1, le secret centralisé et tourné.** Les secrets vivent dans un coffre (Vault, AWS Secrets Manager, Azure Key Vault...), l'application les lit à l'exécution, et une rotation planifiée les renouvelle. C'est déjà un grand progrès : un seul endroit à protéger, des accès journalisés.

**Niveau 2, l'identifiant éphémère.** L'application ne détient aucun secret durable. Elle prouve son identité (jeton OIDC de la pipeline, compte de service Kubernetes, rôle IAM de l'instance) et reçoit en échange des identifiants valables quelques minutes.

## Ce qui change en pratique

- **Pipelines** : échanger le jeton OIDC contre des identifiants cloud temporaires, au lieu de stocker une clé d'accès dans les variables du dépôt.
- **Bases de données** : utiliser des identifiants dynamiques, générés à la demande avec une durée de vie courte, plutôt qu'un compte applicatif unique.
- **Kubernetes** : associer un compte de service à un rôle cloud (par exemple IRSA sur AWS ou Workload Identity sur GKE et AKS) plutôt que de monter une clé dans un `Secret`.

## Le piège classique : la confiance trop large

Passer à OIDC n'apporte rien si la relation de confiance est trop permissive. Une condition du type « n'importe quel dépôt de mon organisation » donne à un projet peu surveillé un accès à la production. Limitez toujours la confiance au dépôt, à la branche et, si possible, à l'environnement de déploiement précis.

## Et quand ça fuite quand même ?

Il faut s'y préparer, car cela arrivera :

1. **Révoquer** le secret immédiatement, avant toute enquête.
2. **Régénérer** et redéployer le nouveau.
3. **Auditer** les journaux d'accès pour la période d'exposition.
4. **Corriger la cause** : pourquoi était-il là où il ne devait pas être ?

Supprimer le commit fautif ne suffit pas : l'historique Git et les clones conservent la valeur.

## Pour démarrer

Faites l'inventaire de vos secrets : où sont-ils, qui les utilise, quand ont-ils été changés pour la dernière fois ? Cette liste suffit en général à désigner les trois ou quatre candidats prioritaires pour passer à des identifiants éphémères. Commencez par celui qui donne le plus de pouvoir, généralement l'accès de déploiement en production.
