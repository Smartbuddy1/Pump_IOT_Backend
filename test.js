const { Client } = require('pg');
const client = new Client('postgres://postgres:Akshay@123@localhost:5432/petroleum_iot');

async function test() {
  await client.connect();
  const res = await client.query('SELECT * FROM omc');
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

test();
