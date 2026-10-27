const mqtt = require('mqtt');
const pool = require('../config/db'); // Use your DB pool
const logger = require('../utils/logger');

// You can use a public broker for testing, or set this in .env
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'petroleum/iot/telemetry/+'; // Wildcard topic for dynamic machine scale

const initMqtt = (io) => {
  logger.info(`Connecting to MQTT Broker: ${MQTT_BROKER}`);
  const client = mqtt.connect(MQTT_BROKER);

  client.on('connect', () => {
    logger.info('Connected to MQTT Broker successfully! 📡');
    // Subscribe to the telemetry topic
    client.subscribe([MQTT_TOPIC, 'petroleum/iot/status/+'], (err) => {
      if (err) {
        logger.error(`MQTT Subscription Error: ${err.message}`);
      } else {
        logger.info(`Subscribed to MQTT Topic: ${MQTT_TOPIC} and petroleum/iot/status/+`);
      }
    });
  });

  client.on('message', async (topic, message) => {
    try {
      const payload = message.toString();
      logger.info(`[MQTT Received] Topic: ${topic} | Payload: ${payload}`);

      // Parse Machine ID from wildcard topic instead of payload (more enterprise standard)
      // Example topic: petroleum/iot/telemetry/SBP2T101
      const topicParts = topic.split('/');
      let machineIdStr = topicParts[topicParts.length - 1]; 
      
      // Handle LWT Status messages
      if (topic.startsWith('petroleum/iot/status/')) {
         const status = payload === 'OFFLINE' ? 'Offline' : 'Running';
         await pool.query('UPDATE machines SET status = $1 WHERE name = $2', [status, machineIdStr]);
         if (io) {
            io.emit('machine_status_update', { machineId: machineIdStr, status });
         }
         logger.info(`[MQTT Status] Machine ${machineIdStr} is now ${status}`);
         return;
      }
      
      const parts = payload.split(',');
      if (parts.length < 2) return;

      // Allow payload to dictate machineId if topic wildcard isn't used
      if (parts[0] !== 'LIVE_DATA' && parts[0] !== 'ALERT') {
          machineIdStr = parts[0];
      }
      
      const command = parts.length >= 2 && (parts[1] === 'LIVE_DATA' || parts[1] === 'ALERT') ? parts[1] : parts[0];

      if (command === 'LIVE_DATA' && parts.length === 6) {
        const temp = parts[2] + '°C';
        const rawWater = String(parts[3]).replace('%', '').trim().toLowerCase();
        const waterNum = parseInt(rawWater, 10);
        const water = rawWater === 'low' || (!isNaN(waterNum) && waterNum <= 20) ? 'Low' : 'Normal';
        const humidity = parts[4] + '%';
        const odour = parts[5] + ' PPM';

        // Update the database.
        // Assuming we map string ID 'SBE2T101' to a machine in the database.
        // (If the machines table ID is integer, we might need to match by 'name' or a new 'hardware_id' column. We will match by 'name' for now).
        await pool.query(
          `UPDATE machines 
           SET live_temp = $1, live_water = $2, live_humidity = $3, live_odour = $4 
           WHERE name = $5`,
          [temp, water, humidity, odour, machineIdStr]
        );
        
        // Also insert into telemetry_history for analytics charts
        await pool.query(
          `INSERT INTO telemetry_history (machine_name, temperature, water, humidity, odour) 
           VALUES ($1, $2, $3, $4, $5)`,
          [machineIdStr, parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4]), parseFloat(parts[5])]
        );
        
        // Broadcast Real-time Live Data Update via WebSockets
        if (io) {
          io.emit('live_data_update', {
             machineId: machineIdStr,
             temperature: temp,
             water: water,
             humidity: humidity,
             odour: odour
          });
        }
        
        logger.info(`[MQTT Processed] Updated telemetry and history for ${machineIdStr}`);
      } 
      else if (command === 'ALERT' && parts.length >= 3) {
        const alertMsg = parts[2];
        
        // Find machine ID from name
        const machineRes = await pool.query(`SELECT id FROM machines WHERE name = $1`, [machineIdStr]);
        if (machineRes.rows.length > 0) {
          const mId = machineRes.rows[0].id;
          
          // Prevent duplicate active alerts for this machine and message
          const existingAlert = await pool.query(
            `SELECT id FROM alerts WHERE machine_id = $1 AND message = $2 AND status != 'Resolved'`,
            [mId, alertMsg]
          );

          if (existingAlert.rows.length === 0) {
            const isLowSeverity = alertMsg.toLowerCase().includes('low') || alertMsg.toLowerCase().includes('moderate');
            const calculatedSeverity = isLowSeverity ? 'Low' : 'Danger';

            await pool.query(
              `INSERT INTO alerts (machine_id, severity, message, status) VALUES ($1, $2, $3, 'Open')`,
              [mId, calculatedSeverity, alertMsg]
            );
            
            // Broadcast Real-time Alert Notification via WebSockets
            if (io) {
              io.emit('new_alert', {
                 machineId: machineIdStr,
                 alertMessage: alertMsg,
                 severity: calculatedSeverity
              });
            }
            
            logger.info(`[MQTT Processed] Created Alert for ${machineIdStr}: ${alertMsg} (${calculatedSeverity})`);
          } else {
            logger.info(`[MQTT Processed] Ignored duplicate active alert for ${machineIdStr}: ${alertMsg}`);
          }
        }
      }

    } catch (err) {
      logger.error(`[MQTT Error processing message]: ${err.message}`);
    }
  });

  client.on('error', (err) => {
    logger.error(`MQTT Client Error: ${err.message}`);
  });
};

module.exports = initMqtt;
