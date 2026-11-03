# entrainer.py — Bloc 2 : entraîne et évalue le modèle de deep matching CV ↔ offre.
#
# Données : la base nettoyée du bloc 1, ../analyse/cvmatch_donnees.db (7 933 paires CV ↔ offre étiquetées
#           No Fit / Potential Fit / Good Fit, jeu public « resume-job-description-fit »).
#           Elle est créée par le notebook ../analyse/analyse_donnees.ipynb.
# Résultats : artefacts/classifieur.joblib (utilisé par service.py), artefacts/metriques.json,
#             artefacts/*.png (graphiques pour la soutenance).
#
# Lancer : .venv\Scripts\python.exe entrainer.py
import json
import sqlite3
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
BASE = DOSSIER.parent / 'analyse' / 'cvmatch_donnees.db'
ARTEFACTS = DOSSIER / 'artefacts'
ARTEFACTS.mkdir(exist_ok=True)
CACHE = DONNEES / 'cache_embeddings.joblib'

# Évaluation : on met de côté 30 % des CV et 30 % des offres. Le test ne contient que des paires
# dont le CV ET l'offre sont nouveaux, comme dans l'application. Le test est donc petit :
# on répète le tirage 5 fois et on donne la moyenne ± l'écart-type.
PART_TEST = 0.3
REPETITIONS = 5


# =============================================
# 1. CHARGEMENT (données déjà nettoyées au bloc 1)
# =============================================
if not BASE.exists():
    raise SystemExit(f"{BASE} introuvable : exécutez d'abord le notebook analyse/analyse_donnees.ipynb")

with sqlite3.connect(BASE) as con:
    df = pd.read_sql(
        '''SELECT p.cv_id, p.offre_id, p.etiquette, c.texte AS cv, o.texte AS offre
           FROM paires p JOIN cvs c ON c.id = p.cv_id JOIN offres o ON o.id = p.offre_id''',
        con,
    )
# Même mise en forme que les textes envoyés par l'application à service.py
df['cv'] = df['cv'].map(nettoyer)
df['offre'] = df['offre'].map(nettoyer)
print(f'{len(df)} paires, {df.cv_id.nunique()} CV, {df.offre_id.nunique()} offres')


# =============================================
# 2. EMBEDDINGS (mis en cache : le calcul prend quelques minutes)
# =============================================
cache = joblib.load(CACHE) if CACHE.exists() else {}
if cache.get('version') != VERSION_EMBEDDINGS:
    cache = {'version': VERSION_EMBEDDINGS, 'cv': {}, 'offre': {}}

a_calculer = {role: sorted(set(df[role]) - set(cache[role])) for role in ('cv', 'offre')}
if any(a_calculer.values()):
    modele = charger_modele_embeddings()
    for role, textes in a_calculer.items():
        if textes:
            print(f'Embeddings : {len(textes)} textes ({role})…')
            debut = time.time()
            cache[role].update(zip(textes, encoder(modele, textes, role)))
            print(f'  {time.time() - debut:.0f} s')
    joblib.dump(cache, CACHE)

vec_cv = np.stack([cache['cv'][t] for t in df['cv']])
vec_offre = np.stack([cache['offre'][t] for t in df['offre']])
recouvrement = np.array([recouvrement_mots(c, o) for c, o in zip(df['cv'], df['offre'])])
X = caracteristiques(vec_cv, vec_offre, recouvrement)
y = df['etiquette'].map(ETIQUETTES.index).to_numpy()

# Colonnes de la matrice : 0 = cosinus, dernière = recouvrement de mots-clés
COL_COSINUS, COL_MOTS = [0], [X.shape[1] - 1]


def decoupage(graine):
    """Masques (train, test) : le test n'a que des CV et des offres jamais vus à l'entraînement."""
    hasard = np.random.default_rng(graine)
    cvs, offres = df['cv_id'].unique(), df['offre_id'].unique()
    cvs_test = hasard.choice(cvs, int(len(cvs) * PART_TEST), replace=False)
    offres_test = hasard.choice(offres, int(len(offres) * PART_TEST), replace=False)
    cv_test, offre_test = df['cv_id'].isin(cvs_test), df['offre_id'].isin(offres_test)
    # Les paires « CV vu + offre nouvelle » (ou l'inverse) ne servent ni à l'un ni à l'autre
    return (~cv_test & ~offre_test).to_numpy(), (cv_test & offre_test).to_numpy()



# 3. CHOIX DU CLASSIFIEUR (validation croisée groupée par offre, sur l'entraînement du 1er tirage)

def regression_logistique(c):
    return make_pipeline(StandardScaler(), LogisticRegression(C=c, class_weight='balanced', max_iter=3000))


candidats = {
    'Régression logistique (C=0.01)': lambda: regression_logistique(0.01),
    'Régression logistique (C=0.1)': lambda: regression_logistique(0.1),
    'Régression logistique (C=1)': lambda: regression_logistique(1),
    'Gradient boosting': lambda: HistGradientBoostingClassifier(class_weight='balanced', random_state=0),
}
train0, _ = decoupage(0)
print('\nValidation croisée (F1 macro, 5 plis groupés par offre) :')
resultats_cv = {}
for nom, fabriquer in candidats.items():
    scores = cross_val_score(
        fabriquer(), X[train0], y[train0], cv=GroupKFold(n_splits=5),
        groups=df.loc[train0, 'offre_id'], scoring='f1_macro', n_jobs=2,
    )
    resultats_cv[nom] = {'moyenne': float(scores.mean()), 'ecart_type': float(scores.std())}
    print(f'  {nom:32s} {scores.mean():.3f} ± {scores.std():.3f}')

meilleur_nom = max(resultats_cv, key=lambda n: resultats_cv[n]['moyenne'])
print(f'→ retenu : {meilleur_nom}')


# =============================================
# 4. ÉVALUATION SUR 5 TIRAGES (CV et offres jamais vus)
# =============================================
def precision_top5(test, scores):
    """Pour chaque offre : parmi les 5 CV les mieux notés, quelle part est vraiment « Good Fit » ?"""
    valeurs = []
    for _, groupe in test.assign(score=scores).groupby('offre_id'):
        if (groupe['etiquette'] == 'Good Fit').any() and len(groupe) >= 5:
            top = groupe.nlargest(5, 'score')
            valeurs.append((top['etiquette'] == 'Good Fit').mean())
    return float(np.mean(valeurs)) if valeurs else np.nan


systemes = {
    'Mots-clés (comme match.js)': (lambda: regression_logistique(1), COL_MOTS),
    'Cosinus seul': (lambda: regression_logistique(1), COL_COSINUS),
    'Deep matching': (candidats[meilleur_nom], slice(None)),
}
par_tirage = {nom: [] for nom in systemes}
confusion = np.zeros((3, 3), dtype=int)
tailles = []
for graine in range(REPETITIONS):
    train, test = decoupage(graine)
    tailles.append((int(train.sum()), int(test.sum())))
    for nom, (fabriquer, colonnes) in systemes.items():
        clf = fabriquer().fit(X[train][:, colonnes], y[train])
        probas = clf.predict_proba(X[test][:, colonnes])
        predictions = probas.argmax(axis=1)
        scores = score_sur_100(probas)
        par_tirage[nom].append({
            'exactitude': accuracy_score(y[test], predictions),
            'f1_macro': f1_score(y[test], predictions, average='macro'),
            # Le score 0-100 sépare-t-il bien les « Good Fit » du reste ? (0,5 = hasard, 1 = parfait)
            'auc_good_fit': roc_auc_score(y[test] == 2, scores),
            'precision_top5': precision_top5(df[test], scores),
        })
        if nom == 'Deep matching':
            confusion += confusion_matrix(y[test], predictions, labels=[0, 1, 2])
    print(f"Tirage {graine + 1}/{REPETITIONS} : {tailles[-1][0]} paires d'entraînement, {tailles[-1][1]} de test")

metriques = {
    nom: {
        m: {'moyenne': float(np.nanmean([t[m] for t in tirages])), 'ecart_type': float(np.nanstd([t[m] for t in tirages]))}
        for m in tirages[0]
    }
    for nom, tirages in par_tirage.items()
}
print()
for nom, valeurs in metriques.items():
    print(f'{nom:28s} ' + '  '.join(f'{m} {v["moyenne"]:.3f} ± {v["ecart_type"]:.3f}' for m, v in valeurs.items()))



# 5. MODÈLE FINAL : réentraîné sur TOUTES les paires (l'évaluation est faite)

modele_final = candidats[meilleur_nom]().fit(X, y)
joblib.dump(
    {'classifieur': modele_final, 'modele_embeddings': NOM_MODELE_EMBEDDINGS, 'etiquettes': ETIQUETTES},
    ARTEFACTS / 'classifieur.joblib',
)

with open(ARTEFACTS / 'metriques.json', 'w', encoding='utf-8') as f:
    json.dump(
        {
            'modele_embeddings': VERSION_EMBEDDINGS,
            'classifieur_retenu': meilleur_nom,
            'donnees': f'{BASE.name} (nettoyées au bloc 1) : {len(df)} paires',
            'evaluation': f"{REPETITIONS} tirages ; test = paires dont le CV et l'offre sont nouveaux "
                          f'({int(PART_TEST * 100)} % des CV et des offres mis de côté)',
            'paires_entrainement_test_par_tirage': tailles,
            'validation_croisee': resultats_cv,
            'test': metriques,
            'matrice_confusion_deep_matching_cumulee': confusion.tolist(),
        },
        f,
        ensure_ascii=False,
        indent=2,
    )



# 6. GRAPHIQUES

# Matrice de confusion du modèle retenu (somme des 5 tirages)
fig, ax = plt.subplots(figsize=(6, 5))
ConfusionMatrixDisplay(confusion, display_labels=ETIQUETTES).plot(cmap='Reds', ax=ax, colorbar=False)
ax.set_title(f'Deep matching — matrice de confusion\n(test, {REPETITIONS} tirages cumulés)')
ax.set_xlabel('Prédit')
ax.set_ylabel('Réel')
fig.tight_layout()
fig.savefig(ARTEFACTS / 'matrice_confusion.png', dpi=150)

# Comparaison des trois méthodes, avec l'écart-type entre tirages
noms_metriques = {'f1_macro': 'F1 macro', 'auc_good_fit': 'AUC « Good Fit »', 'precision_top5': 'Précision top 5'}
x = np.arange(len(noms_metriques))
largeur = 0.27
couleurs = ['#C9B8B0', '#A8C5D6', '#8C3B2E']  # gris, bleu poudré, rouge brique de l'application
fig, ax = plt.subplots(figsize=(8, 4.5))
for i, (nom, valeurs) in enumerate(metriques.items()):
    barres = ax.bar(
        x + (i - 1) * largeur, [valeurs[k]['moyenne'] for k in noms_metriques], largeur, label=nom, color=couleurs[i],
        yerr=[valeurs[k]['ecart_type'] for k in noms_metriques], capsize=3, error_kw={'ecolor': '#52514e', 'lw': 1},
    )
    ax.bar_label(barres, fmt='%.2f', fontsize=8, padding=6)
ax.set_xticks(x, noms_metriques.values())
ax.set_ylim(0, 1)
ax.set_title('Mots-clés vs deep matching (CV et offres jamais vus, 5 tirages)')
ax.legend(loc='upper left', fontsize=8)
ax.spines[['top', 'right']].set_visible(False)
fig.tight_layout()
fig.savefig(ARTEFACTS / 'comparaison.png', dpi=150)

print(f'\nArtefacts enregistrés dans {ARTEFACTS}')
