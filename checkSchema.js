const db = require('./config/db');
const bcrypt = require('bcrypt');

async function testCreateOMC() {
    try {
        const name = "hp";
        const location = "niphad";
        const contact = "8796654567";
        const contact_password = "12345";
        
        console.log("1. Create OMC");
        const result = await db.query(
            'INSERT INTO omc (name, location, contact, contact_password) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, location, contact, contact_password]
        );
        const newOmc = result.rows[0];
        console.log("OMC created:", newOmc);

        console.log("2. Generate OMC Admin User");
        const rawPassword = contact_password || Math.random().toString(36).slice(-8);
        const username = contact || (name.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '') + Math.floor(1000 + Math.random() * 9000));
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(rawPassword, salt);

        console.log("Inserting user...");
        await db.query(
            'INSERT INTO users (username, password, role, omc_id) VALUES ($1, $2, $3, $4)',
            [username, hashedPassword, 'OMC Admin', newOmc.id]
        );
        console.log("User created successfully");
        process.exit(0);
    } catch (e) {
        console.error("Error occurred:", e.message);
        process.exit(1);
    }
}

testCreateOMC();
