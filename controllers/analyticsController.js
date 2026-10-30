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
        TO_CHAR(DATE(created_at), 'DD Mon') as date,
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
      query += ` AND DATE(created_at) >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      query += ` AND DATE(created_at) <= $${params.length}`;
    }

    query += ` GROUP BY DATE(created_at) ORDER BY DATE(created_at) ASC LIMIT 30`;

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

    const todayRes = await pool.query(`
      SELECT COUNT(*) as today_users 
      FROM telemetry_history th
      WHERE th.created_at >= CURRENT_DATE AND th.created_at < CURRENT_DATE + INTERVAL '1 day' ${machineFilter}
    `, machineParams);
    const todayUsers = parseInt(todayRes.rows[0]?.today_users || 0, 10);

    const historyRes = await pool.query(`
      SELECT 
        TO_CHAR(d.day, 'Mon DD') as day,
        TO_CHAR(d.day, 'Mon DD (Dy)') as full_day,
        COALESCE(COUNT(th.id), 0) as users
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval) d(day)
      LEFT JOIN telemetry_history th ON th.created_at >= d.day AND th.created_at < d.day + INTERVAL '1 day' ${machineFilter}
      GROUP BY d.day
      ORDER BY d.day ASC
    `, machineParams);

    res.status(200).json({
      success: true,
      data: {
        todayUsers,
        dailyFootfall: historyRes.rows.map(r => ({
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
    const { machineId, limit = 1000, days = 2 } = req.query;
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
        th.created_at as "timestamp"
      FROM telemetry_history th
      WHERE th.created_at >= NOW() - (INTERVAL '1 day' * $1)
    `;
    const params = [parseInt(days, 10) || 2];

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

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 10), 3000);
    params.push(safeLimit);
    query += ` ORDER BY th.created_at DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);
    res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    next(error);
  }
};
