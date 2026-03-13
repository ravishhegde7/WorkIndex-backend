let AuditLog;

function getModel() {
  if (!AuditLog) {
    try { AuditLog = require('../models/AuditLog'); } catch(e) {}
  }
  return AuditLog;
}

/**
 * logAudit(actor, action, target, metadata)
 * actor   = { id, role, name }
 * action  = string e.g. 'request_created'
 * target  = { type, id, name } — all optional
 * metadata = plain object for extra context
 */
async function logAudit(actor, action, target, metadata) {
  try {
    var Model = getModel();
    if (!Model) return;
    if (!actor || !actor.id) return;

    await Model.create({
      actor:      actor.id,
      actorRole:  actor.role  || 'client',
      actorName:  actor.name  || '',
      action:     action,
      targetType: (target && target.type) || '',
      targetId:   (target && target.id)   || null,
      targetName: (target && target.name) || '',
      metadata:   metadata || {}
    });
  } catch(err) {
    // Never crash the main request because of audit failure
    console.error('[audit] log failed:', err.message);
  }
}

module.exports = { logAudit };
