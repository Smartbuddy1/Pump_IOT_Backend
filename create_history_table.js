const { Client } = require('pg');
const client = new Client('postgres://postgres:Akshay@123@localhost:5432/petroleum_iot');
client.connect();
client.query(`
    CREATE TABLE IF NOT EXISTS telemetry_history (
        id SERIAL PRIMARY KEY,
        machine_name VARCHAR(50) NOT NULL,
        temperature NUMERIC,
        water NUMERIC,
        humidity NUMERIC,
        odour NUMERIC,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`, (err, res) => {
    if (err) console.error(err);
    else console.log('telemetry_history table created');
    client.end();
});
