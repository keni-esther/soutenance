# CVMatch IA — projet de soutenance

- `cvmatchIA/` : app mobile Expo 58 (SDK 58, RN 0.88, Expo Router, routes dans `src/app/`). Voir `cvmatchIA/AGENTS.md`.
- `server/` : API Node/Express 5 + MySQL (XAMPP, dans `Downloads/kenixampp` ; ne pas lancer le MySQL de Laragon en même temps : conflit sur le port 3306) + Claude (`claude-opus-5-5`). Voir `server/README.md`.

## Avancement
- [x] Phase 1-2 : intro, connexion, inscription, OTP par e-mail (Gmail / nodemailer)
- [x] Phase 3 : profil candidat + dépôt du CV
- [x] Phase 4 : résumé du CV par Claude (`server/src/services/ia.js`), validation par le candidat
- [x] Onglets candidat / recruteur (`_layout.tsx`)
- [x] Phase 5 : recruteur — profil entreprise, recherche de candidats + fiche, enregistrer / contacter (e-mail), suivi
- [x] Phase 6 : offres (publier, modifier, désactiver, supprimer), candidatures avec score de compatibilité (`server/src/services/match.js`), retenir/refuser + e-mail, suivi candidat
- [x] Refonte visuelle d'après `maquette/` : splash + intro (bloc rouge), version web ordinateur (≥ 900 px) avec panneau rouge à gauche (intro/connexion) et menu latéral (`components/barre-laterale.tsx`, `en-tete.tsx`, `grille.tsx`, `hooks/use-ecran-large.ts`)
- [x] Gmail configuré dans server/.env
- [x] Mise à jour Expo SDK 57 → 58 (Expo Go l'exige) ; `API_URL` déduite de l'IP d'Expo (`hostUri`), plus d'IP en dur
- [x] Inscription : confirmation du mot de passe + œil afficher/masquer (connexion et inscription)
- [ ] À faire par l'utilisateur : mettre une vraie clé Anthropic (`sk-ant-api03-…`) dans server/.env. La clé actuelle (`sk-…`, 35 car.) n'est pas une clé Anthropic → 401, le résumé du CV échoue
- [ ] Commit côté `server/` (agent, candidats.js…) — le dépôt racine n'a pas été commité depuis `cde38d3`
- [ ] Préparer la démo : comptes de test (candidat, recruteur) + quelques offres

## Reste à faire d'après la grille (`maquette/Evaluation Soutenance DATA IA.pdf`, /130)
- [ ] Bloc 2 Modèle (/25) : rien d'entraîné (`match.js` = règles par mots-clés). Plan validé avec l'utilisateur : **deep matching** = embeddings multilingues (sentence-transformers) CV ↔ offre + petit modèle scikit-learn entraîné sur des paires étiquetées, métriques, comparaison avec `match.js` (gardé en secours), utilisé dans l'API
- [x] Bloc 4 Agent IA (/25) : assistant recruteur `server/src/services/agent.js` (boucle d'outils Claude, 6 outils, mémoire en base `conversations_agent`, brouillons validés par le recruteur avant envoi) + onglet `recruteur/assistant.tsx`. Outils testés sur la base ; **pas encore testé avec Claude (clé API manquante)**
- [ ] Bloc 4 suite : scénarios de test de l'agent à présenter au jury (demande normale, ambiguë, discriminatoire, hors sujet, aucun résultat)
- [ ] Bloc 1 Données (/25) : nettoyage/analyse documentés + tableau de bord avec graphiques
- [ ] Bloc 3 App (/30) : déployer (API + base MySQL + web), APK Android (EAS), version desktop installable (Electron), quelques tests, fonction mobile (caméra pour photographier le CV, notifications)
- [ ] Bloc 5 Intégration IA (/25) : déjà bien couvert ; ajouter la clé API, gestion des coûts/délais

## Notes
- `cvmatchIA/` a **son propre dépôt git** (séparé du dépôt racine) : y commiter les changements de l'app.
- Sécurité OTP à améliorer (proposé, pas fait) : code stocké en clair dans `codes_otp`, pas de limite d'essais.
- Comptes de test : utiliser de vraies adresses, ex. `keniesther06+candidat1@gmail.com` (alias Gmail `+`). Une adresse inventée provoque des mails « Message non distribué » renvoyés à GMAIL_USER.
- Les id MySQL ne se suivent pas (AUTO_INCREMENT ne réutilise pas les id supprimés) : normal. `TRUNCATE` pour repartir de 1 sur une base de test.
