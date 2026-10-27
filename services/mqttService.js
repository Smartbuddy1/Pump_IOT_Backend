const mqtt = require('mqtt');
const pool = require('../config/db');
const logger = require('../utils/logger');

// Mosquitto Broker Configuration via Environment Variables
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'petroleum/iot/telemetry/+';
const MQTT_STATUS_TOPIC = process.env.MQTT_STATUS_TOPIC || 'petroleum/iot/status/+';
const MQTT_ALERTS_TOPIC = process.env.MQTT_ALERTS_TOPIC || 'petroleum/iot/alerts/+';

const mqttOptions = {
  clientId: process.env.MQTT_CLIENT_ID || `backend_iot_${Math.random().toString(16).substring(2, 8)}`,
  clean: true,
  connectTimeout: 30000,
  reconnectPeriod: 5000,
  keepalive: 60,
};

if (process.env.MQTT_USERNAME) {
  mqttOptions.username = process.env.MQTT_USERNAME;
  mqttOptions.password = process.env.MQTT_PASSWORD || '';
}

let mqttClient = null;

const initMqtt = (io) => {
  logger.info(`[MQTT] Connecting to Mosquitto Broker at: ${MQTT_BROKER} (Client: ${mqttOptions.clientId})`);

  mqttClient = mqtt.connect(MQTT_BROKER, mqttOptions);

  mqttClient.on('connect', () => {
    logger.info('Connected to Mosquitto MQTT Broker successfully! 📡');
    
    // Subscribe to telemetry, status (LWT), and direct alerts
    const topicsToSubscribe = [MQTT_TOPIC, MQTT_STATUS_TOPIC, MQTT_ALERTS_TOPIC];
    mqttClient.subscribe(topicsToSubscribe, { qos: 1 }, (err, granted) => {
      if (err) {
        logger.error(`[MQTT] Subscription Error: ${err.message}`);
      } else {
        logger.info(`[MQTT] Subscribed to topics: ${granted.map(g => g.topic).join(', ')}`);
      }
    });
  });

  mqttClient.on('reconnect', () => {
    logger.warn('[MQTT] Reconnecting to Mosquitto Broker...');
  });

  mqttClient.on('offline', () => {
    logger.warn('[MQTT] Mosquitto client is offline');
  });

  mqttClient.on('error', (err) => {
    logger.error(`[MQTT Client Error]: ${err.message}`);
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const payload = message.toString().trim();
      logger.info(`[MQTT Received] Topic: ${topic} | Payload: ${payload}`);

      // Extract Machine ID from wildcard topic (e.g., petroleum/iot/telemetry/SBP2T101)
      const topicParts = topic.split('/');
      let machineIdStr = topicParts[topicParts.length - 1];

      // Fetch machine metadata from DB to verify registration and get tenant routing (omc_id, ro_id)
      let machineInfo = null;
      try {
        const mRes = await pool.query(
          `SELECT m.id, m.name, m.ro_id, r.omc_id 
           FROM machines m 
           LEFT JOIN ro r ON m.ro_id = r.id 
           WHERE LOWER(m.name) = LOWER($1)`,
          [machineIdStr]
        );
        if (mRes.rows.length > 0) {
          machineInfo = mRes.rows[0];
        }
      } catch (dbErr) {
        logger.error(`[MQTT] Error querying machine info: ${dbErr.message}`);
      }

      // ── 1. Handle LWT / Machine Status Messages ───────────────────────────
      if (topic.startsWith('petroleum/iot/status/')) {
        const status = payload.toUpperCase() === 'OFFLINE' ? 'Offline' : 'Running';
        await pool.query('UPDATE machines SET status = $1 WHERE LOWER(name) = LOWER($2)', [status, machineIdStr]);

        const statusPayload = { machineId: machineIdStr, status };
        if (io) {
          // Broadcast globally + targeted tenant rooms
          io.emit('machine_status_update', statusPayload);
          if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('machine_status_update', statusPayload);
          if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('machine_status_update', statusPayload);
          io.to('super_admin').emit('machine_status_update', statusPayload);
        }
        logger.info(`[MQTT Status] Machine ${machineIdStr} is now ${status}`);
        return;
      }

      // ── 2. Parse Telemetry Payload ─────────────────────────────────────────
      // Format 1 (CSV): SBP2T101,LIVE_DATA,28,45,55,30,12,8
      // Format 2 (CSV without ID): LIVE_DATA,28,45,55,30,12,8
      const parts = payload.split(',');
      if (parts.length < 2) return;

      if (parts[0] !== 'LIVE_DATA' && parts[0] !== 'ALERT') {
        machineIdStr = parts[0];
      }

      const command = parts.length >= 2 && (parts[1] === 'LIVE_DATA' || parts[1] === 'ALERT') ? parts[1] : parts[0];

      // Handle LIVE_DATA telemetry
      if (command === 'LIVE_DATA' && parts.length >= 6) {
        const tempRaw = parts[2] ? parts[2].replace(/[^0-9.-]/g, '') : '25';
        const temp = tempRaw + '°C';
        
        // Clean water parsing (prevent NaN from strings like 'low')
        const rawWaterStr = String(parts[3] || '').replace('%', '').trim().toLowerCase();
        const parsedWaterNum = parseFloat(rawWaterStr);
        const waterNumeric = !isNaN(parsedWaterNum) ? parsedWaterNum : (rawWaterStr === 'low' ? 10 : 80);
        const waterStatus = rawWaterStr === 'low' || (!isNaN(parsedWaterNum) && parsedWaterNum <= 20) ? 'Low' : 'Normal';

        const humRaw = parts[4] ? parts[4].replace(/[^0-9.-]/g, '') : '50';
        const humidity = humRaw + '%';

        const odourRaw = parts[5] ? parts[5].replace(/[^0-9.-]/g, '') : '30';
        const odour = odourRaw + ' PPM';

        const nh3Raw = parts[6] ? parts[6].replace(/[^0-9.-]/g, '') : '0';
        const h2sRaw = parts[7] ? parts[7].replace(/[^0-9.-]/g, '') : '0';

        // Update live machine readings
        await pool.query(
          `UPDATE machines 
           SET live_temp = $1, 
               live_water = $2, 
               live_humidity = $3, 
               live_odour = $4,
               live_nh3 = COALESCE($5, live_nh3),
               live_h2s = COALESCE($6, live_h2s),
               status = 'Running'
           WHERE LOWER(name) = LOWER($7)`,
          [temp, waterStatus, humidity, odour, nh3Raw, h2sRaw, machineIdStr]
        );

        // Insert into telemetry_history for analytics & graphs
        await pool.query(
          `INSERT INTO telemetry_history (machine_name, temperature, water, humidity, odour) 
           VALUES ($1, $2, $3, $4, $5)`,
          [machineIdStr, parseFloat(tempRaw) || 0, waterNumeric, parseFloat(humRaw) || 0, parseFloat(odourRaw) || 0]
        );

        // Real-time WebSocket broadcast
        const telemetryBroadcast = {
          machineId: machineIdStr,
          temperature: temp,
          water: waterStatus,
          humidity: humidity,
          odour: odour,
          nh3: nh3Raw,
          h2s: h2sRaw
        };

        if (io) {
          io.emit('live_data_update', telemetryBroadcast);
          if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('live_data_update', telemetryBroadcast);
          if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('live_data_update', telemetryBroadcast);
          io.to('super_admin').emit('live_data_update', telemetryBroadcast);
        }

        logger.info(`[MQTT Processed] Telemetry updated for ${machineIdStr}`);
      }

      // ── 3. Handle ALERT Messages ───────────────────────────────────────────
      else if (command === 'ALERT' && parts.length >= 3) {
        const alertMsg = parts[2];

        // Fetch machine ID
        const mCheck = await pool.query(`SELECT id, ro_id FROM machines WHERE LOWER(name) = LOWER($1)`, [machineIdStr]);
        if (mCheck.rows.length > 0) {
          const mId = mCheck.rows[0].id;

          // Prevent duplicate active alerts for this machine
          const existing = await pool.query(
            `SELECT id FROM alerts WHERE machine_id = $1 AND message = $2 AND status != 'Resolved'`,
            [mId, alertMsg]
          );

          if (existing.rows.length === 0) {
            const isLow = alertMsg.toLowerCase().includes('low') || alertMsg.toLowerCase().includes('moderate');
            const severity = isLow ? 'Low' : 'Danger';

            await pool.query(
              `INSERT INTO alerts (machine_id, severity, message, status) VALUES ($1, $2, $3, 'Open')`,
              [mId, severity, alertMsg]
            );

            const alertPayload = {
              machineId: machineIdStr,
              alertMessage: alertMsg,
              severity: severity,
              timestamp: new Date().toISOString()
            };

            if (io) {
              io.emit('new_alert', alertPayload);
              if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('new_alert', alertPayload);
              if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('new_alert', alertPayload);
              io.to('super_admin').emit('new_alert', alertPayload);
            }

            logger.info(`[MQTT Alert Created] ${machineIdStr}: ${alertMsg} (${severity})`);
          }
        }
      }
    } catch (err) {
      logger.error(`[MQTT Process Error]: ${err.message}`);
    }
  });

  return mqttClient;
};

const getMqttClient = () => mqttClient;

module.exports = initMqtt;
module.exports.getMqttClient = getMqttClient;
