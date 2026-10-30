const mqtt = require('mqtt');
require('dotenv').config();
const pool = require('./config/db');

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://13.232.110.133:1883';
const MAIN_TOPIC = process.env.MQTT_TOPIC || 'petroleum';

async function startSimulator() {
  console.log(`Connecting to MQTT Broker: ${MQTT_BROKER}...`);
  const mqttOptions = {
    clientId: `simulator_${Math.random().toString(16).substring(2, 8)}`,
    clean: true,
  };
  if (process.env.MQTT_USERNAME) {
    mqttOptions.username = process.env.MQTT_USERNAME;
    mqttOptions.password = process.env.MQTT_PASSWORD || '';
  }
  const client = mqtt.connect(MQTT_BROKER, mqttOptions);

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
    console.log(`Publishing all telemetry & alerts to unified topic: '${MAIN_TOPIC}'`);

    // Set machines status to Running
    machineNames.forEach(mName => {
      client.publish(MAIN_TOPIC, `${mName},Running`);
      client.publish(`petroleum/iot/status/${mName}`, 'Running');
    });

    // Publish LIVE_DATA every 4 seconds for active machines
    setInterval(() => {
      machineNames.forEach(mName => {
        const temp = (Math.random() * (35 - 24) + 24).toFixed(1); // 24 to 35 C (normal)
        const water = (Math.random() * (90 - 40) + 40).toFixed(1); // 40 to 90% (normal)
        const humidity = (Math.random() * (60 - 40) + 40).toFixed(1); // 40 to 60% (normal)
        const odour = (Math.random() * (25 - 5) + 5).toFixed(1); // 5 to 25 PPM (clean)
        const nh3 = (Math.random() * (15 - 2) + 2).toFixed(1); // 2 to 15 PPM
        const h2s = (Math.random() * (10 - 1) + 1).toFixed(1); // 1 to 10 PPM

        const payload = `${mName},LIVE_DATA,${temp},${water},${humidity},${odour},${nh3},${h2s}`;

        // 1. Publish to unified topic 'petroleum'
        client.publish(MAIN_TOPIC, payload, () => {
          console.log(`Published [${MAIN_TOPIC}]: ${payload}`);
        });

        // 2. Also publish to legacy topic
        client.publish(`petroleum/iot/telemetry/${mName}`, payload);
      });
    }, 4000);

    // Occasional alert generator
    setInterval(() => {
      if (machineNames.length === 0) return;
      const mName = machineNames[Math.floor(Math.random() * machineNames.length)];
      const alertTypes = ['Water Level Low - Refill required', 'High Temperature Detected'];
      const randomAlert = alertTypes[Math.floor(Math.random() * alertTypes.length)];
      const payload = `${mName},ALERT,${randomAlert}`;

      client.publish(MAIN_TOPIC, payload, () => {
        console.log(`Published ALERT [${MAIN_TOPIC}]: ${payload}`);
      });
    }, 30000);
  });
}

startSimulator();
