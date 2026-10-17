// mail.js — envoi du code OTP par e-mail (Gmail)
const nodemailer = require('nodemailer');

const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
const mailConfigure = Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);

const transporteur = mailConfigure
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })
  : null;

async function envoyerCodeOTP(email, code) {
  // Toujours visible dans la console : pratique pour tester sans ouvrir sa boîte mail
  console.log(`📧 Code OTP pour ${email} : ${code}`);

  if (!mailConfigure) {
    console.warn('   (Gmail non configuré dans .env — e-mail non envoyé)');
    return;
  }

  await transporteur.sendMail({
    from: `"CVMatch IA" <${GMAIL_USER}>`,
    to: email,
    subject: 'Votre code de vérification CVMatch IA',
    text: `Votre code de vérification est : ${code}\nIl expire dans 10 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;background:#FDF6EC;border-radius:12px">
        <h2 style="color:#8C3B2E;margin-top:0">CVMatch IA</h2>
        <p style="color:#2B1B17">Votre code de vérification :</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#8C3B2E">${code}</p>
        <p style="color:#6B5A55;font-size:13px">Ce code expire dans 10 minutes.</p>
      </div>`,
  });
}

// Échappe le texte saisi par un utilisateur avant de l'insérer dans un e-mail HTML
function echapper(texte) {
  return String(texte).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Phase 5 : un recruteur contacte un candidat
async function envoyerMessageCandidat({ emailCandidat, nomCandidat, recruteur, message }) {
  console.log(`📧 Message de ${recruteur.entreprise} pour ${emailCandidat} :\n   ${message}`);

  if (!mailConfigure) {
    console.warn('   (Gmail non configuré dans .env — e-mail non envoyé)');
    return;
  }

  const contacts = [`E-mail : ${recruteur.email}`, recruteur.telephone && `Téléphone : ${recruteur.telephone}`]
    .filter(Boolean);

  await transporteur.sendMail({
    from: `"CVMatch IA" <${GMAIL_USER}>`,
    to: emailCandidat,
    replyTo: recruteur.email, // le candidat répond directement au recruteur
    subject: `${recruteur.entreprise} souhaite vous contacter`,
    text: `Bonjour ${nomCandidat},\n\n${recruteur.entreprise} a vu votre profil sur CVMatch IA :\n\n${message}\n\n${contacts.join('\n')}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#FDF6EC;border-radius:12px">
        <h2 style="color:#8C3B2E;margin-top:0">CVMatch IA</h2>
        <p style="color:#2B1B17">Bonjour ${echapper(nomCandidat)},</p>
        <p style="color:#2B1B17"><b>${echapper(recruteur.entreprise)}</b> a vu votre profil et vous a écrit :</p>
        <p style="background:#fff;border-left:4px solid #A8C5D6;padding:12px;color:#2B1B17;white-space:pre-line">${echapper(message)}</p>
        <p style="color:#6B5A55;font-size:13px">${contacts.map(echapper).join('<br>')}</p>
      </div>`,
  });
}

// Phase 6 : le recruteur retient ou refuse une candidature
async function envoyerReponseCandidature({ emailCandidat, nomCandidat, entreprise, titreOffre, retenue }) {
  const texte = retenue
    ? `Bonne nouvelle ! ${entreprise} a retenu votre candidature pour « ${titreOffre} ». Le recruteur va vous recontacter.`
    : `${entreprise} n'a pas retenu votre candidature pour « ${titreOffre} ». D'autres offres vous attendent sur CVMatch IA.`;
  console.log(`📧 Réponse de candidature pour ${emailCandidat} : ${retenue ? 'retenue' : 'refusée'}`);

  if (!mailConfigure) {
    console.warn('   (Gmail non configuré dans .env — e-mail non envoyé)');
    return;
  }

  await transporteur.sendMail({
    from: `"CVMatch IA" <${GMAIL_USER}>`,
    to: emailCandidat,
    subject: `Votre candidature : ${titreOffre}`,
    text: `Bonjour ${nomCandidat},\n\n${texte}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#FDF6EC;border-radius:12px">
        <h2 style="color:#8C3B2E;margin-top:0">CVMatch IA</h2>
        <p style="color:#2B1B17">Bonjour ${echapper(nomCandidat)},</p>
        <p style="color:#2B1B17">${echapper(texte)}</p>
      </div>`,
  });
}

module.exports = { envoyerCodeOTP, envoyerMessageCandidat, envoyerReponseCandidature };
