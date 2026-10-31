const { Pool } = require('pg');
require('dotenv').config();

let dbUrl = process.env.DATABASE_URL;
if (dbUrl && dbUrl.includes('sslmode=require')) {
  dbUrl = dbUrl.replace('sslmode=require', 'sslmode=verify-full');
}

const poolConfig = dbUrl
  ? {
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      max: 10,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'petroleum_iot',
      password: process.env.DB_PASSWORD || 'password',
      port: process.env.DB_PORT || 5432,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client (handled):', err.message);
});

// Test connection and release immediately
pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection failed. Error:', err.message);
  } else {
    console.log('Connected to PostgreSQL Database 🐘');
    if (release) release();
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
