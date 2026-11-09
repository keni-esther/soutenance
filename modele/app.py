# app.py — lance le service du modèle dans un Space Hugging Face (SDK Gradio, gratuit).
# - /scores et /sante : les mêmes adresses que service.py, appelées par l'API Node (MODELE_URL)
# - / : une petite page pour essayer le modèle à la main (pratique pour la démo au jury)
#
# En local : .venv\Scripts\python.exe app.py  → http://127.0.0.1:7860
try:
    # Space gratuit = matériel ZeroGPU : il faut importer `spaces` avant torch et déclarer
    # au moins une fonction GPU. Le modèle, lui, reste sur le processeur (assez rapide).
    import spaces

    @spaces.GPU
    def _gpu_inutilise():
        pass
except ImportError:  # sur l'ordinateur, `spaces` n'est pas installé
    pass

import gradio as gr

from service import Demande, Paire, app, scores


def tester(cv, offre):
    resultat = scores(Demande(paires=[Paire(cv=cv, offre=offre)]))['scores'][0]
    return f"{resultat['score']} / 100 ({resultat['etiquette']})"


demo = gr.Interface(
    fn=tester,
    inputs=[gr.Textbox(label='CV du candidat', lines=8), gr.Textbox(label="Texte de l'offre", lines=8)],
    outputs=gr.Textbox(label='Compatibilité'),
    title='CVMatch IA : deep matching CV ↔ offre',
    description='Score calculé par le modèle entraîné (embeddings multilingual-e5-small + régression logistique).',
    flagging_mode='never',
)

if __name__ == '__main__':
    # Sur ZeroGPU, c'est Gradio qui doit lancer le serveur (port 7860) : on ajoute ensuite
    # /scores et /sante de service.py en tête de ses routes, puis on attend les requêtes.
    # ssr_mode=False : sinon, sur Hugging Face, un serveur d'affichage passe devant et répond
    # par la page web à /scores et /sante.
    demo.launch(prevent_thread_lock=True, ssr_mode=False)
    demo.app.router.routes[:0] = [r for r in app.routes if getattr(r, 'path', '') in ('/scores', '/sante')]
    demo.block_thread()
