// init-db.js — crée la base et les tables à partir de sql/schema.sql
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const connexion = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await connexion.query(sql);
  await connexion.end();
  console.log('✅ Base de données "cvmatchia" prête.');
}

main().catch((err) => {
  console.error('❌ Erreur MySQL :', err.message);
  console.error('   Vérifiez que MySQL est démarré dans XAMPP et les valeurs DB_* du fichier .env');
  process.exit(1);
});
