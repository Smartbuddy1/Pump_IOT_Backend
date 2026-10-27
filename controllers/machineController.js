const db = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get all machines
// @route   GET /api/v1/machines
// @access  Private
exports.getMachines = async (req, res, next) => {
  try {
    const role = req.user?.role;
    const omcId = req.user?.omcId;
    const roId = req.user?.roId;
    let result;
    if (role === 'RO Manager' && roId) {
      // RO Manager sees only their own RO's machines
      result = await db.query(
        `SELECT m.*, r.status AS ro_status, r.name AS ro_name,
           CASE WHEN LOWER(COALESCE(r.status, '')) = 'inactive' THEN 'Inactive' ELSE m.status END AS status
         FROM machines m
         LEFT JOIN ro r ON m.ro_id = r.id
         WHERE m.ro_id = $1
         ORDER BY m.created_at DESC`,
        [roId]
      );
    } else if (role === 'OMC Admin' && omcId) {
      // OMC Admin sees all machines under their OMC's ROs
      result = await db.query(
        `SELECT m.*, r.status AS ro_status, r.name AS ro_name,
           CASE WHEN LOWER(COALESCE(r.status, '')) = 'inactive' THEN 'Inactive' ELSE m.status END AS status
         FROM machines m
         JOIN ro r ON m.ro_id = r.id
         WHERE r.omc_id = $1
         ORDER BY m.created_at DESC`,
        [omcId]
      );
    } else {
      // Super Admin sees all
      result = await db.query(
        `SELECT m.*, r.status AS ro_status, r.name AS ro_name,
           CASE WHEN LOWER(COALESCE(r.status, '')) = 'inactive' THEN 'Inactive' ELSE m.status END AS status
         FROM machines m
         LEFT JOIN ro r ON m.ro_id = r.id
         ORDER BY m.created_at DESC`
      );
    }
    console.log(`[getMachines] Called by user ${req.user?.id} (${role}), returned ${result.rows.length} rows`);
    res.status(200).json(new ApiResponse(200, result.rows, 'Machines retrieved successfully'));
  } catch (error) { next(error); }
};

// @desc    Create a machine
// @route   POST /api/v1/machines
// @access  Private (Super Admin, OMC Admin, RO Manager)
exports.createMachine = async (req, res, next) => {
  try {
    const { 
      name, 
      ro_id, 
      type, 
      status, 
      health_score, 
      last_maintenance, 
      install_date, 
      created_at,
      live_temp,
      liveTemp,
      live_water,
      liveWater,
      live_humidity,
      liveHumidity,
      live_odour,
      liveOdour,
      live_nh3,
      liveNh3,
      live_h2s,
      liveH2s,
      wifiName,
      wifi_name,
      wifiPassword,
      wifi_password,
      tempLimitLow,
      temp_limit_low,
      tempLimitMedium,
      temp_limit_medium,
      tempLimitDanger,
      temp_limit_danger,
      humidityLimitLow,
      humidity_limit_low,
      humidityLimitMedium,
      humidity_limit_medium,
      humidityLimitDanger,
      humidity_limit_danger,
      odourLimitLow,
      odour_limit_low,
      odourLimitMedium,
      odour_limit_medium,
      odourLimitDanger,
      odour_limit_danger,
      nh3LimitLow,
      nh3_limit_low,
      nh3LimitDanger,
      nh3_limit_danger,
      h2sLimitLow,
      h2s_limit_low,
      h2sLimitDanger,
      h2s_limit_danger,
      waterLevelTrigger,
      water_level_trigger
    } = req.body;

    if (!ro_id) {
      return res.status(400).json(new ApiResponse(400, null, 'Please assign an RO'));
    }

    // Check if the assigned RO is Inactive
    const roCheck = await db.query('SELECT id, name, status FROM ro WHERE id = $1', [ro_id]);
    if (roCheck.rows.length === 0) {
      return res.status(400).json(new ApiResponse(400, null, 'Selected RO not found'));
    }
    const roStatus = String(roCheck.rows[0].status || '').trim().toLowerCase();
    if (roStatus === 'inactive') {
      return res.status(400).json(new ApiResponse(400, null, `Cannot create machine for Inactive RO "${roCheck.rows[0].name}". Please activate the RO first.`));
    }

    const dateVal = install_date || created_at || new Date();
    const installDateStr = String(install_date || created_at || new Date().toISOString().split('T')[0]).split('T')[0];
    const tempVal = String(live_temp || liveTemp || '28').replace(/[^0-9.-]/g, '') || '28';
    const waterVal = String(live_water || liveWater || 'Normal').trim();
    const humVal = String(live_humidity || liveHumidity || '50').replace(/[^0-9.-]/g, '') || '50';
    const odourVal = String(live_odour || liveOdour || '40').replace(/[^0-9.-]/g, '') || '40';
    const nh3Val = String(live_nh3 || liveNh3 || '0').replace(/[^0-9.-]/g, '') || '0';
    const h2sVal = String(live_h2s || liveH2s || '0').replace(/[^0-9.-]/g, '') || '0';
    const wifiN = wifi_name || wifiName || null;
    const wifiP = wifi_password || wifiPassword || null;
    const tLow = String(temp_limit_low || tempLimitLow || '20');
    const tMed = String(temp_limit_medium || tempLimitMedium || '30');
    const tDang = String(temp_limit_danger || tempLimitDanger || '41');
    const hLow = String(humidity_limit_low || humidityLimitLow || '35');
    const hMed = String(humidity_limit_medium || humidityLimitMedium || '70');
    const hDang = String(humidity_limit_danger || humidityLimitDanger || '76');
    const oLow = String(odour_limit_low || odourLimitLow || '40');
    const oMed = String(odour_limit_medium || odourLimitMedium || '60');
    const oDang = String(odour_limit_danger || odourLimitDanger || '71');
    const nLow = String(nh3_limit_low || nh3LimitLow || '25');
    const nDang = String(nh3_limit_danger || nh3LimitDanger || '50');
    const sLow = String(h2s_limit_low || h2sLimitLow || '10');
    const sDang = String(h2s_limit_danger || h2sLimitDanger || '20');
    const wTrig = String(water_level_trigger || waterLevelTrigger || 'Low');
    const healthVal = health_score !== undefined && health_score !== null ? health_score : 100;
    const maintVal = last_maintenance || null;
    const statusVal = status || 'Running';
    const typeVal = type || 'Dispenser';

    const result = await db.query(
      `INSERT INTO machines (
        name, ro_id, type, status, health_score, last_maintenance, created_at, install_date,
        live_temp, live_water, live_humidity, live_odour, live_nh3, live_h2s,
        wifi_name, wifi_password, temp_limit_low, temp_limit_medium, temp_limit_danger,
        humidity_limit_low, humidity_limit_medium, humidity_limit_danger,
        odour_limit_low, odour_limit_medium, odour_limit_danger,
        nh3_limit_low, nh3_limit_danger, h2s_limit_low, h2s_limit_danger, water_level_trigger
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30) RETURNING *`,
      [
        name, ro_id, typeVal, statusVal, healthVal, maintVal, dateVal, installDateStr,
        tempVal, waterVal, humVal, odourVal, nh3Val, h2sVal,
        wifiN, wifiP, tLow, tMed, tDang,
        hLow, hMed, hDang,
        oLow, oMed, oDang,
        nLow, nDang, sLow, sDang, wTrig
      ]
    );
    res.status(201).json(new ApiResponse(201, result.rows[0], 'Machine created successfully'));
  } catch (error) { next(error); }
};

// @desc    Update a machine
// @route   PUT /api/v1/machines/:id
// @access  Private
exports.updateMachine = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      ro_id, 
      type, 
      status, 
      health_score, 
      last_maintenance, 
      install_date, 
      created_at,
      live_temp,
      liveTemp,
      live_water,
      liveWater,
      live_humidity,
      liveHumidity,
      live_odour,
      liveOdour,
      live_nh3,
      liveNh3,
      live_h2s,
      liveH2s,
      wifiName,
      wifi_name,
      wifiPassword,
      wifi_password,
      tempLimitLow,
      temp_limit_low,
      tempLimitMedium,
      temp_limit_medium,
      tempLimitDanger,
      temp_limit_danger,
      humidityLimitLow,
      humidity_limit_low,
      humidityLimitMedium,
      humidity_limit_medium,
      humidityLimitDanger,
      humidity_limit_danger,
      odourLimitLow,
      odour_limit_low,
      odourLimitMedium,
      odour_limit_medium,
      odourLimitDanger,
      odour_limit_danger,
      nh3LimitLow,
      nh3_limit_low,
      nh3LimitDanger,
      nh3_limit_danger,
      h2sLimitLow,
      h2s_limit_low,
      h2sLimitDanger,
      h2s_limit_danger,
      waterLevelTrigger,
      water_level_trigger
    } = req.body;

    const isNum = !isNaN(parseInt(id, 10)) && /^\d+$/.test(String(id));
    const targetDbId = isNum ? parseInt(id, 10) : null;
    const targetName = String(name || id || '').trim();

    const dateVal = install_date || created_at || null;
    const tempVal = String(live_temp || liveTemp || '28').replace(/[^0-9.-]/g, '') || '28';
    const waterVal = String(live_water || liveWater || 'Normal').trim();
    const humVal = String(live_humidity || liveHumidity || '50').replace(/[^0-9.-]/g, '') || '50';
    const odourVal = String(live_odour || liveOdour || '40').replace(/[^0-9.-]/g, '') || '40';
    const nh3Val = String(live_nh3 || liveNh3 || '0').replace(/[^0-9.-]/g, '') || '0';
    const h2sVal = String(live_h2s || liveH2s || '0').replace(/[^0-9.-]/g, '') || '0';
    const wifiN = wifi_name || wifiName || null;
    const wifiP = wifi_password || wifiPassword || null;
    const tLow = String(temp_limit_low || tempLimitLow || '20');
    const tMed = String(temp_limit_medium || tempLimitMedium || '30');
    const tDang = String(temp_limit_danger || tempLimitDanger || '41');
    const hLow = String(humidity_limit_low || humidityLimitLow || '35');
    const hMed = String(humidity_limit_medium || humidityLimitMedium || '70');
    const hDang = String(humidity_limit_danger || humidityLimitDanger || '76');
    const oLow = String(odour_limit_low || odourLimitLow || '40');
    const oMed = String(odour_limit_medium || odourLimitMedium || '60');
    const oDang = String(odour_limit_danger || odourLimitDanger || '71');
    const nLow = String(nh3_limit_low || nh3LimitLow || '25');
    const nDang = String(nh3_limit_danger || nh3LimitDanger || '50');
    const sLow = String(h2s_limit_low || h2sLimitLow || '10');
    const sDang = String(h2s_limit_danger || h2sLimitDanger || '20');
    const wTrig = String(water_level_trigger || waterLevelTrigger || 'Low');
    const healthVal = health_score !== undefined && health_score !== null ? health_score : 100;
    const maintVal = last_maintenance || null;
    const statusVal = status || 'Running';
    const typeVal = type || 'Dispenser';

    const fields = [
      'name = $1', 'ro_id = $2', 'type = $3', 'status = $4', 'health_score = $5',
      'last_maintenance = $6', 'live_temp = $7', 'live_water = $8', 'live_humidity = $9',
      'live_odour = $10', 'live_nh3 = $11', 'live_h2s = $12', 'wifi_name = $13',
      'wifi_password = $14', 'temp_limit_low = $15', 'temp_limit_medium = $16',
      'temp_limit_danger = $17', 'humidity_limit_low = $18', 'humidity_limit_medium = $19',
      'humidity_limit_danger = $20', 'odour_limit_low = $21', 'odour_limit_medium = $22',
      'odour_limit_danger = $23', 'nh3_limit_low = $24', 'nh3_limit_danger = $25',
      'h2s_limit_low = $26', 'h2s_limit_danger = $27', 'water_level_trigger = $28'
    ];
    let params = [
      targetName, ro_id, typeVal, statusVal, healthVal, maintVal,
      tempVal, waterVal, humVal, odourVal, nh3Val, h2sVal,
      wifiN, wifiP, tLow, tMed, tDang, hLow, hMed, hDang,
      oLow, oMed, oDang, nLow, nDang, sLow, sDang, wTrig
    ];

    if (dateVal) {
      const installDateStr = String(install_date || created_at || '').split('T')[0] || null;
      fields.push(`created_at = $${params.length + 1}`);
      params.push(dateVal);
      if (installDateStr) {
        fields.push(`install_date = $${params.length + 1}`);
        params.push(installDateStr);
      }
    }

    let whereClause = '';
    if (targetDbId) {
      whereClause = `WHERE id = $${params.length + 1} OR name = $${params.length + 2}`;
      params.push(targetDbId, targetName);
    } else {
      whereClause = `WHERE name = $${params.length + 1}`;
      params.push(targetName);
    }

    const query = `UPDATE machines SET ${fields.join(', ')} ${whereClause} RETURNING *`;
    const result = await db.query(query, params);
    if (result.rows.length === 0) return res.status(404).json(new ApiResponse(404, null, 'Machine not found'));
    res.status(200).json(new ApiResponse(200, result.rows[0], 'Machine updated successfully'));
  } catch (error) { next(error); }
};

// @desc    Delete a machine
// @route   DELETE /api/v1/machines/:id
// @access  Private (Super Admin, OMC Admin)
exports.deleteMachine = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isNum = !isNaN(parseInt(id, 10)) && /^\d+$/.test(String(id));
    
    // Cascading delete alerts
    await db.query('DELETE FROM alerts WHERE machine_id = $1 OR machine_id = $2', [id, String(id)]).catch(() => {});
    
    let result;
    if (isNum) {
      result = await db.query('DELETE FROM machines WHERE id = $1 OR name = $2 RETURNING id, name', [parseInt(id, 10), String(id)]);
    } else {
      result = await db.query('DELETE FROM machines WHERE name = $1 RETURNING id, name', [String(id)]);
    }
    
    res.status(200).json(new ApiResponse(200, result?.rows?.[0] || null, 'Machine deleted successfully'));
  } catch (error) { next(error); }
};
