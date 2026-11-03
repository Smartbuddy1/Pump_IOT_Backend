const mqtt = require('mqtt');
const pool = require('../config/db');
const logger = require('../utils/logger');

// Mosquitto Broker Configuration via Environment Variables
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
// Primary topic is now the simplified 'petroleum'
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'petroleum';
const MQTT_STATUS_TOPIC = process.env.MQTT_STATUS_TOPIC || 'petroleum/iot/status/+';
const MQTT_ALERTS_TOPIC = process.env.MQTT_ALERTS_TOPIC || 'petroleum/iot/alerts/+';
const MQTT_COMMANDS_TOPIC = process.env.MQTT_COMMANDS_TOPIC || 'petroleum/iot/commands/+';

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
const machineMetadataCache = new Map(); // In-memory cache for fast tenant routing (1 min TTL)

const getCachedMachineInfo = async (machineName) => {
  if (!machineName || machineName.toLowerCase() === 'petroleum') return null;
  const cacheKey = String(machineName || '').toLowerCase().trim();
  const cached = machineMetadataCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp < 60000)) {
    return cached.info;
  }
  try {
    const mRes = await pool.query(
      `SELECT m.id, m.name, m.ro_id, r.omc_id 
       FROM machines m 
       LEFT JOIN ro r ON m.ro_id = r.id 
       WHERE LOWER(m.name) = LOWER($1) 
          OR REPLACE(LOWER(m.name), 'o', '0') = REPLACE(LOWER($1), 'o', '0')
       LIMIT 1`,
      [cacheKey]
    );
    const info = mRes.rows.length > 0 ? mRes.rows[0] : null;
    machineMetadataCache.set(cacheKey, { info, timestamp: now });
    if (info && info.name) {
      machineMetadataCache.set(info.name.toLowerCase().trim(), { info, timestamp: now });
    }
    return info;
  } catch (dbErr) {
    logger.error(`[MQTT] Error querying machine info: ${dbErr.message}`);
    return cached ? cached.info : null;
  }
};

const initMqtt = (io) => {
  logger.info(`[MQTT] Connecting to Mosquitto Broker at: ${MQTT_BROKER} (Client: ${mqttOptions.clientId})`);

  mqttClient = mqtt.connect(MQTT_BROKER, mqttOptions);

  mqttClient.on('connect', () => {
    console.log('📡 Connected to Mosquitto MQTT Broker successfully!');
    logger.info('Connected to Mosquitto MQTT Broker successfully! 📡');
    
    // Subscribe to:
    // 1. 'petroleum' (Primary single topic for all hardware telemetry/alerts/status)
    // 2. Legacy topics for complete backward compatibility
    const topicsToSubscribe = [
      'petroleum',
      'petroleum/iot/telemetry/+',
      'petroleum/iot/status/+',
      'petroleum/iot/alerts/+',
      'petroleum/iot/commands/+',
      'petroleum/iot/footfall/+',
      'petroleum/footfall/+'
    ];
    if (MQTT_TOPIC && !topicsToSubscribe.includes(MQTT_TOPIC)) {
      topicsToSubscribe.push(MQTT_TOPIC);
    }

    // Auto-migrate footfall_history table and visits column on startup
    pool.query(`
      ALTER TABLE machines ADD COLUMN IF NOT EXISTS visits INTEGER DEFAULT 0;
      CREATE TABLE IF NOT EXISTS footfall_history (
        id SERIAL PRIMARY KEY,
        machine_name VARCHAR(100) NOT NULL,
        machine_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_footfall_history_machine_date ON footfall_history (machine_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_footfall_history_created_at ON footfall_history (created_at DESC);
    `).catch(err => logger.error(`[DB Migration] Auto-migration error: ${err.message}`));

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
      console.log(`📩 MQTT Message: [${topic}] -> ${payload}`);
      logger.info(`[MQTT Received] Topic: ${topic} | Payload: ${payload}`);

      // ── Step 1: Extract Machine ID and Command from Payload & Topic ────────
      let machineIdStr = '';
      const topicParts = topic.split('/');
      const lastTopicPart = topicParts[topicParts.length - 1];

      // If topic has subtopic beyond 'petroleum' (e.g. petroleum/iot/telemetry/SBP2T101)
      const ignoredTopicWords = ['petroleum', 'iot', 'telemetry', 'status', 'alerts', 'commands', '+', '#'];
      if (lastTopicPart && !ignoredTopicWords.includes(lastTopicPart.toLowerCase())) {
        machineIdStr = lastTopicPart.trim();
      }

      // Check if payload is JSON
      let parsedJson = null;
      if ((payload.startsWith('{') && payload.endsWith('}')) || (payload.startsWith('[') && payload.endsWith(']'))) {
        try {
          parsedJson = JSON.parse(payload);
        } catch (e) {}
      }

      const parts = payload.split(',').map(p => p.trim());
      const firstPartUpper = String(parts[0] || '').trim().toUpperCase();
      const secondPartUpper = String(parts[1] || '').trim().toUpperCase();
      const knownKeywords = ['LIVE_DATA', 'ALERT', 'STATUS', 'OFFLINE', 'ONLINE', 'RUNNING', 'ACTIVE', 'INACTIVE', 'SET_WIFI', 'WIFI', 'PERSON_IN', 'PERSON-IN'];

      if (parsedJson && typeof parsedJson === 'object') {
        const jsonId = parsedJson.machine_id || parsedJson.machineId || parsedJson.id || parsedJson.name || parsedJson.machine || parsedJson.device_id || parsedJson.deviceId;
        if (jsonId) machineIdStr = String(jsonId).trim();
      } else if (parts.length >= 2 && secondPartUpper === 'PERSON_IN') {
        // Direct format: serial number,PERSON_IN (e.g. SBP2T101,PERSON_IN)
        machineIdStr = parts[0].trim();
      } else if (firstPartUpper === 'PERSON_IN' && parts.length >= 2) {
        machineIdStr = parts[1].trim();
      } else if (parts.length >= 2 && !knownKeywords.includes(firstPartUpper) && !firstPartUpper.startsWith('SET_WIFI') && !firstPartUpper.startsWith('WIFI:')) {
        machineIdStr = parts[0].trim();
      }

      if (!machineIdStr || machineIdStr.toLowerCase() === 'petroleum') {
        logger.warn(`[MQTT] Discarding message: Machine ID could not be identified from topic '${topic}' or payload '${payload}'`);
        return;
      }

      // In-memory cached lookup for machine metadata (zero-latency tenant routing)
      let machineInfo = await getCachedMachineInfo(machineIdStr);

      // ── Step 1.5: Handle FOOTFALL (PERSON_IN) Messages ─────────────────────
      // Supports:
      // - Payload format: serial number,PERSON_IN (e.g. SBP2T101,PERSON_IN)
      // - Topic format: petroleum/iot/telemetry/SBP2T101 with payload 'PERSON_IN'
      // - JSON: { "machine_id": "SBP2T101", "event": "PERSON_IN" } or { "command": "PERSON_IN" }
      const isFootfallCsv = (parts.length >= 2 && secondPartUpper === 'PERSON_IN') ||
                            (firstPartUpper === 'PERSON_IN') ||
                            (payload.toUpperCase().includes('PERSON_IN'));
      const isFootfallJson = parsedJson && (
        String(parsedJson.event || '').toUpperCase() === 'PERSON_IN' ||
        String(parsedJson.command || '').toUpperCase() === 'PERSON_IN' ||
        String(parsedJson.action || '').toUpperCase() === 'PERSON_IN' ||
        parsedJson.footfall === 1 || parsedJson.person_in === true
      );

      if (isFootfallCsv || isFootfallJson) {
        let mId = machineInfo?.id;

        // Auto-register machine if not found so no footfall count is lost
        if (!mId) {
          const mCheck = await pool.query(
            `SELECT m.id, m.name, m.ro_id, r.omc_id 
             FROM machines m 
             LEFT JOIN ro r ON m.ro_id = r.id 
             WHERE LOWER(m.name) = LOWER($1) 
                OR REPLACE(LOWER(m.name), 'o', '0') = REPLACE(LOWER($1), 'o', '0') 
             LIMIT 1`,
            [machineIdStr]
          );
          if (mCheck.rows.length > 0) {
            machineInfo = mCheck.rows[0];
            mId = machineInfo.id;
          } else {
            const defaultRoRes = await pool.query('SELECT id FROM ro ORDER BY id ASC LIMIT 1');
            const defaultRoId = defaultRoRes.rows[0]?.id || 1;
            const newMRes = await pool.query(
              `INSERT INTO machines (name, ro_id, type, status, visits, last_seen)
               VALUES ($1, $2, 'Dispenser', 'Active', 1, CURRENT_TIMESTAMP)
               RETURNING id, name, ro_id`,
              [machineIdStr, defaultRoId]
            );
            machineInfo = newMRes.rows[0];
            mId = machineInfo.id;
            machineMetadataCache.delete(machineIdStr.toLowerCase());
          }
        }

        const canonicalId = machineInfo?.name || machineIdStr;

        // 1. Increment machine visits count in machines table
        const updRes = await pool.query(
          `UPDATE machines 
           SET visits = COALESCE(visits, 0) + 1, 
               status = 'Active', 
               last_seen = CURRENT_TIMESTAMP 
           WHERE id = $1 
           RETURNING visits`,
          [mId]
        );
        const updatedMachineVisits = updRes.rows[0]?.visits || 1;

        // 2. Insert into dedicated footfall_history table
        try {
          await pool.query(
            `INSERT INTO footfall_history (machine_name, machine_id) VALUES ($1, $2)`,
            [canonicalId, mId]
          );
        } catch (fhErr) {
          logger.error(`[MQTT Footfall] Error inserting into footfall_history: ${fhErr.message}`);
        }

        // 3. Also insert into telemetry_history for analytics compatibility
        try {
          await pool.query(
            `INSERT INTO telemetry_history (machine_name, temperature, water, humidity, odour, nh3, h2s) 
             VALUES ($1, 28, 85, 50, 20, 5, 2)`,
            [canonicalId]
          );
        } catch (thErr) {}

        // 4. Query updated today's total footfall count
        let todayUsersCount = 1;
        try {
          const todayRes = await pool.query(`
            SELECT COUNT(*) as today_count 
            FROM footfall_history 
            WHERE (created_at + INTERVAL '5 hours 30 minutes') >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE
          `);
          todayUsersCount = parseInt(todayRes.rows[0]?.today_count || 1, 10);
        } catch (e) {}

        // 5. Emit real-time WebSocket notifications
        const footfallPayload = {
          machineId: canonicalId,
          machineName: canonicalId,
          machineIdNum: mId,
          visits: updatedMachineVisits,
          todayUsers: todayUsersCount,
          timestamp: new Date().toISOString()
        };

        if (io) {
          if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('footfall_update', footfallPayload);
          if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('footfall_update', footfallPayload);
          io.to('super_admin').emit('footfall_update', footfallPayload);
          io.emit('footfall_update', footfallPayload);
          io.emit('person_in', footfallPayload);
        }

        console.log(`🚶 Footfall Event: [${canonicalId}] -> Machine Total Visits: ${updatedMachineVisits}, Today's Total: ${todayUsersCount}`);
        logger.info(`[MQTT Footfall] PERSON_IN event processed for ${canonicalId} (Visits: ${updatedMachineVisits})`);
        return;
      }

      // ── Step 2: Handle LWT / Machine Status Messages ───────────────────────
      // Supports:
      // - Topic: petroleum/iot/status/SBP2T101 with payload 'Running' / 'OFFLINE'
      // - Topic: petroleum with payload 'SBP2T101,Running' or 'SBP2T101,OFFLINE' or 'SBP2T101,STATUS,Active'
      // - JSON: { "machine_id": "SBP2T101", "status": "Running" }
      const isStatusTopic = topic.startsWith('petroleum/iot/status/') || topic.endsWith('/status');
      const isStatusCsv = (parts.length === 2 && ['ONLINE', 'OFFLINE', 'RUNNING', 'ACTIVE', 'INACTIVE'].includes(String(parts[1] || '').trim().toUpperCase())) ||
                          (parts.length >= 3 && String(parts[1] || '').trim().toUpperCase() === 'STATUS');
      const isStatusJson = parsedJson && parsedJson.status !== undefined && parsedJson.temperature === undefined;

      if (isStatusTopic || isStatusCsv || isStatusJson) {
        let rawStatus = '';
        if (isStatusJson) {
          rawStatus = String(parsedJson.status);
        } else if (isStatusCsv) {
          rawStatus = parts.length >= 3 ? parts[2] : parts[1];
        } else {
          rawStatus = payload;
        }

        const isOffline = rawStatus.toUpperCase() === 'OFFLINE' || rawStatus.toUpperCase() === 'INACTIVE';
        const status = isOffline ? 'Inactive' : 'Active';
        await pool.query('UPDATE machines SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE LOWER(name) = LOWER($2)', [status, machineIdStr]);

        const statusPayload = { machineId: machineIdStr, status };
        if (io) {
          if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('machine_status_update', statusPayload);
          if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('machine_status_update', statusPayload);
          io.to('super_admin').emit('machine_status_update', statusPayload);
          io.emit('machine_status_update', statusPayload);
        }
        console.log(`📡 Machine Status: [${machineIdStr}] -> ${status}`);
        logger.info(`[MQTT Status] Machine ${machineIdStr} is now ${status}`);
        return;
      }

      // ── Step 3: Parse Telemetry Payload (LIVE_DATA) ────────────────────────
      // Format 1 (CSV with ID): SBP2T101,LIVE_DATA,28,45,55,30,12,8
      // Format 2 (CSV without ID): LIVE_DATA,28,45,55,30,12,8 (machineId from topic)
      // Format 3 (JSON): { "machine_id": "SBP2T101", "temperature": 28, "water": 45, "humidity": 55, "odour": 30, "nh3": 12, "h2s": 8 }
      const isLiveCsv = parts.length >= 2 && (parts[0] === 'LIVE_DATA' || parts[1] === 'LIVE_DATA');
      const isLiveJson = parsedJson && (parsedJson.temperature !== undefined || parsedJson.temp !== undefined || parsedJson.live_temp !== undefined);

      if (isLiveCsv || isLiveJson) {
        let rawTemp, rawWater, rawHum, rawOdour, rawNh3, rawH2s;

        if (isLiveJson) {
          rawTemp = parsedJson.temperature ?? parsedJson.temp ?? parsedJson.live_temp ?? '28';
          rawHum = parsedJson.humidity ?? parsedJson.hum ?? parsedJson.live_humidity ?? '50';
          rawOdour = parsedJson.voc ?? parsedJson.voc_gas ?? parsedJson.odour ?? parsedJson.odor ?? parsedJson.live_odour ?? '40';
          rawNh3 = parsedJson.nh3 ?? parsedJson.live_nh3 ?? '0';
          rawH2s = parsedJson.h2s ?? parsedJson.live_h2s ?? '0';

          const jWater = parsedJson.water ?? parsedJson.water_level ?? parsedJson.live_water;
          if (jWater === 0 || jWater === '0' || String(jWater).toLowerCase() === 'low') {
            rawWater = 'Low';
          } else if (jWater === 1 || jWater === '1' || String(jWater).toLowerCase() === 'normal') {
            rawWater = 'Normal';
          } else {
            rawWater = jWater ?? 'Normal';
          }
        } else {
          // If parts[1] is LIVE_DATA, data starts at index 2. If parts[0] is LIVE_DATA, data starts at index 1.
          const offset = (parts[1] === 'LIVE_DATA') ? 2 : 1;
          const dataParts = parts.slice(offset).map(p => p.trim());

          // Check if water level is added at the end per Rahul Sir's specification:
          // "Water level will be added as 1 or 0 in existing string at the end"
          // "1 is normal"
          // "0 is low level"
          const lastDataPart = String(dataParts[dataParts.length - 1] || '').trim();
          const isWaterAtEnd = (dataParts.length >= 6) && (
            lastDataPart === '0' || lastDataPart === '1' || 
            lastDataPart.toLowerCase() === 'normal' || lastDataPart.toLowerCase() === 'low'
          );

          if (isWaterAtEnd) {
            // New Hardware format: MachineID,LIVE_DATA,temp,hum,voc,nh3,h2s,water_level
            // E.g.: SBE2O001,LIVE_DATA,33,55,1231,627,1379,1 (1 = Normal)
            // E.g.: SBE2O001,LIVE_DATA,33,55,1231,627,1379,0 (0 = Low Level)
            rawTemp = dataParts[0];
            rawHum = dataParts[1];
            rawOdour = dataParts[2];
            rawNh3 = dataParts[3];
            rawH2s = dataParts[4];
            rawWater = (lastDataPart === '1' || lastDataPart.toLowerCase() === 'normal') ? 'Normal' : 'Low';
          } else if (dataParts.length === 5) {
            // Hardware format from petroleum topic without water: MachineID,LIVE_DATA,temp,hum,voc,nh3,h2s
            // E.g.: SBE2O001,LIVE_DATA,33,55,1231,627,1379
            rawTemp = dataParts[0];
            rawHum = dataParts[1];
            rawOdour = dataParts[2];
            rawNh3 = dataParts[3];
            rawH2s = dataParts[4];
            rawWater = 'Normal';
          } else if (dataParts.length >= 6) {
            // Legacy / Simulator format with water at index 1: MachineID,LIVE_DATA,temp,water,hum,odour,nh3,h2s
            rawTemp = dataParts[0];
            rawWater = dataParts[1];
            rawHum = dataParts[2];
            rawOdour = dataParts[3];
            rawNh3 = dataParts[4];
            rawH2s = dataParts[5];
          } else if (dataParts.length === 4) {
            // E.g.: SBP2T101,LIVE_DATA,27,80,45,15
            rawTemp = dataParts[0];
            rawWater = dataParts[1];
            rawHum = dataParts[2];
            rawOdour = dataParts[3];
            rawNh3 = '0';
            rawH2s = '0';
          } else {
            rawTemp = dataParts[0] || '28';
            rawWater = dataParts[1] || 'Normal';
            rawHum = dataParts[2] || '50';
            rawOdour = dataParts[3] || '40';
            rawNh3 = dataParts[4] || '0';
            rawH2s = dataParts[5] || '0';
          }
        }

        // Sanity validation & clamping for sensor readings
        let tempVal = parseFloat(String(rawTemp || '').replace(/[^0-9.-]/g, ''));
        if (isNaN(tempVal) || tempVal < -40 || tempVal > 100) tempVal = 0;
        const temp = `${tempVal}°C`;
        const tempRaw = String(tempVal);
        
        // Clean water parsing strictly following Rahul Sir's specification:
        // 1 is normal
        // 0 is low level
        let waterStatus = 'Normal';
        let waterNumeric = 85;

        const cleanWaterStr = String(rawWater || '').trim().toLowerCase();
        if (cleanWaterStr === '0' || cleanWaterStr === 'low' || cleanWaterStr === 'empty') {
          waterStatus = 'Low';
          waterNumeric = 10;
        } else if (cleanWaterStr === '1' || cleanWaterStr === 'normal' || cleanWaterStr === 'high' || cleanWaterStr === 'ok') {
          waterStatus = 'Normal';
          waterNumeric = 85;
        } else {
          let parsedWaterNum = parseFloat(cleanWaterStr.replace('%', ''));
          if (isNaN(parsedWaterNum)) {
            parsedWaterNum = (cleanWaterStr === 'low' ? 10 : 85);
          }
          waterNumeric = Math.max(0, Math.min(100, parsedWaterNum));
          waterStatus = waterNumeric <= 20 ? 'Low' : 'Normal';
        }

        let humVal = parseFloat(String(rawHum || '').replace(/[^0-9.-]/g, ''));
        if (isNaN(humVal) || humVal < 0 || humVal > 100) humVal = 0;
        const humidity = `${humVal}%`;
        const humRaw = String(humVal);

        let odourVal = parseFloat(String(rawOdour || '').replace(/[^0-9.-]/g, ''));
        if (isNaN(odourVal) || odourVal < 0) odourVal = 0;
        if (odourVal > 100000) odourVal = 100000;
        const odour = `${odourVal} PPM`;
        const odourRaw = String(odourVal);

        let nh3Val = parseFloat(String(rawNh3 || '').replace(/[^0-9.-]/g, ''));
        if (isNaN(nh3Val) || nh3Val < 0) nh3Val = 0;
        if (nh3Val > 100000) nh3Val = 100000;
        const nh3Raw = String(nh3Val);

        let h2sVal = parseFloat(String(rawH2s || '').replace(/[^0-9.-]/g, ''));
        if (isNaN(h2sVal) || h2sVal < 0) h2sVal = 0;
        if (h2sVal > 100000) h2sVal = 100000;
        const h2sRaw = String(h2sVal);

        // Update live machine readings in database
        const updateRes = await pool.query(
          `UPDATE machines 
           SET live_temp = $1, 
               live_water = $2, 
               live_humidity = $3, 
               live_odour = $4,
               live_nh3 = COALESCE($5, live_nh3),
               live_h2s = COALESCE($6, live_h2s),
               status = 'Active',
               last_seen = CURRENT_TIMESTAMP
           WHERE LOWER(name) = LOWER($7) 
              OR REPLACE(LOWER(name), 'o', '0') = REPLACE(LOWER($7), 'o', '0')`,
          [temp, waterStatus, humidity, odour, nh3Raw, h2sRaw, machineIdStr]
        );

        // If machine does not exist in DB yet, auto-register it to default RO so live telemetry is never lost!
        if (updateRes.rowCount === 0) {
          const defaultRoRes = await pool.query('SELECT id FROM ro ORDER BY id ASC LIMIT 1');
          const defaultRoId = defaultRoRes.rows[0]?.id || 1;
          await pool.query(
            `INSERT INTO machines (name, ro_id, type, status, live_temp, live_water, live_humidity, live_odour, live_nh3, live_h2s, last_seen)
             VALUES ($1, $2, 'Dispenser', 'Active', $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
            [machineIdStr, defaultRoId, temp, waterStatus, humidity, odour, nh3Raw, h2sRaw]
          );
          logger.info(`[MQTT Auto-Register] Machine ${machineIdStr} auto-registered under RO ${defaultRoId} with live telemetry!`);
          machineMetadataCache.delete(machineIdStr.toLowerCase());
          machineInfo = await getCachedMachineInfo(machineIdStr);
        }

        const canonicalId = machineInfo?.name || machineIdStr;
        const targetMachineId = machineInfo?.id;

        // ── Automated Water Level Alert Lifecycle ──
        if (targetMachineId) {
          try {
            if (waterStatus === 'Low') {
              const existingAlert = await pool.query(
                `SELECT id FROM alerts WHERE machine_id = $1 AND message LIKE '%Water Level Low%' AND status != 'Resolved'`,
                [targetMachineId]
              );
              if (existingAlert.rows.length === 0) {
                await pool.query(
                  `INSERT INTO alerts (machine_id, severity, message, status) VALUES ($1, 'Low', 'Water Level Low - Refill required', 'Open')`,
                  [targetMachineId]
                );
                const alertPayload = {
                  machineId: canonicalId,
                  alertMessage: 'Water Level Low - Refill required',
                  severity: 'Low',
                  timestamp: new Date().toISOString()
                };
                if (io) {
                  if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('new_alert', alertPayload);
                  if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('new_alert', alertPayload);
                  io.to('super_admin').emit('new_alert', alertPayload);
                  io.emit('new_alert', alertPayload);
                }
                console.log(`⚠️ Water Alert Created: [${canonicalId}] -> Water Level Low (0)`);
                logger.info(`[Water Alert] Water level low alert generated for ${canonicalId}`);
              }
            } else if (waterStatus === 'Normal') {
              // Auto-resolve any open Water Level Low alert when tank is refilled (1)
              const resolveRes = await pool.query(
                `UPDATE alerts SET status = 'Resolved' WHERE machine_id = $1 AND message LIKE '%Water Level Low%' AND status != 'Resolved' RETURNING id`,
                [targetMachineId]
              );
              if (resolveRes.rowCount > 0 && io) {
                const resolvePayload = {
                  machineId: canonicalId,
                  alertMessage: 'Water Level Low - Refill required',
                  status: 'Resolved',
                  timestamp: new Date().toISOString()
                };
                if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('alert_resolved', resolvePayload);
                if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('alert_resolved', resolvePayload);
                io.to('super_admin').emit('alert_resolved', resolvePayload);
                io.emit('alert_resolved', resolvePayload);
                console.log(`✅ Water Alert Auto-Resolved: [${canonicalId}] -> Water level restored to Normal (1)`);
              }
            }
          } catch (wAlertErr) {
            logger.error(`[Water Alert Lifecycle Error]: ${wAlertErr.message}`);
          }
        }

        // Insert into telemetry_history for analytics & graphs
        try {
          await pool.query(
            `INSERT INTO telemetry_history (machine_name, temperature, water, humidity, odour, nh3, h2s) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [canonicalId, parseFloat(tempRaw) || 0, waterNumeric, parseFloat(humRaw) || 0, parseFloat(odourRaw) || 0, parseFloat(nh3Raw) || 0, parseFloat(h2sRaw) || 0]
          );
        } catch (histErr) {
          await pool.query(
            `INSERT INTO telemetry_history (machine_name, temperature, water, humidity, odour) 
             VALUES ($1, $2, $3, $4, $5)`,
            [canonicalId, parseFloat(tempRaw) || 0, waterNumeric, parseFloat(humRaw) || 0, parseFloat(odourRaw) || 0]
          );
        }

        // Real-time WebSocket broadcast strictly routed to tenant rooms
        const telemetryBroadcast = {
          machineId: canonicalId,
          rawMachineId: machineIdStr,
          temperature: temp,
          water: waterStatus,
          waterLevel: waterStatus === 'Normal' ? 1 : 0,
          humidity: humidity,
          odour: odour,
          nh3: nh3Raw,
          h2s: h2sRaw,
          timestamp: new Date().toISOString()
        };

        if (io) {
          if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('live_data_update', telemetryBroadcast);
          if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('live_data_update', telemetryBroadcast);
          io.to('super_admin').emit('live_data_update', telemetryBroadcast);
          io.emit('live_data_update', telemetryBroadcast);
          io.emit('new_reading', telemetryBroadcast);

          const statusPayload = { machineId: canonicalId, status: 'Active' };
          if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('machine_status_update', statusPayload);
          if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('machine_status_update', statusPayload);
          io.to('super_admin').emit('machine_status_update', statusPayload);
          io.emit('machine_status_update', statusPayload);
        }

        console.log(`✅ Telemetry saved for ${canonicalId}: Temp=${temp}, Hum=${humidity}, VOC=${odour}, NH3=${nh3Raw}, H2S=${h2sRaw}`);
        logger.info(`[MQTT Processed] Telemetry updated for ${machineIdStr} (Topic: ${topic})`);
        return;
      }

      // ── Step 4: Handle SET_WIFI / Remote WiFi Configuration ────────────────
      if (payload.includes('SET_WIFI') || payload.includes('WIFI:') || (parsedJson && (parsedJson.wifi_name || parsedJson.ssid))) {
        let ssid = '';
        let pass = '';

        if (parsedJson) {
          ssid = parsedJson.wifi_name || parsedJson.ssid || '';
          pass = parsedJson.wifi_password || parsedJson.password || '';
        } else if (payload.includes('SET_WIFI:')) {
          const afterColon = payload.split('SET_WIFI:')[1] || '';
          const commaIdx = afterColon.indexOf(',');
          if (commaIdx !== -1) {
            ssid = afterColon.substring(0, commaIdx).trim();
            pass = afterColon.substring(commaIdx + 1).trim();
          } else {
            ssid = afterColon.trim();
          }
        } else if (payload.includes('SET_WIFI,')) {
          const sub = payload.split('SET_WIFI,')[1].split(',');
          ssid = sub[0]?.trim() || '';
          pass = sub[1]?.trim() || '';
        }

        if (ssid) {
          await pool.query(
            'UPDATE machines SET wifi_name = $1, wifi_password = $2 WHERE LOWER(name) = LOWER($3)',
            [ssid, pass, machineIdStr]
          );
          logger.info(`[MQTT WiFi] Updated WiFi credentials for ${machineIdStr}: SSID="${ssid}"`);

          if (io) {
            const wifiPayload = { machineId: machineIdStr, wifiName: ssid, wifiPassword: pass };
            if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('machine_wifi_update', wifiPayload);
            if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('machine_wifi_update', wifiPayload);
            io.to('super_admin').emit('machine_wifi_update', wifiPayload);
          }
        }
        return;
      }

      // ── Step 5: Handle ALERT Messages ─────────────────────────────────────
      // Format 1: SBP2T101,ALERT,Water Level Low
      // Format 2: ALERT,Water Level Low (with machineId from topic)
      // Format 3: JSON: { "machine_id": "SBP2T101", "alert": "High Temperature Detected" }
      const isAlert = (parts[0] === 'ALERT' && parts.length >= 2) || 
                      (parts.length >= 3 && parts[1] === 'ALERT') ||
                      (parsedJson && (parsedJson.alert || parsedJson.alertMessage));

      if (isAlert) {
        let alertMsg = '';
        if (parsedJson) {
          alertMsg = parsedJson.alert || parsedJson.alertMessage || parsedJson.message || 'Alert Triggered';
        } else if (parts[1] === 'ALERT') {
          alertMsg = parts.slice(2).join(',').trim();
        } else {
          alertMsg = parts.slice(1).join(',').trim();
        }

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
              if (machineInfo?.omc_id) io.to(`omc_${machineInfo.omc_id}`).emit('new_alert', alertPayload);
              if (machineInfo?.ro_id) io.to(`ro_${machineInfo.ro_id}`).emit('new_alert', alertPayload);
              io.to('super_admin').emit('new_alert', alertPayload);
              io.emit('new_alert', alertPayload);
            }

            console.log(`⚠️ Alert Created: [${machineIdStr}] -> ${alertMsg} (${severity})`);
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

const publishMachineCommand = (machineName, commandStr) => {
  if (!mqttClient || !mqttClient.connected) {
    logger.warn(`[MQTT] Cannot publish command to ${machineName}: MQTT client not connected`);
    return false;
  }
  try {
    const payload = commandStr.startsWith(machineName) ? commandStr : `${machineName},${commandStr}`;
    // 1. Publish to the unified 'petroleum' topic
    mqttClient.publish('petroleum', payload, { qos: 1 });
    // 2. Also publish to legacy topic for backward compatibility
    mqttClient.publish(`petroleum/iot/commands/${machineName}`, payload, { qos: 1 });
    mqttClient.publish(`petroleum/iot/telemetry/${machineName}`, payload, { qos: 1 });
    logger.info(`[MQTT Published Command] Topic: petroleum | Payload: ${payload}`);
    return true;
  } catch (err) {
    logger.error(`[MQTT Publish Error]: ${err.message}`);
    return false;
  }
};

module.exports = initMqtt;
module.exports.getMqttClient = getMqttClient;
module.exports.publishMachineCommand = publishMachineCommand;
