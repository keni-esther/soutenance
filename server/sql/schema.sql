-- schema.sql — base de données de CVMatch IA
-- Exécuté automatiquement par "npm run init-db"

CREATE DATABASE IF NOT EXISTS cvmatchia CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cvmatchia;

-- Comptes (candidats et recruteurs)
CREATE TABLE IF NOT EXISTS utilisateurs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  mot_de_passe VARCHAR(255) NOT NULL,
  role ENUM('candidat', 'recruteur') NOT NULL,
  verifie BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Codes OTP envoyés par e-mail (un seul code actif par utilisateur)
CREATE TABLE IF NOT EXISTS codes_otp (
  utilisateur_id INT PRIMARY KEY,
  code CHAR(6) NOT NULL,
  expire_le DATETIME NOT NULL,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- Profil d'un candidat
CREATE TABLE IF NOT EXISTS profils_candidats (
  utilisateur_id INT PRIMARY KEY,
  nom VARCHAR(255) NOT NULL,
  metier VARCHAR(255),
  ville VARCHAR(255),
  annees_experience INT,
  competences TEXT,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- Profil d'un recruteur
CREATE TABLE IF NOT EXISTS profils_recruteurs (
  utilisateur_id INT PRIMARY KEY,
  entreprise VARCHAR(255) NOT NULL,
  secteur VARCHAR(255) NOT NULL,
  ville VARCHAR(255),
  telephone VARCHAR(50),
  description TEXT,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- CV déposé par un candidat (le dernier remplace le précédent)
CREATE TABLE IF NOT EXISTS cvs (
  utilisateur_id INT PRIMARY KEY,
  chemin VARCHAR(500) NOT NULL,
  nom_original VARCHAR(255) NOT NULL,
  type_mime VARCHAR(100) NOT NULL,
  depose_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- Résumé du CV généré par l'IA (phase 4)
CREATE TABLE IF NOT EXISTS resumes (
  utilisateur_id INT PRIMARY KEY,
  metier VARCHAR(255),
  ville VARCHAR(255),
  annees_experience INT,
  competences JSON,            -- liste de compétences, ex. ["Soudure", "Mécanique"]
  resume_complet TEXT,
  valide BOOLEAN NOT NULL DEFAULT FALSE,
  genere_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- Suivi recruteur (phase 5) : candidats enregistrés ou contactés
CREATE TABLE IF NOT EXISTS suivi_candidats (
  recruteur_id INT NOT NULL,
  candidat_id INT NOT NULL,
  statut ENUM('enregistre', 'contacte') NOT NULL,
  message TEXT,                -- dernier message envoyé au candidat
  mis_a_jour_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (recruteur_id, candidat_id),
  FOREIGN KEY (recruteur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  FOREIGN KEY (candidat_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- Offres d'emploi publiées par les recruteurs (phase 6)
CREATE TABLE IF NOT EXISTS offres (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recruteur_id INT NOT NULL,
  titre VARCHAR(255) NOT NULL,
  metier VARCHAR(255) NOT NULL,
  ville VARCHAR(255) NOT NULL,
  type_contrat ENUM('CDI', 'CDD', 'Stage', 'Freelance', 'Journalier') NOT NULL,
  salaire VARCHAR(100),
  competences TEXT,            -- séparées par des virgules
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recruteur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);

-- Candidatures des candidats aux offres (phase 6)
CREATE TABLE IF NOT EXISTS candidatures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  offre_id INT NOT NULL,
  candidat_id INT NOT NULL,
  message TEXT,
  statut ENUM('envoyee', 'vue', 'retenue', 'refusee') NOT NULL DEFAULT 'envoyee',
  cree_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mis_a_jour_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY une_candidature_par_offre (offre_id, candidat_id),
  FOREIGN KEY (offre_id) REFERENCES offres(id) ON DELETE CASCADE,
  FOREIGN KEY (candidat_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
);
