# Serveur CVMatch IA

API Express + MySQL + Claude utilisée par l'application `cvmatchIA/`.

## Démarrage

1. **XAMPP** : démarrer MySQL dans le panneau XAMPP (Laragon doit être arrêté, sinon conflit sur le port 3306).
2. Remplir le fichier `.env` (voir `.env.example`) :
   - `GMAIL_USER` / `GMAIL_APP_PASSWORD` pour envoyer les codes OTP par e-mail ;
   - `ANTHROPIC_API_KEY` pour le résumé de CV par Claude.
3. Dans ce dossier :

```bash
npm install        # une seule fois
npm run init-db    # une seule fois : crée la base "cvmatchia" et ses tables
npm run dev        # lance le serveur sur http://localhost:3000
```

Le code OTP s'affiche aussi dans la console du serveur (pratique pour tester).

## Routes

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/auth/inscription` | Crée un compte + envoie un code OTP |
| POST | `/api/auth/connexion` | Connexion (renvoie le token) |
| POST | `/api/auth/verifier-otp` | Vérifie le code et connecte |
| POST | `/api/auth/renvoyer-otp` | Renvoie un nouveau code |
| GET  | `/api/candidat/profil` | Profil + CV + résumé IA |
| PUT  | `/api/candidat/profil` | Met à jour le profil |
| POST | `/api/candidat/upload-cv` | Dépose le CV, Claude génère le résumé |
| POST | `/api/candidat/resume/valider` | Le candidat valide son résumé |
| GET / PUT | `/api/recruteur/profil` | Profil de l'entreprise |
| GET  | `/api/recruteur/candidats?q=&ville=` | Recherche de candidats |
| GET  | `/api/recruteur/candidats/:id` | Fiche d'un candidat (e-mail visible après contact) |
| POST / DELETE | `/api/recruteur/candidats/:id/enregistrer` | Enregistrer / retirer un candidat |
| POST | `/api/recruteur/candidats/:id/contacter` | Envoie un e-mail au candidat |
| GET  | `/api/recruteur/suivi` | Candidats enregistrés et contactés |
| GET / POST / DELETE | `/api/recruteur/agent` | Assistant IA : conversation en cours / nouvelle demande `{ message }` / recommencer |

| GET / POST | `/api/recruteur/offres` | Mes offres / publier une offre |
| PUT / DELETE | `/api/recruteur/offres/:id` | Modifier (ou désactiver) / supprimer |
| GET  | `/api/recruteur/offres/:id/candidatures` | Candidatures reçues, triées par compatibilité |
| PUT  | `/api/recruteur/candidatures/:id` | Retenir / refuser (e-mail au candidat) |
| GET  | `/api/candidat/offres?q=&ville=` | Offres actives avec score de compatibilité |
| GET  | `/api/candidat/offres/:id` | Détail d'une offre |
| POST | `/api/candidat/offres/:id/postuler` | Postuler (profil + CV obligatoires) |
| GET / DELETE | `/api/candidat/candidatures[/:id]` | Mes candidatures / retirer |

Le score de compatibilité (`src/services/match.js`) compare le métier (50 pts),
les compétences demandées (35 pts) et la ville (15 pts).

Un candidat apparaît dans la recherche dès qu'il a un compte vérifié, un métier renseigné
et un CV déposé. Si son résumé IA est validé, ce sont les infos de l'IA qui sont affichées.

## Tester sur un vrai téléphone

Dans `cvmatchIA/src/constants/app-context.ts`, remplacer `localhost` par l'adresse IP
de l'ordinateur (commande `ipconfig`), ex. `http://192.168.1.10:3000`.
Le téléphone et l'ordinateur doivent être sur le même Wi-Fi.
