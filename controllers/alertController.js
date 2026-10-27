const db = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get all alerts
// @route   GET /api/v1/alerts
// @access  Private
exports.getAlerts = async (req, res, next) => {
  try {
    const role = req.user?.role;
    const omcId = req.user?.omcId;
    const roId = req.user?.roId;
    let result;
    if (role === 'RO Manager' && roId) {
      result = await db.query(
        `SELECT 
          a.*,
          m.name AS machine_name,
          m.name AS "machineName",
          r.name AS ro_name,
          r.name AS "roName"
        FROM alerts a 
        JOIN machines m ON a.machine_id = m.id 
        LEFT JOIN ro r ON m.ro_id = r.id 
        WHERE m.ro_id = $1 
          AND a.message NOT LIKE 'Customer Cleanliness Complaint%'
          AND a.message NOT LIKE 'Customer Complaint%'
        ORDER BY a.timestamp DESC`,
        [roId]
      );
    } else if (role === 'OMC Admin' && omcId) {
      result = await db.query(
        `SELECT 
          a.*,
          m.name AS machine_name,
          m.name AS "machineName",
          r.name AS ro_name,
          r.name AS "roName"
        FROM alerts a 
        JOIN machines m ON a.machine_id = m.id 
        JOIN ro r ON m.ro_id = r.id 
        WHERE r.omc_id = $1 
          AND a.message NOT LIKE 'Customer Cleanliness Complaint%'
          AND a.message NOT LIKE 'Customer Complaint%'
        ORDER BY a.timestamp DESC`,
        [omcId]
      );
    } else {
      result = await db.query(
        `SELECT 
          a.*,
          m.name AS machine_name,
          m.name AS "machineName",
          r.name AS ro_name,
          r.name AS "roName"
        FROM alerts a 
        LEFT JOIN machines m ON a.machine_id = m.id 
        LEFT JOIN ro r ON m.ro_id = r.id 
        WHERE a.message NOT LIKE 'Customer Cleanliness Complaint%'
          AND a.message NOT LIKE 'Customer Complaint%'
        ORDER BY a.timestamp DESC`
      );
    }
    res.status(200).json(new ApiResponse(200, result.rows, 'Alerts retrieved successfully'));
  } catch (error) { next(error); }
};

// @desc    Create an alert
// @route   POST /api/v1/alerts
// @access  Private (Internal/IoT Service typically)
exports.createAlert = async (req, res, next) => {
  try {
    const { machine_id, severity, message } = req.body;
    const result = await db.query(
      'INSERT INTO alerts (machine_id, severity, message) VALUES ($1, $2, $3) RETURNING *',
      [machine_id, severity, message]
    );
    res.status(201).json(new ApiResponse(201, result.rows[0], 'Alert created successfully'));
  } catch (error) { next(error); }
};

// @desc    Update an alert (e.g. resolve)
// @route   PUT /api/v1/alerts/:id
// @access  Private
exports.updateAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const result = await db.query(
      'UPDATE alerts SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (result.rows.length === 0) return res.status(404).json(new ApiResponse(404, null, 'Alert not found'));
    res.status(200).json(new ApiResponse(200, result.rows[0], 'Alert updated successfully'));
  } catch (error) { next(error); }
};

// @desc    Delete an alert
// @route   DELETE /api/v1/alerts/:id
// @access  Private (Super Admin)
exports.deleteAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM alerts WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json(new ApiResponse(404, null, 'Alert not found'));
    res.status(200).json(new ApiResponse(200, null, 'Alert deleted successfully'));
  } catch (error) { next(error); }
};
