# Conformité — ce qui est fait, ce qui reste à faire

> ⚠️ **Ce document est un support de travail, pas un avis juridique.** Il a été
> rédigé à partir de l'analyse de ton code, pas par un juriste. Les modèles de
> clauses et de mentions doivent être relus par un professionnel avant d'être
> opposés à un client ou publiés. Sur une activité de sous-traitance de données
> vendue à des entreprises, un document mal calibré crée du risque au lieu d'en
> retirer.

---

## 1. Fait — livré dans le code

| Élément | Où |
|---|---|
| Cloisonnement des données vérifié côté serveur | `firestore.rules` |
| Escalade de rôle fermée (`profils`) | `firestore.rules` |
| Compte désactivé bloqué côté serveur, pas seulement à l'écran | `firestore.rules` |
| Accès du collègue aux référentiels partagés rétabli | `firestore.rules` |
| Plafond de taille par document | `firestore.rules` |
| Droit d'accès — export PDF lisible | `rgpd.js` |
| Droit à la portabilité — export JSON structuré | `rgpd.js` |
| Droit à l'effacement — suppression des données relationnelles | `rgpd.js` |
| Distinction effacement / conservation comptable obligatoire | `rgpd.js` |
| Revue des durées de conservation (36 mois sans contact) | `rgpd.js` |
| Registre des traitements pré-rempli et exportable | `rgpd.js` |
| Traçabilité des demandes traitées (journal d'activité) | `rgpd.js` |
| Mention de vigilance à la saisie des comptes rendus | `visites.js` |

---

## 2. À faire par toi — console Firebase

Aucune de ces actions n'est réalisable depuis le code.

- [ ] **Publier les nouvelles règles.** Firestore → Règles. Les tester d'abord
      dans le simulateur avec l'uid de ton collègue sur `contacts_mdm_<son_uid>`
      puis sur `accords_global`.

- [ ] **Vérifier la région de la base.** Firestore → Paramètres. Si elle n'est
      pas `eur3` ou `europe-*`, les données personnelles de tes clients sont
      hébergées hors UE. **La région ne peut pas être modifiée après création** :
      il faut un nouveau projet et une migration. À trancher avant de vendre.

- [ ] **Fermer l'inscription libre.** Authentication → Sign-in method. Si
      email/mot de passe est ouvert, n'importe qui peut créer un compte. Les
      règles ne peuvent pas l'empêcher.

- [ ] **Activer App Check.** Empêche l'accès à ta base hors de ton application.

- [ ] **Restreindre la clé API** aux domaines autorisés (console Google Cloud →
      Identifiants). Rappel : cette clé n'est pas un secret, mais la restreindre
      limite l'usage abusif.

- [ ] **Activer la sauvegarde** Firestore (exports programmés).

---

## 3. À faire par toi — organisationnel

### Ton statut change

Aujourd'hui tu traites tes propres données : tu es **responsable de traitement**.
Dès que tu vends le CRM, tes clients deviennent responsables de traitement et toi
leur **sous-traitant**. Ce changement de statut emporte des obligations propres.

### Contrat de sous-traitance (article 28 RGPD)

Obligatoire avec **chaque** client. Il n'est pas optionnel et tes clients sérieux
te le réclameront. Points que le contrat doit couvrir :

- objet, durée, nature et finalité du traitement
- catégories de données et de personnes concernées
- interdiction d'utiliser les données à tes propres fins
- liste des sous-traitants ultérieurs (**Google Firebase**, **API Adresse**,
  **OpenStreetMap**, et le fournisseur d'IA si le client active ce module) et
  procédure d'autorisation en cas de changement
- mesures de sécurité (celles listées en partie 1)
- assistance du client pour répondre aux demandes des personnes — c'est
  exactement ce que fournit le module Conformité
- notification des violations de données, avec un délai
- sort des données en fin de contrat : restitution ou suppression
- droit d'audit du client

La CNIL publie un modèle de clauses ainsi qu'un guide du sous-traitant.
Pars de ces textes plutôt que d'une rédaction libre.

### Registre

Tu en tiens **deux** : celui de tes propres traitements (clients de LOAC DEV,
prospection, comptabilité) et, en tant que sous-traitant, celui des traitements
réalisés pour le compte de tes clients. Le module Conformité génère la trame du
second.

### Mentions d'information

Les personnes dont tu détiens les données doivent être informées. En pratique,
pour de la prospection B2B, cela passe par une mention dans tes emails et une
page accessible. À faire figurer : identité du responsable, finalités, base
légale, durée de conservation, destinataires, droits et modalités d'exercice,
droit de réclamation auprès de la CNIL.

### Violation de données

Prépare la procédure **avant** d'en avoir besoin : qui constate, qui décide,
notification à la CNIL sous 72 h, information des personnes si le risque est
élevé. Une page suffit, mais elle doit exister.

---

## 4. Le point qui mérite une décision, pas une case à cocher

### Géolocalisation

Le module Tournées géolocalise des **adresses d'établissements**. C'est un
traitement banal.

Il change de nature si tu ouvres une version où un responsable voit la position
de ses commerciaux. Ce serait alors de la **géolocalisation de salariés** :
information individuelle préalable, consultation du CSE, interdiction en dehors
du temps de travail, analyse d'impact généralement nécessaire, et un régime de
sanctions nettement plus sévère.

**Décide-le explicitement**, et si tu ne veux pas de cette contrainte,
verrouille-le techniquement plutôt que contractuellement.

### Texte libre des comptes rendus

C'est ton risque le plus élevé, parce qu'il ne dépend pas de ton code mais de ce
que tes utilisateurs y écrivent. La CNIL sanctionne régulièrement les
« commentaires excessifs ou subjectifs » dans les CRM. Une personne peut demander
copie de ce qui est écrit sur elle — le module la produit en un clic, ce qui est
une bonne chose à condition que le contenu soit tenable.

La mention affichée à la saisie est un début. Pour une version vendue, prévois
une sensibilisation des utilisateurs dans ton offre.

---

## 5. Ordre suggéré

1. Publier les règles Firestore *(aujourd'hui — c'est le seul point qui te
   concerne sur tes données réelles)*
2. Vérifier la région Firestore *(avant tout nouveau client)*
3. Fermer l'inscription libre, activer App Check
4. Rédiger le contrat de sous-traitance à partir du modèle CNIL, le faire relire
5. Migrer vers `/orgs/{orgId}/` avec custom claims *(avant le 2ᵉ client)*
6. Mentions d'information et procédure de violation
