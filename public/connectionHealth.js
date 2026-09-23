(function (root) {
  function createConnectionHealth(socket, onChange, {
    now = () => performance.now(),
    schedule = (callback, delay) => setInterval(callback, delay),
    cancel = (timer) => clearInterval(timer),
  } = {}) {
    const intervalMs = 500;
    const timeoutMs = 2000;
    let timer = null;
    let generation = 0;
    let lastReply = 0;
    let interrupted = false;

    function update(value) {
      if (interrupted === value) return;
      interrupted = value;
      onChange(value);
    }

    function stop() {
      generation++;
      if (timer !== null) cancel(timer);
      timer = null;
      update(false);
    }

    function start() {
      stop();
      const currentGeneration = generation;
      lastReply = now();
      function tick() {
        if (!socket.connected || currentGeneration !== generation) return;
        update(now() - lastReply >= timeoutMs);
        const sentAt = now();
        // Volatile packets never queue during an outage; timed acknowledgements
        // bound pending callbacks and prevent old replies from clearing a warning.
        socket.volatile.timeout(timeoutMs).emit('connection-health', (error, reply) => {
          if (error || reply !== true || !socket.connected
              || currentGeneration !== generation || now() - sentAt >= timeoutMs) return;
          lastReply = now();
          update(false);
        });
      }
      timer = schedule(tick, intervalMs);
      tick();
    }

    return { start, stop };
  }
  if (typeof module !== 'undefined') module.exports = { createConnectionHealth };
  else root.createConnectionHealth = createConnectionHealth;
})(globalThis);
