# service.py — service de deep matching appelé par l'API Node (server/src/services/match.js).
#
# POST /scores  { "paires": [{ "cv": "profil + résumé du candidat", "offre": "texte de l'offre" }, …] }
#            →  { "scores": [{ "score": 87, "etiquette": "Good Fit" }, …] }   (même ordre que les paires)
# GET  /sante  → vérifie que le service tourne
#
# Lancer : .venv\Scripts\python.exe -m uvicorn service:app --port 8000
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

from commun import caracteristiques, charger_modele_embeddings, encoder, nettoyer, recouvrement_mots, score_sur_100

ARTEFACT = joblib.load(Path(__file__).parent / 'artefacts' / 'classifieur.joblib')
CLASSIFIEUR = ARTEFACT['classifieur']
ETIQUETTES = ARTEFACT['etiquettes']
MODELE = charger_modele_embeddings()

app = FastAPI(title='CVMatch IA — deep matching')


class Paire(BaseModel):
    cv: str
    offre: str


class Demande(BaseModel):
    paires: list[Paire]


# Un même CV ou une même offre revient souvent : on garde les vecteurs déjà calculés
@lru_cache(maxsize=2000)
def vecteur(texte, role):
    return encoder(MODELE, [texte], role)[0]


@app.get('/sante')
def sante():
    return {'statut': 'ok', 'modele_embeddings': ARTEFACT['modele_embeddings']}


@app.post('/scores')
def scores(demande: Demande):
    if not demande.paires:
        return {'scores': []}
    cvs = [nettoyer(p.cv) for p in demande.paires]
    offres = [nettoyer(p.offre) for p in demande.paires]

    vec_cv = np.stack([vecteur(t, 'cv') for t in cvs])
    vec_offre = np.stack([vecteur(t, 'offre') for t in offres])
    recouvrement = np.array([recouvrement_mots(c, o) for c, o in zip(cvs, offres)])

    probas = CLASSIFIEUR.predict_proba(caracteristiques(vec_cv, vec_offre, recouvrement))
    return {
        'scores': [
            {'score': int(s), 'etiquette': ETIQUETTES[int(p.argmax())]} for s, p in zip(score_sur_100(probas), probas)
        ]
    }
