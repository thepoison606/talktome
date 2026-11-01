function canUserRearrangeTargets(user, defaultSettings = {}) {
  if (!user || user.is_superadmin || user.is_guest_profile) return false;
  return user.allow_target_rearrange == null
    ? defaultSettings?.allowTargetRearrange !== false
    : Boolean(user.allow_target_rearrange);
}

function canUserAddRemoveTargets(user, defaultSettings = {}) {
  if (!user || user.is_superadmin || user.is_guest_profile) return false;
  return user.allow_target_add_remove == null
    ? defaultSettings?.allowTargetAddRemove === true : Boolean(user.allow_target_add_remove);
}

function validateCompleteTargetOrder(items, availableTargets) {
  if (!Array.isArray(items)) {
    const error = new Error('items array required');
    error.statusCode = 400;
    throw error;
  }
  if (items.length !== availableTargets.length) {
    const error = new Error('Targets changed. Reload the list and try again.');
    error.statusCode = 409;
    throw error;
  }

  const available = new Set(availableTargets.map((target) => `${target.targetType}:${target.targetId}`));
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const targetType = item?.targetType;
    const targetId = Number(item?.targetId);
    if (!['user', 'conference', 'feed'].includes(targetType) || !Number.isSafeInteger(targetId) || targetId < 1) {
      const error = new Error('Invalid target');
      error.statusCode = 400;
      throw error;
    }
    const key = `${targetType}:${targetId}`;
    if (!available.has(key) || seen.has(key)) {
      const error = new Error('Targets changed. Reload the list and try again.');
      error.statusCode = 409;
      throw error;
    }
    seen.add(key);
    normalized.push({ targetType, targetId });
  }
  return normalized;
}

module.exports = { canUserAddRemoveTargets, canUserRearrangeTargets, validateCompleteTargetOrder };
