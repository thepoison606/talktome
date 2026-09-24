(function (root) {
  function createConnectionSounds(getContext, load = (url) => fetch(url)) {
    const files = {};
    const buffers = {};
    const decoding = {};
    let lost = false;
    let enabled = true;
    let source = null;
    let background = false;
    let backgroundCycleComplete = false;
    // Fetch while connected: the loss notification must not require the server.
    for (const name of ['disconnected', 'reconnected']) {
      files[name] = load(`/audio/${name}.mp3`)
        .then((response) => {
          if (!response.ok) throw new Error('Sound unavailable');
          return response.arrayBuffer();
        }).catch(() => null);
    }
    async function prepare() {
      const ctx = getContext();
      if (!ctx) return;
      // Call resume directly inside the gesture, before awaiting any downloads.
      if (['suspended', 'interrupted'].includes(ctx.state)) {
        try { ctx.resume().catch(() => {}); } catch {}
      }
      await Promise.all(Object.keys(files).map(async (name) => {
        if (buffers[name]) return;
        if (!decoding[name]) {
          decoding[name] = (async () => {
            const bytes = await files[name];
            if (bytes) {
              try { buffers[name] = await ctx.decodeAudioData(bytes.slice(0)); } catch {}
            }
          })().finally(() => { delete decoding[name]; });
        }
        await decoding[name];
      }));
    }
    function play(name) {
      if (!enabled) return;
      const ctx = getContext();
      // Never queue a stale announcement for a later user gesture.
      if (!ctx || ctx.state !== 'running' || !buffers[name]) return;
      try {
        if (source) source.stop();
        const next = ctx.createBufferSource();
        source = next;
        next.buffer = buffers[name];
        next.connect(ctx.destination);
        next.onended = () => { next.disconnect(); if (source === next) source = null; };
        next.start();
      } catch {}
    }
    return {
      prepare,
      setEnabled(value) {
        enabled = !!value;
        if (!enabled && source) {
          try { source.stop(); } catch {}
          source = null;
        }
      },
      setBackground(value) {
        const next = !!value;
        if (background !== next) {
          background = next;
          backgroundCycleComplete = false;
        }
      },
      disconnected() {
        if (lost) return;
        lost = true;
        if (!background || !backgroundCycleComplete) play('disconnected');
      },
      reconnected() {
        if (!lost) return;
        lost = false;
        if (!background || !backgroundCycleComplete) play('reconnected');
        if (background) backgroundCycleComplete = true;
      },
    };
  }
  if (typeof module !== 'undefined') module.exports = { createConnectionSounds };
  else root.createConnectionSounds = createConnectionSounds;
})(globalThis);
