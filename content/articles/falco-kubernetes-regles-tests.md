---
title: "Falco sur Kubernetes : règles maison, exceptions ciblées et tests de bout en bout"
date: 2026-12-28
category: Détection
tags: [falco, kubernetes, runtime, iso-27001]
summary: "Déployer Falco prend dix minutes. Le rendre utile demande des règles adaptées, des exceptions précises et un moyen de prouver que la chaîne fonctionne. Voici ma démarche."
draft: true
---

Falco observe les appels système des conteneurs et lève un événement quand une règle correspond : un shell ouvert dans un pod, une lecture de `/etc/shadow`, un outil réseau lancé. L'installation est rapide. Ce qui prend du temps, c'est d'en faire un dispositif dont on peut **prouver** qu'il détecte, sans noyer l'équipe sous le bruit.

## Architecture

```
Falco (DaemonSet, un pod par nœud, sonde modern_ebpf)
  └─ Falcosidekick
       ├─ Loki          >= notice    -> dashboards Grafana, rétention d'un an
       ├─ Alertmanager  >= critical  -> notification immédiate
       ├─ SIEM Wazuh    >= notice    -> trace de sécurité centralisée
       └─ /metrics -> Prometheus -> alertes de détection et de santé
```

Prérequis vérifié avant tout : des noyaux récents avec BTF sur tous les pools de nœuds, ce qui permet le driver `modern_ebpf` sans module noyau à compiler.

## Des règles reproductibles

Par défaut, `falcoctl` télécharge les règles depuis un registre au démarrage. Sur des nœuds à IP publique partagée, ce registre renvoyait des erreurs 429 et Falco ne démarrait pas. J'ai désactivé le téléchargement : les règles stables sont celles **embarquées dans l'image**, à version de chart figée. Effet secondaire bienvenu : les résultats sont reproductibles, les règles ne changent qu'avec une montée de version décidée.

## Cinq règles pour le périmètre applicatif

Les règles par défaut couvrent déjà beaucoup. J'en ai ajouté cinq, limitées aux namespaces applicatifs grâce à une liste et une macro :

```yaml
- list: app_namespaces
  items: [falco-test, dev, staging]

- macro: app_scope
  condition: (container and k8s.ns.name in (app_namespaces))

- rule: App - Shell interactif dans un conteneur applicatif
  condition: >
    spawned_process and app_scope
    and proc.name in (shell_binaries) and proc.tty != 0
  output: >
    Shell interactif (user=%user.name cmd=%proc.cmdline ns=%k8s.ns.name pod=%k8s.pod.name)
  priority: CRITICAL
  tags: [container, shell, mitre_execution, T1059]
```

| Règle | Priorité | Déclencheur |
|-------|----------|-------------|
| Shell interactif | Critical | shell avec terminal (`kubectl exec -it`) |
| Outil de reconnaissance réseau | Error | `nc`, `nmap`, `socat`, `tcpdump`... |
| Écriture dans un répertoire système | Error | écriture sous `/etc` ou dans un répertoire de binaires |
| Gestionnaire de paquets | Warning | `apt`, `apk`, `pip`, `npm`... |
| Lecture du jeton ServiceAccount | Warning | lecture du jeton monté dans le pod |

Ces règles sont fortes parce que les conteneurs applicatifs tournent en `readOnlyRootFilesystem` et `runAsNonRoot` : une écriture système ou un gestionnaire de paquets n'y a **aucune** raison d'être. Le namespace des bases de données est exclu, car l'opérateur PostgreSQL lit son jeton et lance des shells légitimement. Il reste couvert par les règles par défaut.

## Une exception doit être chirurgicale

Dès le premier jour, la règle « outil réseau » a produit 1 660 événements en 4 heures. La cause : les sondes de santé d'un conteneur ClamAV, qui exécutent `echo PING | nc 127.0.0.1 3310` toutes les quelques secondes.

Désactiver la règle aurait été la solution rapide. L'exception exige à la place le nom du conteneur, le processus parent **et** la commande exacte :

```yaml
exceptions:
  # FAL-001 : sondes de santé du conteneur clamav
  - name: sonde_clamd
    fields: [container.name, proc.pname, proc.cmdline]
    comps: ["=", "=", "="]
    values:
      - [clamav, sh, "nc 127.0.0.1 3310"]
```

Un `nc` vers une autre cible, ou lancé depuis un autre conteneur, reste détecté. Chaque exception reçoit un identifiant `FAL-xxx` consigné avec sa justification. Un faux positif peut aussi être **accepté sans exception** : l'opérateur PostgreSQL qui contacte l'API Kubernetes est une détection de priorité Notice, non notifiée, conservée pour la traçabilité.

## Valider une règle avant de la déployer

Une règle invalide empêche Falco de démarrer **sur tous les nœuds**. Je valide donc chaque modification dans un pod jetable, avec la même image que celle déployée :

```bash
kubectl -n falco-test run falco-validate --rm -it --restart=Never \
  --image=falcosecurity/falco:<version> -- \
  falco -V /etc/falco/falco_rules.yaml -V /regles/app-rules.yaml
```

(le fichier de règles est monté depuis une ConfigMap temporaire). Les deux fichiers doivent répondre `ok` avant le `helm upgrade`.

## Prouver que la chaîne fonctionne

Un script joue 7 scénarios inoffensifs dans un namespace de test : shell interactif, lecture de `/etc/shadow`, `apt-get --version`, écriture sous `/etc`, faux `nmap` (un `/bin/true` renommé), lectures répétées du jeton. Puis un mode `verify` contrôle la chaîne maillon par maillon : pods Falco présents sur chaque nœud, règles attendues déclenchées, événements arrivés dans Loki, métriques dans Prometheus, alertes évaluées et, en option, réception dans le SIEM.

Deux enseignements de ce script :

- **Le scénario shell exige un vrai terminal.** Sans `kubectl exec -it`, aucun TTY n'est alloué et les règles shell ne voient rien. Le premier passage a donc « raté » une détection qui fonctionnait.
- **Un test qui échoue à tort est pire qu'un test absent.** Un `grep -q` sous `set -o pipefail` et un nom de métrique inexistant produisaient de faux échecs. Corrigés, sinon plus personne ne fait confiance au script.

Un second script inventorie toutes les détections réelles hors namespace de test, regroupées par règle, workload et commande. Je le relance après quelques jours d'activité normale, avant d'activer les notifications.

## N'alerter que ce qui demande une action

L'ISO 27001 n'impose pas de liste d'alertes : elle demande une surveillance proportionnée, une réaction prévue à chaque alerte et la preuve que la surveillance fonctionne. J'en ai tiré une règle simple : **seul ce qui demande une action rapide est notifié**.

| Alerte | Canal | Réaction attendue |
|--------|-------|-------------------|
| Détection Critical (shell dans une application) | Sécurité, en quelques secondes | Identifier l'auteur, sinon incident |
| Détection Error | Sécurité, sous 5 minutes | Faux positif : exception `FAL-xxx`. Sinon : incident |
| Falco absent d'un nœud ou du cluster | Supervision, 10 à 15 minutes | Rétablir, consigner la période aveugle |
| Sortie Falcosidekick en erreur | Supervision, sous 10 minutes | Rétablir la sortie |

Warning et Notice restent visibles dans Grafana et sont revus chaque semaine. Cette revue, consignée, est la trace attendue en audit.

Dernier point : surveiller le surveillant. Falco suit les remplacements de nœuds, mais un changement de noyau peut casser la sonde eBPF. L'alerte « DaemonSet incomplet » le signale. Côté ressources, Falco reste sobre (50m de CPU et 256 Mi demandés), à vérifier sur un dashboard de santé des agents.
