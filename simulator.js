const mqtt = require('mqtt');
require('dotenv').config();
const pool = require('./config/db');

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';

async function startSimulator() {
  console.log(`Connecting to MQTT Broker: ${MQTT_BROKER}...`);
  const client = mqtt.connect(MQTT_BROKER);

  // Fetch machines from DB or fallback
  let machineNames = ['SBP2T601', 'SBP2T101'];
  try {
    const res = await pool.query("SELECT name FROM machines WHERE status = 'ACTIVE' OR status = 'Running'");
    if (res.rows.length > 0) {
      machineNames = res.rows.map(r => r.name);
    }
  } catch (err) {
    console.warn('Could not load machines from DB, using defaults:', err.message);
  }

  client.on('connect', () => {
    console.log(`Simulation Started for machines: [${machineNames.join(', ')}]! Connected to Broker 🚀`);

    // Set machines status to Running
    machineNames.forEach(mName => {
      client.publish(`petroleum/iot/status/${mName}`, 'Running');
    });

    // Publish LIVE_DATA every 3 seconds for active machines
    setInterval(() => {
      machineNames.forEach(mName => {
        const temp = (Math.random() * (35 - 24) + 24).toFixed(1); // 24 to 35 C (normal)
        const water = (Math.random() * (90 - 40) + 40).toFixed(1); // 40 to 90% (normal)
        const humidity = (Math.random() * (60 - 40) + 40).toFixed(1); // 40 to 60% (normal)
        const odour = (Math.random() * (25 - 5) + 5).toFixed(1); // 5 to 25 PPM (clean)

        const topic = `petroleum/iot/telemetry/${mName}`;
        const payload = `${mName},LIVE_DATA,${temp},${water},${humidity},${odour}`;

        client.publish(topic, payload, () => {
          console.log(`Published: [${topic}] ${payload}`);
        });
      });
    }, 4000);

    // Occasional alert generator
    setInterval(() => {
      if (machineNames.length === 0) return;
      const mName = machineNames[Math.floor(Math.random() * machineNames.length)];
      const alertTypes = ['Water Level Low - Refill required', 'High Temperature Detected'];
      const randomAlert = alertTypes[Math.floor(Math.random() * alertTypes.length)];
      const topic = `petroleum/iot/telemetry/${mName}`;
      const payload = `${mName},ALERT,${randomAlert}`;

      client.publish(topic, payload, () => {
        console.log(`Published ALERT: [${topic}] ${payload}`);
      });
    }, 30000);
  });
}

startSimulator();
