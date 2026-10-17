// auth.js — création et vérification du jeton de connexion (JWT)
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'secret-de-developpement';

function creerToken(utilisateur) {
  return jwt.sign({ id: utilisateur.id, role: utilisateur.role }, SECRET, { expiresIn: '7d' });
}

// Middleware : refuse la requête si le header "Authorization: Bearer <token>" est absent ou invalide
function exigerConnexion(req, res, next) {
  const [type, token] = (req.headers.authorization || '').split(' ');
  if (type !== 'Bearer' || !token) {
    return res.status(401).json({ erreur: 'Vous devez être connecté.' });
  }
  try {
    req.utilisateur = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ erreur: 'Session expirée, reconnectez-vous.' });
  }
}

// Middleware : limite une route à un rôle (candidat ou recruteur)
function exigerRole(role) {
  return (req, res, next) => {
    if (req.utilisateur.role !== role) {
      return res.status(403).json({ erreur: 'Accès refusé.' });
    }
    next();
  };
}

module.exports = { creerToken, exigerConnexion, exigerRole };
