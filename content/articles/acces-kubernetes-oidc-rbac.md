---
title: "Accès à Kubernetes sans cluster-admin partagé : OIDC Keycloak, kubelogin et RBAC par groupe"
date: 2027-01-25
category: Kubernetes
tags: [kubernetes, oidc, keycloak, rbac, iam]
summary: "Un kubeconfig cluster-admin sur une VM partagée, c'est un identifiant permanent, anonyme et irrévocable. Voici l'accès nominatif, court et limité que j'ai conçu pour le remplacer."
draft: true
---

Sur beaucoup de clusters, l'accès humain se résume à un fichier : un kubeconfig `cluster-admin` à certificat client, copié sur une VM d'administration partagée. Il donne tous les droits, n'est rattaché à personne et ne se révoque pas. J'ai préparé son remplacement par un accès nominatif via Keycloak, avec des droits limités par groupe.

## Le vrai problème n'était pas le fichier

L'état des lieux de la VM d'administration a révélé deux choses :

| Élément | Risque |
|---------|--------|
| Kubeconfig `cluster-admin` à certificat client | Droits complets, identifiant non nominatif, non révocable |
| Jetons de session de l'outil en ligne de commande du fournisseur | Permettent de **générer à volonté** de nouveaux kubeconfigs `cluster-admin` |

Le second point est le plus important : supprimer le kubeconfig sans fermer la session de l'outil ne change rien, puisqu'un nouveau kubeconfig s'obtient en une commande. Un audit qui s'arrête au fichier visible passe à côté.

## Le principe

```
kubectl ─ kubelogin ─ Keycloak (realm dédié à l'infra, MFA pour les admins)
   │                      └─ jeton OIDC de 15 minutes : e-mail + groupes
   └─ API server (OIDC) ─ RBAC : groupe oidc:<groupe> -> rôle limité
```

Chacun s'authentifie avec son identité et reçoit un jeton de 15 minutes, renouvelé tant que sa session Keycloak est ouverte (10 heures au plus). Le kubeconfig distribué ne contient **ni certificat ni jeton**.

Un realm dédié à l'infrastructure, distinct des realms de l'application, sépare les comptes, la politique de mot de passe et la MFA de l'applicatif.

## Côté API server

L'API server doit faire confiance à l'issuer Keycloak. Les options standard de `kube-apiserver` (sur un Kubernetes managé, elles se règlent par l'API du fournisseur) :

```
--oidc-issuer-url=https://<keycloak>/realms/<realm>
--oidc-client-id=kubernetes
--oidc-username-claim=email
--oidc-username-prefix=oidc:
--oidc-groups-claim=groups
--oidc-groups-prefix=oidc:
```

Le préfixe `oidc:` évite qu'un nom d'utilisateur ou de groupe venu de Keycloak entre en collision avec un groupe interne de Kubernetes, comme `system:masters`. L'issuer doit être en HTTPS et joignable depuis le plan de contrôle, qui y lit les clés de signature.

## Des droits par groupe

| Groupe Keycloak | Droits |
|-----------------|--------|
| `k8s-developpeurs` | Dans les namespaces applicatifs : lecture, logs, `exec`, `port-forward`, suppression de pod. Ni Secrets ni modification des Deployments |
| `k8s-lecture` | `view` sur tout le cluster (le rôle `view` n'inclut pas les Secrets) |
| `k8s-admins` | `cluster-admin`, groupe restreint, MFA obligatoire |

Pourquoi pas de modification des Deployments ? Ils sont déployés par Argo CD en synchronisation automatique : une modification manuelle serait écrasée. Pourquoi pas de Secrets ? Les secrets applicatifs viennent de Vault.

Le rôle développeur est un `ClusterRole` lié par des `RoleBinding`. Un ClusterRole lié par un RoleBinding ne vaut que dans le namespace du RoleBinding : c'est ce qui limite le développeur à ses namespaces, sans dupliquer un Role par namespace.

```yaml
kind: ClusterRole
metadata:
  name: app:developpeur
rules:
  - apiGroups: [""]
    resources: [pods, pods/log, services, configmaps, events]
    verbs: [get, list, watch]
  - apiGroups: [""]
    resources: [pods]
    verbs: [delete]            # redémarrer un pod
  - apiGroups: [""]
    resources: [pods/exec, pods/portforward]
    verbs: [create, get]       # chaque shell est tracé par Falco
```

Le droit `exec` est un compromis assumé pour le diagnostic en développement. Il est compensé par la détection : chaque shell interactif dans un conteneur applicatif déclenche une alerte Falco critique. En production, il disparaît du rôle.

## Vérifier les droits sans créer de compte de test

C'est la commande que je préfère dans tout ce chantier :

```bash
kubectl auth can-i --list -n dev --as=test --as-group=oidc:k8s-developpeurs
kubectl auth can-i get secrets -n dev --as=test --as-group=oidc:k8s-developpeurs        # no
kubectl auth can-i delete pods -n monitoring --as=test --as-group=oidc:k8s-developpeurs # no
```

L'impersonation permet de tester chaque rôle avant qu'un seul utilisateur ne soit migré.

## Un kubeconfig sans secret

Un script génère le kubeconfig à distribuer. Il ne contient que l'adresse de l'API server, son certificat d'autorité et l'appel à kubelogin :

```yaml
users:
  - name: oidc
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: kubectl
        args:
          - oidc-login
          - get-token
          - --oidc-issuer-url=https://<keycloak>/realms/<realm>
          - --oidc-client-id=kubernetes
          - --grant-type=device-code   # fonctionne en SSH, sans navigateur local
```

Le script se termine par un contrôle : s'il trouve `client-certificate-data`, `client-key-data` ou `token:` dans le fichier produit, il échoue. Le flux *device code* affiche une URL et un code à saisir dans un navigateur, ce qui fonctionne depuis une session SSH sur la VM d'administration.

## Retirer les identifiants statiques, et prévoir l'urgence

Une fois l'accès OIDC validé pour chaque utilisateur, on supprime le kubeconfig en cache **et** les jetons de session de l'outil du fournisseur.

Reste le cas où Keycloak est en panne. L'OIDC s'ajoute à l'authentification par certificat, il ne la remplace pas. L'accès d'urgence consiste à émettre un certificat **nominatif** et **court** (quelques heures), depuis un poste d'administration, jamais depuis la VM partagée. Le nom rend les actions traçables. La durée compense une limite à connaître : un certificat client Kubernetes émis ne se révoque pas, seule sa durée de vie le borne.

Complément utile : restreindre les adresses autorisées à joindre l'API server à celles de la VM d'administration et du VPN. Cela réduit l'exposition des certificats encore valides.

## La correspondance ISO 27001

| Mesure | Réponse |
|--------|---------|
| 5.15, 8.3 Contrôle d'accès | RBAC par groupe et par namespace, pas d'accès aux Secrets |
| 5.16 Gestion des identités | Comptes nominatifs, `oidc:<email>` dans les journaux d'audit de l'API |
| 5.17 Informations d'authentification | Plus d'identifiant statique, jetons de 15 minutes |
| 5.18 Droits d'accès | Révocation en retirant le compte du groupe |
| 8.2 Accès privilégiés | `cluster-admin` réservé, MFA, accès d'urgence nominatif et borné |
| 8.5 Authentification sécurisée | OIDC avec PKCE ou device code, MFA pour les privilèges |

Le bénéfice le plus visible est ailleurs : quand quelqu'un quitte l'équipe, on le retire d'un groupe Keycloak. Il n'y a plus de fichier à chercher sur des machines.
