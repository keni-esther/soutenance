// resume-local.js — résumé du CV sans Claude (mode sans clé API, ou si Claude ne répond pas)
// On lit le texte du CV et on y repère compétences, formation, langues et qualités connues ;
// le reste vient du profil saisi.
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { createWorker } = require('tesseract.js');
const db = require('../db');

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Langues de l'OCR, téléchargées une seule fois (~ 15 Mo) dans server/.cache-ocr/
const DOSSIER_OCR = path.join(__dirname, '..', '..', '.cache-ocr');
// PDF fait d'images (scan, export Canva…) : on lit au plus ses 3 premières pages par OCR
const MAX_PAGES_OCR = 3;

// Compétences courantes, complétées par celles des offres publiées et du profil du candidat
const COMPETENCES_CONNUES = [
  // Informatique
  'JavaScript', 'TypeScript', 'Python', 'Java', 'PHP', 'C++', 'C#', 'SQL', 'MySQL', 'PostgreSQL', 'MongoDB',
  'HTML', 'CSS', 'React', 'React Native', 'Angular', 'Vue.js', 'Node.js', 'Express', 'Laravel', 'Django',
  'Flask', 'FastAPI', 'Flutter', 'Kotlin', 'Firebase', 'API REST', 'PDO', 'phpMyAdmin', 'WordPress', 'Bootstrap',
  'Git', 'GitHub', 'Docker', 'Linux', 'Figma', 'Réseaux',
  // Data et IA
  'Excel', 'Power BI', 'Power Query', 'DAX', 'Data visualisation', 'Analyse de données', 'Pandas', 'NumPy',
  'Scikit-learn', 'TensorFlow', 'PyTorch', 'Jupyter', 'Machine learning', 'Deep learning', 'NLP', 'LLM', 'RAG',
  'Embeddings', 'Intelligence artificielle', 'n8n',
  // Bureautique, gestion, commerce, communication
  'Word', 'PowerPoint', 'Canva', 'Comptabilité', 'Gestion de projet', 'Agile', 'Scrum', 'Marketing', 'Vente',
  'Négociation', 'Service client', 'Communication', 'Ressources humaines', 'Logistique', 'Secrétariat',
  // Métiers techniques
  'Mécanique', 'Soudure', 'Électricité', 'Plomberie', 'Maçonnerie', 'Menuiserie', 'Conduite',
  'Maintenance', 'Diagnostic', 'Cuisine', 'Pâtisserie', 'Couture', 'Coiffure', 'Agriculture',
];

const QUALITES_CONNUES = [
  'Autonomie', 'Rigueur', "Esprit d'équipe", 'Travail en équipe', 'Sens du résultat', 'Sens de l\'organisation',
  'Ponctualité', 'Créativité', 'Adaptabilité', 'Curiosité', 'Leadership', 'Polyvalence',
  'Dynamisme', 'Persévérance', 'Esprit d\'analyse', 'Écoute', 'Honnêteté', 'Patience',
];

const LANGUES = ['Français', 'Anglais', 'Espagnol', 'Allemand', 'Arabe', 'Chinois', 'Portugais', 'Italien'];
// Niveaux reconnus (sans accents, comme le texte normalisé) et leur écriture dans le résumé
const NIVEAUX_LANGUE = {
  courant: 'courant', debutant: 'débutant', intermediaire: 'intermédiaire', bilingue: 'bilingue', natif: 'natif',
  native: 'natif', maternelle: 'langue maternelle', notions: 'notions', notion: 'notions', 'bon niveau': 'bon niveau',
  avance: 'avancé', scolaire: 'scolaire',
};

// Mots qui annoncent un diplôme ou une formation
const DIPLOMES = /\b(baccalaur[ée]at|bac\b|bts|dut|licence|master|doctorat|dipl[ôo]me|attestation|certificat|certification|formation|ing[ée]nieur|cap\b|bepc|mba)/i;

const MAX_COMPETENCES = 20;
const MAX_FORMATIONS = 3;

// Minuscules, sans accents, apostrophes droites : « Électricité » et « electricite » se retrouvent
function normaliser(texte) {
  return (texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase();
}

function decouper(liste) {
  return (liste || '').split(',').map((c) => c.trim()).filter(Boolean);
}

// Sans doublons, à la casse et aux accents près (« Javascript » et « JavaScript » comptent une fois)
function sansDoublons(liste) {
  const vus = new Map();
  for (const c of liste) if (!vus.has(normaliser(c))) vus.set(normaliser(c), c);
  return [...vus.values()];
}

async function texteDuCV(chemin, typeMime) {
  if (typeMime === 'application/pdf') {
    const lecteur = new PDFParse({ data: fs.readFileSync(chemin) });
    try {
      const texte = (await lecteur.getText()).text;
      // Peu de texte (en dehors des « -- 1 of 2 -- ») : PDF fait d'images, on le lit par OCR
      if (texte.replace(/-- \d+ of \d+ --/g, '').trim().length >= 50) return texte;
      const captures = await lecteur.getScreenshot({ desiredWidth: 2000, imageDataUrl: false, first: MAX_PAGES_OCR });
      return lireParOCR(captures.pages.map((p) => Buffer.from(p.data)));
    } finally {
      await lecteur.destroy();
    }
  }
  if (typeMime === MIME_DOCX || path.extname(chemin).toLowerCase() === '.docx') {
    return (await mammoth.extractRawText({ path: chemin })).value;
  }
  if (typeMime.startsWith('image/')) {
    return lireParOCR([chemin]);
  }
  return '';
}

// Lecture du texte d'images (photos, pages de PDF) par OCR (Tesseract, français + anglais), ~ 5 à 15 s par page
async function lireParOCR(images) {
  fs.mkdirSync(DOSSIER_OCR, { recursive: true });
  const ocr = await createWorker(['fra', 'eng'], 1, { cachePath: DOSSIER_OCR });
  try {
    const textes = [];
    for (const image of images) textes.push((await ocr.recognize(image)).data.text);
    return textes.join('\n');
  } catch (err) {
    console.warn(`OCR impossible (${err.message}) : résumé à partir du profil.`);
    return '';
  } finally {
    await ocr.terminate();
  }
}

async function vocabulaire(profil) {
  const [offres] = await db.query("SELECT competences FROM offres WHERE competences <> ''");
  return sansDoublons([
    ...decouper(profil.competences),
    ...offres.flatMap((o) => decouper(o.competences)),
    ...COMPETENCES_CONNUES,
  ]);
}

// Le terme comme mot entier dans un texte normalisé (« sql » est trouvé dans « php, sql » mais pas dans « mysql »)
function motif(terme) {
  const echappe = normaliser(terme).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${echappe}($|[^a-z0-9+#])`);
}

function termesTrouves(texte, termes) {
  const t = normaliser(texte);
  return termes.filter((terme) => motif(terme).test(t));
}

// Retire un terme déjà contenu dans un autre (« React » avec « React Native », « n8n » avec « automatisation n8n »)
function sansTermesInclus(termes) {
  return termes.filter(
    (terme) => !termes.some((autre) => normaliser(autre) !== normaliser(terme) && motif(terme).test(normaliser(autre)))
  );
}

// « 5 ans d'expérience », « 3 années d'expérience »…
function anneesDansLeTexte(texte) {
  const m = normaliser(texte).match(/(\d{1,2})\s*(?:ans|annees)\s+d['’]\s?experience/);
  return m ? parseInt(m[1], 10) : null;
}

// « Français : Courant », « Anglais - B1 »… → « français (courant) »
function languesTrouvees(texte) {
  const trouvees = [];
  const niveaux = [...Object.keys(NIVEAUX_LANGUE), '[abc][12]'].join('|');
  for (const langue of LANGUES) {
    const m = normaliser(texte).match(new RegExp(`${normaliser(langue)}\\s*[:\\-–(]?\\s*(${niveaux})\\b`));
    if (m) trouvees.push(`${langue.toLowerCase()} (${NIVEAUX_LANGUE[m[1]] || m[1].toUpperCase()})`);
  }
  return trouvees;
}

// Puces et bruit de l'OCR en début de ligne (« e Python », « » Rigueur », « - Flask »)
function nettoyerLigne(ligne) {
  return ligne.replace(/^(?:[\s•·*«»>\-–—©°]|e(?=\s+[A-ZÉ]))+/, '').replace(/\s+/g, ' ').trim();
}

// Lignes de la rubrique « Formation » (sinon de tout le CV) qui annoncent un diplôme,
// avec l'école et l'année de la ligne suivante : « Baccalauréat Série D », « Master (Université X, 2024) »
function formationsTrouvees(texte) {
  const lignes = texte.split('\n').map(nettoyerLigne).filter(Boolean);
  const titre = lignes.findIndex((l) => /^(formations?|dipl[ôo]mes?|[ée]ducation|[ée]tudes|parcours acad[ée]mique)\b/i.test(l));
  const zone = titre >= 0 ? lignes.slice(titre + 1, titre + 12) : lignes;

  const formations = [];
  for (let i = 0; i < zone.length && formations.length < MAX_FORMATIONS; i++) {
    const ligne = zone[i];
    // Fin de la rubrique : un autre titre en majuscules (« LANGUES », « EXPÉRIENCES »…)
    if (titre >= 0 && ligne.length > 3 && ligne === ligne.toUpperCase() && /[A-Z]/.test(ligne)) break;
    if (!DIPLOMES.test(ligne) || ligne.length > 100) continue;
    const suivante = zone[i + 1] || '';
    if (/\b(19|20)\d{2}\b/.test(suivante) && !DIPLOMES.test(suivante)) {
      formations.push(`${ligne} (${suivante.replace(/\s*\|\s*/g, ', ')})`);
      i++;
    } else {
      formations.push(ligne);
    }
  }
  return formations;
}

function experience(annees, texte) {
  if (annees == null) return /\bjunior\b/i.test(texte) ? 'Profil junior.' : null;
  if (annees === 0) return /\bjunior\b/i.test(texte) ? 'Profil junior.' : 'Profil débutant.';
  return `${annees} an${annees > 1 ? 's' : ''} d'expérience professionnelle.`;
}

/**
 * Même format que le résumé de Claude (voir SCHEMA_RESUME dans ia.js).
 * @param {{ chemin: string, typeMime: string }[]} fichiers le CV (un fichier, ou une photo par page)
 * @param {object} profil infos saisies par le candidat (nom, metier, ville, annees_experience, competences)
 */
async function resumeLocal(fichiers, profil) {
  const textes = [];
  for (const { chemin, typeMime } of fichiers) textes.push(await texteDuCV(chemin, typeMime));
  const texte = textes.join('\n');
  if (!texte.trim()) console.warn('Aucun texte lu dans le CV : résumé à partir du profil saisi.');

  const competences = sansTermesInclus(
    sansDoublons([...decouper(profil.competences), ...termesTrouves(texte, await vocabulaire(profil))])
  ).slice(0, MAX_COMPETENCES);
  const annees = profil.annees_experience ?? anneesDansLeTexte(texte);
  const formations = formationsTrouvees(texte);
  const langues = languesTrouvees(texte);
  const qualites = termesTrouves(texte, QUALITES_CONNUES).map((q) => q.toLowerCase());

  // Tournure neutre (« Développeuse data IA à Abidjan ») : pas d'accord à deviner
  const metier = profil.metier ? profil.metier.charAt(0).toUpperCase() + profil.metier.slice(1) : 'Candidat';
  const phrases = [`${metier}${profil.ville ? ` à ${profil.ville}` : ''}.`];
  const exp = experience(annees, texte);
  if (exp) phrases.push(exp);
  if (formations.length) phrases.push(`Formation : ${formations.join(' ; ')}.`);
  if (competences.length) phrases.push(`Compétences : ${competences.join(', ')}.`);
  if (langues.length) phrases.push(`Langues : ${langues.join(', ')}.`);
  if (qualites.length) phrases.push(`Qualités : ${qualites.join(', ')}.`);

  return {
    metier: profil.metier || '',
    ville: profil.ville || '',
    annees_experience: annees,
    competences,
    resume_complet: phrases.join(' '),
  };
}

module.exports = { resumeLocal };
