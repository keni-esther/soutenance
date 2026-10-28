// candidats.js — requêtes sur les candidats, partagées par les routes recruteur et l'agent IA
const db = require('../db');
const { envoyerMessageCandidat } = require('./mail');

// Un candidat est visible s'il a déposé un CV et renseigné son métier.
// Si son résumé IA est validé, ce sont ces infos qui sont affichées en priorité.
const SELECT_CANDIDAT = `
  SELECT
    u.id,
    p.nom,
    COALESCE(IF(r.valide, r.metier, NULL), p.metier) AS metier,
    COALESCE(IF(r.valide, r.ville, NULL), p.ville) AS ville,
    COALESCE(IF(r.valide, r.annees_experience, NULL), p.annees_experience) AS annees_experience,
    IF(r.valide, r.competences, NULL) AS competences_ia,
    p.competences AS competences_saisies,
    IF(r.valide, r.resume_complet, NULL) AS resume_complet,
    COALESCE(r.valide, FALSE) AS resume_valide,
    s.statut
  FROM utilisateurs u
  JOIN profils_candidats p ON p.utilisateur_id = u.id
  JOIN cvs c ON c.utilisateur_id = u.id
  LEFT JOIN resumes r ON r.utilisateur_id = u.id
  LEFT JOIN suivi_candidats s ON s.candidat_id = u.id AND s.recruteur_id = ?
  WHERE u.role = 'candidat' AND u.verifie = TRUE AND p.metier IS NOT NULL AND p.metier <> ''`;

// Met les compétences sous une seule forme : un tableau de textes
function formaterCandidat(ligne) {
  const { competences_ia, competences_saisies, ...reste } = ligne;
  let competences = [];
  if (competences_ia) {
    competences = typeof competences_ia === 'string' ? JSON.parse(competences_ia) : competences_ia;
  } else if (competences_saisies) {
    competences = competences_saisies.split(',').map((c) => c.trim()).filter(Boolean);
  }
  return { ...reste, resume_valide: Boolean(reste.resume_valide), competences };
}

// Recherche : "q" cherche dans le métier, les compétences et le résumé
async function rechercherCandidats(recruteurId, { q = '', ville = '' } = {}) {
  let sql = SELECT_CANDIDAT;
  const params = [recruteurId];

  if (q) {
    sql += ` AND (p.metier LIKE ? OR p.competences LIKE ? OR r.metier LIKE ?
                  OR CAST(r.competences AS CHAR) LIKE ? OR r.resume_complet LIKE ?)`;
    params.push(...Array(5).fill(`%${q}%`));
  }
  if (ville) {
    sql += ' AND (p.ville LIKE ? OR r.ville LIKE ?)';
    params.push(`%${ville}%`, `%${ville}%`);
  }
  // Les profils validés par l'IA d'abord, puis les plus expérimentés
  sql += ' ORDER BY resume_valide DESC, annees_experience DESC, p.nom LIMIT 50';

  const [lignes] = await db.query(sql, params);
  return lignes.map(formaterCandidat);
}

// Charge un candidat visible, ou null
async function candidatVisible(recruteurId, candidatId) {
  const [[ligne]] = await db.query(`${SELECT_CANDIDAT} AND u.id = ?`, [recruteurId, candidatId]);
  return ligne ? formaterCandidat(ligne) : null;
}

// Enregistre un candidat dans le suivi (un candidat déjà contacté reste "contacté")
async function enregistrerCandidat(recruteurId, candidatId) {
  await db.query(
    `INSERT INTO suivi_candidats (recruteur_id, candidat_id, statut) VALUES (?, ?, 'enregistre')
     ON DUPLICATE KEY UPDATE statut = statut`,
    [recruteurId, candidatId]
  );
}

// Envoie l'e-mail au candidat et le passe en "contacté" ; renvoie son adresse
async function contacterCandidat(recruteurId, candidat, message) {
  const [[{ email: emailCandidat }]] = await db.query('SELECT email FROM utilisateurs WHERE id = ?', [
    candidat.id,
  ]);
  const [[recruteur]] = await db.query(
    `SELECT r.entreprise, r.telephone, u.email FROM profils_recruteurs r
     JOIN utilisateurs u ON u.id = r.utilisateur_id WHERE r.utilisateur_id = ?`,
    [recruteurId]
  );

  await envoyerMessageCandidat({ emailCandidat, nomCandidat: candidat.nom, recruteur, message });

  await db.query(
    `INSERT INTO suivi_candidats (recruteur_id, candidat_id, statut, message) VALUES (?, ?, 'contacte', ?)
     ON DUPLICATE KEY UPDATE statut = 'contacte', message = VALUES(message)`,
    [recruteurId, candidat.id, message]
  );
  return emailCandidat;
}

module.exports = {
  SELECT_CANDIDAT,
  formaterCandidat,
  rechercherCandidats,
  candidatVisible,
  enregistrerCandidat,
  contacterCandidat,
};
