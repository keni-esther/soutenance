// routes/recruteur.js — phase 5 : profil entreprise, recherche de candidats, suivi
const express = require('express');
const db = require('../db');
const { exigerConnexion, exigerRole } = require('../auth');
const { envoyerReponseCandidature } = require('../services/mail');
const { scoreCompatibilite } = require('../services/match');
const {
  SELECT_CANDIDAT,
  formaterCandidat,
  rechercherCandidats,
  candidatVisible,
  enregistrerCandidat,
  contacterCandidat,
} = require('../services/candidats');
const agent = require('../services/agent');

const router = express.Router();
router.use(exigerConnexion, exigerRole('recruteur'));

// =============================================
// PROFIL ENTREPRISE
// =============================================

// GET /api/recruteur/profil
router.get('/profil', async (req, res) => {
  const [[profil]] = await db.query(
    `SELECT r.*, u.email FROM profils_recruteurs r
     JOIN utilisateurs u ON u.id = r.utilisateur_id
     WHERE r.utilisateur_id = ?`,
    [req.utilisateur.id]
  );
  res.json({ profil: profil || null });
});

// PUT /api/recruteur/profil
router.put('/profil', async (req, res) => {
  const { entreprise, secteur, ville, telephone, description } = req.body;
  if (!entreprise || !secteur) {
    return res.status(400).json({ erreur: "L'entreprise et le secteur sont obligatoires." });
  }
  await db.query(
    `UPDATE profils_recruteurs
     SET entreprise = ?, secteur = ?, ville = ?, telephone = ?, description = ?
     WHERE utilisateur_id = ?`,
    [entreprise, secteur, ville || null, telephone || null, description || null, req.utilisateur.id]
  );
  res.json({ message: 'Profil mis à jour.' });
});

// =============================================
// RECHERCHE DE CANDIDATS
// =============================================

// GET /api/recruteur/candidats?q=mécanicien&ville=Marcory
// "q" cherche dans le métier, les compétences et le résumé
router.get('/candidats', async (req, res) => {
  const candidats = await rechercherCandidats(req.utilisateur.id, {
    q: (req.query.q || '').trim(),
    ville: (req.query.ville || '').trim(),
  });
  res.json({ candidats });
});

// GET /api/recruteur/candidats/:id — fiche détaillée
router.get('/candidats/:id', async (req, res) => {
  const candidat = await candidatVisible(req.utilisateur.id, req.params.id);
  if (!candidat) {
    return res.status(404).json({ erreur: 'Candidat introuvable.' });
  }
  // L'e-mail du candidat n'est montré qu'après l'avoir contacté
  if (candidat.statut === 'contacte') {
    const [[u]] = await db.query('SELECT email FROM utilisateurs WHERE id = ?', [candidat.id]);
    candidat.email = u.email;
  }
  res.json({ candidat });
});

// =============================================
// SUIVI : ENREGISTRER / CONTACTER
// =============================================

// POST /api/recruteur/candidats/:id/enregistrer
router.post('/candidats/:id/enregistrer', async (req, res) => {
  if (!(await candidatVisible(req.utilisateur.id, req.params.id))) {
    return res.status(404).json({ erreur: 'Candidat introuvable.' });
  }
  await enregistrerCandidat(req.utilisateur.id, req.params.id);
  res.json({ message: 'Candidat enregistré.' });
});

// DELETE /api/recruteur/candidats/:id/enregistrer — retire de la liste
router.delete('/candidats/:id/enregistrer', async (req, res) => {
  await db.query(
    "DELETE FROM suivi_candidats WHERE recruteur_id = ? AND candidat_id = ? AND statut = 'enregistre'",
    [req.utilisateur.id, req.params.id]
  );
  res.json({ message: 'Candidat retiré.' });
});

// POST /api/recruteur/candidats/:id/contacter  { message }
router.post('/candidats/:id/contacter', async (req, res) => {
  const message = (req.body.message || '').trim();
  if (message.length < 10) {
    return res.status(400).json({ erreur: 'Écrivez un message d’au moins 10 caractères.' });
  }

  const candidat = await candidatVisible(req.utilisateur.id, req.params.id);
  if (!candidat) {
    return res.status(404).json({ erreur: 'Candidat introuvable.' });
  }

  const emailCandidat = await contacterCandidat(req.utilisateur.id, candidat, message);
  res.json({ message: 'Message envoyé au candidat !', email: emailCandidat });
});

// GET /api/recruteur/suivi — listes "enregistrés" et "contactés"
router.get('/suivi', async (req, res) => {
  const [lignes] = await db.query(
    `${SELECT_CANDIDAT} AND s.statut IS NOT NULL ORDER BY s.mis_a_jour_le DESC`,
    [req.utilisateur.id]
  );
  const candidats = lignes.map(formaterCandidat);
  res.json({
    enregistres: candidats.filter((c) => c.statut === 'enregistre'),
    contactes: candidats.filter((c) => c.statut === 'contacte'),
  });
});

// =============================================
// OFFRES D'EMPLOI (phase 6)
// =============================================

const TYPES_CONTRAT = ['CDI', 'CDD', 'Stage', 'Freelance', 'Journalier'];

// Vérifie les champs d'une offre ; renvoie un message d'erreur ou null
function erreurOffre({ titre, metier, ville, type_contrat, description }) {
  if (!titre || !metier || !ville || !description) {
    return 'Titre, métier, ville et description sont obligatoires.';
  }
  if (!TYPES_CONTRAT.includes(type_contrat)) {
    return 'Type de contrat invalide.';
  }
  return null;
}

// Charge une offre du recruteur connecté, ou null
async function offreDuRecruteur(recruteurId, offreId) {
  const [[offre]] = await db.query('SELECT * FROM offres WHERE id = ? AND recruteur_id = ?', [offreId, recruteurId]);
  return offre || null;
}

// GET /api/recruteur/offres — mes offres + nombre de candidatures
router.get('/offres', async (req, res) => {
  const [offres] = await db.query(
    `SELECT o.*,
       COUNT(c.id) AS nb_candidatures,
       SUM(c.statut = 'envoyee') AS nb_nouvelles
     FROM offres o
     LEFT JOIN candidatures c ON c.offre_id = o.id
     WHERE o.recruteur_id = ?
     GROUP BY o.id
     ORDER BY o.active DESC, o.cree_le DESC`,
    [req.utilisateur.id]
  );
  res.json({
    offres: offres.map((o) => ({
      ...o,
      active: Boolean(o.active),
      nb_candidatures: Number(o.nb_candidatures),
      nb_nouvelles: Number(o.nb_nouvelles || 0),
    })),
  });
});

// POST /api/recruteur/offres — publier une offre
router.post('/offres', async (req, res) => {
  const erreur = erreurOffre(req.body);
  if (erreur) return res.status(400).json({ erreur });

  const { titre, metier, ville, type_contrat, salaire, competences, description } = req.body;
  const [resultat] = await db.query(
    `INSERT INTO offres (recruteur_id, titre, metier, ville, type_contrat, salaire, competences, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.utilisateur.id, titre, metier, ville, type_contrat, salaire || null, competences || null, description]
  );
  res.status(201).json({ message: 'Offre publiée !', id: resultat.insertId });
});

// PUT /api/recruteur/offres/:id — modifier une offre (ou seulement l'activer / la désactiver)
router.put('/offres/:id', async (req, res) => {
  const offre = await offreDuRecruteur(req.utilisateur.id, req.params.id);
  if (!offre) return res.status(404).json({ erreur: 'Offre introuvable.' });

  // Mise à jour partielle : les champs absents gardent leur valeur
  const nouvelle = { ...offre, ...req.body };
  const erreur = erreurOffre(nouvelle);
  if (erreur) return res.status(400).json({ erreur });

  await db.query(
    `UPDATE offres SET titre = ?, metier = ?, ville = ?, type_contrat = ?, salaire = ?,
       competences = ?, description = ?, active = ?
     WHERE id = ?`,
    [
      nouvelle.titre, nouvelle.metier, nouvelle.ville, nouvelle.type_contrat, nouvelle.salaire || null,
      nouvelle.competences || null, nouvelle.description, Boolean(nouvelle.active), offre.id,
    ]
  );
  res.json({ message: 'Offre mise à jour.' });
});

// DELETE /api/recruteur/offres/:id
router.delete('/offres/:id', async (req, res) => {
  const [resultat] = await db.query('DELETE FROM offres WHERE id = ? AND recruteur_id = ?', [
    req.params.id,
    req.utilisateur.id,
  ]);
  if (resultat.affectedRows === 0) return res.status(404).json({ erreur: 'Offre introuvable.' });
  res.json({ message: 'Offre supprimée.' });
});

// GET /api/recruteur/offres/:id/candidatures — qui a postulé, triés par compatibilité
router.get('/offres/:id/candidatures', async (req, res) => {
  const offre = await offreDuRecruteur(req.utilisateur.id, req.params.id);
  if (!offre) return res.status(404).json({ erreur: 'Offre introuvable.' });

  const [candidatures] = await db.query('SELECT * FROM candidatures WHERE offre_id = ?', [offre.id]);
  if (candidatures.length === 0) return res.json({ offre, candidatures: [] });

  const [lignes] = await db.query(`${SELECT_CANDIDAT} AND u.id IN (?)`, [
    req.utilisateur.id,
    candidatures.map((c) => c.candidat_id),
  ]);
  const candidats = new Map(lignes.map((l) => [l.id, formaterCandidat(l)]));

  const resultat = candidatures
    .filter((c) => candidats.has(c.candidat_id))
    .map((c) => {
      const candidat = candidats.get(c.candidat_id);
      return {
        id: c.id,
        message: c.message,
        statut: c.statut,
        cree_le: c.cree_le,
        score: scoreCompatibilite(offre, candidat),
        candidat,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Le recruteur a maintenant vu les nouvelles candidatures
  await db.query("UPDATE candidatures SET statut = 'vue' WHERE offre_id = ? AND statut = 'envoyee'", [offre.id]);

  res.json({ offre: { ...offre, active: Boolean(offre.active) }, candidatures: resultat });
});

// PUT /api/recruteur/candidatures/:id  { statut: 'retenue' | 'refusee' }
router.put('/candidatures/:id', async (req, res) => {
  const { statut } = req.body;
  if (!['retenue', 'refusee'].includes(statut)) {
    return res.status(400).json({ erreur: 'Statut invalide.' });
  }

  const [[c]] = await db.query(
    `SELECT c.id, o.titre, r.entreprise, u.email, p.nom
     FROM candidatures c
     JOIN offres o ON o.id = c.offre_id
     JOIN profils_recruteurs r ON r.utilisateur_id = o.recruteur_id
     JOIN utilisateurs u ON u.id = c.candidat_id
     JOIN profils_candidats p ON p.utilisateur_id = c.candidat_id
     WHERE c.id = ? AND o.recruteur_id = ?`,
    [req.params.id, req.utilisateur.id]
  );
  if (!c) return res.status(404).json({ erreur: 'Candidature introuvable.' });

  await db.query('UPDATE candidatures SET statut = ? WHERE id = ?', [statut, c.id]);
  await envoyerReponseCandidature({
    emailCandidat: c.email,
    nomCandidat: c.nom,
    entreprise: c.entreprise,
    titreOffre: c.titre,
    retenue: statut === 'retenue',
  });
  res.json({ message: statut === 'retenue' ? 'Candidat retenu, il a été prévenu.' : 'Candidature refusée.' });
});

// =============================================
// AGENT IA (assistant recruteur)
// =============================================

// GET /api/recruteur/agent — conversation en cours
router.get('/agent', async (req, res) => {
  const messages = await agent.chargerHistorique(req.utilisateur.id);
  res.json({ fil: await agent.filDeDiscussion(req.utilisateur.id, messages) });
});

// POST /api/recruteur/agent  { message }
router.post('/agent', async (req, res) => {
  const message = (req.body.message || '').trim();
  if (!message) return res.status(400).json({ erreur: 'Écrivez votre demande.' });
  if (message.length > 2000) return res.status(400).json({ erreur: 'Demande trop longue (2000 caractères maximum).' });

  try {
    res.json({ fil: await agent.demanderAgent(req.utilisateur.id, message) });
  } catch (err) {
    console.error('Agent :', err);
    res.status(502).json({
      erreur: err.visible ? err.message : "L'assistant est indisponible pour le moment, réessayez dans un instant.",
    });
  }
});

// DELETE /api/recruteur/agent — nouvelle conversation
router.delete('/agent', async (req, res) => {
  await agent.effacerHistorique(req.utilisateur.id);
  res.json({ fil: [] });
});

module.exports = router;
