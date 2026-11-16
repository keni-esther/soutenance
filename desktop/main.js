// main.js — CVMatch IA, version ordinateur (Electron)
// Le logiciel affiche dans une fenêtre Windows le site exporté de l'app (dossier app-web).
// Les données (comptes, offres, CV…) passent par l'API en ligne (Railway), comme sur le téléphone.
const { app, BrowserWindow, Menu, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const SITE_WEB = 'https://cvmatchia.netlify.app';
const API = 'https://soutenance-production-5bbf.up.railway.app'; // seule adresse que la page peut contacter
const DOSSIER_WEB = path.join(__dirname, 'app-web');
const PAGE_HORS_LIGNE = path.join(__dirname, 'hors-ligne.html');
const ADRESSE_DEPART = 'app://cvmatch/connexion';

// =============================================
// INSTALLATION WINDOWS (Squirrel) : raccourcis Bureau / menu Démarrer
// L'installateur relance le logiciel avec --squirrel-… : on crée ou supprime les raccourcis puis on quitte.
// =============================================
function gererInstallation() {
  const commande = process.argv[1];
  if (process.platform !== 'win32' || !commande || !commande.startsWith('--squirrel-')) return false;
  const update = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const exe = path.basename(process.execPath);
  const lancer = (args) => spawn(update, args, { detached: true }).on('close', () => app.quit());
  if (commande === '--squirrel-install' || commande === '--squirrel-updated') {
    lancer([`--createShortcut=${exe}`]);
  } else if (commande === '--squirrel-uninstall') {
    lancer([`--removeShortcut=${exe}`]);
  } else {
    app.quit();
  }
  return true;
}
if (gererInstallation()) return;

// Une seule fenêtre : si on relance le logiciel, on remet la fenêtre existante au premier plan
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// =============================================
// MÉMORISER LA TAILLE ET LA POSITION DE LA FENÊTRE (fichier JSON)
// Fichier : %APPDATA%\CVMatch IA\fenetre.json
// =============================================
const FICHIER_FENETRE = () => path.join(app.getPath('userData'), 'fenetre.json');

function lireFenetre() {
  try {
    return JSON.parse(fs.readFileSync(FICHIER_FENETRE(), 'utf8'));
  } catch {
    return { width: 1280, height: 800 }; // premier lancement ou fichier abîmé
  }
}

function enregistrerFenetre(fenetre) {
  try {
    const etat = { ...fenetre.getNormalBounds(), agrandie: fenetre.isMaximized() };
    fs.writeFileSync(FICHIER_FENETRE(), JSON.stringify(etat));
  } catch (err) {
    console.error('Impossible d\'enregistrer la fenêtre :', err.message);
  }
}

// =============================================
// SERVIR LES ÉCRANS DE L'APP : adresses app://cvmatch/…
// /connexion → app-web/connexion.html, /candidat/offres → app-web/candidat/offres.html, etc.
// =============================================
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function fichierDemande(chemin) {
  const relatif = decodeURIComponent(chemin).replace(/^\/+/, '');
  const complet = path.normalize(path.join(DOSSIER_WEB, relatif));
  // Sécurité : interdit de sortir du dossier app-web (ex. /../../Windows)
  if (complet !== DOSSIER_WEB && !complet.startsWith(DOSSIER_WEB + path.sep)) return null;

  const essais = path.extname(complet)
    ? [complet]
    : [complet + '.html', path.join(complet, 'index.html')];
  return essais.find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) || null;
}

function servirApp() {
  protocol.handle('app', async (requete) => {
    const { pathname } = new URL(requete.url);
    const estUnePage = !path.extname(pathname);

    // Pas d'Internet : on affiche la page « Pas de connexion » au lieu d'un écran qui ne marchera pas
    if (estUnePage && !net.isOnline()) {
      return net.fetch(pathToFileURL(PAGE_HORS_LIGNE).toString());
    }

    const fichier = fichierDemande(pathname) || (estUnePage ? fichierDemande('/+not-found') : null);
    if (!fichier) return new Response('Introuvable', { status: 404 });
    const reponse = await net.fetch(pathToFileURL(fichier).toString());
    if (!fichier.endsWith('.html')) return reponse;

    // Pages : on ajoute la politique de sécurité (CSP)
    const entetes = new Headers(reponse.headers);
    entetes.set('Content-Security-Policy', CSP);
    return new Response(reponse.body, { status: reponse.status, headers: entetes });
  });
}

// Politique de sécurité du contenu : la page ne peut charger que ses propres fichiers
// et ne peut contacter que l'API CVMatch IA (Railway)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // petit script de démarrage intégré par Expo
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${API}`,
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

// =============================================
// MENUS WINDOWS
// =============================================
function creerMenu(fenetre) {
  const modele = [
    {
      label: 'Fichier',
      submenu: [
        { label: 'Accueil (connexion)', accelerator: 'Ctrl+H', click: () => fenetre.loadURL(ADRESSE_DEPART) },
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Recharger', role: 'reload' },
        { type: 'separator' },
        { label: 'Zoom avant', role: 'zoomIn' },
        { label: 'Zoom arrière', role: 'zoomOut' },
        { label: 'Taille normale', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
        // Outils de développement seulement pendant le développement, pas dans l'installateur
        ...(app.isPackaged ? [] : [{ label: 'Outils de développement', role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'Ouvrir la version web', click: () => shell.openExternal(SITE_WEB) },
        { type: 'separator' },
        {
          label: 'À propos de CVMatch IA',
          click: () =>
            dialog.showMessageBox(fenetre, {
              type: 'info',
              title: 'À propos',
              message: `CVMatch IA — version ${app.getVersion()}`,
              detail:
                "Plateforme de recrutement assistée par l'intelligence artificielle.\n" +
                'Résumé des CV, score de compatibilité CV / offre, assistant du recruteur.\n\n' +
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(modele));
}

// =============================================
// FENÊTRE PRINCIPALE
// =============================================
function creerFenetre() {
  const etat = lireFenetre();
  const fenetre = new BrowserWindow({
    x: etat.x,
    y: etat.y,
    width: etat.width,
    height: etat.height,
    minWidth: 1000, // au-dessus de 900 px : l'app affiche sa version ordinateur (menu latéral)
    minHeight: 650,
    title: 'CVMatch IA',
    icon: path.join(__dirname, 'icone.ico'),
    backgroundColor: '#FDF6EC', // crème, comme l'app : pas d'éclair blanc au démarrage
    show: false,
    webPreferences: {
      // Sécurité : la page n'a aucun accès à Windows ni à Node.js
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (etat.agrandie) fenetre.maximize();
  fenetre.once('ready-to-show', () => fenetre.show());
  fenetre.on('close', () => enregistrerFenetre(fenetre));

  // Liens externes (site, e-mail…) : ouverts dans le navigateur / la messagerie, pas dans le logiciel
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', (evenement, url) => {
    if (!url.startsWith('app://')) {
      evenement.preventDefault();
      if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    }
  });

  creerMenu(fenetre);
  fenetre.loadURL(ADRESSE_DEPART);
  return fenetre;
}

app.on('second-instance', () => {
  const [fenetre] = BrowserWindow.getAllWindows();
  if (fenetre) {
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.focus();
  }
});

app.whenReady().then(() => {
  if (!fs.existsSync(DOSSIER_WEB)) {
    dialog.showErrorBox('CVMatch IA', 'Les écrans de l\'application sont introuvables (dossier app-web). Lancez « npm run copier-web ».');
    app.quit();
    return;
  }
  servirApp();
  creerFenetre();
});

app.on('window-all-closed', () => app.quit());
