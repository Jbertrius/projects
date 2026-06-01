# Guide du débutant

Bienvenue ! Ce guide t'explique comment fonctionne ce projet et comment tu peux m'aider dessus, même si tu débutes en programmation.

---

## C'est quoi ce projet ?

C'est un **site web interne** qui sert à suivre l'activité d'un groupe de personnes :

- Qui a rencontré quel pasteur, et quand ?
- Qui est actif, qui est inactif ?
- Qui suit la formation, et à quel stade ?

Les données arrivent par **deux bots Telegram** (des robots automatiques sur l'appli Telegram), et le site web les affiche sous forme de tableaux et graphiques.

### Schéma simplifié

```
Un membre envoie un message sur Telegram
        ↓
Le bot Telegram comprend le message
        ↓
Le bot envoie les infos au site web (l'API)
        ↓
Le site web stocke les infos dans une base de données (Firestore)
        ↓
Un responsable se connecte au site et voit les tableaux de bord
```

---

## Les technologies utilisées

| Outil | À quoi ça sert | Tu dois le connaître ? |
|---|---|---|
| **Node.js** | Fait tourner le site web (côté serveur) | ✅ Oui |
| **Express** | Gère les pages web et les requêtes API | ✅ Oui (c'est simple) |
| **HTML / CSS / JavaScript** | Les pages que l'utilisateur voit | ✅ Oui |
| **Firestore** | La base de données (stocke les membres, rencontres…) | 🟡 Un peu |
| **Python** | Les bots Telegram | ❌ Pas au début |
| **Google Cloud Run** | Héberge le site sur internet | ❌ Pas au début |

**En résumé :** si tu connais un peu de JavaScript et de HTML, tu peux déjà aider.

---

## Installer le projet sur ton ordinateur

### Ce dont tu as besoin

1. **Node.js** (version 20 ou plus) → [Télécharger ici](https://nodejs.org/)
2. **Git** → [Télécharger ici](https://git-scm.com/)
3. **Un éditeur de code** → Je recommande [VS Code](https://code.visualstudio.com/)

### Étapes

Ouvre un terminal (PowerShell ou le terminal de VS Code) et tape :

```bash
# 1. Cloner le projet (le télécharger)
git clone https://github.com/Jbertrius/projects.git
cd projects

# 2. Installer les dépendances (les librairies dont le projet a besoin)
npm install

# 3. Lancer le site en local
npm start
```

Le site sera accessible sur : **http://localhost:8080**

> 💡 Sans la base de données (Firestore), le site affichera des pages vides ou des erreurs — c'est normal. On peut quand même travailler sur le visuel.

---

## Comment le projet est organisé

```
projects/
│
├── server.js              ← Le fichier qui démarre tout
│
├── public/                ← 🎨 LES PAGES WEB (ce que l'utilisateur voit)
│   ├── index.html         ← Page d'accueil / tableau de bord
│   ├── login.html         ← Page de connexion
│   ├── pastors.html       ← Page des pasteurs
│   ├── academy.html       ← Page de la formation
│   ├── styles.css         ← Le style visuel (couleurs, mise en page)
│   └── *.js               ← Le code JavaScript des pages
│
├── src/                   ← 🔧 LE CODE DU SERVEUR (la logique)
│   ├── routes/            ← Les endpoints de l'API (ce que le serveur répond)
│   ├── repositories/      ← Les fonctions qui lisent/écrivent dans la base de données
│   ├── middleware/        ← Code qui s'exécute à chaque requête (sécurité, logs…)
│   └── jobs/              ← Tâches automatiques qui tournent en arrière-plan
│
├── lib/                   ← Les connexions à Google (Firestore, Sheets…)
│
├── tests/                 ← Les tests automatiques
│
├── apps/                  ← Les bots Telegram (Python, tu n'y touches pas au début)
│   ├── attendance-bot/
│   └── mannam-bot/
│
└── docs/                  ← La documentation (tu es ici !)
```

### Où tu peux aider facilement

| Dossier | Type de travail | Difficulté |
|---|---|---|
| `public/*.html` | Modifier les pages web (ajouter un bouton, un texte…) | ⭐ Facile |
| `public/styles.css` | Changer les couleurs, la mise en page | ⭐ Facile |
| `public/*.js` | Modifier le comportement des pages | ⭐⭐ Moyen |
| `src/routes/` | Ajouter un endpoint API | ⭐⭐⭐ Plus avancé |

---

## Comprendre les concepts clés

### Qu'est-ce qu'une API ?

C'est un système de questions-réponses entre le navigateur et le serveur.

**Exemple :**
- Le navigateur demande : `GET /api/dashboard` (« donne-moi les données du tableau de bord »)
- Le serveur répond : `{ "totalMembers": 45, "activeMeetings": 12 }` (les données en format JSON)

Dans notre projet, les routes API sont dans `src/routes/`. Chaque fichier gère un domaine :
- `dashboard.routes.js` → les données du tableau de bord
- `pastors.routes.js` → les infos sur les pasteurs
- `academy.routes.js` → la formation

### Qu'est-ce que Firestore ?

C'est une base de données en ligne (hébergée par Google). Elle stocke nos données sous forme de **collections** (comme des dossiers) qui contiennent des **documents** (comme des fiches) :

```
Firestore
├── members/          ← Tous les membres
│   ├── doc1 → { name: "Alice", zone: "Paris", status: "active" }
│   └── doc2 → { name: "Bob", zone: "Lyon", status: "inactive" }
│
├── meetings/         ← Toutes les rencontres
│   └── doc1 → { memberName: "Alice", pastorName: "Martin", date: "2026-05-01" }
│
└── academyStudents/  ← Les étudiants en formation
    └── doc1 → { name: "Alice", class: "Niveau 1", progress: 80 }
```

---

## Comment lire le code (méthode simple)

Si tu veux comprendre ce que fait une page, suis ce chemin :

### Exemple : la page "pasteurs"

1. **Ouvre la page HTML** → `public/pastors.html`
   - C'est la structure de la page (les titres, boutons, tableaux)

2. **Regarde le fichier JS associé** → `public/pastors.js`
   - C'est le code qui charge les données et remplit la page
   - Cherche un appel comme `fetch("/api/pastors")` — c'est la requête au serveur

3. **Trouve la route API** → `src/routes/pastors.routes.js`
   - C'est le code serveur qui répond à la requête
   - Il appelle un "repository" pour lire dans Firestore

4. **Le repository** → `src/repositories/`
   - C'est lui qui parle vraiment à la base de données

---

## Comment lancer les tests

```bash
npm test
```

Si tu vois des ✔ (checkmarks verts), c'est bon. Des ✗ (croix rouges) signifient qu'un test échoue.

> ⚠️ Certains tests liés aux bots échouent sans Firestore, c'est connu et normal en local.

---

## Comment proposer un changement

### 1. Créer une branche

Avant de modifier quoi que ce soit, crée une branche (une copie de travail) :

```bash
git checkout -b mon-changement
```

Par exemple : `git checkout -b fix-couleur-bouton`

### 2. Faire tes modifications

Édite les fichiers, teste dans le navigateur.

### 3. Enregistrer tes changements

```bash
# Voir ce qui a changé
git status

# Ajouter tous les fichiers modifiés
git add .

# Créer un "commit" (un point de sauvegarde)
git commit -m "fix: correction de la couleur du bouton principal"
```

### 4. Envoyer sur GitHub

```bash
git push origin mon-changement
```

Puis sur GitHub, crée une **Pull Request** (PR) pour que je puisse relire avant de fusionner.

---

## Conventions à respecter

### Messages de commit

Utilise ce format : `type: description courte`

| Type | Quand l'utiliser |
|---|---|
| `fix:` | Tu corriges un bug |
| `feat:` | Tu ajoutes une fonctionnalité |
| `style:` | Tu changes le visuel (CSS, HTML cosmétique) |
| `docs:` | Tu modifies de la documentation |

**Exemples :**
- `fix: le bouton se superpose au tableau sur mobile`
- `feat: ajout du filtre par zone sur la page pasteurs`
- `style: amélioration du contraste en mode sombre`

### Code

- Pas besoin de tout commenter, mais si un bout de code est compliqué, mets un commentaire
- Indente avec 2 espaces (c'est la config du projet)
- Teste toujours dans le navigateur avant de commit

---

## Les tâches que tu peux prendre

Regarde le fichier `TODO.md` à la racine du projet ou demande-moi directement. Voici des exemples de tâches accessibles :

- 🟢 **Corriger un problème d'affichage** (CSS, responsive…)
- 🟢 **Ajouter un texte ou un label** dans une page HTML
- 🟡 **Ajouter un filtre** sur une page existante (un peu de JS)
- 🟡 **Créer une nouvelle page** en copiant une page existante
- 🔴 **Modifier la logique serveur** (plus tard quand tu seras à l'aise)

---

## Si tu es bloqué

1. **Lis le message d'erreur** — souvent il dit exactement quel fichier et quelle ligne a un problème
2. **Google l'erreur** — copie-colle le message, quelqu'un a sûrement eu le même problème
3. **Demande-moi** — pas de question bête, je préfère t'aider que perdre du temps à corriger après

---

## Ressources pour apprendre

| Sujet | Ressource gratuite |
|---|---|
| HTML & CSS | [MDN Web Docs (fr)](https://developer.mozilla.org/fr/docs/Learn/HTML) |
| JavaScript | [javascript.info](https://fr.javascript.info/) |
| Node.js & Express | [Express - Guide officiel](https://expressjs.com/fr/starter/installing.html) |
| Git | [Git - le guide simple](https://rogerdudler.github.io/git-guide/index.fr.html) |

---

Bon courage et bienvenue sur le projet ! 🚀
