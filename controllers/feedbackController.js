const db = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

// @desc    Get machine details for public feedback screen
// @route   GET /api/v1/feedback/machine/:machineId
// @access  Public
exports.getPublicMachineDetails = async (req, res, next) => {
  try {
    const { machineId } = req.params;
    const cleanId = String(machineId || '').trim();

    const query = `
      SELECT 
        m.id, 
        m.name, 
        m.type, 
        m.status, 
        m.ro_id, 
        r.name as ro_name, 
        r.location as ro_location, 
        o.id as omc_id, 
        o.name as omc_name
      FROM machines m
      LEFT JOIN ro r ON m.ro_id = r.id
      LEFT JOIN omc o ON r.omc_id = o.id
      WHERE LOWER(m.name) = LOWER($1) OR CAST(m.id AS TEXT) = $1
      LIMIT 1
    `;
    const result = await db.query(query, [cleanId]);

    if (result.rows.length === 0) {
      return res.status(200).json(new ApiResponse(200, {
        id: cleanId,
        name: cleanId,
        ro_name: 'Retail Outlet (Petrol Pump)',
        omc_name: 'Fuel Station'
      }, 'Fallback machine details'));
    }

    res.status(200).json(new ApiResponse(200, result.rows[0], 'Machine details retrieved'));
  } catch (error) {
    next(error);
  }
};

// @desc    Submit public feedback
// @route   POST /api/v1/feedback/public
// @access  Public
exports.submitFeedback = async (req, res, next) => {
  try {
    const { 
      machineId, 
      machineName, 
      rating, 
      reasons, 
      comment, 
      userPhone, 
      userName 
    } = req.body;

    const numRating = parseInt(rating, 10);
    if (!numRating || numRating < 1 || numRating > 5) {
      return res.status(400).json(new ApiResponse(400, null, 'Valid rating between 1 and 5 stars is required'));
    }

    const cleanMachineName = String(machineName || machineId || '').trim();
    let resolvedMachineId = null;
    let resolvedRoId = null;
    let resolvedOmcId = null;

    if (cleanMachineName) {
      const mRes = await db.query(`
        SELECT m.id, m.name, m.ro_id, r.omc_id 
        FROM machines m
        LEFT JOIN ro r ON m.ro_id = r.id
        WHERE LOWER(m.name) = LOWER($1) OR CAST(m.id AS TEXT) = $1
        LIMIT 1
      `, [cleanMachineName]);

      if (mRes.rows.length > 0) {
        resolvedMachineId = mRes.rows[0].id;
        resolvedRoId = mRes.rows[0].ro_id;
        resolvedOmcId = mRes.rows[0].omc_id;
      }
    }

    const reasonsString = Array.isArray(reasons) ? reasons.join(', ') : (reasons || '');

    const insertQuery = `
      INSERT INTO feedbacks (
        machine_id, 
        machine_name, 
        ro_id, 
        omc_id, 
        rating, 
        reasons, 
        comment, 
        user_phone, 
        user_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
      RETURNING *
    `;

    const result = await db.query(insertQuery, [
      resolvedMachineId,
      cleanMachineName,
      resolvedRoId,
      resolvedOmcId,
      numRating,
      reasonsString,
      comment || '',
      userPhone || null,
      userName || null
    ]);

    const createdFeedback = result.rows[0];

    // Broadcast live feedback event via Socket.IO if available (Feedbacks are managed in Feedbacks logs)
    const io = req.app.get('io');
    if (io) {
      io.emit('new_feedback', {
        ...createdFeedback,
        machineName: cleanMachineName
      });
    }

    res.status(201).json(new ApiResponse(201, createdFeedback, 'Feedback submitted successfully! Thank you.'));
  } catch (error) {
    next(error);
  }
};

// @desc    Get all feedbacks (with role-based access)
// @route   GET /api/v1/feedback
// @access  Private (Super Admin, OMC Admin, RO Manager)
exports.getFeedbacks = async (req, res, next) => {
  try {
    const role = req.user?.role;
    const omcId = req.user?.omcId;
    const roId = req.user?.roId;

    let query = `
      SELECT 
        f.*, 
        COALESCE(m.name, f.machine_name) as display_machine_name,
        r.name as ro_name, 
        r.location as ro_location,
        o.name as omc_name
      FROM feedbacks f
      LEFT JOIN machines m ON f.machine_id = m.id
      LEFT JOIN ro r ON COALESCE(f.ro_id, m.ro_id) = r.id
      LEFT JOIN omc o ON COALESCE(f.omc_id, r.omc_id) = o.id
    `;
    const params = [];

    if (role === 'RO Manager' && roId) {
      query += ` WHERE COALESCE(f.ro_id, m.ro_id) = $1`;
      params.push(roId);
    } else if (role === 'OMC Admin' && omcId) {
      query += ` WHERE COALESCE(f.omc_id, r.omc_id) = $1`;
      params.push(omcId);
    }

    query += ` ORDER BY f.created_at DESC LIMIT 200`;

    const result = await db.query(query, params);
    res.status(200).json(new ApiResponse(200, result.rows, 'Feedbacks retrieved successfully'));
  } catch (error) {
    next(error);
  }
};
