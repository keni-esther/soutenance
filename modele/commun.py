# commun.py — ce qui est partagé entre l'entraînement (entrainer.py) et le service (service.py) :
# le modèle d'embeddings, le nettoyage des textes et le calcul des caractéristiques d'une paire CV ↔ offre.
import re
import unicodedata

import numpy as np
from sentence_transformers import SentenceTransformer

# Modèle multilingue (≈ 100 langues dont français et anglais), lit jusqu'à 512 tokens (~ une page)
NOM_MODELE_EMBEDDINGS = 'intfloat/multilingual-e5-small'
# Change dès que la façon de calculer les vecteurs change : le cache d'entrainer.py est alors recalculé.
# Essai v2 « CV entier » (moyenne de morceaux de 250 mots) : moins bon que le début du CV
# (F1 0,41 contre 0,45, cf. artefacts/metriques_v2_cv_entier_moyenne.json), donc abandonné.
VERSION_EMBEDDINGS = f'{NOM_MODELE_EMBEDDINGS}|début du texte (512 tokens)'

ETIQUETTES = ['No Fit', 'Potential Fit', 'Good Fit']

# Mots trop courants pour compter dans le recouvrement de mots-clés (anglais + français)
MOTS_VIDES = set(
    'the and for with you our are will from this that have has your can all who in of to a an on as at or by be is'
    ' de des du la le les et en un une pour au aux sur par dans avec est sont nous vous'.split()
)


def charger_modele_embeddings():
    # Toujours sur le processeur : sur un Space ZeroGPU, la carte graphique annoncée n'est
    # utilisable que dans une fonction @spaces.GPU, ailleurs les vecteurs seraient faux.
    return SentenceTransformer(NOM_MODELE_EMBEDDINGS, device='cpu')


def nettoyer(texte):
    """Espaces normalisés, phrases recollées ("track record.Proven" → "track record. Proven")."""
    texte = unicodedata.normalize('NFKC', str(texte or ''))
    texte = re.sub(r'([a-z])\.([A-Z])', r'\1. \2', texte)
    return re.sub(r'\s+', ' ', texte).strip()


def encoder(modele, textes, role):
    """
    Vecteurs normalisés. Le modèle lit le début du texte (512 tokens, ~ une page) : pour un CV,
    c'est le titre, le profil et le poste actuel, le plus utile pour juger du match.
    e5 attend un préfixe : 'query: ' pour l'offre, 'passage: ' pour le CV.
    """
    prefixe = 'query: ' if role == 'offre' else 'passage: '
    return modele.encode(
        [prefixe + t for t in textes],
        batch_size=16,
        normalize_embeddings=True,
        show_progress_bar=len(textes) > 50,
    )


def mots(texte):
    """Ensemble de mots sans accents ni mots vides, comme match.js côté Node."""
    texte = unicodedata.normalize('NFD', texte.lower())
    texte = ''.join(c for c in texte if unicodedata.category(c) != 'Mn')
    return {m for m in re.split(r'[^a-z0-9+#]+', texte) if len(m) > 1 and m not in MOTS_VIDES}


def recouvrement_mots(cv, offre):
    """Part des mots de l'offre présents dans le CV (0 à 1) : la méthode « mots-clés »."""
    mots_offre = mots(offre)
    return len(mots_offre & mots(cv)) / len(mots_offre) if mots_offre else 0.0


def caracteristiques(vec_cv, vec_offre, recouvrement):
    """
    Caractéristiques d'une paire, données au classifieur :
    - similarité cosinus (le « sens » global est-il proche ?)
    - produit et écart des deux vecteurs, dimension par dimension (sur quels aspects ils se rejoignent)
    - recouvrement de mots-clés
    """
    vec_cv, vec_offre = np.atleast_2d(vec_cv), np.atleast_2d(vec_offre)
    cosinus = np.sum(vec_cv * vec_offre, axis=1, keepdims=True)
    return np.hstack([cosinus, vec_cv * vec_offre, np.abs(vec_cv - vec_offre), np.atleast_2d(recouvrement).T])


def score_sur_100(probas):
    """Probabilités [No Fit, Potential Fit, Good Fit] → score 0-100 (Potential compte pour moitié)."""
    probas = np.atleast_2d(probas)
    return np.round(100 * (probas[:, 2] + 0.5 * probas[:, 1])).astype(int)
