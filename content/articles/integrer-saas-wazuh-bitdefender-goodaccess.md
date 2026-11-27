---
title: "Intégrer des sources SaaS dans Wazuh sans exposer le SIEM : Bitdefender GravityZone et GoodAccess"
date: 2027-01-18
category: SIEM
tags: [wazuh, siem, bitdefender, goodaccess]
summary: "Antivirus et VPN en SaaS poussent leurs journaux vers l'extérieur. Wazuh n'écoute ni en HTTPS ni en syslog TLS. Voici le montage de relais locaux que j'ai retenu."
draft: true
---

Un SIEM devient utile quand il croise les sources. Après les détections Kubernetes (Falco) et les événements d'authentification (Keycloak), j'ai intégré deux services SaaS : l'antivirus des postes (Bitdefender GravityZone) et le VPN d'accès de l'équipe (GoodAccess). Les deux ont la même particularité : ce sont **eux qui envoient**, vers une adresse publique qu'on leur indique.

## Le problème commun

| Source | Ce qu'elle envoie | Ce que Wazuh sait recevoir |
|--------|-------------------|----------------------------|
| GravityZone | HTTPS, format CEF, attend une réponse 2xx | Pas d'écouteur HTTPS |
| GoodAccess | Syslog sur TCP **avec TLS** | Syslog sans TLS |

Ouvrir directement le manager Wazuh à Internet n'était pas une option. J'ai retenu le même schéma pour les deux : un **relais** qui termine le protocole exposé, et qui transmet à Wazuh sur la **boucle locale**.

```
GravityZone ──HTTPS──► connecteur Bitdefender ──syslog──► 127.0.0.1:5514 ──► Wazuh
GoodAccess  ──TLS────► relais stunnel         ──syslog──► 127.0.0.1:5515 ──► Wazuh
```

Les ports syslog de Wazuh n'écoutent que sur `127.0.0.1` : aucune règle de pare-feu pour eux. Seuls les ports des relais sont ouverts, et **uniquement** depuis les adresses sources publiées par chaque éditeur, en `/32` quand il n'y en a qu'une. Je ne recopie pas ces listes dans le dépôt : elles changent, et on les reprend à la source au moment de l'ouverture.

## Bitdefender GravityZone

Bitdefender fournit un connecteur (paquet `gz-evpsc`) qui reçoit les événements en HTTPS et les relaie en syslog. Mon script d'installation :

- contrôle le certificat et la clé fournis avant de modifier quoi que ce soit (correspondance, expiration) ;
- ajoute le dépôt APT de l'éditeur avec une clé en `signed-by` ;
- configure le relais vers la boucle locale ;
- pose le certificat **après** le script de configuration de l'éditeur, qui génère son propre certificat auto-signé et écraserait le nôtre ;
- génère la valeur d'autorisation du récepteur et ne l'affiche **qu'une fois**, pour la ranger dans Vault.

Trois règles de secrets :

- La valeur d'autorisation du récepteur est **distincte** de la clé d'API GravityZone.
- La clé d'API n'a qu'un seul droit, celui de configurer l'envoi d'événements. Le script la demande sans l'afficher, et n'en montre que la longueur pour vérification.
- **Le journal du connecteur contient la valeur d'autorisation à chaque requête.** Son dossier est réservé à root, et ce journal n'est jamais envoyé dans Loki ni lu par Wazuh.

Un script de test envoie un événement comme le ferait Bitdefender et vérifie trois choses : une requête **sans** autorisation est refusée, une requête autorisée répond OK, et l'alerte arrive dans Wazuh.

### Écrire les décodeurs avant d'avoir de vrais événements

Pour avancer sans attendre la mise en service, j'ai reconstitué 19 événements à partir des noms de champs de la documentation, puis validé décodeurs et règles avec `wazuh-logtest`. Dès le premier événement réel, deux surprises :

- **La forme de ligne.** Le connecteur envoie l'hôte puis `CEF:0|...` sans nom de programme : pour le pré-décodeur de Wazuh, `CEF` **devient** le nom du programme.
- **Les champs.** Un événement antimalware réel n'a pas les compteurs de la documentation : le résultat est dans `act` (`deleted`, `quarantined`, `still present`...).

J'ai rendu toutes les clés des décodeurs optionnelles : un champ absent laisse une valeur vide au lieu de faire échouer toute la lecture. Les échantillons sont marqués « reconstitués » ou « réels » dans le dépôt, et les reconstitués seront remplacés au fil de l'eau (événement de test de l'éditeur, puis fichier EICAR sur un poste).

| Niveau | Cas |
|--------|-----|
| 12 | Malware non nettoyé, rançongiciel, 5 détections en 10 minutes sur un poste |
| 10 | Antimalware désactivé, anti-exploit, détection avancée, incident |
| 8 | Malware traité, analyse comportementale, **désinstallation de l'agent** |

## GoodAccess

GoodAccess envoie ses journaux (administration, blocage de menaces, conformité des postes) en syslog JSON sur TLS. Un relais `stunnel` termine le TLS avec le certificat du nom public, sous un utilisateur système dédié et avec des droits systemd restreints.

Côté GoodAccess, on dépose le certificat d'**autorité** qui a émis le nôtre. Le script de test vérifie la chaîne avec cette seule autorité, exactement comme le fera GoodAccess. Point à ne pas oublier : si le certificat change d'émetteur, il faut redéposer la nouvelle autorité, sinon l'envoi échoue sans bruit côté SIEM.

Le décodage m'a appris une subtilité de Wazuh. Les lignes ressemblent à :

```
<14>Nov 16 12:15:11 siem.example device_posture_check: timestamp:... message:{JSON} application:device_posture_check
```

Le pré-décodeur prend `device_posture_check` pour le nom du programme. Or, pour un événement qui a un nom de programme, **Wazuh n'essaie que les décodeurs qui en déclarent un**. Le décodeur parent en déclare donc un qui accepte n'importe quelle valeur, et se reconnaît au format `timestamp:... message:{...} application:...`. Un décodeur fils passe ensuite l'objet JSON au décodeur JSON natif : aucune clé à déclarer.

| Niveau | Événement |
|--------|-----------|
| 8 | Poste non conforme (avec la raison) |
| 3 | Tout journal GoodAccess décodé |
| 2 | Poste conforme : fréquent, volontairement sous le seuil d'alerte |

Les échantillons de test sont anonymisés (domaines en `example.invalid`). Aucun vrai nom ni aucune vraie adresse e-mail ne doit entrer dans le dépôt.

## Organiser les règles de plusieurs sources

Une plage d'identifiants par source, tenue dans un registre : 100100 pour Falco, 100200 pour Bitdefender, 100300 pour GoodAccess, 100500 pour Keycloak. Quand une règle est provisoire (écrite sur un nom de programme supposé), elle est marquée comme telle. Un événement qui ne correspond pas retombe sur la règle générique de sa source, et le champ `predecoder.program_name` de l'alerte donne le vrai nom à reporter.

## Avant la production : une VM dédiée

Installer les relais sur la VM du SIEM était le plus rapide pour démarrer. Mais un connecteur exposé à Internet est un service attaquable, et sa compromission ne doit pas donner accès au SIEM. Le montage est donc prévu pour être déplacé sur **une VM dédiée** sans toucher aux décodeurs ni aux règles : il suffit de changer l'adresse d'écoute et la source autorisée. Même raisonnement pour le certificat : plutôt qu'une copie de la clé privée de l'application sur la VM du SIEM, un certificat propre à ce nom.

Dernier point de supervision : une alerte si une source n'envoie plus rien pendant 24 heures. Un SaaS qui cesse d'envoyer, c'est le même silence trompeur qu'une collecte tombée.
