// match.js — score de compatibilité entre un candidat et une offre (0 à 100)
// 1. Deep matching : le modèle entraîné du dossier modele/ (service Python, MODELE_URL)
// 2. En secours, si ce service ne répond pas : calcul simple par mots du métier, des compétences et de la ville

// Mots trop courants pour être utiles
const MOTS_VIDES = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'et', 'en', 'un', 'une', 'pour', 'au', 'aux', 'a', 'h', 'f']);

// "Mécanicienne Auto" → ["mecanicienne", "auto"]
function mots(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // enlève les accents
    .split(/[^a-z0-9+#]+/)
    .filter((m) => m.length > 1 && !MOTS_VIDES.has(m));
}

// Deux mots "correspondent" s'ils partagent la même racine (mecanicien / mecanicienne)
function correspond(a, b) {
  const n = Math.min(a.length, b.length, 6);
  return n >= 4 ? a.slice(0, n) === b.slice(0, n) : a === b;
}

function contientUnDe(motsCherches, motsTexte) {
  return motsCherches.some((m) => motsTexte.some((t) => correspond(m, t)));
}

/**
 * @param offre    { titre, metier, ville, competences: "a, b, c" }
 * @param candidat { metier, ville, competences: string[], resume_complet }
 */
function scoreCompatibilite(offre, candidat) {
  const motsCandidat = mots([candidat.metier, ...(candidat.competences || []), candidat.resume_complet].join(' '));

  // 1. Métier (50 points)
  const metierOffre = mots(`${offre.metier} ${offre.titre}`);
  const pointsMetier = contientUnDe(metierOffre, mots(candidat.metier)) ? 50 : contientUnDe(metierOffre, motsCandidat) ? 25 : 0;

  // 2. Compétences demandées que le candidat possède (35 points)
  const competencesOffre = String(offre.competences || '')
    .split(',')
    .map((c) => mots(c))
    .filter((c) => c.length > 0);
  const trouvees = competencesOffre.filter((c) => contientUnDe(c, motsCandidat)).length;
  const pointsCompetences = competencesOffre.length ? Math.round((35 * trouvees) / competencesOffre.length) : 20;

  // 3. Même ville (15 points)
  const pointsVille = contientUnDe(mots(offre.ville), mots(candidat.ville)) ? 15 : 0;

  return Math.min(100, pointsMetier + pointsCompetences + pointsVille);
}

// =============================================
// DEEP MATCHING (modele/service.py)
// =============================================
const MODELE_URL = process.env.MODELE_URL || 'http://127.0.0.1:8000';

// Textes envoyés au modèle : tout ce qu'on sait du candidat et de l'offre
function texteCandidat(c) {
  return [
    c.metier,
    c.ville,
    c.annees_experience != null ? `${c.annees_experience} ans d'expérience` : '',
    (c.competences || []).length ? `Compétences : ${c.competences.join(', ')}` : '',
    c.resume_complet,
  ]
    .filter(Boolean)
    .join('. ');
}

function texteOffre(o) {
  return [o.titre, o.metier, o.ville, o.competences ? `Compétences : ${o.competences}` : '', o.description]
    .filter(Boolean)
    .join('. ');
}

/**
 * Scores de plusieurs paires en un seul appel au modèle.
 * @param paires [{ offre, candidat }]
 * @returns      [score 0-100], dans le même ordre
 */
async function scoresCompatibilite(paires) {
  if (paires.length === 0) return [];
  try {
    const reponse = await fetch(`${MODELE_URL}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paires: paires.map(({ offre, candidat }) => ({ cv: texteCandidat(candidat), offre: texteOffre(offre) })),
      }),
      // Le 1er calcul d'un CV prend ~ 1 s sur processeur, les suivants sont en cache
      signal: AbortSignal.timeout(30000),
    });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const { scores } = await reponse.json();
    return scores.map((s) => s.score);
  } catch (err) {
    console.warn(`Modèle de deep matching indisponible (${err.message}) : score par mots-clés.`);
    return paires.map(({ offre, candidat }) => scoreCompatibilite(offre, candidat));
  }
}

module.exports = { scoreCompatibilite, scoresCompatibilite };
