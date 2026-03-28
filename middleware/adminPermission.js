function checkPermission(module, action) {
  return function(req, res, next) {
    // Super admin bypasses all checks
    if (req.admin.role === 'super_admin') return next();

    var perms = req.admin.permissions;
    if (!perms || !perms[module] || !perms[module][action]) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: requires ' + module + '.' + action + ' permission'
      });
    }
    next();
  };
}
module.exports = checkPermission;
