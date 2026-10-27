const db = require('./config/db');
const bcrypt = require('bcrypt');

const initDatabase = async () => {
  try {
    console.log('Connecting and creating tables...');

    // 1. OMC table
    await db.query(`
      CREATE TABLE IF NOT EXISTS omc (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        contact VARCHAR(50),
        contact_password VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. RO table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ro (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        omc_id INTEGER REFERENCES omc(id) ON DELETE CASCADE,
        location VARCHAR(255),
        contact VARCHAR(50),
        contact_password VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Users table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        omc_id INTEGER REFERENCES omc(id) ON DELETE SET NULL,
        ro_id INTEGER REFERENCES ro(id) ON DELETE SET NULL,
        refresh_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Machines table
    await db.query(`
      CREATE TABLE IF NOT EXISTS machines (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        ro_id INTEGER REFERENCES ro(id) ON DELETE CASCADE,
        type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Running',
        health_score INTEGER DEFAULT 100,
        live_temp VARCHAR(50) DEFAULT '0',
        live_water VARCHAR(50) DEFAULT '0',
        live_humidity VARCHAR(50) DEFAULT '0',
        live_odour VARCHAR(50) DEFAULT '0',
        last_maintenance DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Alerts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        machine_id INTEGER REFERENCES machines(id) ON DELETE CASCADE,
        severity VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Open',
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. Telemetry History table
    await db.query(`
      CREATE TABLE IF NOT EXISTS telemetry_history (
        id SERIAL PRIMARY KEY,
        machine_name VARCHAR(50) NOT NULL,
        temperature NUMERIC,
        water NUMERIC,
        humidity NUMERIC,
        odour NUMERIC,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    // 7. Feedbacks table
    await db.query(`
      CREATE TABLE IF NOT EXISTS feedbacks (
        id SERIAL PRIMARY KEY,
        machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
        machine_name VARCHAR(50),
        ro_id INTEGER REFERENCES ro(id) ON DELETE SET NULL,
        omc_id INTEGER REFERENCES omc(id) ON DELETE SET NULL,
        rating INTEGER NOT NULL,
        reasons TEXT,
        comment TEXT,
        user_phone VARCHAR(20),
        user_name VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('All tables verified/created successfully! 🚀');

    // Seed default Super Admin user if not exists
    const adminCheck = await db.query("SELECT * FROM users WHERE username = '9284188705'");
    if (adminCheck.rows.length === 0) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('Akshay@123', salt);
      await db.query(
        "INSERT INTO users (username, password, role) VALUES ($1, $2, 'Super Admin')",
        ['9284188705', hashedPassword]
      );
      console.log('Default Super Admin account seeded (9284188705 / Akshay@123).');
    }

    // Seed initial OMC & RO & Machine if empty
    const omcCheck = await db.query('SELECT COUNT(*) FROM omc');
    if (parseInt(omcCheck.rows[0].count) === 0) {
      const omcRes = await db.query(
        "INSERT INTO omc (name, location, contact, contact_password, status) VALUES ('IOCL', 'Mumbai', '8767955438', 'Nilam@123', 'Active') RETURNING id"
      );
      const omcId = omcRes.rows[0].id;

      const roRes = await db.query(
        "INSERT INTO ro (name, omc_id, location, contact, contact_password, status) VALUES ('Mumbai Central RO', $1, 'Mumbai South', '8010209983', 'Shital@123', 'Active') RETURNING id",
        [omcId]
      );
      const roId = roRes.rows[0].id;

      await db.query(
        "INSERT INTO machines (name, ro_id, type, status, health_score, live_temp, live_water, live_humidity, live_odour) VALUES ('SBP2T101', $1, 'Dispenser', 'Online', 100, '25', '0.2', '45', '0.01')",
        [roId]
      );
      console.log('Sample OMC, RO and Machine seeded! ⛽');
    }

    console.log('Database initialization completed successfully! 🎉');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
};

initDatabase();
