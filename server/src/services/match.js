// match.js — score de compatibilité entre un candidat et une offre (0 à 100)
// Calcul simple, sans IA : on compare les mots du métier, des compétences et la ville.

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

module.exports = { scoreCompatibilite };
