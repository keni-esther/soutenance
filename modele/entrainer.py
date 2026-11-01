# entrainer.py — Bloc 2 : entraîne et évalue le modèle de deep matching CV ↔ offre.
#
# Données : donnees/train.csv et donnees/test.csv (8 000 paires CV ↔ offre étiquetées
#           No Fit / Potential Fit / Good Fit, jeu public « resume-job-description-fit »).
# Résultats : artefacts/classifieur.joblib (utilisé par service.py), artefacts/metriques.json,
#             artefacts/*.png (graphiques pour la soutenance).
#
# Lancer : .venv\Scripts\python.exe entrainer.py
import json
import time
from pathlib import Path

import joblib
import matplotlib

matplotlib.use('Agg')  # pas de fenêtre : on enregistre les graphiques en PNG
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from commun import (
    ETIQUETTES,
    NOM_MODELE_EMBEDDINGS,
    VERSION_EMBEDDINGS,
    caracteristiques,
    charger_modele_embeddings,
    encoder,
    nettoyer,
    recouvrement_mots,
    score_sur_100,
)

DOSSIER = Path(__file__).parent
DONNEES = DOSSIER / 'donnees'
ARTEFACTS = DOSSIER / 'artefacts'
ARTEFACTS.mkdir(exist_ok=True)
CACHE = DONNEES / 'cache_embeddings.joblib'


# =============================================
# 1. CHARGEMENT ET NETTOYAGE
# =============================================
def charger(nom):
    df = pd.read_csv(DONNEES / nom)
    avant = len(df)
    df = df.rename(columns={'resume_text': 'cv', 'job_description_text': 'offre', 'label': 'etiquette'})
    df = df.dropna()
    df['cv'] = df['cv'].map(nettoyer)
    df['offre'] = df['offre'].map(nettoyer)
    df = df[(df['cv'].str.len() > 0) & (df['offre'].str.len() > 0)]
    # Une même paire CV ↔ offre ne doit compter qu'une fois
    df = df.drop_duplicates(['cv', 'offre']).reset_index(drop=True)
    print(f'{nom} : {avant} lignes → {len(df)} après nettoyage')
    return df


train = charger('train.csv')
test = charger('test.csv')

# Les offres du test n'apparaissent jamais à l'entraînement : on mesure bien la capacité
# à juger une offre nouvelle, comme dans l'application.
assert not set(test['offre']) & set(train['offre'])


# =============================================
# 2. EMBEDDINGS (mis en cache : le calcul prend quelques minutes)
# =============================================
cache = joblib.load(CACHE) if CACHE.exists() else {}
if cache.get('version') != VERSION_EMBEDDINGS:
    cache = {'version': VERSION_EMBEDDINGS, 'cv': {}, 'offre': {}}

a_calculer = {
    role: sorted(set(pd.concat([train[role], test[role]])) - set(cache[role])) for role in ('cv', 'offre')
}
if any(a_calculer.values()):
    modele = charger_modele_embeddings()
    for role, textes in a_calculer.items():
        if textes:
            print(f'Embeddings : {len(textes)} textes ({role})…')
            debut = time.time()
            cache[role].update(zip(textes, encoder(modele, textes, role)))
            print(f'  {time.time() - debut:.0f} s')
    joblib.dump(cache, CACHE)


def matrice(df):
    vec_cv = np.stack([cache['cv'][t] for t in df['cv']])
    vec_offre = np.stack([cache['offre'][t] for t in df['offre']])
    recouvrement = np.array([recouvrement_mots(c, o) for c, o in zip(df['cv'], df['offre'])])
    return caracteristiques(vec_cv, vec_offre, recouvrement)


X_train, X_test = matrice(train), matrice(test)
y_train = train['etiquette'].map(ETIQUETTES.index).to_numpy()
y_test = test['etiquette'].map(ETIQUETTES.index).to_numpy()

# Colonnes de la matrice : 0 = cosinus, dernière = recouvrement de mots-clés
COL_COSINUS, COL_MOTS = [0], [X_train.shape[1] - 1]


# =============================================
# 3. CHOIX DU CLASSIFIEUR (validation croisée groupée par offre, sur l'entraînement seulement)
# =============================================
def regression_logistique(c):
    return make_pipeline(StandardScaler(), LogisticRegression(C=c, class_weight='balanced', max_iter=3000))


candidats = {
    'Régression logistique (C=0.01)': regression_logistique(0.01),
    'Régression logistique (C=0.1)': regression_logistique(0.1),
    'Régression logistique (C=1)': regression_logistique(1),
    'Gradient boosting': HistGradientBoostingClassifier(class_weight='balanced', random_state=0),
}
# GroupKFold : une offre est soit dans les plis d'entraînement, soit dans le pli de validation, jamais les deux
plis = GroupKFold(n_splits=5)
groupes = train['offre'].factorize()[0]

print('\nValidation croisée (F1 macro, 5 plis groupés par offre) :')
resultats_cv = {}
for nom, clf in candidats.items():
    scores = cross_val_score(clf, X_train, y_train, cv=plis, groups=groupes, scoring='f1_macro', n_jobs=-1)
    resultats_cv[nom] = {'moyenne': float(scores.mean()), 'ecart_type': float(scores.std())}
    print(f'  {nom:32s} {scores.mean():.3f} ± {scores.std():.3f}')

meilleur_nom = max(resultats_cv, key=lambda n: resultats_cv[n]['moyenne'])
print(f'→ retenu : {meilleur_nom}')


# =============================================
# 4. ÉVALUATION FINALE SUR LE TEST (une seule fois)
# =============================================
def precision_top5(df, scores):
    """Pour chaque offre : parmi les 5 CV les mieux notés, quelle part est vraiment « Good Fit » ?"""
    valeurs = []
    for _, groupe in df.assign(score=scores).groupby('offre'):
        if (groupe['etiquette'] == 'Good Fit').any() and len(groupe) >= 5:
            top = groupe.nlargest(5, 'score')
            valeurs.append((top['etiquette'] == 'Good Fit').mean())
    return float(np.mean(valeurs))


systemes = {
    'Mots-clés (comme match.js)': (regression_logistique(1), COL_MOTS),
    'Cosinus seul': (regression_logistique(1), COL_COSINUS),
    'Deep matching': (candidats[meilleur_nom], slice(None)),
}
metriques = {}
for nom, (clf, colonnes) in systemes.items():
    clf.fit(X_train[:, colonnes], y_train)
    probas = clf.predict_proba(X_test[:, colonnes])
    predictions = probas.argmax(axis=1)
    scores = score_sur_100(probas)
    metriques[nom] = {
        'exactitude': accuracy_score(y_test, predictions),
        'f1_macro': f1_score(y_test, predictions, average='macro'),
        # Le score 0-100 sépare-t-il bien les « Good Fit » du reste ? (0,5 = hasard, 1 = parfait)
        'auc_good_fit': roc_auc_score(y_test == 2, scores),
        'precision_top5': precision_top5(test, scores),
    }
    print(f'\n=== {nom} ===')
    print(classification_report(y_test, predictions, target_names=ETIQUETTES, digits=3))
    print({k: round(v, 3) for k, v in metriques[nom].items()})

modele_final = systemes['Deep matching'][0]  # déjà entraîné sur tout le jeu d'entraînement
predictions = modele_final.predict(X_test)


# =============================================
# 5. ENREGISTREMENT ET GRAPHIQUES
# =============================================
joblib.dump(
    {'classifieur': modele_final, 'modele_embeddings': NOM_MODELE_EMBEDDINGS, 'etiquettes': ETIQUETTES},
    ARTEFACTS / 'classifieur.joblib',
)

with open(ARTEFACTS / 'metriques.json', 'w', encoding='utf-8') as f:
    json.dump(
        {
            'modele_embeddings': VERSION_EMBEDDINGS,
            'classifieur_retenu': meilleur_nom,
            'paires_entrainement': len(train),
            'paires_test': len(test),
            'validation_croisee': resultats_cv,
            'test': metriques,
            'matrice_confusion_deep_matching': confusion_matrix(y_test, predictions).tolist(),
        },
        f,
        ensure_ascii=False,
        indent=2,
    )

# Matrice de confusion du modèle retenu
fig, ax = plt.subplots(figsize=(6, 5))
ConfusionMatrixDisplay.from_predictions(
    y_test, predictions, display_labels=ETIQUETTES, cmap='Reds', ax=ax, colorbar=False
)
ax.set_title('Deep matching — matrice de confusion (test)')
ax.set_xlabel('Prédit')
ax.set_ylabel('Réel')
fig.tight_layout()
fig.savefig(ARTEFACTS / 'matrice_confusion.png', dpi=150)

# Comparaison des trois méthodes
noms_metriques = {'f1_macro': 'F1 macro', 'auc_good_fit': 'AUC « Good Fit »', 'precision_top5': 'Précision top 5'}
x = np.arange(len(noms_metriques))
largeur = 0.27
couleurs = ['#C9B8B0', '#A8C5D6', '#8C3B2E']  # gris, bleu poudré, rouge brique de l'application
fig, ax = plt.subplots(figsize=(8, 4.5))
for i, (nom, valeurs) in enumerate(metriques.items()):
    barres = ax.bar(x + (i - 1) * largeur, [valeurs[k] for k in noms_metriques], largeur, label=nom, color=couleurs[i])
    ax.bar_label(barres, fmt='%.2f', fontsize=8)
ax.set_xticks(x, noms_metriques.values())
ax.set_ylim(0, 1)
ax.set_title('Mots-clés vs deep matching (jeu de test, offres jamais vues)')
ax.legend(loc='upper left', fontsize=8)
ax.spines[['top', 'right']].set_visible(False)
fig.tight_layout()
fig.savefig(ARTEFACTS / 'comparaison.png', dpi=150)

print(f'\nArtefacts enregistrés dans {ARTEFACTS}')
