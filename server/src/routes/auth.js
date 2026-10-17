// routes/auth.js — inscription, connexion, vérification OTP
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { creerToken } = require('../auth');
const { envoyerCodeOTP } = require('../services/mail');

const router = express.Router();
const DUREE_OTP_MINUTES = 10;

// Crée un nouveau code à 6 chiffres, l'enregistre et l'envoie par e-mail
async function nouveauCode(utilisateurId, email) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.query(
    `REPLACE INTO codes_otp (utilisateur_id, code, expire_le)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [utilisateurId, code, DUREE_OTP_MINUTES]
  );
  await envoyerCodeOTP(email, code);
}

// Données renvoyées à l'application après connexion
async function infosUtilisateur(id) {
  const [[u]] = await db.query(
    `SELECT u.id, u.email, u.role, c.nom, r.entreprise, r.secteur
     FROM utilisateurs u
     LEFT JOIN profils_candidats c ON c.utilisateur_id = u.id
     LEFT JOIN profils_recruteurs r ON r.utilisateur_id = u.id
     WHERE u.id = ?`,
    [id]
  );
  return u;
}

// POST /api/auth/inscription
router.post('/inscription', async (req, res) => {
  const { email, mot_de_passe, role, nom, entreprise, secteur } = req.body;

  if (!email || !mot_de_passe || !['candidat', 'recruteur'].includes(role)) {
    return res.status(400).json({ erreur: 'Remplissez tous les champs.' });
  }
  if (role === 'candidat' && !nom) {
    return res.status(400).json({ erreur: 'Le nom est obligatoire.' });
  }
  if (role === 'recruteur' && (!entreprise || !secteur)) {
    return res.status(400).json({ erreur: "L'entreprise et le secteur sont obligatoires." });
  }
  if (mot_de_passe.length < 6) {
    return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  const [existants] = await db.query('SELECT id FROM utilisateurs WHERE email = ?', [email]);
  if (existants.length > 0) {
    return res.status(409).json({ erreur: 'Un compte existe déjà avec cet e-mail.' });
  }

  const hash = await bcrypt.hash(mot_de_passe, 10);
  const [resultat] = await db.query(
    'INSERT INTO utilisateurs (email, mot_de_passe, role) VALUES (?, ?, ?)',
    [email, hash, role]
  );
  const userId = resultat.insertId;

  if (role === 'candidat') {
    await db.query('INSERT INTO profils_candidats (utilisateur_id, nom) VALUES (?, ?)', [userId, nom]);
  } else {
    await db.query(
      'INSERT INTO profils_recruteurs (utilisateur_id, entreprise, secteur) VALUES (?, ?, ?)',
      [userId, entreprise, secteur]
    );
  }

  await nouveauCode(userId, email);
  res.status(201).json({ message: 'Compte créé ! Un code vous a été envoyé par e-mail.', userId });
});

// POST /api/auth/connexion
router.post('/connexion', async (req, res) => {
  const { email, mot_de_passe, role } = req.body;
  if (!email || !mot_de_passe) {
    return res.status(400).json({ erreur: 'Remplissez tous les champs.' });
  }

  const [[u]] = await db.query('SELECT * FROM utilisateurs WHERE email = ?', [email]);
  if (!u || !(await bcrypt.compare(mot_de_passe, u.mot_de_passe))) {
    return res.status(401).json({ erreur: 'E-mail ou mot de passe incorrect.' });
  }

  // Le rôle choisi sur l'écran de connexion doit correspondre au compte
  if (role && role !== u.role) {
    return res.status(403).json({
      erreur: `Ce compte est un compte ${u.role}. Sélectionnez « ${u.role === 'candidat' ? 'Candidat' : 'Recruteur'} » pour vous connecter.`,
    });
  }

  // Compte pas encore vérifié : on renvoie un code et l'app ouvre l'écran OTP
  if (!u.verifie) {
    await nouveauCode(u.id, u.email);
    return res.json({ verifie: false, userId: u.id });
  }

  res.json({ token: creerToken(u), utilisateur: await infosUtilisateur(u.id) });
});

// POST /api/auth/verifier-otp
router.post('/verifier-otp', async (req, res) => {
  const { userId, code } = req.body;

  const [[otp]] = await db.query(
    'SELECT code, expire_le < NOW() AS expire FROM codes_otp WHERE utilisateur_id = ?',
    [userId]
  );
  if (!otp || otp.code !== String(code)) {
    return res.status(400).json({ erreur: 'Code incorrect.' });
  }
  if (otp.expire) {
    return res.status(400).json({ erreur: 'Code expiré, demandez-en un nouveau.' });
  }

  await db.query('UPDATE utilisateurs SET verifie = TRUE WHERE id = ?', [userId]);
  await db.query('DELETE FROM codes_otp WHERE utilisateur_id = ?', [userId]);

  const utilisateur = await infosUtilisateur(userId);
  res.json({ token: creerToken(utilisateur), utilisateur });
});

// POST /api/auth/renvoyer-otp
router.post('/renvoyer-otp', async (req, res) => {
  const { userId } = req.body;
  const [[u]] = await db.query('SELECT id, email, verifie FROM utilisateurs WHERE id = ?', [userId]);
  if (!u) {
    return res.status(404).json({ erreur: 'Compte introuvable.' });
  }
  if (u.verifie) {
    return res.status(400).json({ erreur: 'Ce compte est déjà vérifié.' });
  }
  await nouveauCode(u.id, u.email);
  res.json({ message: 'Un nouveau code vous a été envoyé.' });
});

module.exports = router;
