const bcrypt = require('bcrypt');
const { Client } = require('pg');
require('dotenv').config();
const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});
async function run() {
  await client.connect();
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('Akshay@123', salt);
  await client.query('UPDATE users SET password = $1 WHERE username = $2', [hash, '9284188705']);
  console.log('Password updated.');
  await client.end();
}
run();
