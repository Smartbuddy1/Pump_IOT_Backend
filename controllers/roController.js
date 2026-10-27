const db = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const bcrypt = require('bcrypt');

// @desc    Get all ROs
// @route   GET /api/v1/ro
// @access  Private
exports.getROs = async (req, res, next) => {
  try {
    const role = req.user?.role;
    const omcId = req.user?.omcId;
    const roId = req.user?.roId;
    let result;
    if (role === 'RO Manager' && roId) {
      // RO Manager only sees their own RO
      result = await db.query('SELECT * FROM ro WHERE id = $1', [roId]);
    } else if (role === 'OMC Admin' && omcId) {
      // OMC Admin sees all ROs under their OMC
      result = await db.query('SELECT * FROM ro WHERE omc_id = $1 ORDER BY created_at DESC', [omcId]);
    } else {
      // Super Admin sees all
      result = await db.query('SELECT * FROM ro ORDER BY created_at DESC');
    }
    console.log(`[getROs] Called by user ${req.user?.id} (${role}), returned ${result.rows.length} rows`);
    res.status(200).json(new ApiResponse(200, result.rows, 'ROs retrieved successfully'));
  } catch (error) { next(error); }
};

// @desc    Create an RO
// @route   POST /api/v1/ro
// @access  Private (Super Admin, OMC Admin)
exports.createRO = async (req, res, next) => {
  try {
    const { name, omc_id, location, status, contact, contact_password } = req.body;
    if (!omc_id) {
      return res.status(400).json(new ApiResponse(400, null, 'OMC selection is required'));
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json(new ApiResponse(400, null, 'RO Name is required'));
    }
    if (!location || !String(location).trim()) {
      return res.status(400).json(new ApiResponse(400, null, 'Location is required'));
    }
    if (!contact_password) {
      return res.status(400).json(new ApiResponse(400, null, 'Password is required'));
    }

    const cleanContact = String(contact || '').replace(/\D/g, '').trim();
    if (!cleanContact || cleanContact.length !== 10) {
      return res.status(400).json(new ApiResponse(400, null, 'Phone number must be exactly 10 digits'));
    }

    // Check if phone number already exists in ro, omc, or users
    const existingRo = await db.query("SELECT id, name FROM ro WHERE REGEXP_REPLACE(contact, '\\D', '', 'g') = $1", [cleanContact]);
    if (existingRo.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered with RO "${existingRo.rows[0].name}". Duplicate phone number is strictly prohibited.`));
    }
    const existingOmc = await db.query("SELECT id, name FROM omc WHERE REGEXP_REPLACE(contact, '\\D', '', 'g') = $1", [cleanContact]);
    if (existingOmc.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered with OMC "${existingOmc.rows[0].name}". Duplicate phone number is strictly prohibited.`));
    }
    const existingUser = await db.query("SELECT id FROM users WHERE username = $1 OR REGEXP_REPLACE(username, '\\D', '', 'g') = $1", [cleanContact]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered to an existing account. Duplicate phone number is strictly prohibited.`));
    }
    
    // 1. Create RO
    const result = await db.query(
      'INSERT INTO ro (name, omc_id, location, status, contact, contact_password) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, omc_id, location, status || 'Active', cleanContact, contact_password]
    );
    const newRo = result.rows[0];

    // 2. Generate RO Manager User
    const rawPassword = contact_password || Math.random().toString(36).slice(-8); // Random 8 char password
    const username = cleanContact;
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    await db.query(
      'INSERT INTO users (username, password, role, omc_id, ro_id) VALUES ($1, $2, $3, $4, $5)',
      [username, hashedPassword, 'RO Manager', omc_id, newRo.id]
    );

    // 3. Return RO and Credentials
    res.status(201).json(new ApiResponse(201, {
      ...newRo,
      credentials: { username, password: rawPassword }
    }, 'RO created successfully'));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json(new ApiResponse(400, null, 'This phone number is already registered in the system. Duplicate numbers are strictly prohibited.'));
    }
    next(error);
  }
};

// @desc    Update an RO
// @route   PUT /api/v1/ro/:id
// @access  Private (Super Admin, OMC Admin, RO Manager)
exports.updateRO = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, omc_id, location, status, contact, contact_password } = req.body;
    if (!contact_password) {
      return res.status(400).json(new ApiResponse(400, null, 'Password is required'));
    }

    const cleanContact = String(contact || '').replace(/\D/g, '').trim();
    if (!cleanContact || cleanContact.length !== 10) {
      return res.status(400).json(new ApiResponse(400, null, 'Phone number must be exactly 10 digits'));
    }

    // Check duplicate phone number when updating
    const existingRo = await db.query("SELECT id, name FROM ro WHERE REGEXP_REPLACE(contact, '\\D', '', 'g') = $1 AND id != $2", [cleanContact, id]);
    if (existingRo.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered with RO "${existingRo.rows[0].name}". Duplicate phone number is strictly prohibited.`));
    }
    const existingOmc = await db.query("SELECT id, name FROM omc WHERE REGEXP_REPLACE(contact, '\\D', '', 'g') = $1", [cleanContact]);
    if (existingOmc.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered with OMC "${existingOmc.rows[0].name}". Duplicate phone number is strictly prohibited.`));
    }
    const existingUser = await db.query("SELECT id FROM users WHERE (username = $1 OR REGEXP_REPLACE(username, '\\D', '', 'g') = $1) AND (ro_id IS NULL OR ro_id != $2)", [cleanContact, id]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered to another account. Duplicate phone number is strictly prohibited.`));
    }

    const result = await db.query(
      'UPDATE ro SET name = $1, omc_id = $2, location = $3, status = $4, contact = $5, contact_password = $6 WHERE id = $7 RETURNING *',
      [name, omc_id, location, status, cleanContact, contact_password, id]
    );
    if (result.rows.length === 0) return res.status(404).json(new ApiResponse(404, null, 'RO not found'));

    // Update the RO Manager user
    if (contact_password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(contact_password, salt);
      await db.query(
        'UPDATE users SET password = $1, username = $2 WHERE ro_id = $3 AND role = $4',
        [hashedPassword, cleanContact, id, 'RO Manager']
      );
    } else {
      await db.query(
        'UPDATE users SET username = $1 WHERE ro_id = $2 AND role = $3',
        [cleanContact, id, 'RO Manager']
      );
    }

    // If RO status is set to Inactive, update all its machines to Inactive
    if (status && String(status).toLowerCase() === 'inactive') {
      await db.query('UPDATE machines SET status = $1 WHERE ro_id = $2', ['Inactive', id]);
    }

    res.status(200).json(new ApiResponse(200, result.rows[0], 'RO updated successfully'));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json(new ApiResponse(400, null, 'This phone number is already registered in the system. Duplicate numbers are strictly prohibited.'));
    }
    next(error);
  }
};

// @desc    Delete an RO
// @route   DELETE /api/v1/ro/:id
// @access  Private (Super Admin, OMC Admin)
exports.deleteRO = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // First verify RO exists
    const roCheck = await db.query('SELECT * FROM ro WHERE id = $1', [id]);
    if (roCheck.rows.length === 0) return res.status(404).json(new ApiResponse(404, null, 'RO not found'));
    const ro = roCheck.rows[0];

    // If caller is OMC Admin, ensure RO belongs to caller's OMC
    if (req.user?.role === 'OMC Admin' && ro.omc_id !== req.user.omcId) {
      return res.status(403).json(new ApiResponse(403, null, 'Not authorized to delete RO belonging to another OMC'));
    }

    // Cascading delete
    // 1. Delete telemetry history for machines under this RO
    await db.query('DELETE FROM telemetry_history WHERE machine_name IN (SELECT name FROM machines WHERE ro_id = $1)', [id]);

    // 2. Delete alerts linked to machines under this RO
    await db.query('DELETE FROM alerts WHERE machine_id IN (SELECT id FROM machines WHERE ro_id = $1)', [id]);

    // 3. Delete machines under this RO
    await db.query('DELETE FROM machines WHERE ro_id = $1', [id]);

    // 4. Delete users (RO Managers/Operators) linked to this RO (by ro_id or contact username)
    if (ro.contact) {
      await db.query('DELETE FROM users WHERE ro_id = $1 OR username = $2', [id, ro.contact]);
    } else {
      await db.query('DELETE FROM users WHERE ro_id = $1', [id]);
    }
    
    // 5. Delete RO record
    await db.query('DELETE FROM ro WHERE id = $1', [id]);
    res.status(200).json(new ApiResponse(200, null, 'RO and all associated machines and user accounts deleted successfully'));
  } catch (error) { next(error); }
};
