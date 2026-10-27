const { Client } = require('pg');
const client = new Client('postgres://postgres:Akshay@123@localhost:5432/petroleum_iot');
client.connect();
client.query("INSERT INTO omc (name, location, status) VALUES ('IOCL', 'Mumbai', 'Active') RETURNING id", (err, res) => {
    if (err) { console.error(err); client.end(); return; }
    const omcId = res.rows[0].id;
    client.query("INSERT INTO ro (name, omc_id, location, status) VALUES ('Mumbai RO', $1, 'Mumbai South', 'Active') RETURNING id", [omcId], (err, res2) => {
        if (err) { console.error(err); client.end(); return; }
        const roId = res2.rows[0].id;
        client.query("INSERT INTO machines (name, ro_id, type, status, health_score, live_temp, live_water, live_humidity, live_odour) VALUES ('SBP2T101', $1, 'Dispenser', 'Online', 100, '0', '0', '0', '0')", [roId], (err, res3) => {
            if (err) console.error(err);
            else console.log('Seed data inserted');
            client.end();
        });
    });
});
