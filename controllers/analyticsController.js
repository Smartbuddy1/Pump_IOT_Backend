const pool = require('../config/db');

exports.getTelemetryHistory = async (req, res) => {
  try {
    const { machineId, startDate, endDate } = req.query;

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
    console.error('Error fetching telemetry history:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getDashboardStats = async (req, res) => {
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
      WHERE DATE(th.created_at) = CURRENT_DATE ${machineFilter}
    `, machineParams);
    const todayUsers = parseInt(todayRes.rows[0]?.today_users || 0, 10);

    const historyRes = await pool.query(`
      SELECT 
        TO_CHAR(d.day, 'Mon DD') as day,
        TO_CHAR(d.day, 'Mon DD (Dy)') as full_day,
        COALESCE(COUNT(th.id), 0) as users
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval) d(day)
      LEFT JOIN telemetry_history th ON DATE(th.created_at) = DATE(d.day) ${machineFilter}
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
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
