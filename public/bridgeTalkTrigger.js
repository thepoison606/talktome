(function initBridgeTalkTrigger(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TalktomeBridgeTalkTrigger = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createBridgeTalkTrigger() {
  function mode(value) {
    return ['audio-level', 'always-on'].includes(value) ? value : 'external';
  }
  // A missing list falls back to the single target saved by older servers.
  // An explicit empty list clears that target instead.
  function targets(value, legacy = null, { strict = false } = {}) {
    if (typeof value === 'string' && !strict) {
      try { value = JSON.parse(value); } catch { value = []; }
    }
    if (value === null || value === undefined) value = legacy ? [legacy] : [];
    if (!Array.isArray(value)) {
      if (strict) throw new Error('Talk targets must be an array');
      return [];
    }
    const unique = new Map();
    for (const target of value) {
      const type = target?.type;
      const id = Number(target?.id);
      if (!['user', 'conference'].includes(type) || !Number.isSafeInteger(id) || id < 1) {
        if (strict) throw new Error('Talk targets must be valid users or conferences');
        continue;
      }
      unique.set(`${type}:${id}`, { type, id });
    }
    return [...unique.values()];
  }
  function fromTrigger(trigger = {}) {
    return targets(trigger.targets, trigger.target);
  }
  function matches(first, second) {
    const a = targets(first);
    const b = targets(second);
    const keys = new Set(a.map(target => `${target.type}:${target.id}`));
    return a.length === b.length && b.every(target => keys.has(`${target.type}:${target.id}`));
  }
  return Object.freeze({ mode, targets, fromTrigger, matches });
}));
