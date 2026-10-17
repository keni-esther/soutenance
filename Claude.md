# CVMatch IA — projet de soutenance

- `cvmatchIA/` : app mobile Expo 57 (Expo Router, routes dans `src/app/`). Voir `cvmatchIA/AGENTS.md`.
- `server/` : API Node/Express 5 + MySQL (Laragon) + Claude (`claude-opus-5-5`). Voir `server/README.md`.

## Avancement
- [x] Phase 1-2 : intro, connexion, inscription, OTP par e-mail (Gmail / nodemailer)
- [x] Phase 3 : profil candidat + dépôt du CV
- [x] Phase 4 : résumé du CV par Claude (`server/src/services/ia.js`), validation par le candidat
- [x] Onglets candidat / recruteur (`_layout.tsx`)
- [x] Phase 5 : recruteur — profil entreprise, recherche de candidats + fiche, enregistrer / contacter (e-mail), suivi
- [x] Phase 6 : offres (publier, modifier, désactiver, supprimer), candidatures avec score de compatibilité (`server/src/services/match.js`), retenir/refuser + e-mail, suivi candidat
- [ ] À faire par l'utilisateur : ajouter ANTHROPIC_API_KEY (et Gmail) dans server/.env
