// resume-local.js — résumé du CV sans Claude (mode sans clé API, ou si Claude ne répond pas)
// On lit le texte du CV et on y repère des compétences connues ; le reste vient du profil saisi.
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const db = require('../db');

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Compétences courantes, complétées par celles des offres publiées et du profil du candidat
const COMPETENCES_CONNUES = [
  // Informatique
  'JavaScript', 'TypeScript', 'Python', 'Java', 'PHP', 'C++', 'C#', 'SQL', 'MySQL', 'PostgreSQL', 'MongoDB',
  'HTML', 'CSS', 'React', 'React Native', 'Angular', 'Vue.js', 'Node.js', 'Express', 'Laravel', 'Django',
  'Git', 'Docker', 'Linux', 'Excel', 'Word', 'PowerPoint', 'Power BI', 'Machine learning', 'Réseaux',
  // Gestion, commerce, communication
  'Comptabilité', 'Gestion de projet', 'Marketing', 'Vente', 'Négociation', 'Service client',
  'Communication', 'Ressources humaines', 'Logistique', 'Secrétariat', 'Anglais', 'Français',
  // Métiers techniques
  'Mécanique', 'Soudure', 'Électricité', 'Plomberie', 'Maçonnerie', 'Menuiserie', 'Conduite',
  'Maintenance', 'Diagnostic', 'Cuisine', 'Pâtisserie', 'Couture', 'Coiffure', 'Agriculture',
];

const MAX_COMPETENCES = 12;

// Minuscules, sans accents : « Électricité » et « electricite » se retrouvent
function normaliser(texte) {
  return (texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function decouper(liste) {
  return (liste || '').split(',').map((c) => c.trim()).filter(Boolean);
}

async function texteDuCV(chemin, typeMime) {
  if (typeMime === 'application/pdf') {
    const lecteur = new PDFParse({ data: fs.readFileSync(chemin) });
    try {
      return (await lecteur.getText()).text;
    } finally {
      await lecteur.destroy();
    }
  }
  if (typeMime === MIME_DOCX || path.extname(chemin).toLowerCase() === '.docx') {
    return (await mammoth.extractRawText({ path: chemin })).value;
  }
  return ''; // photo du CV : impossible à lire sans IA, on s'appuie sur le profil
}

async function vocabulaire(profil) {
  const [offres] = await db.query("SELECT competences FROM offres WHERE competences <> ''");
  const tous = [...decouper(profil.competences), ...offres.flatMap((o) => decouper(o.competences)), ...COMPETENCES_CONNUES];
  // Sans doublons (« JS » et « js » comptent une fois)
  const vus = new Map();
  for (const c of tous) if (!vus.has(normaliser(c))) vus.set(normaliser(c), c);
  return [...vus.values()];
}

function competencesTrouvees(texte, termes) {
  const t = normaliser(texte);
  return termes.filter((terme) => {
    const echappe = normaliser(terme).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${echappe}($|[^a-z0-9+#])`).test(t);
  });
}

// « 5 ans d'expérience », « 3 années d'expérience »…
function anneesDansLeTexte(texte) {
  const m = normaliser(texte).match(/(\d{1,2})\s*(?:ans|annees)\s+d['’]\s?experience/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Même format que le résumé de Claude (voir SCHEMA_RESUME dans ia.js).
 * @param {object} profil infos saisies par le candidat (nom, metier, ville, annees_experience, competences)
 */
async function resumeLocal(chemin, typeMime, profil) {
  const texte = await texteDuCV(chemin, typeMime);
  const saisies = decouper(profil.competences);
  const trouvees = competencesTrouvees(texte, await vocabulaire(profil));
  const competences = [...new Set([...saisies, ...trouvees])].slice(0, MAX_COMPETENCES);
  const annees = profil.annees_experience ?? anneesDansLeTexte(texte);

  const phrases = [`${profil.metier || 'Candidat'}${profil.ville ? `, basé à ${profil.ville}` : ''}.`];
  if (annees != null) phrases.push(`${annees} an${annees > 1 ? 's' : ''} d'expérience professionnelle.`);
  if (competences.length) phrases.push(`Compétences : ${competences.join(', ')}.`);
  phrases.push(
    texte
      ? 'Résumé établi automatiquement à partir du texte du CV et du profil saisi.'
      : 'Le CV est une photo : résumé établi à partir du profil saisi.'
  );

  return {
    metier: profil.metier || '',
    ville: profil.ville || '',
    annees_experience: annees,
    competences,
    resume_complet: phrases.join(' '),
  };
}

module.exports = { resumeLocal };
