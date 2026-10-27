const db = require('../config/db');
const ApiResponse = require('../utils/apiResponse');
const bcrypt = require('bcrypt');

// @desc    Get all OMCs
// @route   GET /api/v1/omc
// @access  Private
exports.getOMCs = async (req, res, next) => {
  try {
    const role = req.user?.role;
    const omcId = req.user?.omcId;
    let result;
    if (role === 'OMC Admin' && omcId) {
      // OMC Admin only sees their own OMC
      result = await db.query('SELECT * FROM omc WHERE id = $1', [omcId]);
    } else if (role === 'RO Manager' && omcId) {
      // RO Manager sees the parent OMC
      result = await db.query('SELECT * FROM omc WHERE id = $1', [omcId]);
    } else {
      // Super Admin sees all
      result = await db.query('SELECT * FROM omc ORDER BY created_at DESC');
    }
    console.log(`[getOMCs] Called by user ${req.user?.id} (${role}), returned ${result.rows.length} rows`);
    res.status(200).json(new ApiResponse(200, result.rows, 'OMCs retrieved successfully'));
  } catch (error) { next(error); }
};

// @desc    Create an OMC
// @route   POST /api/v1/omc
// @desc    Create an OMC
// @route   POST /api/v1/omc
// @access  Private (Super Admin)
exports.createOMC = async (req, res, next) => {
  try {
    const { name, location, contact, contact_password } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json(new ApiResponse(400, null, 'OMC Name is required'));
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

    // Check if phone number already exists in omc, ro, or users
    const existingOmc = await db.query("SELECT id, name FROM omc WHERE REGEXP_REPLACE(contact, '\\D', '', 'g') = $1", [cleanContact]);
    if (existingOmc.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered with OMC "${existingOmc.rows[0].name}". Duplicate phone number is strictly prohibited.`));
    }

    const existingRo = await db.query("SELECT id, name FROM ro WHERE REGEXP_REPLACE(contact, '\\D', '', 'g') = $1", [cleanContact]);
    if (existingRo.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered with RO "${existingRo.rows[0].name}". Duplicate phone number is strictly prohibited.`));
    }

    const existingUser = await db.query("SELECT id, username FROM users WHERE username = $1 OR REGEXP_REPLACE(username, '\\D', '', 'g') = $1", [cleanContact]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered to an existing account. Duplicate phone number is strictly prohibited.`));
    }
    
    // 1. Create OMC
    const result = await db.query(
      'INSERT INTO omc (name, location, contact, contact_password) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, location, cleanContact, contact_password]
    );
    const newOmc = result.rows[0];

    // 2. Generate OMC Admin User
    const rawPassword = contact_password || Math.random().toString(36).slice(-8);
    const username = cleanContact;
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    await db.query(
      'INSERT INTO users (username, password, role, omc_id) VALUES ($1, $2, $3, $4)',
      [username, hashedPassword, 'OMC Admin', newOmc.id]
    );

    // 3. Return OMC and Credentials
    res.status(201).json(new ApiResponse(201, {
      ...newOmc,
      credentials: { username, password: rawPassword }
    }, 'OMC created successfully'));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json(new ApiResponse(400, null, 'This phone number is already registered in the system. Duplicate numbers are strictly prohibited.'));
    }
    next(error);
  }
};

// @desc    Update an OMC
// @route   PUT /api/v1/omc/:id
// @access  Private (Super Admin, OMC Admin)
exports.updateOMC = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, location, contact, contact_password } = req.body;
    if (!contact_password) {
      return res.status(400).json(new ApiResponse(400, null, 'Password is required'));
    }

    const cleanContact = String(contact || '').replace(/\D/g, '').trim();
    if (!cleanContact || cleanContact.length !== 10) {
      return res.status(400).json(new ApiResponse(400, null, 'Phone number must be exactly 10 digits'));
    }

    // Check duplicate phone number when updating
    const existingOmc = await db.query("SELECT id, name FROM omc WHERE REGEXP_REPLACE(contact, '\\D', '', 'g') = $1 AND id != $2", [cleanContact, id]);
    if (existingOmc.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered with OMC "${existingOmc.rows[0].name}". Duplicate phone number is strictly prohibited.`));
    }

    const existingRo = await db.query("SELECT id, name FROM ro WHERE REGEXP_REPLACE(contact, '\\D', '', 'g') = $1", [cleanContact]);
    if (existingRo.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered with RO "${existingRo.rows[0].name}". Duplicate phone number is strictly prohibited.`));
    }

    const existingUser = await db.query("SELECT id FROM users WHERE (username = $1 OR REGEXP_REPLACE(username, '\\D', '', 'g') = $1) AND (omc_id IS NULL OR omc_id != $2)", [cleanContact, id]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json(new ApiResponse(400, null, `Phone number ${cleanContact} is already registered to another account. Duplicate phone number is strictly prohibited.`));
    }

    const result = await db.query(
      'UPDATE omc SET name = $1, location = $2, contact = $3, contact_password = $4 WHERE id = $5 RETURNING *',
      [name, location, cleanContact, contact_password, id]
    );
    if (result.rows.length === 0) return res.status(404).json(new ApiResponse(404, null, 'OMC not found'));
    
    // Also update the user's password if it was changed
    if (contact_password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(contact_password, salt);
      await db.query(
        'UPDATE users SET password = $1, username = $2 WHERE omc_id = $3 AND role = $4',
        [hashedPassword, cleanContact, id, 'OMC Admin']
      );
    } else {
      await db.query(
        'UPDATE users SET username = $1 WHERE omc_id = $2 AND role = $3',
        [cleanContact, id, 'OMC Admin']
      );
    }
    
    res.status(200).json(new ApiResponse(200, result.rows[0], 'OMC updated successfully'));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json(new ApiResponse(400, null, 'This phone number is already registered in the system. Duplicate numbers are strictly prohibited.'));
    }
    next(error);
  }
};

// @desc    Delete an OMC
// @route   DELETE /api/v1/omc/:id
// @access  Private (Super Admin)
exports.deleteOMC = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const omcCheck = await db.query('SELECT * FROM omc WHERE id = $1', [id]);
    if (omcCheck.rows.length === 0) return res.status(404).json(new ApiResponse(404, null, 'OMC not found'));
    const omc = omcCheck.rows[0];

    // Cascading delete
    // 1. Delete telemetry history for machines under this OMC's ROs
    await db.query(`
      DELETE FROM telemetry_history 
      WHERE machine_name IN (
        SELECT name FROM machines WHERE ro_id IN (SELECT id FROM ro WHERE omc_id = $1)
      )
    `, [id]);

    // 2. Delete alerts linked to machines under ROs under this OMC
    await db.query(`
      DELETE FROM alerts 
      WHERE machine_id IN (
        SELECT id FROM machines WHERE ro_id IN (SELECT id FROM ro WHERE omc_id = $1)
      )
    `, [id]);

    // 3. Delete machines under ROs under this OMC
    await db.query(`
      DELETE FROM machines 
      WHERE ro_id IN (SELECT id FROM ro WHERE omc_id = $1)
    `, [id]);

    // 4. Delete users linked to ROs under this OMC (by ro_id or RO contacts)
    await db.query(`
      DELETE FROM users 
      WHERE ro_id IN (SELECT id FROM ro WHERE omc_id = $1)
         OR (username IS NOT NULL AND username IN (SELECT contact FROM ro WHERE omc_id = $1 AND contact IS NOT NULL))
    `, [id]);

    // 5. Delete ROs under this OMC
    await db.query('DELETE FROM ro WHERE omc_id = $1', [id]);

    // 6. Delete OMC Admin users (by omc_id or OMC contact)
    if (omc.contact) {
      await db.query('DELETE FROM users WHERE omc_id = $1 OR username = $2', [id, omc.contact]);
    } else {
      await db.query('DELETE FROM users WHERE omc_id = $1', [id]);
    }
    
    // 7. Delete OMC record
    await db.query('DELETE FROM omc WHERE id = $1', [id]);
    res.status(200).json(new ApiResponse(200, null, 'OMC and all associated ROs, machines, and user accounts deleted successfully'));
  } catch (error) { next(error); }
};
