// db.js — connexion à MySQL (pool partagé par toutes les routes)
const mysql = require('mysql2/promise');

// Sur Railway, la base fournit une seule adresse : MYSQL_URL = mysql://utilisateur:motdepasse@hote:port/base
// Sur l'ordinateur (XAMPP), on utilise les valeurs DB_* du fichier .env.
function parametres() {
  if (process.env.MYSQL_URL) {
    const url = new URL(process.env.MYSQL_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  };
}

const pool = mysql.createPool({
  ...parametres(),
  database: process.env.DB_NAME || 'cvmatchia',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
module.exports.parametres = parametres;
