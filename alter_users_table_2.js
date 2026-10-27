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
    console.log('Altering users table to add omc_id and ro_id...');

    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS omc_id INTEGER REFERENCES omc(id),
      ADD COLUMN IF NOT EXISTS ro_id INTEGER REFERENCES ro(id);
    `);

    console.log('Columns added successfully! 🎉');
  } catch (error) {
    console.error('Error altering tables:', error);
  } finally {
    pool.end();
  }
};

alterTables();
