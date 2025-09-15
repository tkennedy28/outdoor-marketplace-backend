// backend/middleware/auth.js
const jwt = require('jsonwebtoken');

// Reads Bearer or x-auth-token header
function readToken(req) {
  const bearer = req.header('Authorization');
  if (bearer && bearer.startsWith('Bearer ')) return bearer.slice(7);
  const x = req.header('x-auth-token');
  return x || null;
}

// Strict auth (your current behavior)
function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token, authorization denied'
      });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // keep payload as-is
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Token is not valid'
    });
  }
}

// Admin-only (wraps requireAuth, then checks role flags)
function requireAdmin(req, res, next) {
  return requireAuth(req, res, (err) => {
    if (err) return next(err);
    const u = req.user || {};
    const roles = Array.isArray(u.roles) ? u.roles : [];
    const isAdmin =
      u.role === 'admin' ||
      u.isAdmin === true ||
      roles.includes('admin');

    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    return next();
  });
}

// Optional auth (never 401s)
function optionalAuth(req, _res, next) {
  try {
    const token = readToken(req);
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }
  } catch {
    // ignore invalid token
  }
  return next();
}

// Export default + named middlewares
module.exports = requireAuth;
module.exports.admin = requireAdmin;
module.exports.optional = optionalAuth;
