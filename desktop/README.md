# CVMatch IA : version ordinateur (Windows)

Logiciel installable sur Windows, fait avec **Electron 45** (fenêtre, menus) et **Electron Forge 8** (outil officiel, fabrique l'installateur).
Il affiche les écrans de l'app (le site exporté de `cvmatchIA/`) dans une fenêtre. Les données passent par l'API en ligne (Railway), comme pour l'APK et le site web : **il faut Internet**.

## Installer (utilisateur)

1. Lancer `CVMatchIA-Setup.exe`. L'installation se fait seule, puis le logiciel s'ouvre.
2. Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires → Exécuter quand même**. Le logiciel n'est pas signé (un certificat de signature est payant).
3. Raccourcis créés sur le Bureau et dans le menu Démarrer. Pour désinstaller : Paramètres → Applications → CVMatch IA.

## Ce que fait le logiciel (`main.js`)

| Fonction | Détail |
|---|---|
| Fenêtre | 1280 × 800 au départ, 1000 px minimum : l'app s'affiche toujours en version ordinateur (menu latéral) |
| Écrans embarqués | Copie du site dans `app-web/`, servie à l'adresse `app://cvmatch/…` : le logiciel démarre même si Netlify ne répond pas |
| Menus | Fichier (Accueil, Quitter), Affichage (Recharger, zoom, plein écran), Aide (version web, À propos) |
| Fichier | Taille et position de la fenêtre mémorisées dans `%APPDATA%\CVMatch IA\fenetre.json` |
| Hors ligne | Page « Pas de connexion Internet » avec un bouton Réessayer (`hors-ligne.html`) |
| Sécurité | Page isolée de Windows (`contextIsolation`, `sandbox`, pas de `nodeIntegration`) ; politique de sécurité (CSP) : la page ne peut contacter que l'API CVMatch IA ; liens externes ouverts dans le navigateur ; une seule fenêtre à la fois |
| Installation | Raccourcis créés et supprimés par l'installateur (Squirrel) |

## Développer et refaire l'installateur

```bash
# 1. Exporter le site (dans cvmatchIA/)
npm run export:web

# 2. Dans desktop/
npm install          # la première fois
npm start            # lancer le logiciel sans l'installer
npm run make         # fabriquer l'installateur → out/make/squirrel.windows/x64/CVMatchIA-Setup.exe
```

`npm start` et `npm run make` copient d'abord `cvmatchIA/dist` dans `app-web/` (`copier-web.js`).
