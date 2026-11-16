// forge.config.js — réglages d'Electron Forge (outil officiel) pour fabriquer l'installateur Windows
const path = require('path');

module.exports = {
  packagerConfig: {
    name: 'CVMatch IA',
    executableName: 'CVMatchIA',
    icon: path.join(__dirname, 'icone'), // icone.ico
    asar: true, // fichiers de l'app regroupés en une seule archive
  },
  makers: [
    {
      // Installateur Windows : CVMatchIA-Setup.exe (raccourcis Bureau + menu Démarrer)
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'CVMatchIA',
        setupExe: 'CVMatchIA-Setup.exe',
        setupIcon: path.join(__dirname, 'icone.ico'),
      },
    },
  ],
};
