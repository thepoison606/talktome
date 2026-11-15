(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TalktomeAdminAutoSave = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function create({ save, render, onSaved = () => {}, savedMs = 2500 }) {
    const pending = new Map(), revisions = new Map(), errors = new Map();
    let running = false, clearTimer;
    function display(saved = false) {
      clearTimeout(clearTimer);
      if (errors.size) render(`Not saved: ${[...errors.values()].map(entry => entry.error.message).join(' · ')}`, retry);
      else if (running || pending.size) render('Saving…');
      else if (saved) {
        render('Saved');
        clearTimer = setTimeout(() => render(''), savedMs);
      }
    }
    function request(key, read) {
      clearTimeout(clearTimer);
      const revision = (revisions.get(key) || 0) + 1;
      revisions.set(key, revision);
      try {
        const value = read();
        pending.set(key, { key, read, value, revision });
        errors.delete(key);
      } catch (error) {
        pending.delete(key); errors.set(key, { read, error }); display(); return;
      }
      display(); void pump();
    }
    async function pump() {
      if (running) return;
      running = true; display();
      while (pending.size) {
        const [key, job] = pending.entries().next().value;
        pending.delete(key);
        try {
          const result = await save(key, job.value);
          if (revisions.get(key) === job.revision) {
            errors.delete(key); await onSaved(key, job.value, result);
          }
        } catch (error) {
          if (revisions.get(key) === job.revision) errors.set(key, { read: job.read, error });
        }
      }
      running = false; display(true);
    }
    function retry() { for (const [key, entry] of [...errors]) request(key, entry.read); }
    return { request, retry, hasError(key) { return errors.has(key); }, get busy() { return running || pending.size > 0; } };
  }
  return { create };
});
