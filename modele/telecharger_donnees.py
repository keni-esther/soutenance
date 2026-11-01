# telecharger_donnees.py — récupère le jeu public « resume-job-description-fit » (Hugging Face)
# dans donnees/ : 8 000 paires CV ↔ offre étiquetées No Fit / Potential Fit / Good Fit.
#
# Lancer : .venv\Scripts\python.exe telecharger_donnees.py
from pathlib import Path
from urllib.request import urlretrieve

SOURCE = 'https://huggingface.co/datasets/cnamuangtoun/resume-job-description-fit/resolve/main/'
DONNEES = Path(__file__).parent / 'donnees'
DONNEES.mkdir(exist_ok=True)

for nom in ('train.csv', 'test.csv'):
    destination = DONNEES / nom
    if destination.exists():
        print(f'{nom} déjà présent')
        continue
    print(f'Téléchargement de {nom}…')
    urlretrieve(SOURCE + nom, destination)
    print(f'  {destination.stat().st_size // 1_000_000} Mo')
