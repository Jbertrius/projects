# Proposition d'architecture low-cost

## Objectif

Centraliser dans une application web:

- l'activité des membres;
- les rencontres avec les pasteurs;
- le suivi des déclarations issues de Telegram;
- le suivi d'une formation sur un mois.

## Recommandation pragmatique

### Option retenue

- Frontend + API sur `Cloud Run`
- Données initiales dans `Google Sheets`
- Connecteur de lecture via `Google Sheets API`
- Évolution future vers `Firestore`

## Pourquoi ne pas commencer directement avec SQL

`Cloud SQL` coûtera plus cher, demandera plus d'administration, et n'apporte pas assez de valeur au début pour un usage départemental avec budget serré.

## Flux cible

1. Un membre saisit une rencontre via Telegram.
2. Le bot écrit dans Google Sheets et peut continuer à écrire dans Google Calendar.
3. L'application web lit et agrège les données.
4. Le dashboard expose:
   - activité par membre;
   - volume de rencontres;
   - membres inactifs;
   - progression formation;
   - alertes de suivi.

## Modèle de données conseillé

### `members`

- `id`
- `name`
- `zone`
- `department_role`
- `status`

### `meetings`

- `id`
- `member_id`
- `pastor_name`
- `meeting_date`
- `report_date`
- `source`
- `calendar_event_id`

### `training_sessions`

- `id`
- `member_id`
- `cohort`
- `week`
- `attendance`
- `completion_score`

## Découpage produit

### MVP

- dashboard global
- classement activité membres
- vue formation
- filtres temporels simples

### V2

- détail par membre
- détail par pasteur
- recherche
- alertes automatiques
- exports PDF ou CSV
