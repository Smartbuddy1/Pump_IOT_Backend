const jwt = require('jsonwebtoken');
const db = require('../config/db');
const ApiResponse = require('../utils/apiResponse');

exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json(new ApiResponse(401, null, 'Not authorized to access this route'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Real-time check in Database
    const userResult = await db.query('SELECT id, username, role, omc_id, ro_id FROM users WHERE id = $1', [decoded.id]);
    const user = userResult.rows[0];
    
    if (!user) {
      return res.status(401).json(new ApiResponse(401, null, 'User no longer exists'));
    }

    // Real-time check if OMC was deleted
    if (user.role === 'OMC Admin') {
      if (!user.omc_id) {
        return res.status(401).json(new ApiResponse(401, null, 'OMC no longer exists or was deleted'));
      }
      const omcExists = await db.query('SELECT id FROM omc WHERE id = $1', [user.omc_id]);
      if (omcExists.rows.length === 0) {
        return res.status(401).json(new ApiResponse(401, null, 'OMC no longer exists or was deleted'));
      }
    }

    // Real-time check if RO or parent OMC was deleted
    if (user.role === 'RO Manager' || user.role === 'Operator') {
      if (!user.ro_id) {
        return res.status(401).json(new ApiResponse(401, null, 'RO no longer exists or was deleted'));
      }
      const roExists = await db.query(
        'SELECT r.id FROM ro r JOIN omc o ON r.omc_id = o.id WHERE r.id = $1',
        [user.ro_id]
      );
      if (roExists.rows.length === 0) {
        return res.status(401).json(new ApiResponse(401, null, 'RO or its parent OMC no longer exists or was deleted'));
      }
    }
    
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      omcId: user.omc_id,
      roId: user.ro_id
    }; // Updated with latest role from DB
    next();
  } catch (err) {
    return res.status(401).json(new ApiResponse(401, null, 'Not authorized to access this route'));
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json(new ApiResponse(403, null, `User role ${req.user.role} is not authorized to access this route`));
    }
    next();
  };
};
