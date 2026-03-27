# Architecture de donnees recommandee

## Recommandation simple

Pour ton cas, je recommande ceci:

- `Google Calendar` reste un outil agenda
- `Google Sheets` devient la source de verite du MVP
- l'application lit `Google Sheets`
- plus tard, on synchronise `Google Sheets -> Firestore`

## Pourquoi ne pas prendre Google Calendar comme source principale

Google Calendar est bon pour:

- planifier
- visualiser les rendez-vous
- notifier

Mais ce n'est pas une bonne base analytique pour:

- suivre l'activite par membre
- compter des pasteurs distincts
- faire des statuts d'avancement
- historiser des champs metier riches

## Meilleure transition

### Etape 1

- le bot envoie vers `Google Sheets`
- le bot peut continuer a envoyer aussi vers `Google Calendar`
- le dashboard lit `Google Sheets`

### Etape 2

- un job de synchronisation lit `Google Sheets`
- il alimente `Firestore`
- le dashboard lit `Firestore`

### Etape 3

- le bot ecrit directement dans `Firestore`
- `Google Sheets` devient optionnel
- `Google Calendar` reste un canal secondaire pour la planification

## Conclusion pragmatique

Pour le test local et le MVP:

- ne pars pas de Google Calendar
- branche d'abord l'application sur Google Sheets

C'est la solution la plus simple, la moins risquee, et la plus rapide a valider.
