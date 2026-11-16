// copier-web.js — copie le site exporté (cvmatchIA/dist) dans desktop/app-web
// Le logiciel embarque ainsi ses écrans : il démarre même si Netlify ne répond pas.
// Avant : dans cvmatchIA, lancer `npm run export:web`.
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'cvmatchIA', 'dist');
const cible = path.join(__dirname, 'app-web');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  console.error('cvmatchIA/dist introuvable : lancez d\'abord « npm run export:web » dans cvmatchIA.');
  process.exit(1);
}
fs.rmSync(cible, { recursive: true, force: true });
fs.cpSync(source, cible, { recursive: true });
console.log('Site copié dans desktop/app-web.');
