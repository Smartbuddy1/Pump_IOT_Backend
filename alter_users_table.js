const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'petroleum_iot',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

const alterTables = async () => {
  try {
    console.log('Altering users table to add refresh_token...');

    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS refresh_token TEXT;
    `);

    console.log('Column added successfully! 🎉');
  } catch (error) {
    console.error('Error altering tables:', error);
  } finally {
    pool.end();
  }
};

alterTables();
