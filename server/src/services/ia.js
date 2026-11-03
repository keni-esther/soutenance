// ia.js — phase 4 : Claude lit le CV et en produit un résumé structuré
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const mammoth = require('mammoth');
const { resumeLocal } = require('./resume-local');

const client = new Anthropic(); // lit ANTHROPIC_API_KEY dans .env

const IMAGES_ACCEPTEES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Format JSON que Claude doit obligatoirement respecter
const SCHEMA_RESUME = {
  type: 'object',
  properties: {
    metier: { type: 'string', description: 'Métier principal, ex. "Mécanicien automobile"' },
    ville: { type: 'string', description: 'Ville ou commune de résidence, "" si absente' },
    annees_experience: {
      anyOf: [{ type: 'integer' }, { type: 'null' }],
      description: "Nombre total d'années d'expérience professionnelle, null si impossible à estimer",
    },
    competences: {
      type: 'array',
      items: { type: 'string' },
      description: '5 à 12 compétences clés, courtes (1 à 4 mots chacune)',
    },
    resume_complet: {
      type: 'string',
      description: 'Résumé de 4 à 6 phrases du parcours, à la 3e personne',
    },
  },
  required: ['metier', 'ville', 'annees_experience', 'competences', 'resume_complet'],
  additionalProperties: false,
};

const CONSIGNE = `Tu es l'assistant de CVMatch IA, une application qui met en relation candidats et recruteurs.
Analyse le CV fourni et extrais les informations demandées, en français.
- N'invente rien : si une information n'apparaît pas dans le CV, utilise les infos du profil saisi par le candidat, sinon laisse la valeur vide (ou null).
- Le résumé doit aider un recruteur à comprendre en 30 secondes qui est le candidat : métier, expérience, points forts.`;

// Transforme le fichier du CV en bloc de contenu lisible par Claude
async function contenuDuCV(chemin, typeMime) {
  if (typeMime === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(chemin).toString('base64') },
    };
  }
  if (IMAGES_ACCEPTEES.includes(typeMime)) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: typeMime, data: fs.readFileSync(chemin).toString('base64') },
    };
  }
  if (typeMime === MIME_DOCX || path.extname(chemin).toLowerCase() === '.docx') {
    const { value } = await mammoth.extractRawText({ path: chemin });
    return { type: 'text', text: `Contenu du CV :\n\n${value}` };
  }
  throw new Error('Format non pris en charge. Utilisez un PDF, un Word (.docx) ou une photo (JPG/PNG).');
}

// Résumé par Claude (lève une erreur si la clé est invalide, le réseau coupé, etc.)
async function resumeParClaude(fichiers, profil) {
  const cv = [];
  for (const { chemin, typeMime } of fichiers) cv.push(await contenuDuCV(chemin, typeMime));

  const reponse = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SCHEMA_RESUME },
    },
    // Si le modèle refuse la demande, l'API réessaie automatiquement avec un autre modèle
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: CONSIGNE,
    messages: [
      {
        role: 'user',
        content: [
          ...cv,
          {
            type: 'text',
            text: `Profil saisi par le candidat : ${JSON.stringify(profil)}\n\nAnalyse ce CV.`,
          },
        ],
      },
    ],
  });

  if (reponse.stop_reason === 'refusal') {
    throw new Error("L'IA n'a pas pu analyser ce CV.");
  }
  if (reponse.stop_reason === 'max_tokens') {
    throw new Error("La réponse de l'IA a été coupée, réessayez.");
  }

  const texte = reponse.content.find((bloc) => bloc.type === 'text');
  return JSON.parse(texte.text);
}

/**
 * Génère le résumé d'un CV : par Claude si possible, sinon par le résumé local (resume-local.js).
 * @param {{ chemin: string, typeMime: string }[]} fichiers le CV (un fichier, ou une photo par page)
 * @param {object} profil   infos saisies par le candidat (nom, metier, ville...)
 * @returns {{ resume: object, parIA: boolean }}
 */
async function genererResume(fichiers, profil) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return { resume: await resumeParClaude(fichiers, profil), parIA: true };
    } catch (err) {
      console.warn(`Claude indisponible (${err.message}) : résumé local.`);
    }
  }
  return { resume: await resumeLocal(fichiers, profil), parIA: false };
}

module.exports = { genererResume };
