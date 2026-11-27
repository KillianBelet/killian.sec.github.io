---
title: "Surveiller Keycloak avec Wazuh : force brute, actions d'admin et collecte qui tombe en silence"
date: 2027-01-11
category: SIEM
tags: [wazuh, keycloak, siem, iam]
summary: "Collecter les événements Keycloak depuis Kubernetes vers Wazuh, détecter force brute et actions d'admin, et prouver par un battement de cœur que la chaîne vit."
draft: true
---

Un fournisseur d'identité voit passer chaque connexion, chaque échec et chaque changement de droits. Pour un SIEM, c'est une source de premier ordre. Pour un Keycloak hébergé sur Kubernetes, j'ai construit une chaîne de collecte vers Wazuh, avec une contrainte de plus : **savoir quand elle s'arrête**.

## Faire parler Keycloak

Keycloak moderne est une distribution Quarkus : pas de fichier `server.log`, tout part sur la sortie standard du conteneur, conservée par le kubelet dans `/var/log/pods`. Le système de fichiers du conteneur est en lecture seule, et je n'ai pas voulu changer ça pour écrire un fichier de logs.

Deux réglages suffisent :

- **L'écouteur `jboss-logging`** écrit les événements dans les logs, avec un niveau pour les succès et un pour les erreurs :

  ```yaml
  KC_SPI_EVENTS_LISTENER_JBOSS_LOGGING_SUCCESS_LEVEL: "info"
  KC_SPI_EVENTS_LISTENER_JBOSS_LOGGING_ERROR_LEVEL: "warn"
  ```

- **Les événements d'administration** sont activés realm par realm, par un script `kcadm` qui affiche ce qu'il va changer, puis l'applique avec `--apply`. L'option « Include Representation » reste désactivée : elle recopie l'objet modifié dans l'événement, gonfle les lignes au-delà de 16 Kio (le runtime les découpe alors) et peut y faire figurer des données sensibles.

Ce premier réglage redémarre les pods Keycloak : opération planifiée et annoncée, car l'instance servait aussi un autre environnement.

## Collecter sans dépendre du reste

Les mêmes logs partaient déjà vers Loki pour l'exploitation. Je ne m'en suis pas servi pour le SIEM : cette chaîne dépendait d'un autre site. Une chaîne de sécurité ne doit pas tomber avec celle qu'elle surveille.

La collecte repose sur un **agent Wazuh en DaemonSet**, limité aux nœuds qui hébergent Keycloak, qui lit en lecture seule `/var/log/pods/<namespace>_*-keycloak-*/keycloak/*.log`. Il communique avec le manager sur 1514/TCP (chiffré) et s'enrôle sur 1515/TCP avec un mot de passe stocké dans Vault. Une NetworkPolicy restreint ses sorties.

Un détail Kubernetes compte : un nœud recréé par l'autoHealing produit un nouvel agent du même nom. Le manager est configuré pour remplacer un agent déconnecté depuis plus d'une heure, sinon l'enrôlement échoue.

## Un décodeur tolérant

Une ligne d'événement ressemble à :

```
... INFO  [org.keycloak.events] (executor-thread-7) type="LOGIN", realmName="app", clientId="web", ipAddress="203.0.113.24", ...
```

J'ai écrit des décodeurs **frères** (même nom, même parent), un par champ. Chaque champ est cherché indépendamment : un champ absent n'empêche pas l'extraction des autres. Les guillemets sont optionnels dans les expressions, car les anciennes versions de Keycloak écrivent `type=LOGIN` et les récentes `type="LOGIN"`.

```xml
<decoder name="keycloak-events">
  <prematch type="pcre2">\[org\.keycloak\.events\]</prematch>
</decoder>

<decoder name="keycloak-events-fields">
  <parent>keycloak-events</parent>
  <regex type="pcre2">\btype="?([A-Z_]+)"?</regex>
  <order>keycloak.type</order>
</decoder>
```

## Les règles

| Niveau | Détection | MITRE ATT&CK |
|--------|-----------|--------------|
| 3 | Connexion réussie | T1078 |
| 5 | Échec de connexion | T1110 |
| 8 | Connexion au realm `master` ou à la console d'administration | T1078 |
| 10 | 8 échecs en 2 minutes depuis la même IP (force brute) | T1110.001 |
| 12 | Échecs sur de nombreux comptes depuis une IP (pulvérisation de mots de passe) | T1110.003 |
| 10 | Échecs répétés sur un compte depuis plusieurs IP | T1110 |
| 6 | Changement de mot de passe, d'OTP ou d'e-mail | T1098 |
| 8 | Modification de rôle, de client ou de groupe | T1098 |
| 10 | Suppression d'un utilisateur | T1531 |
| 12 | **Modification de la configuration des événements** | T1562.008 |

La dernière ligne est ma préférée. Un attaquant qui obtient un accès administrateur commence souvent par réduire la journalisation. Désactiver les événements d'un realm est donc une alerte de niveau maximal, déclenchée par l'événement d'administration qui en garde la trace.

Les règles de corrélation utilisent la fréquence et la fenêtre de Wazuh :

```xml
<rule id="100503" level="10" frequency="8" timeframe="120">
  <if_matched_sid>100502</if_matched_sid>
  <description>Keycloak : échecs de connexion répétés depuis $(srcip) (force brute)</description>
  <mitre><id>T1110.001</id></mitre>
</rule>
```

## Le battement de cœur : prouver que la collecte vit

Une collecte qui tombe ne produit aucune alerte : elle produit du **silence**, qu'on confond facilement avec une période calme. J'ai donc ajouté un battement de cœur de bout en bout :

1. Une **CronJob Kubernetes** se connecte toutes les 15 minutes à Keycloak avec un client dédié (`siem-heartbeat`, secret dans Vault). Cela produit un vrai événement de connexion, qui traverse toute la chaîne.
2. Une règle Wazuh reconnaît cet événement (niveau 3).
3. Sur le manager, un script exécuté toutes les 10 minutes (`full_command`) cherche le dernier battement. Au-delà de 45 minutes, soit trois battements manqués, il écrit une ligne d'état qu'une règle transforme en **alerte de niveau 12**.

Le script conserve la date du dernier battement dans un fichier d'état : la rotation quotidienne du fichier d'alertes ne provoque donc pas de fausse alerte. Une règle distincte signale un agent de collecte déconnecté.

L'avantage par rapport à une simple supervision de l'agent : le battement teste **tout**. Keycloak, l'écriture des logs, la lecture par l'agent, le transport, le décodeur et les règles.

## Les critères de recette

Je n'ai pas considéré la chaîne comme terminée avant d'avoir provoqué chaque cas :

| Contrôle | Attendu |
|----------|---------|
| Connexion d'un compte de test | Alerte de connexion |
| 8 échecs en 2 minutes | Échecs, puis alerte de force brute |
| Ajout d'un rôle, suppression d'un compte de test | Alertes d'administration |
| Relance du script de configuration des événements | Alerte de niveau 12 |
| Rotation du fichier de log | Ni trou ni doublon |
| Redémarrage de l'agent | Reprise à la position enregistrée |
| CronJob suspendue 45 minutes | Alerte « battement absent » |
| Agent supprimé | Alerte « agent déconnecté » |

Dernier point d'attention : le kubelet écrit en UTC. La synchronisation NTP des nœuds et du SIEM conditionne la corrélation temporelle, donc la valeur des règles à fenêtre de temps.
