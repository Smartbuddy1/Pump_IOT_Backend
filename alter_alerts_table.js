const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'petroleum_iot',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

const alterAlertsTable = async () => {
  try {
    await pool.query(`
      ALTER TABLE alerts
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Open'
    `);
    console.log('Added status column to alerts table successfully.');
  } catch (error) {
    console.error('Error altering alerts table:', error);
  } finally {
    pool.end();
  }
};

alterAlertsTable();
