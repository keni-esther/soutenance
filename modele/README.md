---
title: CVMatch IA - deep matching
emoji: 🎯
colorFrom: red
colorTo: blue
sdk: gradio
sdk_version: 6.31.0
python_version: "3.12"
app_file: app.py
pinned: false
---

# CVMatch IA — deep matching CV ↔ offre

Modèle entraîné dans `entrainer.py` (embeddings `intfloat/multilingual-e5-small` + régression logistique),
servi par `service.py` et appelé par l'API Node de CVMatch IA (`server/src/services/match.js`, variable `MODELE_URL`).

- `GET /sante` : vérifie que le service tourne
- `POST /scores` : `{ "paires": [{ "cv": "…", "offre": "…" }] }` → `{ "scores": [{ "score": 87, "etiquette": "Good Fit" }] }`
- `/` : page Gradio pour essayer le modèle à la main

L'en-tête ci-dessus sert à Hugging Face Spaces : le Space lance `app.py` (SDK Gradio, gratuit).
