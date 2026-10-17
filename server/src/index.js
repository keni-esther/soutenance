// index.js — point d'entrée du serveur CVMatch IA
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ message: 'API CVMatch IA en ligne' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/candidat', require('./routes/candidat'));
app.use('/api/recruteur', require('./routes/recruteur'));

// Toute erreur non prévue renvoie un message propre à l'application
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ erreur: 'Fichier trop volumineux (10 Mo maximum).' });
  }
  if (err.status === 400) {
    return res.status(400).json({ erreur: err.message });
  }
  res.status(500).json({ erreur: 'Erreur interne du serveur.' });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur CVMatch IA démarré sur http://localhost:${PORT}`);
});
