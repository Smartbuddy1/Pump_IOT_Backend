const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const pool = require('../config/db');

exports.getTelemetryHistory = async (req, res, next) => {
  try {
    const { machineId, startDate, endDate } = req.query;
    const role = req.user?.role;
    const omcId = req.user?.omcId;
    const roId = req.user?.roId;

    let query = `
      SELECT 
        TO_CHAR(DATE(created_at + INTERVAL '5 hours 30 minutes'), 'DD Mon') as date,
        ROUND(AVG(temperature), 1) as avg_temp,
        ROUND(AVG(humidity), 1) as avg_humidity,
        ROUND(AVG(odour), 1) as avg_odour,
        COUNT(CASE WHEN water < 10 THEN 1 END) as total_water_alerts,
        COUNT(*) as total_visits
      FROM telemetry_history
      WHERE 1=1
    `;
    const params = [];

    // Tenant isolation — restrict by role
    if (role === 'RO Manager' && roId) {
      params.push(roId);
      query += ` AND machine_name IN (SELECT name FROM machines WHERE ro_id = $${params.length})`;
    } else if (role === 'OMC Admin' && omcId) {
      params.push(omcId);
      query += ` AND machine_name IN (SELECT m.name FROM machines m JOIN ro r ON m.ro_id = r.id WHERE r.omc_id = $${params.length})`;
    }

    if (machineId && machineId !== 'All') {
      params.push(machineId);
      query += ` AND machine_name = $${params.length}`;
    }

    if (startDate) {
      params.push(startDate);
      query += ` AND DATE(created_at + INTERVAL '5 hours 30 minutes') >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      query += ` AND DATE(created_at + INTERVAL '5 hours 30 minutes') <= $${params.length}`;
    }

    query += ` GROUP BY DATE(created_at + INTERVAL '5 hours 30 minutes') ORDER BY DATE(created_at + INTERVAL '5 hours 30 minutes') ASC LIMIT 30`;

    const result = await pool.query(query, params);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

exports.getDashboardStats = async (req, res, next) => {
  try {
    const role = req.user?.role;
    const omcId = req.user?.omcId || req.query.omcId;
    const roId = req.user?.roId || req.query.roId;

    // Build machine_name filter based on role or query
    let machineFilter = '';
    let machineParams = [];
    if ((role === 'RO Manager' || role === 'RO Admin') || (roId && role !== 'Super Admin')) {
      const targetRoId = roId || req.user?.roId;
      if (targetRoId) {
        machineParams.push(targetRoId);
        machineFilter = `AND th.machine_name IN (SELECT name FROM machines WHERE ro_id = $${machineParams.length})`;
      }
    } else if ((role === 'OMC Admin' || role === 'OMC Manager') || (omcId && role !== 'Super Admin')) {
      const targetOmcId = omcId || req.user?.omcId;
      if (targetOmcId) {
        machineParams.push(targetOmcId);
        machineFilter = `AND th.machine_name IN (SELECT m.name FROM machines m JOIN ro r ON m.ro_id = r.id WHERE r.omc_id = $${machineParams.length})`;
      }
    }

    // 1. Try fetching today's footfall from dedicated footfall_history (PERSON_IN events)
    let todayUsers = 0;
    try {
      const ffTodayRes = await pool.query(`
        SELECT COUNT(*) as today_users 
        FROM footfall_history th
        WHERE (th.created_at + INTERVAL '5 hours 30 minutes') >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE 
          AND (th.created_at + INTERVAL '5 hours 30 minutes') < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE + INTERVAL '1 day' 
          ${machineFilter}
      `, machineParams);
      todayUsers = parseInt(ffTodayRes.rows[0]?.today_users || 0, 10);
    } catch (e) {}

    // Fallback to telemetry_history if footfall_history is empty
    if (todayUsers === 0) {
      const todayRes = await pool.query(`
        SELECT COUNT(*) as today_users 
        FROM telemetry_history th
        WHERE (th.created_at + INTERVAL '5 hours 30 minutes') >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE 
          AND (th.created_at + INTERVAL '5 hours 30 minutes') < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE + INTERVAL '1 day' 
          ${machineFilter}
      `, machineParams).catch(() => ({ rows: [{ today_users: 0 }] }));
      todayUsers = parseInt(todayRes.rows[0]?.today_users || 0, 10);
    }

    // 2. Fetch daily footfall (last 7 days) - prefer footfall_history, fallback to telemetry_history
    let historyRows = [];
    try {
      const ffHistRes = await pool.query(`
        SELECT 
          TO_CHAR(d.day, 'Mon DD') as day,
          TO_CHAR(d.day, 'Mon DD (Dy)') as full_day,
          COALESCE(COUNT(th.id), 0) as users
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval) d(day)
        LEFT JOIN footfall_history th ON (th.created_at + INTERVAL '5 hours 30 minutes') >= d.day 
          AND (th.created_at + INTERVAL '5 hours 30 minutes') < d.day + INTERVAL '1 day' 
          ${machineFilter}
        GROUP BY d.day
        ORDER BY d.day ASC
      `, machineParams);
      const totalFf = ffHistRes.rows.reduce((sum, r) => sum + parseInt(r.users, 10), 0);
      if (totalFf > 0) {
        historyRows = ffHistRes.rows;
      }
    } catch (e) {}

    if (historyRows.length === 0) {
      const historyRes = await pool.query(`
        SELECT 
          TO_CHAR(d.day, 'Mon DD') as day,
          TO_CHAR(d.day, 'Mon DD (Dy)') as full_day,
          COALESCE(COUNT(th.id), 0) as users
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval) d(day)
        LEFT JOIN telemetry_history th ON (th.created_at + INTERVAL '5 hours 30 minutes') >= d.day 
          AND (th.created_at + INTERVAL '5 hours 30 minutes') < d.day + INTERVAL '1 day' 
          ${machineFilter}
        GROUP BY d.day
        ORDER BY d.day ASC
      `, machineParams).catch(() => ({ rows: [] }));
      historyRows = historyRes.rows;
    }

    res.status(200).json({
      success: true,
      data: {
        todayUsers,
        dailyFootfall: historyRows.map(r => ({
          day: r.day,
          fullDay: r.full_day,
          users: parseInt(r.users, 10)
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};


// @desc    Get raw PCB telemetry readings for demo/monitoring table
// @route   GET /api/v1/analytics/readings
// @access  Private
exports.getLiveReadings = async (req, res, next) => {
  try {
    const { machineId, limit, days } = req.query;
    const role = req.user?.role;
    const omcId = req.user?.omcId;
    const roId = req.user?.roId;

    let query = `
      SELECT 
        th.id,
        th.machine_name as "machineId",
        COALESCE(th.temperature, 0) as "temp",
        COALESCE(th.humidity, 0) as "humidity",
        COALESCE(th.odour, 0) as "vocGas",
        COALESCE(th.nh3, 0) as "nh3",
        COALESCE(th.h2s, 0) as "h2s",
        COALESCE(th.water, 0) as "water",
        TO_CHAR(th.created_at + INTERVAL '5 hours 30 minutes', 'YYYY-MM-DD"T"HH24:MI:SS.MS+05:30') as "timestamp"
      FROM telemetry_history th
      WHERE 1=1
    `;
    const params = [];

    // Optional days filter (if 'all' or omitted, returns all telemetry)
    if (days && days !== 'all' && days !== 'unlimited') {
      params.push(parseInt(days, 10) || 30);
      query += ` AND th.created_at >= NOW() - (INTERVAL '1 day' * $${params.length})`;
    }

    if (role === 'RO Manager' && roId) {
      params.push(roId);
      query += ` AND th.machine_name IN (SELECT name FROM machines WHERE ro_id = $${params.length})`;
    } else if (role === 'OMC Admin' && omcId) {
      params.push(omcId);
      query += ` AND th.machine_name IN (SELECT m.name FROM machines m JOIN ro r ON m.ro_id = r.id WHERE r.omc_id = $${params.length})`;
    }

    if (machineId && machineId !== 'All') {
      params.push(machineId);
      query += ` AND (LOWER(th.machine_name) = LOWER($${params.length}) OR REPLACE(LOWER(th.machine_name), 'o', '0') = REPLACE(LOWER($${params.length}), 'o', '0'))`;
    }

    query += ` ORDER BY th.created_at DESC`;

    // Unlimited by default or allow up to specified limit
    if (limit && limit !== 'all' && limit !== 'unlimited') {
      const safeLimit = Math.max(parseInt(limit, 10) || 50000, 10);
      params.push(safeLimit);
      query += ` LIMIT $${params.length}`;
    }

    const result = await pool.query(query, params);
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    next(error);
  }
};


// @desc    Get aggregated day-wise sensor statistics for all machines
// @route   GET /api/v1/analytics/sensor-reports
// @access  Private
exports.getDailySensorReports = async (req, res, next) => {
  try {
    const { machineId, omcId, roId, startDate, endDate } = req.query;
    const role = req.user?.role;
    const userOmcId = req.user?.omcId;
    const userRoId = req.user?.roId;

    let query = `
      SELECT 
        DATE(th.created_at + INTERVAL '5 hours 30 minutes') as raw_date,
        TO_CHAR(DATE(th.created_at + INTERVAL '5 hours 30 minutes'), 'YYYY-MM-DD') as date_ymd,
        TO_CHAR(DATE(th.created_at + INTERVAL '5 hours 30 minutes'), 'DD Mon YYYY') as date,
        th.machine_name as "machineId",
        m.id as "machineDbId",
        COALESCE(r.name, 'RO Location') as "roName",
        COALESCE(o.name, 'HPCL') as "omcName",
        
        -- Temp (Min, Avg, Max)
        ROUND(MIN(th.temperature), 1) as "tempMin",
        ROUND(AVG(th.temperature), 1) as "tempAvg",
        ROUND(MAX(th.temperature), 1) as "tempMax",

        -- Humidity (Min, Avg, Max)
        ROUND(MIN(th.humidity), 1) as "humidityMin",
        ROUND(AVG(th.humidity), 1) as "humidityAvg",
        ROUND(MAX(th.humidity), 1) as "humidityMax",

        -- VOC Gas (Min, Avg, Max)
        ROUND(MIN(th.odour), 1) as "vocMin",
        ROUND(AVG(th.odour), 1) as "vocAvg",
        ROUND(MAX(th.odour), 1) as "vocMax",

        -- NH3 (Min, Avg, Max)
        ROUND(MIN(COALESCE(th.nh3, 0)), 1) as "nh3Min",
        ROUND(AVG(COALESCE(th.nh3, 0)), 1) as "nh3Avg",
        ROUND(MAX(COALESCE(th.nh3, 0)), 1) as "nh3Max",

        -- H2S (Min, Avg, Max)
        ROUND(MIN(COALESCE(th.h2s, 0)), 1) as "h2sMin",
        ROUND(AVG(COALESCE(th.h2s, 0)), 1) as "h2sAvg",
        ROUND(MAX(COALESCE(th.h2s, 0)), 1) as "h2sMax",

        -- Water
        ROUND(AVG(th.water), 1) as "waterAvg",

        -- Total daily transactions / packets / cycles
        COUNT(*) as "transactions"
      FROM telemetry_history th
      LEFT JOIN machines m ON (
        LOWER(m.name) = LOWER(th.machine_name) OR 
        REPLACE(LOWER(m.name), 'o', '0') = REPLACE(LOWER(th.machine_name), 'o', '0')
      )
      LEFT JOIN ro r ON m.ro_id = r.id
      LEFT JOIN omc o ON r.omc_id = o.id
      WHERE 1=1
    `;
    const params = [];

    // Role-based tenant isolation
    if (role === 'RO Manager' && userRoId) {
      params.push(userRoId);
      query += ` AND m.ro_id = $${params.length}`;
    } else if (role === 'OMC Admin' && userOmcId) {
      params.push(userOmcId);
      query += ` AND r.omc_id = $${params.length}`;
    }

    if (omcId && omcId !== 'All') {
      params.push(omcId);
      query += ` AND (r.omc_id = $${params.length} OR o.id = $${params.length})`;
    }

    if (roId && roId !== 'All') {
      params.push(roId);
      query += ` AND m.ro_id = $${params.length}`;
    }

    if (machineId && machineId !== 'All') {
      params.push(machineId);
      query += ` AND (LOWER(th.machine_name) = LOWER($${params.length}) OR REPLACE(LOWER(th.machine_name), 'o', '0') = REPLACE(LOWER($${params.length}), 'o', '0'))`;
    }

    if (startDate) {
      params.push(startDate);
      query += ` AND DATE(th.created_at + INTERVAL '5 hours 30 minutes') >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      query += ` AND DATE(th.created_at + INTERVAL '5 hours 30 minutes') <= $${params.length}`;
    }

    query += `
      GROUP BY DATE(th.created_at + INTERVAL '5 hours 30 minutes'), th.machine_name, m.id, r.name, o.name
      ORDER BY DATE(th.created_at + INTERVAL '5 hours 30 minutes') DESC, th.machine_name ASC
      LIMIT 1500
    `;

    const result = await pool.query(query, params);
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    next(error);
  }
};
