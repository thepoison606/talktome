(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TalktomeClientDeviceStatus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function browserNetworkType(connection, online) {
    if (online === false) return 'none';
    const types = { wifi: 'wifi', cellular: 'cellular', ethernet: 'ethernet', bluetooth: 'bluetooth', none: 'none', other: 'other' };
    // effectiveType (e.g. '4g') describes speed, not Wi-Fi versus cellular.
    return types[connection?.type] || null;
  }
  function createReporter({ socket, isActive, readOutput, environment = window, intervalMs = 10000 }) {
    const nav = environment.navigator;
    let stopped = false, pending = false, battery = null;
    const cleanup = [];
    function listen(target, event, handler) {
      target?.addEventListener?.(event, handler);
      cleanup.push(() => target?.removeEventListener?.(event, handler));
    }
    async function report() {
      if (stopped || pending || !socket.connected || !isActive()) return;
      pending = true;
      let timeout;
      try {
        const output = await Promise.race([
          Promise.resolve().then(readOutput).catch(() => null),
          new Promise(resolve => { timeout = environment.setTimeout(() => resolve(null), 4000); }),
        ]);
        if (stopped || !socket.connected || !isActive()) return;
        const level = battery?.level;
        socket.volatile.emit('client-device-status', {
          audioOutput: output,
          batteryPercent: typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1 ? Math.round(level * 100) : null,
          charging: typeof battery?.charging === 'boolean' ? battery.charging : null,
          networkType: browserNetworkType(nav.connection || nav.mozConnection || nav.webkitConnection, nav.onLine),
        });
      } catch { /* Optional diagnostics cannot block media. */ }
      finally { environment.clearTimeout(timeout); pending = false; }
    }
    const changed = () => { void report(); };
    listen(nav.connection || nav.mozConnection || nav.webkitConnection, 'change', changed);
    listen(nav.mediaDevices, 'devicechange', changed);
    listen(environment, 'online', changed); listen(environment, 'offline', changed);
    listen(environment.document, 'visibilitychange', changed);
    if (typeof nav.getBattery === 'function') {
      Promise.resolve().then(() => nav.getBattery()).then(value => {
        if (stopped) return;
        battery = value;
        listen(battery, 'levelchange', changed); listen(battery, 'chargingchange', changed);
        changed();
      }).catch(() => {});
    }
    const timer = environment.setInterval(changed, intervalMs);
    changed();
    return { report, stop() { stopped = true; environment.clearInterval(timer); cleanup.forEach(remove => remove()); } };
  }
  return { browserNetworkType, createReporter };
});
