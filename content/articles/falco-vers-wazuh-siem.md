---
title: "Envoyer les alertes Falco dans Wazuh : décodeurs, règles et niveaux"
date: 2027-01-04
category: SIEM
tags: [wazuh, falco, siem, kubernetes]
summary: "Falcosidekick sait parler syslog, Wazuh sait le lire. Entre les deux : un décodeur qui bute sur un horodatage, un ordre de règles qui compte et un flux à protéger."
draft: true
---

Les détections de Falco arrivaient déjà dans Loki, lues dans Grafana. Il manquait une **trace de sécurité centralisée**, corrélable avec les autres sources et conservée selon les exigences de journalisation (ISO 27001 : 8.15, 8.16, 5.25). C'est le rôle de Wazuh. Loki reste l'outil de lecture, Wazuh devient le registre.

## L'envoi : une sortie syslog de Falcosidekick

Falcosidekick dispose d'une sortie syslog. Je l'ai placée dans un fichier de values séparé, superposé aux values principales : le retrait consiste à relancer le `helm upgrade` sans ce second fichier.

```yaml
falcosidekick:
  config:
    syslog:
      host: "siem.example.internal"
      port: "514"
      protocol: "tcp"
      format: "json"
      minimumpriority: "notice"
```

Côté Wazuh, un bloc `<remote>` accepte le syslog TCP, **uniquement depuis l'IP de sortie des nœuds** qui hébergent Falcosidekick :

```xml
<remote>
  <connection>syslog</connection>
  <port>514</port>
  <protocol>tcp</protocol>
  <allowed-ips>203.0.113.10/32</allowed-ips>
</remote>
```

Si rien n'arrive alors que tout semble vert, `/var/ossec/logs/ossec.log` dit souvent pourquoi : une source refusée par `allowed-ips`. Pour connaître l'adresse réellement vue par le manager, une capture des SYN entrants sur le port 514 pendant un test suffit.

## Le décodeur et le piège de l'horodatage

Falcosidekick émet des lignes de la forme :

```
<14>2026-11-04T10:00:00Z pod Falco[1]: {"rule":"...","priority":"Warning",...}
```

Le pré-décodeur syslog de Wazuh lit un horodatage avec décalage (`+01:00`) mais **pas** la forme `Z` qu'utilise un pod en UTC. Dans un cas l'en-tête est reconnu et le message est le JSON, dans l'autre il ne l'est pas. J'ai donc écrit deux décodeurs du même nom, le second en PCRE2 :

```xml
<decoder name="falco-json">
  <program_name>^Falco$</program_name>
  <prematch>^{\s*"</prematch>
  <plugin_decoder>JSON_Decoder</plugin_decoder>
</decoder>

<decoder name="falco-json">
  <prematch type="pcre2">^\S+ \S+ Falco\[\d+\]: </prematch>
  <plugin_decoder offset="after_prematch">JSON_Decoder</plugin_decoder>
</decoder>
```

Le décodeur JSON de Wazuh fait le reste : tous les champs de Falco deviennent disponibles, préfixés par `data.` dans l'interface (`data.rule`, `data.priority`, `data.output_fields.k8s.ns.name`).

## Les règles : l'ordre décide du niveau

Une règle parente reconnaît tout événement Falco décodé. Des règles filles fixent ensuite le niveau. **Wazuh retient la première règle fille qui correspond** : les règles propres à l'application viennent donc avant les règles génériques par priorité.

| Priorité Falco | Niveau Wazuh |
|----------------|--------------|
| Emergency, Alert, Critical | 12 |
| Error | 10 |
| Warning | 7 |
| Notice | 4 |
| Autres | 3 |

```xml
<group name="falco,">
  <rule id="100100" level="3">
    <decoded_as>falco-json</decoded_as>
    <field name="rule" type="pcre2">.+</field>
    <description>Falco : $(rule)</description>
  </rule>

  <!-- Règles applicatives d'abord -->
  <rule id="100120" level="12">
    <if_sid>100100</if_sid>
    <field name="rule" type="pcre2">^App - Shell interactif</field>
    <description>Falco : shell interactif dans un conteneur applicatif</description>
    <mitre><id>T1059</id></mitre>
    <group>falco,iso27001_8.16,iso27001_5.25,</group>
  </rule>

  <!-- Puis toutes les autres, selon la priorité -->
  <rule id="100111" level="10">
    <if_sid>100100</if_sid>
    <field name="priority" type="pcre2">^Error$</field>
    <description>Falco erreur : $(rule)</description>
  </rule>
</group>
```

Chaque alerte porte les groupes `falco` et `iso27001_*` : un filtre suffit pour sortir toutes les preuves de surveillance liées à une mesure de la norme.

Les identifiants suivent une **plage réservée par source** (100100 à 100199 pour Falco, les suivantes pour les autres intégrations). Sans cette discipline, deux intégrations finissent par réutiliser le même identifiant, et l'une écrase l'autre.

## Valider avant de brancher

Trois lignes d'exemple et `wazuh-logtest` suffisent à valider décodeurs et règles avant tout branchement :

```bash
sudo /var/ossec/bin/wazuh-logtest < tests/falco-samples.log
```

Attendu : le décodeur `falco-json` sur chaque ligne, puis la bonne règle et le bon niveau. Une ligne sans décodeur signale un décodeur à corriger, avant qu'un seul événement réel ne soit perdu.

Le test de bout en bout réutilise le script de scénarios Falco, avec une option qui ajoute le contrôle côté SIEM. Premier passage : 66 événements reçus, aucune erreur d'envoi.

## Une règle d'hygiène : les faux positifs se traitent dans Falco

Il est tentant d'écrire une règle Wazuh de niveau 0 pour faire taire un faux positif. Je ne le fais pas : le faux positif serait masqué dans le SIEM mais resterait dans Loki, dans les métriques et dans les notifications. Les exceptions vivent **à la source**, dans les règles Falco, avec leur identifiant et leur justification.

## Ce qui reste à faire avant la production

Le syslog de Falcosidekick **n'a pas de TLS** et ouvre une connexion par événement. Avec un filtrage strict des sources, c'est acceptable en environnement de développement. Avant la production, il faut un lien privé entre le cluster et le SIEM, ou un transport chiffré.

Si le SIEM est indisponible, rien n'est perdu côté lecture : les événements restent dans Loki, et l'alerte « sortie Falcosidekick en erreur » prévient. Un SIEM est une brique de plus à superviser, au même titre que ce qu'il surveille.
