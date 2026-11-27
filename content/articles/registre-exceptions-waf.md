---
title: "Faux positifs d'un WAF : tenir un registre d'exceptions au lieu de désactiver des règles"
date: 2026-12-07
category: WAF
tags: [crowdsec, waf, owasp, security-as-code]
summary: "Chaque règle retirée d'un WAF est une détection en moins. Voici le processus que j'applique : mesure, portée minimale, contrôles compensatoires et date de revue."
draft: true
---

Le jour où un WAF bloque un utilisateur légitime, la tentation est forte : on désactive la règle et on passe à autre chose. Trois mois plus tard, personne ne sait pourquoi elle est désactivée, ni ce qu'elle protégeait. Avec CrowdSec AppSec, j'ai mis en place un **registre d'exceptions** versionné avec la configuration, sur le principe du *security as code*.

## Le processus

Toute exclusion de règle suit les mêmes étapes, et rien n'est fusionné sans elles :

1. **Identifier la règle exacte**, par rejeu ciblé et comparaison des compteurs `cscli metrics show appsec`, ou avec `cscli alerts inspect <id> -d` qui donne la règle et la zone en cause.
2. **L'inscrire au registre** avec un identifiant `EXC-xxx` : motif, impact mesuré, contrôles compensatoires, date de revue.
3. **L'appliquer avec la portée la plus étroite possible**, avec l'identifiant en commentaire.
4. **Relancer les tests** de non-régression : les seuils doivent être respectés.
5. **Ouvrir une pull request** contenant le registre, la configuration et les résultats.

## Exclusion globale : seulement si on ne peut pas faire autrement

Les trois premières exceptions concernent des règles RCE qui cherchent des noms de commandes Unix dans les requêtes. Problème : beaucoup sont des mots courants (`time`, `date`, `more`, `find`, `sort`). L'application manipule du texte libre partout (messages, commentaires, descriptions), donc une phrase ordinaire suffisait à déclencher un blocage.

La mesure a guidé la décision :

| Indicateur | CRS complet | Après exclusion |
|------------|-------------|-----------------|
| Faux positifs (corpus GoTestWAF) | 29/141 (20,6 %) | 9/141 (6,4 %) |
| Attaques bloquées | 318/675 | 314/675 |

Les contrôles compensatoires sont écrits noir sur blanc : les autres règles RCE de la même famille restent actives, le virtual patching couvre les CVE connues, et l'application n'exécute aucune commande système à partir des données utilisateur. La revue est datée : avant la mise en production, ou au plus tard dans trois mois.

## Exclusion limitée à une route : le cas par défaut

Le cas le plus intéressant est arrivé en protégeant Keycloak. Au retour d'une connexion Google, Keycloak reçoit les scopes accordés, dont `https://www.googleapis.com/auth/userinfo.profile`. La règle LFI 930120 cherche des noms de fichiers système par sous-chaîne, dont `.profile`. Résultat : **plus personne ne pouvait se connecter avec Google**.

Désactiver 930120 partout aurait affaibli la détection d'inclusion de fichiers sur tout le site. L'exclusion est donc limitée à la méthode et au chemin du retour SSO, grâce au hook `pre_eval` évalué à chaque requête :

```yaml
name: custom/app-crs-tuning
on_load:
  - apply:
      - RemoveInBandRuleByID(932260)   # EXC-001 : exclusion globale
pre_eval:
  # EXC-004 : retour SSO vers Keycloak, faux positif LFI sur "userinfo.profile"
  - filter: IsInBand == true && req.Method == "GET" && req.URL.Path matches "^/realms/[^/]+/broker/[^/]+/endpoint$"
    apply:
      - RemoveInBandRuleByID(930120)
```

Le test associé vérifie autant ce qui doit passer que ce qui doit rester bloqué : le retour SSO est accepté, mais le même paramètre sur un autre chemin, en POST, ou combiné à une traversée de répertoires reçoit toujours un 403.

Même logique pour une automatisation qui poste du texte technique libre vers une API : son contenu citait des appels de fonctions (`gzwrite()`, `write(`), pris pour des injections PHP et Node.js. L'exclusion porte sur cette méthode et ce chemin uniquement, pas sur l'adresse IP de l'automate, qui change à chaque exécution.

## Une exception retire une détection : il faut la surveiller

C'est le point que l'on oublie le plus souvent. Sur une route exceptée, **l'absence d'alerte ne prouve plus l'absence de tentative**. Chaque exception de ce type documente donc :

- son **risque résiduel**, avec ce qui n'a pas pu être vérifié ;
- sa **surveillance** : alertes WAF de la route, échecs côté application, usage de la clé d'API concernée ;
- les **mesures à traiter** pour pouvoir la retirer un jour (restreindre la clé, borner la longueur des champs, exclure un seul champ plutôt que toute la route).

Pour l'automatisation, j'ai lu le code du backend pour confirmer les contrôles compensatoires : authentification par clé d'API avant toute lecture du corps, autorisation par table, validation par schéma. Ce qui n'était pas vérifié est écrit comme tel.

## Et les faux positifs qu'on garde

Quatre règles SQLi et XSS produisent encore quelques faux positifs sur le corpus de test. Elles restent actives : elles portent l'essentiel de la détection des injections. Les retirer coûterait bien plus en détection qu'elles ne coûtent en faux positifs. Elles sont listées dans le registre comme « conservées, à surveiller », et seront traitées route par route si du trafic réel est bloqué.

## Deux pièges de déploiement

**Une clé YAML en double ignore une exception sans bruit.** Après une fusion automatique de branches, la configuration contenait deux clés `pre_eval`. Le YAML n'en garde qu'une, et l'une des exceptions disparaissait silencieusement. Les filtres sont désormais regroupés dans une seule liste.

**Comparer avec le rendu serveur.** `helm template` hors cluster régénère des secrets aléatoires et fausse le diff. J'utilise `helm upgrade --dry-run=server`, comparé à `helm get manifest` : le seul écart attendu est le bloc d'exception ajouté. C'est ce contrôle qui a montré qu'une branche en retard allait **supprimer** l'exception Keycloak et couper de nouveau la connexion Google.

## À retenir

Un registre d'exceptions transforme une décision prise sous pression en décision traçable : on sait ce qui a été retiré, pourquoi, ce que ça coûte, et quand le revoir. C'est aussi exactement ce qu'un auditeur ISO 27001 demandera.
