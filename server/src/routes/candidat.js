// routes/candidat.js — profil, dépôt du CV et résumé IA (phases 3 et 4)
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { exigerConnexion, exigerRole } = require('../auth');
const { genererResume } = require('../services/ia');
const { scoresCompatibilite } = require('../services/match');

const router = express.Router();
router.use(exigerConnexion, exigerRole('candidat'));

// Les CV sont rangés dans server/uploads/
const DOSSIER_UPLOADS = path.join(__dirname, '..', '..', 'uploads');
const TYPES_ACCEPTES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];
const upload = multer({
  storage: multer.diskStorage({
    destination: DOSSIER_UPLOADS,
    filename: (req, fichier, cb) =>
      cb(null, `cv-${req.utilisateur.id}-${Date.now()}${path.extname(fichier.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo
  fileFilter: (req, fichier, cb) => {
    if (TYPES_ACCEPTES.includes(fichier.mimetype)) return cb(null, true);
    const erreur = new Error('Format non pris en charge. Utilisez un PDF, un Word (.docx) ou une photo (JPG/PNG).');
    erreur.status = 400;
    cb(erreur);
  },
});

async function profilDe(id) {
  const [[profil]] = await db.query('SELECT * FROM profils_candidats WHERE utilisateur_id = ?', [id]);
  return profil;
}

// GET /api/candidat/profil — profil + CV + résumé
router.get('/profil', async (req, res) => {
  const id = req.utilisateur.id;
  const [[cv]] = await db.query(
    'SELECT nom_original, type_mime, depose_le FROM cvs WHERE utilisateur_id = ?',
    [id]
  );
  const [[resume]] = await db.query('SELECT * FROM resumes WHERE utilisateur_id = ?', [id]);

  res.json({
    profil: (await profilDe(id)) || null,
    cv: cv || null,
    // L'app attend les compétences sous forme de texte JSON
    resume: resume ? { ...resume, competences: JSON.stringify(resume.competences) } : null,
  });
});

// PUT /api/candidat/profil — mise à jour du formulaire
router.put('/profil', async (req, res) => {
  const { nom, metier, ville, annees_experience, competences } = req.body;
  if (!nom || !metier || !ville) {
    return res.status(400).json({ erreur: 'Nom, métier et ville sont obligatoires.' });
  }
  const annees = annees_experience === '' || annees_experience == null ? null : parseInt(annees_experience, 10);

  await db.query(
    `UPDATE profils_candidats
     SET nom = ?, metier = ?, ville = ?, annees_experience = ?, competences = ?
     WHERE utilisateur_id = ?`,
    [nom, metier, ville, Number.isNaN(annees) ? null : annees, competences || '', req.utilisateur.id]
  );
  res.json({ message: 'Profil mis à jour.' });
});

// POST /api/candidat/upload-cv — enregistre le CV puis demande le résumé à Claude
router.post('/upload-cv', upload.single('cv'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erreur: 'Aucun fichier reçu.' });
  }
  const id = req.utilisateur.id;

  // Remplace l'ancien CV (et supprime l'ancien fichier)
  const [[ancien]] = await db.query('SELECT chemin FROM cvs WHERE utilisateur_id = ?', [id]);
  if (ancien) fs.rm(ancien.chemin, { force: true }, () => {});
  await db.query(
    'REPLACE INTO cvs (utilisateur_id, chemin, nom_original, type_mime) VALUES (?, ?, ?, ?)',
    [id, req.file.path, req.file.originalname, req.file.mimetype]
  );

  try {
    const profil = await profilDe(id);
    const { resume: r, parIA } = await genererResume(req.file.path, req.file.mimetype, {
      nom: profil.nom,
      metier: profil.metier,
      ville: profil.ville,
      annees_experience: profil.annees_experience,
      competences: profil.competences,
    });

    // Nouveau résumé = à revalider par le candidat
    await db.query(
      `REPLACE INTO resumes (utilisateur_id, metier, ville, annees_experience, competences, resume_complet, valide)
       VALUES (?, ?, ?, ?, ?, ?, FALSE)`,
      [id, r.metier, r.ville, r.annees_experience, JSON.stringify(r.competences), r.resume_complet]
    );
    res.json({
      message: parIA
        ? 'CV analysé ! Vérifiez votre résumé.'
        : 'CV analysé en mode simplifié (sans IA). Vérifiez et complétez votre résumé.',
    });
  } catch (err) {
    console.error('Erreur IA :', err);
    res.status(502).json({ erreur: `CV enregistré, mais le résumé n'a pas pu être généré. ${err.message}` });
  }
});

// POST /api/candidat/resume/valider — le candidat confirme son résumé
router.post('/resume/valider', async (req, res) => {
  const [resultat] = await db.query('UPDATE resumes SET valide = TRUE WHERE utilisateur_id = ?', [
    req.utilisateur.id,
  ]);
  if (resultat.affectedRows === 0) {
    return res.status(404).json({ erreur: "Aucun résumé à valider. Déposez d'abord votre CV." });
  }
  res.json({ message: 'Résumé validé !' });
});

// =============================================
// OFFRES ET CANDIDATURES (phase 6)
// =============================================

// Infos du candidat utilisées pour le score : résumé IA validé en priorité, sinon le profil saisi
async function donneesPourScore(id) {
  const profil = (await profilDe(id)) || {};
  const [[resume]] = await db.query('SELECT * FROM resumes WHERE utilisateur_id = ? AND valide = TRUE', [id]);
  if (resume) {
    return {
      metier: resume.metier || profil.metier,
      ville: resume.ville || profil.ville,
      competences: resume.competences || [],
      resume_complet: resume.resume_complet,
    };
  }
  return {
    metier: profil.metier,
    ville: profil.ville,
    competences: String(profil.competences || '').split(',').map((c) => c.trim()).filter(Boolean),
    resume_complet: '',
  };
}

const SELECT_OFFRE = `
  SELECT o.id, o.titre, o.metier, o.ville, o.type_contrat, o.salaire, o.competences, o.description, o.cree_le,
         r.entreprise, r.secteur, r.description AS entreprise_description,
         c.statut AS statut_candidature
  FROM offres o
  JOIN profils_recruteurs r ON r.utilisateur_id = o.recruteur_id
  LEFT JOIN candidatures c ON c.offre_id = o.id AND c.candidat_id = ?
  WHERE o.active = TRUE`;

// GET /api/candidat/offres?q=&ville= — offres actives, les plus compatibles d'abord
router.get('/offres', async (req, res) => {
  const q = (req.query.q || '').trim();
  const ville = (req.query.ville || '').trim();

  let sql = SELECT_OFFRE;
  const params = [req.utilisateur.id];
  if (q) {
    sql += ' AND (o.titre LIKE ? OR o.metier LIKE ? OR o.competences LIKE ? OR r.entreprise LIKE ?)';
    params.push(...Array(4).fill(`%${q}%`));
  }
  if (ville) {
    sql += ' AND o.ville LIKE ?';
    params.push(`%${ville}%`);
  }
  sql += ' ORDER BY o.cree_le DESC LIMIT 100';

  const [offres] = await db.query(sql, params);
  const moi = await donneesPourScore(req.utilisateur.id);
  const scores = await scoresCompatibilite(offres.map((offre) => ({ offre, candidat: moi })));
  res.json({
    offres: offres.map((o, i) => ({ ...o, score: scores[i] })).sort((a, b) => b.score - a.score),
  });
});

// GET /api/candidat/offres/:id — détail d'une offre
router.get('/offres/:id', async (req, res) => {
  const [[offre]] = await db.query(`${SELECT_OFFRE} AND o.id = ?`, [req.utilisateur.id, req.params.id]);
  if (!offre) return res.status(404).json({ erreur: "Cette offre n'est plus disponible." });
  const moi = await donneesPourScore(req.utilisateur.id);
  const [score] = await scoresCompatibilite([{ offre, candidat: moi }]);
  res.json({ offre: { ...offre, score } });
});

// POST /api/candidat/offres/:id/postuler  { message? }
router.post('/offres/:id/postuler', async (req, res) => {
  const id = req.utilisateur.id;

  // Le recruteur doit pouvoir consulter le profil : métier renseigné + CV déposé
  const profil = await profilDe(id);
  const [[cv]] = await db.query('SELECT 1 FROM cvs WHERE utilisateur_id = ?', [id]);
  if (!profil || !profil.metier || !cv) {
    return res.status(400).json({ erreur: "Complétez votre profil et déposez votre CV (onglet Profil) avant de postuler." });
  }

  const [[offre]] = await db.query('SELECT id FROM offres WHERE id = ? AND active = TRUE', [req.params.id]);
  if (!offre) return res.status(404).json({ erreur: "Cette offre n'est plus disponible." });

  try {
    await db.query('INSERT INTO candidatures (offre_id, candidat_id, message) VALUES (?, ?, ?)', [
      offre.id,
      id,
      (req.body.message || '').trim() || null,
    ]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erreur: 'Vous avez déjà postulé à cette offre.' });
    }
    throw err;
  }
  res.status(201).json({ message: 'Candidature envoyée !' });
});

// GET /api/candidat/candidatures — mes candidatures
router.get('/candidatures', async (req, res) => {
  const [candidatures] = await db.query(
    `SELECT c.id, c.statut, c.cree_le, c.mis_a_jour_le,
            o.id AS offre_id, o.titre, o.ville, o.type_contrat, o.active, r.entreprise
     FROM candidatures c
     JOIN offres o ON o.id = c.offre_id
     JOIN profils_recruteurs r ON r.utilisateur_id = o.recruteur_id
     WHERE c.candidat_id = ?
     ORDER BY c.mis_a_jour_le DESC`,
    [req.utilisateur.id]
  );
  res.json({ candidatures: candidatures.map((c) => ({ ...c, active: Boolean(c.active) })) });
});

// DELETE /api/candidat/candidatures/:id — retirer sa candidature (si pas encore traitée)
router.delete('/candidatures/:id', async (req, res) => {
  const [resultat] = await db.query(
    "DELETE FROM candidatures WHERE id = ? AND candidat_id = ? AND statut IN ('envoyee', 'vue')",
    [req.params.id, req.utilisateur.id]
  );
  if (resultat.affectedRows === 0) {
    return res.status(400).json({ erreur: 'Cette candidature ne peut plus être retirée.' });
  }
  res.json({ message: 'Candidature retirée.' });
});

module.exports = router;
