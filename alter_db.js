const db = require('./config/db');

const alterTables = async () => {
  try {
    console.log('Altering machines table to add all telemetry and configuration columns...');

    await db.query(`
      ALTER TABLE machines 
      ADD COLUMN IF NOT EXISTS install_date VARCHAR(50),
      ADD COLUMN IF NOT EXISTS live_temp VARCHAR(50),
      ADD COLUMN IF NOT EXISTS live_water VARCHAR(50),
      ADD COLUMN IF NOT EXISTS live_humidity VARCHAR(50),
      ADD COLUMN IF NOT EXISTS live_odour VARCHAR(50),
      ADD COLUMN IF NOT EXISTS live_nh3 VARCHAR(50),
      ADD COLUMN IF NOT EXISTS live_h2s VARCHAR(50),
      ADD COLUMN IF NOT EXISTS wifi_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS wifi_password VARCHAR(255),
      ADD COLUMN IF NOT EXISTS temp_limit_low VARCHAR(50),
      ADD COLUMN IF NOT EXISTS temp_limit_medium VARCHAR(50),
      ADD COLUMN IF NOT EXISTS temp_limit_danger VARCHAR(50),
      ADD COLUMN IF NOT EXISTS humidity_limit_low VARCHAR(50),
      ADD COLUMN IF NOT EXISTS humidity_limit_medium VARCHAR(50),
      ADD COLUMN IF NOT EXISTS humidity_limit_danger VARCHAR(50),
      ADD COLUMN IF NOT EXISTS odour_limit_low VARCHAR(50),
      ADD COLUMN IF NOT EXISTS odour_limit_medium VARCHAR(50),
      ADD COLUMN IF NOT EXISTS odour_limit_danger VARCHAR(50),
      ADD COLUMN IF NOT EXISTS nh3_limit_low VARCHAR(50),
      ADD COLUMN IF NOT EXISTS nh3_limit_danger VARCHAR(50),
      ADD COLUMN IF NOT EXISTS h2s_limit_low VARCHAR(50),
      ADD COLUMN IF NOT EXISTS h2s_limit_danger VARCHAR(50),
      ADD COLUMN IF NOT EXISTS water_level_trigger VARCHAR(50);
    `);

    console.log('Columns added successfully! 🎉');
    process.exit(0);
  } catch (error) {
    console.error('Error altering tables:', error);
    process.exit(1);
  }
};

alterTables();
