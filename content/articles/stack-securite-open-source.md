---
title: "Une stack de sécurité 100 % open source : qui fait quoi (Trivy, Falco, Wazuh, CrowdSec)"
date: 2026-11-09
category: Détection
tags: [wazuh, crowdsec, falco, trivy, open-source]
summary: "Trivy, Falco, Wazuh et CrowdSec ne se font pas concurrence : ils couvrent des moments différents de la vie d'un système. Voici comment les articuler."
draft: false
---

Quand on monte la sécurité d'un système d'information avec des outils open source, la première confusion est de croire que Trivy, Falco, Wazuh et CrowdSec sont des alternatives les uns des autres. Ils répondent en réalité à des questions différentes, à des moments différents.

## La grille de lecture : avant, pendant, autour

| Moment | Question | Outil |
|---|---|---|
| **Avant** le déploiement | Ce que je livre contient-il des failles connues ? | Trivy |
| **Pendant** l'exécution | Que fait réellement mon workload en ce moment ? | Falco |
| **Autour** du système | Que se passe-t-il sur mes hôtes, mes journaux, mon réseau ? | Wazuh, CrowdSec |

## Trivy : repérer avant de livrer

Trivy analyse les images de conteneurs, les dépendances applicatives, les fichiers d'infrastructure as code et peut produire un inventaire des composants. Son intérêt est d'être **simple à brancher en CI** : un échec sur les vulnérabilités critiques empêche la mise en production d'un composant connu pour être exploitable.

Limite : il ne voit que ce qui est connu et publié. Il ne dit rien du comportement d'une application une fois lancée.

## Falco : voir ce qui se passe à l'exécution

Falco observe les appels système et déclenche des alertes à partir de règles : un shell lancé dans un conteneur, une lecture de fichier sensible, une connexion sortante inhabituelle. Il complète Trivy : une vulnérabilité inconnue ou une mauvaise configuration peut être exploitée sans jamais figurer dans une base de CVE, mais son effet, lui, est observable.

Limite : il demande un réglage des règles pour limiter les faux positifs, surtout au début.

## Wazuh : centraliser et corréler

Wazuh joue le rôle de SIEM et de détection sur les hôtes. Des agents remontent les journaux, vérifient l'intégrité des fichiers, détectent des vulnérabilités sur les machines et des configurations non conformes. Un tableau de bord central permet de corréler ces événements, de rechercher et de produire des alertes.

C'est la brique qui répond à « que s'est-il passé, où, et dans quel ordre ? » lors d'une investigation.

## CrowdSec : bloquer les comportements malveillants

CrowdSec analyse les journaux (accès web, SSH, etc.) pour repérer des comportements hostiles comme le bruteforce ou le scan, puis demande à des « bouncers » (pare-feu, reverse proxy) de bloquer les adresses concernées. Il s'appuie aussi sur des informations partagées par sa communauté.

Limite : il agit sur ce qu'il voit dans les journaux ; il ne remplace ni un pare-feu applicatif ni une analyse de vulnérabilités.

## Comment les articuler

Un schéma simple et réaliste :

1. **Trivy en CI** bloque les composants vulnérables avant livraison.
2. **Falco** surveille les workloads en production et envoie ses alertes à Wazuh.
3. **Wazuh** centralise journaux et alertes, et sert de point d'investigation.
4. **CrowdSec** réduit le bruit en bloquant en amont les sources hostiles évidentes.

L'avantage d'une stack open source : on maîtrise les données, on peut auditer les règles, et le coût de licence ne limite pas le périmètre de supervision.

## Ce qu'il faut garder en tête

Les outils ne remplacent pas les **procédures**. Une alerte sans personne pour la traiter ni procédure de réponse reste du bruit. La partie la moins visible, mais souvent la plus déterminante, est de définir qui reçoit quoi, qui décide, et comment on documente la réponse à un incident.

Un pentest régulier, enfin, vérifie que l'ensemble tient face à un attaquant réel : c'est le test de réalité de toute la chaîne.
