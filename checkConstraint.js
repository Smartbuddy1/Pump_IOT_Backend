const db = require('./config/db');

async function testConstraints() {
    try {
        const res = await db.query("SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name = 'users'");
        console.log("users constraints:", res.rows);
        const res2 = await db.query("SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name = 'omc'");
        console.log("omc constraints:", res2.rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
testConstraints();
