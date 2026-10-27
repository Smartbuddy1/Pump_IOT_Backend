const db = require('./config/db');
async function checkUsers() {
    try {
        const res = await db.query("SELECT * FROM users");
        console.log(res.rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkUsers();
