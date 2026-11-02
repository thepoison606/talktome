(() => {
  'use strict';

  const REDACTED = '********';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    authenticated: false,
    view: 'status',
    status: null,
    statusTimer: null,
    deckTimer: null,
    config: null,
    configDoc: null,
    runningDoc: null,
    fileDoc: null,
    audioDevices: { inputs: [], outputs: [] },
    rawMode: false,
    pressed: new Set(),
    locks: new Set(),
    memberModalKey: null,
    volumeTimers: new Map(),
    restarting: false,
  };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  async function api(method, path, body) {
    const options = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    if (response.status === 401 && !path.endsWith('/api/login')) {
      showLogin();
      throw new Error('login required');
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!response.ok) {
      throw new Error((data && data.error) || `${response.status} ${response.statusText}`);
    }
    return data;
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function badge(text, kind) {
    return el('span', { class: `badge${kind ? ` badge-${kind}` : ''}`, text });
  }

  function formatServerVersion(raw) {
    const text = String(raw || '').trim();
    if (!text) return '–';
    if (text === 'unknown') return 'unknown';
    return text.startsWith('v') || text.startsWith('V') ? text : `v${text}`;
  }

  function tallyBadges(snap) {
    const wrap = el('span', { class: 'tally-badges' });
    if (snap.on_air) wrap.append(badge('ON AIR', 'onair'));
    if (snap.on_air && snap.preview) wrap.append(' ');
    if (snap.preview) wrap.append(badge('PREVIEW', 'preview'));
    if (!snap.on_air && !snap.preview) wrap.append(badge('off'));
    return wrap;
  }

  // Short state for a line that could not be requested; the card message and
  // the cell tooltip carry the full text.
  function gpioErrorLabel(error) {
    return /already used/.test(error) ? 'in use' : 'error';
  }

  function gpioLedClass(output) {
    if (output.error) return 'led-amber';
    if (output.active === null) return 'led-unknown';
    if (!output.active) return '';
    if (output.name === 'tally') return 'led-red';
    if (output.name === 'tally_preview') return 'led-preview';
    return 'led-on';
  }

  function setBadge(node, text, kind) {
    if (!node) return;
    node.textContent = text;
    node.className = `badge${kind ? ` badge-${kind}` : ''}`;
  }

  function flash(message, kind = '') {
    const node = $('#flash');
    node.textContent = message;
    node.className = `flash ${kind}`;
    node.classList.remove('is-hidden');
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => node.classList.add('is-hidden'), 6000);
  }

  function formatDuration(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return '–';
    const s = Math.max(0, Math.floor(seconds));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m ${sec}s`;
    if (m) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  const MUTE_DB = -60;
  const SLIDE_LOCK_PX = 42;
  const UI_ICONS = {
    talk: '/images/walkie-talkies-white.png',
    speakerOn: '/images/speaker-white.png',
    speakerMuted: '/images/speaker-muted.png',
  };
  function linearToDb(linear) {
    const value = Number(linear);
    if (!Number.isFinite(value) || value <= 1e-6) return MUTE_DB;
    return 20 * Math.log10(Math.min(1, Math.max(value, 1e-6)));
  }
  function dbToLinear(db) {
    const value = Number(db);
    if (!Number.isFinite(value) || value <= MUTE_DB) return 0;
    return Math.min(1, Math.pow(10, value / 20));
  }
  function formatDb(linear) {
    const db = linearToDb(linear);
    if (db <= MUTE_DB) return '-inf dB';
    const rounded = Math.round(db * 10) / 10;
    return `${rounded.toFixed(1)} dB`;
  }

  function kv(container, rows) {
    container.replaceChildren();
    for (const [label, value] of rows) {
      if (value === undefined) continue;
      container.append(el('dt', { text: label }));
      const dd = el('dd');
      if (value instanceof Node) dd.append(value);
      else dd.textContent = value === null || value === '' ? '–' : String(value);
      container.append(dd);
    }
  }

  function code(text) {
    return el('code', { text });
  }

  function connectionAlert(snap) {
    switch (snap.media_status) {
      case 'Server not responding':
      case 'Media interrupted':
      case 'Media connecting':
        return { text: snap.media_status, kind: 'warn' };
      case 'Media failed':
        return { text: snap.media_status, kind: 'bad' };
      default:
        return null;
    }
  }

  function connectionKind(connection) {
    switch (connection) {
      case 'ready':
        return 'ok';
      case 'registered':
      case 'connecting':
      case 'logging-in':
      case 'registering':
        return 'warn';
      case 'conflict':
      case 'kicked':
      case 'disconnected':
        return 'bad';
      default:
        return '';
    }
  }

  function targetKey(target) {
    if (typeof target === 'string') return target;
    if (!target) return null;
    const [kind, id] = Object.entries(target)[0];
    return `${kind.toLowerCase()}:${id}`;
  }

  function targetKind(key) {
    return key.split(':')[0];
  }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------

  function showLogin() {
    state.authenticated = false;
    stopPolling();
    $('#login-overlay').classList.remove('is-hidden');
    $('#topbar').classList.add('is-hidden');
    $('#app').classList.add('is-hidden');
    setTimeout(() => $('#login-form input[name="password"]').focus(), 50);
  }

  function showApp() {
    state.authenticated = true;
    $('#login-overlay').classList.add('is-hidden');
    $('#topbar').classList.remove('is-hidden');
    $('#app').classList.remove('is-hidden');
    routeFromHash();
    startPolling();
  }

  async function boot() {
    try {
      const session = await api('GET', '/api/session');
      $('#login-instance').textContent = session.instance ? `Instance ${session.instance} · v${session.version}` : '';
      $('#topbar-instance').textContent = `Talktome Headless · ${session.instance || ''}`;
      if (session.authenticated) {
        showApp();
        if (session.must_change_password) openPasswordDialog(true);
      } else {
        showLogin();
      }
    } catch (error) {
      showLogin();
      $('#login-message').textContent = error.message;
    }
  }

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('#login-message');
    message.textContent = '';
    try {
      const result = await api('POST', '/api/login', {
        username: form.username.value,
        password: form.password.value,
      });
      form.password.value = '';
      showApp();
      if (result.must_change_password) openPasswordDialog(true);
    } catch (error) {
      message.textContent = error.message;
    }
  });

  $('#logout-button').addEventListener('click', async () => {
    try {
      await api('POST', '/api/logout');
    } catch {
      // ignore
    }
    showLogin();
  });

  // ---------------------------------------------------------------------
  // Password dialog
  // ---------------------------------------------------------------------

  function openPasswordDialog(forced) {
    const dialog = $('#password-dialog');
    dialog.dataset.forced = forced ? '1' : '';
    $('#password-intro').textContent = forced
      ? 'The default password is in use. Choose a new one before continuing.'
      : 'Choose a new password for the admin login.';
    $('#password-cancel').classList.toggle('is-hidden', Boolean(forced));
    $('#password-message').textContent = '';
    $('#password-form').reset();
    dialog.classList.remove('is-hidden');
    setTimeout(() => $('#password-form input[name="current"]').focus(), 50);
  }

  $('#password-cancel').addEventListener('click', () => $('#password-dialog').classList.add('is-hidden'));
  $('#change-password-button').addEventListener('click', () => openPasswordDialog(false));

  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('#password-message');
    message.className = 'form-message';
    if (form.new.value !== form.repeat.value) {
      message.textContent = 'The new passwords do not match.';
      return;
    }
    try {
      const result = await api('POST', '/api/password', { current: form.current.value, new: form.new.value });
      $('#password-dialog').classList.add('is-hidden');
      flash(result.note ? `Password changed. ${result.note}` : 'Password changed and saved to the configuration file.', 'ok');
    } catch (error) {
      message.textContent = error.message;
    }
  });

  // ---------------------------------------------------------------------
  // Restart
  // ---------------------------------------------------------------------

  function confirmDialog(title, text, okLabel) {
    return new Promise((resolve) => {
      const dialog = $('#confirm-dialog');
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      $('#confirm-ok').textContent = okLabel;
      dialog.classList.remove('is-hidden');
      const done = (value) => {
        dialog.classList.add('is-hidden');
        $('#confirm-ok').onclick = null;
        $('#confirm-cancel').onclick = null;
        resolve(value);
      };
      $('#confirm-ok').onclick = () => done(true);
      $('#confirm-cancel').onclick = () => done(false);
    });
  }

  async function restartService(skipConfirm) {
    if (!skipConfirm) {
      const ok = await confirmDialog(
        'Restart service?',
        'The client disconnects from Talktome, applies the saved configuration and reconnects. Audio is interrupted for a few seconds.',
        'Restart'
      );
      if (!ok) return;
    }
    try {
      await api('POST', '/api/restart');
    } catch (error) {
      flash(`Restart failed: ${error.message}`, 'error');
      return;
    }
    state.restarting = true;
    stopPolling();
    flash('Restarting… waiting for the service to come back.', '');
    const started = Date.now();
    const poll = async () => {
      try {
        const session = await api('GET', '/api/session');
        if (Date.now() - started > 1500 && session) {
          state.restarting = false;
          flash('Service is back.', 'ok');
          if (session.authenticated) startPolling();
          else showLogin();
          return;
        }
      } catch {
        // still down
      }
      if (Date.now() - started > 90000) {
        flash('The service did not come back within 90 s. Check the journal on the device.', 'error');
        state.restarting = false;
        return;
      }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 1500);
  }

  $('#restart-button').addEventListener('click', () => restartService(false));

  // ---------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------

  function routeFromHash() {
    const view = (location.hash || '#status').slice(1);
    showView(['status', 'remote', 'deck', 'settings'].includes(view) ? view : 'status');
  }

  function showView(view) {
    state.view = view;
    document.body.dataset.view = view;
    for (const section of $$('.view')) section.classList.toggle('is-hidden', section.id !== `view-${view}`);
    for (const link of $$('.topbar__nav a')) {
      if (link.dataset.view === view) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    if (view === 'settings' && !state.config) loadConfig();
    if (view === 'deck') refreshDeck();
  }

  window.addEventListener('hashchange', routeFromHash);

  // ---------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------

  function startPolling() {
    stopPolling();
    refreshStatus();
    state.statusTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshStatus();
    }, 1000);
    state.deckTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && state.view === 'deck') refreshDeck();
    }, 700);
  }

  function stopPolling() {
    clearInterval(state.statusTimer);
    clearInterval(state.deckTimer);
    state.statusTimer = null;
    state.deckTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.authenticated && !state.restarting) refreshStatus();
  });

  // ---------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------

  async function refreshStatus() {
    if (!state.authenticated || state.restarting) return;
    let status;
    try {
      status = await api('GET', '/api/status');
    } catch (error) {
      if (error.message !== 'login required') setBadge($('#badge-connection'), 'no response', 'bad');
      return;
    }
    state.status = status;
    try {
      renderStatus(status);
      renderRemote(status.snapshot);
      refreshSettingsTargetSelects();
    } catch (error) {
      console.error(error);
    }
  }

  function renderStatus(status) {
    const snap = status.snapshot;
    $('#topbar-user').textContent = `${snap.user_name}${snap.user_id != null ? ` (#${snap.user_id})` : ''} · ${snap.server_url}`;
    const alert = connectionAlert(snap);
    setBadge(
      $('#badge-connection'),
      alert ? alert.text : snap.connection,
      alert ? alert.kind : connectionKind(snap.connection)
    );
    $('#badge-onair').classList.toggle('is-hidden', !snap.on_air);
    $('#badge-preview').classList.toggle('is-hidden', !snap.preview);
    setBadge(
      $('#conn-state'),
      alert ? alert.text : snap.connection + (snap.detail ? ` · ${snap.detail}` : ''),
      alert ? alert.kind : connectionKind(snap.connection)
    );

    const media = snap.media || {};
    kv($('#conn-details'), [
      ['Server', code(snap.server_url)],
      ['User', `${snap.user_name}${snap.user_id != null ? ` (id ${snap.user_id})` : ''}`],
      ['Production', productionLabel(snap)],
      ['Registered for', snap.registered_since_unix ? formatDuration(status.now_unix - snap.registered_since_unix) : '–'],
      ['Reconnects', snap.reconnects],
      ['Server heartbeat', snap.heartbeat || '–'],
      ['Media', snap.media_status || '–'],
      ['Send transport', media.send_state || '–'],
      ['Receive transport', media.recv_state || '–'],
      ['Consumers', media.consumers != null ? media.consumers : '–'],
      ['Producer', media.producer_id ? code(media.producer_id.slice(0, 8)) : '–'],
      ['ICE (server)', media.ice_servers_announced && media.ice_servers_announced.length ? media.ice_servers_announced.join(', ') : (media.ice_servers && media.ice_servers.length ? media.ice_servers.join(', ') : 'none (direct only)')],
      ['ICE (webrtc)', iceEffectiveLabel(media)],
      ['ICE policy', media.ice_transport_policy || '–'],
      ['RTT', media.rtt_ms != null ? `${media.rtt_ms} ms${media.rtt_source ? ` (${media.rtt_source})` : ''}` : '–'],
      ['Packet loss', media.packet_loss_pct != null ? `${media.packet_loss_pct}%${media.packets_lost != null ? ` (${media.packets_lost} lost / ${media.packets_received || 0} recv)` : ''}` : '–'],
      ['Receive concealment', media.recv_conceal_pct != null ? `${media.recv_conceal_pct}%` : '–'],
      ['Camera tally', tallyBadges(snap)],
      ['Talktome server', snap.server_version ? formatServerVersion(snap.server_version) : '–'],
    ]);

    // Audio card
    const audio = status.audio || {};
    const audioOk = snap.audio_ok;
    setBadge($('#audio-state'), audioOk ? 'ok' : 'no device', audioOk ? 'ok' : 'bad');
    kv($('#audio-details'), [
      ['Capture', audio.capture_device ? `${audio.capture_device}${audio.capture_ok ? '' : ' (not open)'}` : status.audio_config.input_device === 'none' ? 'disabled' : 'not open'],
      ['Playback', audio.playback_device ? `${audio.playback_device}${audio.playback_ok ? '' : ' (not open)'}` : status.audio_config.output_device === 'none' ? 'disabled' : 'not open'],
      ['Profile', status.audio_config.profile],
      ['Device period', status.audio_config.device_period_ms == null ? '' : `${status.audio_config.device_period_ms} ms`],
      ['Processing', audio.auto_processing ? (audio.aec ? 'AEC + NS + AGC' : 'NS + AGC (no AEC)') : 'off'],
      ['AEC delay', audio.auto_processing && audio.aec ? `${audio.delay_ms} ms` : '–'],
      ['Last error', audio.last_error || '–'],
    ]);
    const level = Math.max(-60, Math.min(0, snap.input_level_db));
    $('#input-meter').style.width = `${((level + 60) / 60) * 100}%`;
    $('#input-level').textContent = snap.input_level_db <= -100 ? '-∞ dBFS' : `${snap.input_level_db.toFixed(1)} dBFS`;

    // GPIO card
    const gpio = status.gpio || {};
    const gpioKind = gpio.backend === 'error' ? 'bad' : gpio.backend === 'disabled' ? '' : gpio.backend === 'mock' ? 'warn' : 'ok';
    setBadge($('#gpio-state'), gpio.backend || 'disabled', gpioKind);
    $('#gpio-error').textContent = gpio.error || '';
    const outputs = $('#gpio-outputs tbody');
    outputs.replaceChildren();
    if (!gpio.outputs || !gpio.outputs.length) {
      outputs.append(el('tr', {}, el('td', { class: 'empty', colspan: 3, text: 'no outputs configured' })));
    }
    for (const output of gpio.outputs || []) {
      const ledClass = gpioLedClass(output);
      outputs.append(
        el('tr', {}, [
          el('td', { text: output.name }),
          el('td', {}, code(`${output.line}${output.active_low ? ' (active low)' : ''}`)),
          el('td', output.error ? { title: output.error } : {}, [el('span', { class: `led ${ledClass}` }), ' ', output.error ? gpioErrorLabel(output.error) : output.active === null ? 'not driven' : output.active ? 'active' : 'inactive']),
        ])
      );
    }
    const inputs = $('#gpio-inputs tbody');
    inputs.replaceChildren();
    if (!gpio.inputs || !gpio.inputs.length) {
      inputs.append(el('tr', {}, el('td', { class: 'empty', colspan: 5, text: 'no inputs configured' })));
    }
    for (const input of gpio.inputs || []) {
      inputs.append(
        el('tr', {}, [
          el('td', {}, code(input.line)),
          el('td', { text: input.action.replace('_', ' ') }),
          el('td', { text: input.target || '–' }),
          el('td', input.error ? { title: input.error } : {}, input.error
            ? [el('span', { class: 'led led-amber' }), ' ', gpioErrorLabel(input.error)]
            : [el('span', { class: `led ${input.pressed ? 'led-on' : ''}` }), ' ', input.pressed ? 'pressed' : 'released']),
          el('td', { text: input.events }),
        ])
      );
    }

    const socket = status.socket || {};
    const socketKind = !socket.enabled ? '' : socket.error ? 'bad' : 'ok';
    setBadge($('#socket-state'), !socket.enabled ? 'disabled' : socket.error ? 'error' : 'listening', socketKind);
    $('#socket-error').textContent = socket.error || '';
    kv($('#socket-details'), [
      ['Unix socket', socket.unix_path ? code(socket.unix_path) : '–'],
      ['TCP (loopback)', socket.tcp ? code(socket.tcp) : 'off'],
      ['Clients', socket.clients != null ? socket.clients : 0],
    ]);

    // Stream Deck card
    const decks = status.decks && status.decks.length ? status.decks : status.deck ? [status.deck] : [];
    const anyEnabled = decks.some((deck) => deck.enabled);
    const connected = decks.filter((deck) => deck.connected);
    setBadge(
      $('#deck-state'),
      !anyEnabled ? 'disabled' : connected.length ? (connected.some((d) => d.mock) ? 'mock' : 'connected') : 'not connected',
      !anyEnabled ? '' : connected.length ? (connected.some((d) => d.mock) && connected.every((d) => d.mock) ? 'warn' : 'ok') : 'bad'
    );
    const deckRows = [];
    if (!decks.length) {
      deckRows.push(['Decks', '–']);
    }
    decks.forEach((deck, index) => {
      const prefix = decks.length > 1 ? `Deck ${index + 1}` : 'Model';
      deckRows.push([
        prefix,
        !deck.enabled
          ? 'disabled'
          : `${deck.kind || '–'}${deck.mock ? ' (mock)' : ''}${deck.serial ? ` · ${deck.serial}` : ''}${deck.connected ? '' : ' · not connected'}`,
      ]);
      if (deck.connected) {
        deckRows.push([
          decks.length > 1 ? `Layout ${index + 1}` : 'Layout',
          `${deck.rows}×${deck.cols} keys${deck.encoders ? `, ${deck.encoders} dials` : ''}${deck.touchpoints ? `, ${deck.touchpoints} touch points` : ''}`,
        ]);
        const pages = `keys ${deck.page + 1}/${deck.pages}${deck.encoder_pages > 1 ? ` · dials ${deck.encoder_page + 1}/${deck.encoder_pages}` : ''}${deck.member_layer ? ' · members layer' : ''}${deck.menu ? ` · ${deck.menu === 'menu' ? 'menu' : `${deck.menu} page`}` : ''}${deck.volume_layer ? ' · volume layer' : ''}`;
        deckRows.push([decks.length > 1 ? `Page ${index + 1}` : 'Page', pages]);
        if (deck.dials && deck.dials.some((dial) => dial.title)) {
          deckRows.push([
            decks.length > 1 ? `Dials ${index + 1}` : 'Dials',
            deck.dials.map((dial) => (dial.title ? `${dial.index + 1}: ${dial.title}` : `${dial.index + 1}: —`)).join(', '),
          ]);
        }
      }
      if (deck.error) deckRows.push([decks.length > 1 ? `Error ${index + 1}` : 'Error', deck.error]);
    });
    kv($('#deck-details'), deckRows);

    // Service card
    setBadge($('#service-state'), status.restart_pending ? 'restarting' : 'running', status.restart_pending ? 'warn' : 'ok');
    kv($('#service-details'), [
      ['Version', status.version],
      ['Talktome server', (state.status && state.status.snapshot && state.status.snapshot.server_version) ? formatServerVersion(state.status.snapshot.server_version) : '–'],
      ['Uptime', formatDuration(status.uptime_s)],
      ['Instance', snap.instance],
      ['Configuration', status.config_path ? code(status.config_path) : 'environment only'],
      ['Supervisor', status.systemd ? 'systemd' : 'none'],
      ['Web interface', `${status.web.bind}:${status.web.port}`],
      ['Health endpoint', status.health_port ? `127.0.0.1:${status.health_port}/healthz` : 'off'],
    ]);
  }

  function iceEffectiveLabel(media) {
    const urls = media.ice_servers || [];
    if (!urls.length) return 'none';
    const bridged = urls.filter((url) => url.includes('127.0.0.1') || url.includes('[::1]'));
    if (!bridged.length) return urls.join(', ');
    return `${bridged.join(', ')} — local UDP façade for TURNS/TURN-TCP, not a second TURN hop`;
  }

  function iconSrc(name) {
    return el('img', { class: 'btn-icon', src: UI_ICONS[name], alt: '', 'aria-hidden': 'true' });
  }

  function postTalk(action, target) {
    return api('POST', '/api/talk', { action, target }).catch((error) => {
      const connection = state.status && state.status.snapshot && state.status.snapshot.connection;
      const offline = !connection || !['ready', 'registered'].includes(connection);
      if (offline && /session not running|user is offline|no target/i.test(error.message)) return;
      flash(error.message, 'error');
    });
  }

  function postAudio(body) {
    return api('POST', '/api/audio', body).catch((error) => {
      const connection = state.status && state.status.snapshot && state.status.snapshot.connection;
      const offline = !connection || !['ready', 'registered'].includes(connection);
      if (offline && /session not running/i.test(error.message)) return;
      flash(error.message, 'error');
    });
  }

  function toggleLock(target) {
    if (state.locks.has(target)) state.locks.delete(target);
    else state.locks.add(target);
    postTalk('lock', target);
    if (state.status && state.status.snapshot) renderRemote(state.status.snapshot);
  }

  function bindHoldTalk(element, getTarget, options = {}) {
    const ignore = options.ignoreSelector || '';
    let active = false;
    let startX = 0;
    let lockedBySlide = false;
    const rowOf = () => options.row || element;
    const isReply = element.id === 'reply';
    const paintPress = (on) => {
      const row = rowOf();
      row.classList.toggle('ptt-pressing', on);
      if (isReply) {
        element.classList.toggle('active', on || (options.isLocked && options.isLocked()));
        return;
      }
      if (on || row.classList.contains('talk-locked')) row.classList.add('talking-to');
      else row.classList.remove('talking-to');
    };
    const begin = (event) => {
      if (ignore && event.target.closest(ignore)) return;
      if (element.disabled) return;
      const target = getTarget();
      if (!target) return;
      event.preventDefault();
      if (options.isLocked && options.isLocked()) {
        toggleLock(target);
        return;
      }
      if (active) return;
      active = true;
      lockedBySlide = false;
      startX = event.clientX;
      state.pressed.add(target);
      paintPress(true);
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      postTalk('press', target);
    };
    const move = (event) => {
      if (!active || lockedBySlide) return;
      if (event.clientX - startX <= -SLIDE_LOCK_PX) {
        lockedBySlide = true;
        const target = getTarget();
        if (target) {
          state.locks.add(target);
          rowOf().classList.add('talk-locked', 'talking-to');
          postTalk('lock', target);
        }
      }
    };
    const end = (event) => {
      if (!active) return;
      active = false;
      const target = getTarget();
      if (target) state.pressed.delete(target);
      paintPress(false);
      if (!lockedBySlide && target) postTalk('release', target);
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };
    element.addEventListener('pointerdown', begin);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      begin(event);
    });
    element.addEventListener('mousemove', move);
    element.addEventListener('mouseup', end);
    element.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  function renderRemote(snap) {
    const online = ['ready', 'registered'].includes(snap.connection);
    if (online) {
      state.locks = new Set(snap.targets.filter((target) => target.locked).map((target) => targetKey(target.key)));
      const replyKey = snap.reply_target ? targetKey(snap.reply_target) : null;
      if (replyKey && state.locks.has(replyKey)) state.locks.add('reply');
    }
    renderTargets(snap);
    updateReply(snap);
    if (state.memberModalKey) {
      const open = snap.targets.find((target) => targetKey(target.key) === state.memberModalKey);
      if (open) renderMembersModal(open);
      else closeMembersModal();
    }
  }

  function renderTargets(snap) {
    const container = $('#targets-list');
    const empty = $('#targets-empty');
    const existing = new Map($$('li.target-item', container).map((node) => [node.dataset.key, node]));
    const seen = new Set();
    for (const target of snap.targets) {
      const key = targetKey(target.key);
      seen.add(key);
      let node = existing.get(key);
      if (!node) {
        node = buildTargetRow(key, target);
        container.append(node);
      }
      updateTargetRow(node, target);
    }
    for (const [key, node] of existing) {
      if (!seen.has(key)) node.remove();
    }
    empty.classList.toggle('is-hidden', snap.targets.length > 0);
  }

  function buildTargetRow(key, target) {
    const kind = targetKind(key);
    const canTalk = target.can_talk && kind !== 'feed';
    const row = el('li', {
      class: `target-item ${kind === 'conference' ? 'conf-target' : kind === 'feed' ? 'feed-target' : 'user-target'}${canTalk ? '' : kind === 'feed' ? '' : ' monitor-only-target'}`,
      dataset: { key, type: kind },
    });

    const iconClass = kind === 'conference' ? 'conf-icon' : kind === 'feed' ? 'feed-icon' : 'user-icon';
    const icon = el('div', { class: iconClass });
    if (kind === 'conference') {
      icon.setAttribute('role', 'button');
      icon.tabIndex = 0;
      icon.title = 'Choose who you hear';
      icon.addEventListener('pointerdown', (event) => event.stopPropagation());
      icon.addEventListener('click', (event) => {
        event.stopPropagation();
        openMembersModal(key);
      });
      icon.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openMembersModal(key);
      });
    }

    const label = el('span', { class: 'target-label' });
    const status = el('div', { class: 'target-status target-status-inline' });
    const labelRow = el('div', { class: 'target-label-row' }, [label, status]);
    const slider = el('input', { type: 'range', class: 'volume-slider', min: '0', max: '1', step: '0.01', title: 'Volume' });
    slider.addEventListener('pointerdown', (event) => event.stopPropagation());
    slider.addEventListener('input', () => {
      clearTimeout(state.volumeTimers.get(key));
      state.volumeTimers.set(
        key,
        setTimeout(() => postAudio({ action: 'volume-set', target: key, value: Number(slider.value) }), 150)
      );
    });
    const info = el('div', { class: 'target-info' }, [labelRow, slider]);

    const muteButton = el('button', { type: 'button', class: 'mute-btn', title: 'Mute' }, [iconSrc('speakerOn')]);
    muteButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    muteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      postAudio({ action: 'mute-toggle', target: key });
    });

    const actions = el('div', { class: 'target-actions ptt-actions' }, [muteButton]);
    let talkButton = null;
    if (canTalk) {
      talkButton = el('button', { type: 'button', class: 'talk-btn', title: 'Hold to talk' }, [iconSrc('talk')]);
      talkButton.setAttribute('aria-pressed', 'false');
      bindHoldTalk(talkButton, () => key, {
        row,
        isLocked: () => row.classList.contains('talk-locked'),
      });
      talkButton.addEventListener('pointerdown', (event) => event.stopPropagation());
      actions.append(talkButton);
      const hint = el('div', { class: 'slide-to-lock-hint', text: '← Slide to lock', 'aria-hidden': 'true' });
      bindHoldTalk(row, () => key, {
        row,
        ignoreSelector: '.talk-btn, .mute-btn, .volume-slider, .conf-icon',
        isLocked: () => row.classList.contains('talk-locked'),
      });
      row.append(icon, info, actions, hint);
    } else {
      row.append(icon, info, actions);
    }

    row._parts = { icon, label, status, slider, muteButton, talkButton };
    return row;
  }

  function updateTargetRow(node, target) {
    const parts = node._parts;
    const key = targetKey(target.key);
    const kind = targetKind(key);
    const userOffline = kind === 'user' && !target.online;
    const locked = target.locked || state.locks.has(key);
    const talking = target.held || locked || state.pressed.has(key);
    const speaking = target.incoming || target.receiving;
    parts.label.textContent = target.name;
    if (kind === 'user') {
      parts.icon.textContent = target.name ? target.name.charAt(0).toUpperCase() : '?';
    } else if (kind === 'conference') {
      parts.icon.textContent = '📡';
      parts.icon.setAttribute('aria-label', `Choose who you hear in ${target.name}`);
    } else {
      parts.icon.textContent = '🎧';
    }
    node.classList.toggle('is-offline', userOffline);
    node.classList.toggle('talking-to', talking);
    node.classList.toggle('speaking', speaking);
    node.classList.toggle('talk-locked', locked);
    node.classList.toggle('muted', target.muted);
    if (parts.talkButton) {
      parts.talkButton.disabled = userOffline;
      parts.talkButton.title = userOffline ? 'Offline' : locked ? 'Locked — tap to unlock' : 'Hold to talk';
      parts.talkButton.setAttribute('aria-pressed', talking ? 'true' : 'false');
      parts.talkButton.setAttribute('aria-label', userOffline ? `${target.name} is offline` : `Hold to talk to ${target.name}`);
    }
    const muteIcon = $('img', parts.muteButton);
    if (muteIcon) muteIcon.src = target.muted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
    parts.muteButton.title = target.muted ? 'Unmute' : 'Mute';
    if (document.activeElement !== parts.slider) {
      parts.slider.disabled = userOffline;
      parts.slider.value = String(Math.max(0, Math.min(1, Number(target.volume) || 0)));
    }
    const speakers = (target.members || []).filter((member) => member.receiving).map((member) => member.name).filter(Boolean);
    parts.status.replaceChildren();
    if (kind === 'conference' && speaking) {
      parts.status.append(el('img', { class: 'speaker-status-icon', src: UI_ICONS.talk, alt: '', 'aria-hidden': 'true' }));
    }
    if (speakers.length) parts.status.append(document.createTextNode(speakers.join(', ')));
    else if (target.incoming) parts.status.append(document.createTextNode('calling'));
  }

  function updateReply(snap) {
    const button = $('#reply');
    const replyKey = snap.reply_target ? targetKey(snap.reply_target) : null;
    const replyTarget = replyKey ? snap.targets.find((target) => targetKey(target.key) === replyKey) : null;
    const active = Boolean(
      state.pressed.has('reply') ||
        state.locks.has('reply') ||
        (replyTarget && (replyTarget.held || replyTarget.locked || (replyKey && state.locks.has(replyKey))))
    );
    const pinned = Boolean(snap.main_target);
    const unavailable = Boolean(snap.main_unavailable);
    const userOffline = Boolean(replyTarget && targetKind(replyKey) === 'user' && !replyTarget.online);
    button.disabled = unavailable || !snap.reply_target || userOffline;
    button.classList.toggle('active', active);
    if (unavailable) {
      button.dataset.label = 'Unavailable target';
      button.setAttribute('aria-label', 'Unavailable target');
    } else if (pinned) {
      const name = snap.reply_name || (replyTarget && replyTarget.name) || '';
      button.dataset.label = name || 'Unavailable target';
      button.setAttribute('aria-label', name ? `Talk to ${name}` : 'Unavailable target');
    } else {
      button.dataset.label = snap.reply_name ? `🔊 ${snap.reply_name}` : '🔊 REPLY';
      button.setAttribute('aria-label', snap.reply_name ? `Reply ${snap.reply_name}` : 'Reply');
    }
  }

  function bindReply() {
    const button = $('#reply');
    bindHoldTalk(button, () => 'reply', {
      isLocked: () => {
        const snap = state.status && state.status.snapshot;
        if (!snap || !snap.reply_target) return false;
        const key = targetKey(snap.reply_target);
        const target = snap.targets.find((item) => targetKey(item.key) === key);
        return Boolean((target && target.locked) || state.locks.has(key) || state.locks.has('reply'));
      },
    });
  }

  function openMembersModal(key) {
    const snap = state.status && state.status.snapshot;
    const target = snap && snap.targets.find((item) => targetKey(item.key) === key);
    if (!target) return;
    state.memberModalKey = key;
    renderMembersModal(target);
    $('#conference-members-modal').hidden = false;
  }

  function closeMembersModal() {
    state.memberModalKey = null;
    $('#conference-members-modal').hidden = true;
  }

  function renderMembersModal(target) {
    const conferenceKey = targetKey(target.key);
    $('#conference-members-modal-description').textContent = `Choose who you hear in ${target.name}.`;
    const list = $('#conference-members-modal-list');
    const members = target.members || [];
    if (!members.length) {
      list.replaceChildren(el('span', { class: 'conference-members-empty', text: 'No other members' }));
      return;
    }
    const existing = new Map($$('.conference-member-listen', list).map((node) => [node.dataset.userId, node]));
    const seen = new Set();
    for (const member of members) {
      const id = String(member.user_id);
      seen.add(id);
      let row = existing.get(id);
      if (!row) {
        row = el('div', { class: 'conference-member-listen', dataset: { userId: id } });
        const checkbox = el('input', { type: 'checkbox', class: 'conference-member-listen-checkbox' });
        const name = el('span', { class: 'conference-member-name' });
        const online = el('span', { class: 'conference-member-online-state' });
        const toggle = el('label', { class: 'conference-member-listen__toggle' }, [checkbox, name, online]);
        const slider = el('input', { type: 'range', class: 'conference-member-level__slider', min: '0', max: '1', step: '0.01' });
        const value = el('output', { class: 'conference-member-level__value' });
        const level = el('div', { class: 'conference-member-level' }, [slider, value]);
        checkbox.addEventListener('change', () => {
          postAudio({ action: 'member-mute-toggle', target: conferenceKey, member: `user:${id}` });
        });
        slider.addEventListener('input', () => {
          value.textContent = formatDb(Number(slider.value));
          const timerKey = `${conferenceKey}/${id}`;
          clearTimeout(state.volumeTimers.get(timerKey));
          state.volumeTimers.set(
            timerKey,
            setTimeout(() => postAudio({ action: 'member-volume-set', target: conferenceKey, member: `user:${id}`, value: Number(slider.value) }), 150)
          );
        });
        row.append(toggle, level);
        row._parts = { checkbox, name, online, slider, value };
        list.append(row);
      }
      row.classList.toggle('is-offline', !member.online);
      row.classList.toggle('is-muted', member.muted);
      row.classList.toggle('is-speaking', member.receiving);
      row._parts.name.textContent = member.name || `User ${id}`;
      row._parts.online.textContent = member.online ? 'Online' : 'Offline';
      row._parts.checkbox.checked = !member.muted;
      row._parts.checkbox.setAttribute('aria-label', `Hear ${member.name || `user ${id}`}`);
      if (document.activeElement !== row._parts.slider) {
        row._parts.slider.value = String(Math.max(0, Math.min(1, Number(member.volume) || 0)));
        row._parts.value.textContent = formatDb(member.volume);
      }
    }
    for (const [id, row] of existing) {
      if (!seen.has(id)) row.remove();
    }
  }

  bindReply();
  $('#conference-members-modal-done').addEventListener('click', closeMembersModal);
  $('#conference-members-modal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeMembersModal();
  });

  // ---------------------------------------------------------------------
  // Stream Deck view
  // ---------------------------------------------------------------------

  async function refreshDeck() {
    if (!state.authenticated || state.restarting) return;
    let payload;
    try {
      payload = await api('GET', '/api/streamdeck');
    } catch {
      return;
    }
    try {
      const decks = payload && payload.decks ? payload.decks : payload && payload.keys ? [payload] : [];
      renderDecks(decks);
    } catch (error) {
      console.error(error);
      flash(`Stream Deck view failed: ${error.message}`, 'error');
    }
  }

  function renderDecks(decks) {
    const list = $('#deck-list');
    const empty = $('#deck-empty');
    if (!decks.length) {
      empty.classList.remove('is-hidden');
      empty.textContent = 'No Stream Deck configured.';
      list.replaceChildren();
      return;
    }
    empty.classList.add('is-hidden');
    const existing = $$('.deck-card', list);
    if (existing.length !== decks.length) {
      list.replaceChildren(...decks.map((deck) => buildDeckCard(deck)));
    }
    decks.forEach((deck, index) => updateDeckCard(list.children[index], deck, index));
  }

  function buildDeckCard(deck) {
    const card = el('article', { class: 'card deck-card', dataset: { device: String(deck.id || 0) } });
    card.append(
      el('header', { class: 'card-header' }, [
        el('h2', { text: 'Stream Deck' }),
        el('div', { class: 'card-tools' }, [el('span', { class: 'badge deck-view-state' }), el('span', { class: 'muted deck-page' })]),
      ]),
      el('p', { class: 'muted deck-message' }),
      el('div', { class: 'deck-grid' }),
      el('div', { class: 'deck-encoders' }),
      el('div', { class: 'deck-encoders deck-touchpoints' }),
      el('p', { class: 'muted small', text: 'Tap and hold a key to press it on the device. Keys behave exactly like on the hardware: hold to talk, tap to lock.' })
    );
    return card;
  }

  function updateDeckCard(card, deck, device) {
    if (!card) return;
    card.dataset.device = String(device);
    const stateBadge = $('.deck-view-state', card);
    const pageLabel = $('.deck-page', card);
    const message = $('.deck-message', card);
    const grid = $('.deck-grid', card);
    const encoders = $('.deck-encoders:not(.deck-touchpoints)', card);
    const touchpoints = $('.deck-touchpoints', card);
    setBadge(stateBadge, !deck.enabled ? 'disabled' : deck.connected ? `${deck.kind}${deck.mock ? ' (mock)' : ''}` : 'not connected', !deck.enabled ? '' : deck.connected ? 'ok' : 'bad');
    const pageBits = [];
    if (deck.connected) {
      pageBits.push(`keys ${deck.page + 1}/${deck.pages}`);
      if (deck.encoder_pages > 1) pageBits.push(`dials ${deck.encoder_page + 1}/${deck.encoder_pages}`);
      if (deck.member_layer) pageBits.push('members layer');
      if (deck.menu) pageBits.push(deck.menu === 'menu' ? 'menu' : `${deck.menu} page`);
      if (deck.volume_layer) pageBits.push('volume layer');
    }
    pageLabel.textContent = pageBits.join(' · ');
    if (!deck.enabled) {
      message.textContent = 'The Stream Deck surface is disabled in the settings.';
      grid.replaceChildren();
      encoders.replaceChildren();
      touchpoints.replaceChildren();
      return;
    }
    if (!deck.connected) {
      message.textContent = deck.error ? `No Stream Deck connected: ${deck.error}` : 'No Stream Deck connected.';
      grid.replaceChildren();
      encoders.replaceChildren();
      touchpoints.replaceChildren();
      return;
    }
    message.textContent = deck.serial ? `Serial ${deck.serial}` : '';
    grid.style.setProperty('--cols', deck.cols);
    grid.style.setProperty('--key-size', `${Math.min(96, deck.key_size || 72)}px`);
    grid.style.gridTemplateColumns = `repeat(${deck.cols}, var(--key-size, 72px))`;
    const existing = $$('.deck-key', grid);
    if (existing.length !== (deck.keys || []).length) {
      grid.replaceChildren(...(deck.keys || []).map((key) => buildDeckKey(device, key)));
    }
    for (const key of deck.keys || []) {
      const button = grid.children[key.index];
      if (!button) continue;
      button.dataset.device = String(device);
      button.dataset.index = String(key.index);
      button.dataset.role = key.role || '';
      button.title = key.subtitle ? `${key.title} · ${key.subtitle}` : key.title || key.role;
      button.setAttribute('aria-label', button.title);
      const img = $('img', button);
      const fallback = $('.deck-key__fallback', button);
      const label = [key.title, key.subtitle].filter(Boolean).join('\n');
      if (fallback) fallback.textContent = label || ' ';
      if (!img) continue;
      const src = `/api/streamdeck/${device}/key/${key.index}?h=${key.hash}`;
      if (img.dataset.src !== src) {
        img.dataset.src = src;
        img.alt = label.replace(/\n/g, ' ');
        img.src = src;
      }
    }
    const dials = deck.dials || [];
    if (encoders.children.length !== deck.encoders) {
      encoders.replaceChildren(
        ...Array.from({ length: deck.encoders }, (_, index) =>
          el('div', { class: 'encoder' }, [
            el('span', { class: 'encoder__name' }),
            el('span', { class: 'muted small encoder__meta' }),
            el('div', { class: 'encoder__row' }, [
              el('button', { type: 'button', class: 'btn btn-small', text: '−', onclick: () => deckInput(device, { kind: 'encoder', index, delta: -1 }) }),
              el('button', { type: 'button', class: 'btn btn-small encoder-press', text: 'Press', dataset: { device: String(device), index: String(index) } }),
              el('button', { type: 'button', class: 'btn btn-small', text: '+', onclick: () => deckInput(device, { kind: 'encoder', index, delta: 1 }) }),
            ]),
          ])
        )
      );
    }
    for (let index = 0; index < deck.encoders; index += 1) {
      const node = encoders.children[index];
      if (!node) continue;
      const dial = dials[index] || {};
      const name = $('.encoder__name', node);
      const meta = $('.encoder__meta', node);
      if (name) name.textContent = dial.title || `Dial ${index + 1}`;
      if (meta) meta.textContent = dial.title ? `${dial.subtitle || ''}${dial.role ? ` · ${dial.role}` : ''}`.replace(/^ · /, '') : 'unassigned';
    }
    if (touchpoints.children.length !== deck.touchpoints) {
      touchpoints.replaceChildren(
        ...Array.from({ length: deck.touchpoints }, (_, index) =>
          el('button', { type: 'button', class: 'btn btn-small', text: index === 0 ? '◂ previous page' : 'next page ▸', onclick: () => deckInput(device, { kind: 'touch', index }) })
        )
      );
    }
  }

  function buildDeckKey(device, key) {
    const fallback = el('span', { class: 'deck-key__fallback' });
    const img = el('img', { alt: key.title || key.role || '' });
    img.addEventListener('error', () => fallback.classList.add('is-visible'));
    img.addEventListener('load', () => fallback.classList.remove('is-visible'));
    const button = el('button', {
      type: 'button',
      class: 'deck-key',
      'aria-label': key.title || key.role,
      dataset: { device: String(device), index: String(key.index), role: key.role || '' },
    }, [img, fallback]);
    return button;
  }

  const deckHeld = new Map();

  function bindDeckKeys() {
    const list = $('#deck-list');
    if (!list || list.dataset.bound === '1') return;
    list.dataset.bound = '1';

    const fromEvent = (event) => {
      const button = event.target.closest && event.target.closest('.deck-key');
      if (!button || !list.contains(button)) return null;
      const device = Number(button.dataset.device);
      const index = Number(button.dataset.index);
      if (!Number.isFinite(device) || !Number.isFinite(index)) return null;
      return { button, device, index, id: `${device}:${index}` };
    };

    const press = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const key = fromEvent(event);
      if (!key) return;
      event.preventDefault();
      if (deckHeld.has(key.id)) return;
      const lastDown = Number(key.button.dataset.lastDown || 0);
      if (Date.now() - lastDown < 400) return;
      deckHeld.set(key.id, true);
      key.button.dataset.lastDown = String(Date.now());
      key.button.dataset.pointerAt = String(Date.now());
      key.button.classList.add('is-pressed');
      if (typeof key.button.setPointerCapture === 'function' && event.pointerId != null) {
        try {
          key.button.setPointerCapture(event.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
      deckInput(key.device, { kind: 'key', index: key.index, action: 'down' });
    };

    const release = (event) => {
      const key = fromEvent(event);
      if (!key || !deckHeld.has(key.id)) return;
      deckHeld.delete(key.id);
      key.button.classList.remove('is-pressed');
      deckInput(key.device, { kind: 'key', index: key.index, action: 'up' });
    };

    list.addEventListener('pointerdown', press);
    list.addEventListener('pointerup', release);
    list.addEventListener('pointercancel', release);
    list.addEventListener('lostpointercapture', release);
    list.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const key = fromEvent(event);
      if (!key) return;
      if (key.button.dataset.pointerAt) return;
      press(event);
    });
    list.addEventListener('mouseup', release);
    list.addEventListener('click', (event) => {
      const key = fromEvent(event);
      if (!key) return;
      event.preventDefault();
      const handledAt = Number(key.button.dataset.pointerAt || 0);
      if (handledAt && Date.now() - handledAt < 1000) return;
      if (deckHeld.has(key.id)) return;
      deckInput(key.device, { kind: 'key', index: key.index, action: 'down' });
      deckInput(key.device, { kind: 'key', index: key.index, action: 'up' });
    });
    list.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.deck-key')) event.preventDefault();
    });
  }

  const encoderHeld = new Map();

  function bindDeckEncoders() {
    const list = $('#deck-list');
    if (!list || list.dataset.encoderBound === '1') return;
    list.dataset.encoderBound = '1';

    const fromEvent = (event) => {
      const button = event.target.closest && event.target.closest('.encoder-press');
      if (!button || !list.contains(button)) return null;
      const device = Number(button.dataset.device);
      const index = Number(button.dataset.index);
      if (!Number.isFinite(device) || !Number.isFinite(index)) return null;
      return { button, device, index, id: `${device}:${index}` };
    };

    const press = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const encoder = fromEvent(event);
      if (!encoder) return;
      event.preventDefault();
      if (encoderHeld.has(encoder.id)) return;
      encoderHeld.set(encoder.id, true);
      encoder.button.classList.add('is-pressed');
      if (typeof encoder.button.setPointerCapture === 'function' && event.pointerId != null) {
        try {
          encoder.button.setPointerCapture(event.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
      deckInput(encoder.device, { kind: 'encoder-press', index: encoder.index, action: 'down' });
    };

    const release = (event) => {
      const encoder = fromEvent(event);
      if (!encoder || !encoderHeld.has(encoder.id)) return;
      encoderHeld.delete(encoder.id);
      encoder.button.classList.remove('is-pressed');
      deckInput(encoder.device, { kind: 'encoder-press', index: encoder.index, action: 'up' });
    };

    list.addEventListener('pointerdown', press);
    list.addEventListener('pointerup', release);
    list.addEventListener('pointercancel', release);
    list.addEventListener('lostpointercapture', release);
  }

  function deckInput(device, body) {
    api('POST', '/api/streamdeck/input', { device, ...body })
      .then(() => setTimeout(refreshDeck, 120))
      .catch((error) => flash(error.message, 'error'));
  }

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------

  const ACTIONS = ['talk', 'reply', 'lock_toggle', 'clear_locks', 'mute_toggle', 'volume_up', 'volume_down'];
  const DECK_MODELS = [['', 'Real hardware'], ['mk2', 'Stream Deck MK.2 (15 keys)'], ['mini', 'Stream Deck Mini'], ['minimk2', 'Stream Deck Mini MK.2'], ['original', 'Stream Deck Original'], ['originalv2', 'Stream Deck Original V2'], ['xl', 'Stream Deck XL'], ['xlv2', 'Stream Deck XL V2'], ['plus', 'Stream Deck +'], ['plusxl', 'Stream Deck + XL'], ['neo', 'Stream Deck Neo'], ['pedal', 'Stream Deck Pedal']];
  const OUTPUT_NAMES = ['tally', 'tally_preview', 'talking', 'incoming', 'connected', 'locked', 'status'];
  const OUTPUT_LABELS = {
    tally: 'tally (PGM / on air)',
    tally_preview: 'tally_preview (PRV)',
    talking: 'talking',
    incoming: 'incoming',
    connected: 'connected',
    locked: 'locked',
    status: 'status light (flash = running, blink = error, on = ok)',
  };

  const DIM_AMOUNT_DB_OPTIONS = [-6, -12, -15, -18, -24];
  const SECTIONS = [
    {
      key: 'general',
      title: 'General',
      desc: 'instance name and state directory',
      fields: [
        { path: 'instance', label: 'Instance name', type: 'text' },
        { path: 'state_dir', label: 'State directory', type: 'text', nullable: true, help: 'Empty: $STATE_DIRECTORY or /var/lib/talktome-headless/<instance>' },
      ],
    },
    {
      key: 'server',
      title: 'Server & TLS',
      desc: 'Talktome server URL and certificate trust',
      open: true,
      fields: [
        { path: 'server.url', label: 'Server URL', type: 'url', wide: true },
        { path: 'tls.ca_file', label: 'CA file (PEM)', type: 'text', nullable: true, help: 'Trust an additional CA, e.g. for a self-signed server' },
        { path: 'tls.fingerprint_sha256', label: 'Pinned certificate SHA-256', type: 'text', nullable: true, help: 'AB:CD:… fingerprint of the server certificate' },
        { path: 'tls.insecure', label: 'Accept any certificate (development only)', type: 'bool' },
      ],
    },
    {
      key: 'user',
      title: 'Talktome user',
      desc: 'the account this panel logs in with',
      open: true,
      fields: [
        { path: 'user.name', label: 'User name', type: 'text' },
        { path: 'user.password', label: 'Password', type: 'password', help: 'Leave the placeholder to keep the stored password' },
        { path: 'user.production', label: 'Production', type: 'production', nullable: true, help: 'Productions this user is assigned to on the server. Restart to apply.' },
        { path: 'registration.conflict', label: 'If the account is already in use', type: 'select', options: [['takeover', 'Take over the session'], ['wait', 'Wait until it is free']] },
        { path: 'registration.takeover_delay_ms', label: 'Takeover delay (ms)', type: 'number' },
        { path: 'registration.retry_ms', label: 'Retry interval (ms)', type: 'number' },
        { path: 'registration.kicked_retry_ms', label: 'Retry after being kicked (ms)', type: 'number' },
      ],
    },
    {
      key: 'audio',
      title: 'Audio',
      desc: 'devices, codec profile, dimming, jitter buffer',
      fields: [
        { path: 'audio.input_device', label: 'Input device', type: 'device', direction: 'inputs', nullable: true, help: 'Use tone or tone:440 on a VM with no microphone' },
        { path: 'audio.output_device', label: 'Output device', type: 'device', direction: 'outputs', nullable: true, help: 'wav:/tmp/out.wav records the mix when there is no speaker' },
        { path: 'audio.profile', label: 'Codec profile', type: 'select', options: [['ultra-low', 'Ultra low (5 ms)'], ['low', 'Low (10 ms)'], ['standard', 'Standard (20 ms, FEC)']], help: 'Default matches the web client (5 ms, no FEC). If audio crackles or the log says audio-stream-error, use Low or Standard. Restart to apply.' },
        { path: 'audio.device_period_ms', label: 'Device period (ms)', type: 'number', min: 0, max: 40, help: '0 uses the sound-card default, often 20–85 ms. 10 ms is stable on a NanoPi NEO; try 5 ms for less delay. The card buffer is two periods. Restart to apply.' },
        { path: 'audio.auto_processing', label: 'Echo cancel, noise suppress, auto gain', type: 'bool', help: 'Same as the browser Audio auto processing toggle. Admin can override it per user after register. Manual input gain is ignored while this is on.' },
        { path: 'audio.input_gain_db', label: 'Input gain (dB)', type: 'number', step: 0.5, min: -30, max: 40, help: 'Ignored while auto processing is on (AGC runs instead).' },
        { path: 'audio.stream_delay_ms', label: 'AEC stream delay (ms)', type: 'number', min: 0, max: 500, nullable: true, help: 'Empty: estimate from capture + playback period. Set if echo remains.' },
        { path: 'audio.default_volume_db', label: 'Default target volume (dB)', type: 'number', step: 0.5, min: -60, max: 0, nullable: true, help: '0 dB is unity. Overrides the legacy 0–1 default_volume value.' },
        { path: 'audio.dim_db', label: 'Dim amount (dB)', type: 'select', numeric: true, options: DIM_AMOUNT_DB_OPTIONS.map((db) => [String(db), `${db} dB`]), help: 'Same list as the web client. Stored −14 dB is migrated to −15 dB.' },
        { path: 'audio.dim_feeds_while_speaking', label: 'Dim feeds while speaking', type: 'bool' },
        { path: 'audio.dim_when_addressed', label: 'Dim feeds when addressed', type: 'bool' },
        { path: 'audio.play_connection_sounds', label: 'Play connection sounds', type: 'bool', help: 'Disconnect and reconnect tones. Same as the web client. Admin can turn them off for this user after register. Restart to apply a change made here.' },
        { path: 'audio.network', label: 'Network', type: 'select', options: [['lan', 'LAN / good Wi-Fi'], ['mobile', 'Mobile network']], help: 'Fills in the jitter buffer and codec profile for this client\u2019s link: LAN 20/20/400 ms and Ultra low; Mobile starts at 150 ms (60\u2013600 ms) and sends Standard (20 ms, FEC). The fields stay editable. Restart to apply.' },
        { path: 'audio.jitter_start_ms', label: 'Jitter buffer start (ms)', type: 'number', help: 'Depth every new stream starts at. It only drops toward the minimum after 10 s of calm arrivals. Raise it when this client is on a bad link. Restart to apply.' },
        { path: 'audio.jitter_min_ms', label: 'Jitter buffer minimum (ms)', type: 'number', help: 'Lowest playout depth. The buffer follows the spread of packet delays over the last 10 s and never goes below this. Restart to apply.' },
        { path: 'audio.jitter_max_ms', label: 'Jitter buffer maximum (ms)', type: 'number', help: 'Ceiling for that adaptive depth. Mobile callers with bursty links need 300-400 ms. Restart to apply.' },
        { path: 'audio.reopen_ms', label: 'Device reopen interval (ms)', type: 'number' },
      ],
    },
    {
      key: 'talk',
      title: 'Talk & VOX',
      desc: 'key behaviour and voice trigger',
      fields: [
        { path: 'talk.tap_ms', label: 'Tap threshold (ms)', type: 'number', help: 'A shorter press toggles the talk lock' },
        { path: 'talk.lock_multiple', label: 'Allow several locks at once', type: 'bool' },
        { path: 'talk.main_target', label: 'Main / Reply pin', type: 'target', nullable: true, kinds: ['user', 'conference'], emptyLabel: 'Reply (last incoming)', help: 'Empty: Reply follows the last incoming call. A pin that is not in this user’s destinations does not fall back to another target. Same as the web client Main button. Restart to apply.' },
        { path: 'vox.enabled', label: 'Voice trigger (VOX)', type: 'bool' },
        { path: 'vox.target', label: 'VOX target', type: 'target', nullable: true, help: 'Conference or user the VOX talks to' },
        { path: 'vox.threshold_db', label: 'VOX threshold (dBFS)', type: 'number' },
        { path: 'vox.hang_ms', label: 'VOX hang time (ms)', type: 'number' },
      ],
    },
    {
      key: 'streamdeck',
      title: 'Stream Deck',
      desc: 'device binding, brightness, volume layer',
      fields: [
        { path: 'streamdeck.enabled', label: 'Use a Stream Deck', type: 'bool' },
        { path: 'streamdeck.mock', label: 'Dummy deck (no hardware)', type: 'select', nullable: true, options: DECK_MODELS, help: 'Used when the device list below is empty. TALKTOME_MOCK_STREAMDECK overrides the first device.' },
        { path: 'streamdeck.serial', label: 'Serial number', type: 'text', nullable: true, help: 'Empty: first unused deck found. Used when the device list below is empty.' },
        { path: 'streamdeck.brightness', label: 'Brightness (%)', type: 'number', min: 0, max: 100 },
        { path: 'streamdeck.font_path', label: 'Font file', type: 'text' },
        { path: 'streamdeck.volume_step_db', label: 'Volume step per key/dial tick (dB)', type: 'number', step: 0.5, min: 0.25, max: 12, nullable: true, help: 'Legacy volume_step values between 0 and 1 become 3 dB.' },
        { path: 'streamdeck.volume_layer_timeout_s', label: 'Volume layer timeout (s)', type: 'number' },
        { path: 'streamdeck.pedal_left', label: 'Pedal left switch target', type: 'target', nullable: true, help: 'Reply is always the right pedal. Equivalent to layout JSON key "0".' },
        { path: 'streamdeck.pedal_target', label: 'Pedal middle switch target', type: 'target', nullable: true, help: 'Equivalent to layout JSON key "1".' },
        { path: 'streamdeck.layout', label: 'Pedal layout overrides (JSON object)', type: 'json', wide: true, help: 'Pedal only. {"0":"user:4","1":"conference:1"} pins left and middle. Right is always Reply. Other indexes are ignored; MK.2 / XL / Neo keep automatic target order.' },
        { type: 'streamdeck-devices' },
      ],
    },
    {
      key: 'gpio',
      title: 'GPIO',
      desc: 'tally and talk lines',
      fields: [
        { path: 'gpio.enabled', label: 'Use GPIO', type: 'bool' },
        { path: 'gpio.chip', label: 'GPIO chip', type: 'text', nullable: true, help: 'Only needed when lines are given as offsets (e.g. gpiochip0)' },
        { type: 'gpio-outputs' },
        { type: 'gpio-target-outputs' },
        { type: 'gpio-inputs' },
      ],
    },
    {
      key: 'socket',
      title: 'Local socket',
      desc: 'JSON-lines API for a display, rotary encoders or MCU panel',
      fields: [
        { path: 'socket.enabled', label: 'Listen for a local panel', type: 'bool', help: 'Unix socket for an OLED, volume rotaries or other MCU. Same talk/volume bus as Stream Deck and GPIO.' },
        { path: 'socket.path', label: 'Unix socket path', type: 'text', nullable: true, help: 'Empty: $RUNTIME_DIRECTORY/control.sock under systemd, otherwise /tmp/talktome-headless-<instance>-control.sock' },
        { path: 'socket.tcp', label: 'Loopback TCP bind', type: 'text', nullable: true, help: 'Optional development bind, e.g. 127.0.0.1:9876. Non-loopback addresses are rejected. Empty: Unix socket only.' },
      ],
    },
    {
      key: 'network',
      title: 'Network & ICE',
      desc: 'STUN/TURN overrides and recovery',
      fields: [
        { path: 'ice.transport_policy', label: 'ICE transport policy', type: 'select', nullable: true, options: [['', 'From server'], ['all', 'all'], ['relay', 'relay (TURN only)']] },
        { path: 'ice.ipv6', label: 'Gather IPv6 ICE candidates', type: 'bool', help: 'Off by default. Enable only if this device has a global IPv6 address.' },
        { path: 'network.ice_disconnect_grace_ms', label: 'ICE disconnect grace (ms)', type: 'number' },
        { path: 'ice.servers', label: 'ICE server overrides (JSON array, testing only)', type: 'json', nullable: true, wide: true, help: '[{ "urls": ["turn:host:3478"], "username": "u", "credential": "p" }]' },
      ],
    },
    {
      key: 'web',
      title: 'Web interface & health',
      desc: 'this interface, health endpoint, logging',
      fields: [
        { path: 'web.enabled', label: 'Web interface', type: 'bool' },
        { path: 'web.bind', label: 'Web bind address', type: 'text' },
        { path: 'web.port', label: 'Web port', type: 'number', min: 1, max: 65535 },
        { path: 'health.port', label: 'Health port (/healthz)', type: 'number', nullable: true, min: 1, max: 65535, help: 'Empty: disabled' },
        { path: 'health.bind', label: 'Health bind address', type: 'text' },
        { path: 'log.level', label: 'Log level', type: 'select', options: [['error', 'error'], ['warn', 'warn'], ['info', 'info'], ['debug', 'debug'], ['trace', 'trace']] },
        { path: 'log.format', label: 'Log format', type: 'select', options: [['auto', 'auto'], ['json', 'json'], ['text', 'text']] },
      ],
    },
  ];

  function getPath(doc, path) {
    return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), doc);
  }

  function setPath(doc, path, value) {
    const keys = path.split('.');
    let cursor = doc;
    for (const key of keys.slice(0, -1)) {
      if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
      cursor = cursor[key];
    }
    cursor[keys[keys.length - 1]] = value;
  }

  function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }

  // Same rule as config::merge_file_over_running: these maps come from the
  // file as a whole, so a cleared GPIO output does not reappear from the
  // running configuration before the restart.
  const FILE_OWNED_MAPS = { gpio: ['outputs'], streamdeck: ['layout'] };

  function mergeFileOverRunning(running, file, section = null) {
    if (file == null) return running;
    if (!isPlainObject(running) || !isPlainObject(file)) return file;
    const owned = (section && FILE_OWNED_MAPS[section]) || [];
    const out = { ...running };
    for (const [key, value] of Object.entries(file)) {
      out[key] = !owned.includes(key) && isPlainObject(value) && isPlainObject(out[key]) ? mergeFileOverRunning(out[key], value, section || key) : value;
    }
    for (const key of owned) {
      if (!(key in file)) out[key] = {};
    }
    return out;
  }

  function hasPath(doc, path) {
    if (doc == null) return false;
    let cursor = doc;
    for (const key of path.split('.')) {
      if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, key)) return false;
      cursor = cursor[key];
    }
    return true;
  }

  function deepEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }

  function editorDocument(config) {
    if (config.editor_document) return config.editor_document;
    if (config.file_document) return mergeFileOverRunning(config.document, config.file_document);
    return config.document;
  }

  function fileDiffersFromRunning(file, running) {
    if (!file || !running) return false;
    const walk = (fromFile, fromRunning) => {
      if (!isPlainObject(fromFile)) return !deepEqual(fromFile, fromRunning);
      if (!isPlainObject(fromRunning)) return true;
      return Object.keys(fromFile).some((key) => walk(fromFile[key], fromRunning[key]));
    };
    return walk(file, running);
  }

  async function loadConfig() {
    const message = $('#settings-message');
    message.textContent = '';
    try {
      const [config, devices] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/config/audio-devices').catch(() => ({ inputs: [], outputs: [] }))]);
      state.config = config;
      state.runningDoc = JSON.parse(JSON.stringify(config.document));
      state.fileDoc = config.file_document ? JSON.parse(JSON.stringify(config.file_document)) : null;
      state.configDoc = JSON.parse(JSON.stringify(editorDocument(config)));
      state.audioDevices = devices;
      $('#settings-path').textContent = config.editable ? `Saved to ${config.path} (${config.format}). Changes apply after a restart.` : 'This instance runs from environment variables only; settings cannot be saved.';
      const env = $('#settings-env');
      if (config.env_overrides.length) {
        env.textContent = `Environment overrides are active and take precedence over the file on the next start: ${config.env_overrides.join(', ')}`;
        env.classList.remove('is-hidden');
      } else {
        env.classList.add('is-hidden');
      }
      const pending = $('#settings-pending');
      if (config.editable && config.file_pending_restart) {
        pending.textContent = 'This file has saved changes the running client is not using yet (for example the Talktome user). Saving another setting keeps those file values. Restart to apply them.';
        pending.classList.remove('is-hidden');
      } else {
        pending.classList.add('is-hidden');
      }
      renderSettingsForm();
      try {
        $('#raw-json').value = JSON.stringify(collectDocument(), null, 2);
      } catch {
        $('#raw-json').value = JSON.stringify(state.configDoc, null, 2);
      }
      const disabled = !config.editable;
      $('#settings-save').disabled = disabled;
      $('#settings-save-restart').disabled = disabled;
    } catch (error) {
      message.className = 'form-message';
      message.textContent = error.message;
    }
  }

  // Values the Network switch fills in (keep in step with NetworkPreset in config.rs).
  const NETWORK_PRESETS = {
    lan: { 'audio.jitter_start_ms': 20, 'audio.jitter_min_ms': 20, 'audio.jitter_max_ms': 400, 'audio.profile': 'ultra-low' },
    mobile: { 'audio.jitter_start_ms': 150, 'audio.jitter_min_ms': 60, 'audio.jitter_max_ms': 600, 'audio.profile': 'standard' },
  };

  function renderSettingsForm() {
    const form = $('#settings-form');
    form.replaceChildren();
    const doc = state.configDoc;
    for (const section of SECTIONS) {
      const details = el('details', section.open ? { open: '' } : {});
      details.append(el('summary', {}, [section.title, el('span', { class: 'desc', text: section.desc })]));
      const fields = el('div', { class: 'fields' });
      for (const field of section.fields) {
        fields.append(renderField(field, doc));
      }
      details.append(fields);
      form.append(details);
    }
    const network = form.querySelector('select[data-path="audio.network"]');
    if (network) {
      network.addEventListener('change', () => {
        for (const [path, value] of Object.entries(NETWORK_PRESETS[network.value] || {})) {
          const input = form.querySelector(`[data-path="${path}"]:is(input, select)`);
          if (input) input.value = String(value);
        }
      });
    }
  }

  function renderField(field, doc) {
    if (field.type === 'gpio-outputs') return renderGpioOutputs(doc);
    if (field.type === 'gpio-target-outputs') return renderGpioTargetOutputs(doc);
    if (field.type === 'gpio-inputs') return renderGpioInputs(doc);
    if (field.type === 'streamdeck-devices') return renderStreamdeckDevices(doc);
    let value = getPath(doc, field.path);
    if (field.path === 'audio.default_volume_db' && (value == null || value === '')) {
      value = Math.round(linearToDb(getPath(doc, 'audio.default_volume') ?? 0.9) * 10) / 10;
    }
    if (field.path === 'streamdeck.volume_step_db' && (value == null || value === '')) {
      const legacy = Number(getPath(doc, 'streamdeck.volume_step'));
      value = Number.isFinite(legacy) && legacy > 1 ? legacy : 3;
    }
    if (field.path === 'audio.dim_db' && Number(value) === -14) value = -15;
    const wrapper = el('label', { class: `field${field.wide ? ' wide' : ''}`, dataset: { path: field.path } });
    if (field.type === 'bool') {
      wrapper.className = `field-check${field.wide ? ' wide' : ''}`;
      const input = el('input', { type: 'checkbox', dataset: { path: field.path, type: 'bool' }, autocomplete: 'off' });
      input.checked = Boolean(value);
      wrapper.append(input, el('span', { text: field.label }));
      return wrapper;
    }
    wrapper.append(el('span', { text: field.label }));
    let input;
    if (field.type === 'production') {
      input = el('select', { dataset: { path: field.path, type: 'select', nullable: '1', production: '1' }, autocomplete: 'off' });
      fillProductionSelect(input, value == null ? '' : String(value));
    } else if (field.type === 'select' || field.type === 'target') {
      const kinds = (field.kinds || []).join(',');
      input = el('select', {
        dataset: {
          path: field.path,
          type: 'select',
          nullable: field.nullable ? '1' : '',
          numeric: field.numeric ? '1' : '',
          kinds,
          emptyLabel: field.emptyLabel || '',
        },
        autocomplete: 'off',
      });
      let options =
        field.type === 'target'
          ? targetSelectOptions(value, { allowEmpty: field.nullable, kinds: field.kinds, emptyLabel: field.emptyLabel })
          : (field.options || []).map((option) => option.slice());
      const current = value == null ? '' : String(value);
      if (field.type === 'select' && current && !options.some((option) => String(option[0]) === current)) {
        options = options.concat([[current, field.numeric ? `Custom (${current} dB)` : current]]);
      }
      for (const [optionValue, label] of options) {
        input.append(el('option', { value: optionValue, text: label }));
      }
      input.value = current;
    } else if (field.type === 'device') {
      input = el('select', { dataset: { path: field.path, type: 'select', nullable: '1' }, autocomplete: 'off' });
      const current = value == null ? '' : String(value);
      const devices = state.audioDevices[field.direction] || [];
      const special = field.direction === 'inputs'
        ? [['none', 'none (no capture)'], ['tone', 'tone (test tone)'], ['tone:440', 'tone:440'], ['tone:1000', 'tone:1000']]
        : [['none', 'none (no playback)'], ['wav:/tmp/talktome-out.wav', 'wav:/tmp/talktome-out.wav (record to file)']];
      const known = new Set(['', ...devices.map((device) => device.id), ...special.map(([id]) => id)]);
      const option = (id, label) => el('option', { value: id, text: label && label !== id ? `${id} — ${label}` : id });
      input.append(el('option', { value: '', text: 'System default' }));
      if (!known.has(current)) input.append(option(current, 'not found'));
      const groups = [
        ['Configured devices (asound.conf)', devices.filter((device) => !device.card)],
        ['Sound cards', devices.filter((device) => device.card)],
      ];
      for (const [label, list] of groups) {
        if (list.length) input.append(el('optgroup', { label }, list.map((device) => option(device.id, device.label))));
      }
      input.append(el('optgroup', { label: 'Testing' }, special.map(([id, label]) => el('option', { value: id, text: label }))));
      input.value = current;
    } else if (field.type === 'json') {
      input = el('textarea', { rows: 3, dataset: { path: field.path, type: 'json', nullable: field.nullable ? '1' : '' } });
      input.value = value == null ? '' : JSON.stringify(value, null, 1);
    } else if (field.type === 'password') {
      input = el('input', { type: 'password', autocomplete: 'new-password', dataset: { path: field.path, type: 'password' } });
      input.value = value == null ? '' : value;
    } else {
      input = el('input', {
        type: field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text',
        dataset: { path: field.path, type: field.type === 'number' ? 'number' : 'text', nullable: field.nullable ? '1' : '' },
        autocomplete: 'off',
      });
      if (field.step != null) input.step = field.step;
      if (field.min != null) input.min = field.min;
      if (field.max != null) input.max = field.max;
      if (field.type === 'number') input.inputMode = 'decimal';
      input.value = value == null ? '' : value;
    }
    wrapper.append(input);
    if (field.help) wrapper.append(el('span', { class: 'help', text: field.help }));
    return wrapper;
  }

  function targetSelectOptions(current, { allowEmpty = true, kinds = null, emptyLabel = '—' } = {}) {
    const options = [];
    const seen = new Set();
    if (allowEmpty) options.push(['', emptyLabel || '—']);
    const targets = (state.status && state.status.snapshot && state.status.snapshot.targets) || [];
    for (const target of targets) {
      const key = targetKey(target.key);
      if (kinds && !kinds.includes(targetKind(key))) continue;
      seen.add(key);
      options.push([key, `${target.name} (${key})`]);
    }
    if (current && !seen.has(current)) options.push([current, current]);
    return options;
  }

  function fillTargetSelect(select, current, extra = {}) {
    const value = current || '';
    select.replaceChildren();
    for (const [optionValue, label] of targetSelectOptions(value, extra)) {
      select.append(el('option', { value: optionValue, text: label }));
    }
    select.value = value;
  }

  function productionLabel(snap) {
    const wanted = String(snap.production || '').trim();
    if (!wanted) return 'Default';
    const match = (snap.productions || []).find((production) => production.id === wanted)
      || (snap.productions || []).find((production) => production.name.toLowerCase() === wanted.toLowerCase());
    return match ? match.name : wanted;
  }

  function snapshotProductions() {
    return (state.status && state.status.snapshot && state.status.snapshot.productions) || [];
  }

  // Stored as the production id; a name typed in by hand selects its id.
  function productionSelectOptions(current) {
    const productions = snapshotProductions();
    const options = [['', 'Server default (no production set)']];
    for (const production of productions) options.push([production.id, production.name]);
    const wanted = String(current || '').trim();
    if (!wanted) return { options, value: '' };
    const match = productions.find((production) => production.id === wanted)
      || productions.find((production) => production.name.toLowerCase() === wanted.toLowerCase());
    if (match) return { options, value: match.id };
    const note = productions.length ? 'not assigned to this user' : 'offline, list unavailable';
    options.push([wanted, `${wanted} (${note})`]);
    return { options, value: wanted };
  }

  function fillProductionSelect(select, current) {
    const { options, value } = productionSelectOptions(current);
    select.replaceChildren();
    for (const [optionValue, label] of options) {
      select.append(el('option', { value: optionValue, text: label }));
    }
    select.value = value;
  }

  function refreshSettingsTargetSelects() {
    for (const select of $$('#settings-form select[data-production="1"]')) {
      fillProductionSelect(select, select.value);
    }
    for (const select of $$('#settings-form select[data-path]')) {
      const path = select.dataset.path;
      if (path !== 'vox.target' && path !== 'talk.main_target' && path !== 'streamdeck.pedal_left' && path !== 'streamdeck.pedal_target') continue;
      const kinds = (select.dataset.kinds || '').split(',').filter(Boolean);
      fillTargetSelect(select, select.value, {
        allowEmpty: select.dataset.nullable === '1',
        kinds: kinds.length ? kinds : null,
        emptyLabel: select.dataset.emptyLabel || (path === 'talk.main_target' ? 'Reply (last incoming)' : '—'),
      });
    }
  }

  function renderGpioOutputs(doc) {
    const outputs = getPath(doc, 'gpio.outputs') || {};
    const editor = el('div', { class: 'list-editor', dataset: { editor: 'gpio-outputs' } });
    editor.append(el('h3', { class: 'subheading', text: 'Outputs (leave the line empty to disable)' }));
    for (const name of OUTPUT_NAMES) {
      const current = outputs[name] || {};
      editor.append(
        el('div', { class: 'list-row', dataset: { output: name } }, [
          el('label', { class: 'field' }, [el('span', { text: `${OUTPUT_LABELS[name] || name} line` }), el('input', { type: 'text', placeholder: 'unassigned', title: 'Line name such as GPIO17; leave empty to leave this output unassigned', dataset: { field: 'line' }, value: current.line || '' })]),
          el('label', { class: 'field-check' }, [el('input', { type: 'checkbox', dataset: { field: 'active_low' }, ...(current.active_low ? { checked: '' } : {}) }), el('span', { text: 'active low' })]),
        ])
      );
    }
    return editor;
  }

  function renderGpioTargetOutputs(doc) {
    const outputs = getPath(doc, 'gpio.target_outputs') || [];
    const editor = el('div', { class: 'list-editor', dataset: { editor: 'gpio-target-outputs' } });
    const rows = el('div', { class: 'list-editor' });
    const addRow = (output) => rows.append(gpioTargetOutputRow(output));
    editor.append(
      el('h3', { class: 'subheading', text: 'Target outputs (line goes active when that destination has audio)' }),
      rows,
      el('div', {}, el('button', { type: 'button', class: 'btn btn-small', text: '+ Add target output', onclick: () => addRow({ line: '', target: '', when: 'receiving', active_low: false }) }))
    );
    for (const output of outputs) addRow(output);
    return editor;
  }

  function gpioTargetOutputRow(output) {
    const row = el('div', { class: 'list-row', dataset: { targetOutput: '1' } });
    const when = el('select', { dataset: { field: 'when' } });
    when.append(el('option', { value: 'receiving', text: 'receiving audio' }));
    when.append(el('option', { value: 'incoming', text: 'incoming / calling' }));
    when.value = output.when || 'receiving';
    const target = el('select', { dataset: { field: 'target' } });
    fillTargetSelect(target, output.target || '');
    row.append(
      el('label', { class: 'field' }, [el('span', { text: 'Line' }), el('input', { type: 'text', placeholder: 'e.g. GPIO18', dataset: { field: 'line' }, value: output.line || '' })]),
      el('label', { class: 'field' }, [el('span', { text: 'Target' }), target]),
      el('label', { class: 'field' }, [el('span', { text: 'When' }), when]),
      el('label', { class: 'field-check' }, [el('input', { type: 'checkbox', dataset: { field: 'active_low' }, ...(output.active_low ? { checked: '' } : {}) }), el('span', { text: 'active low' })]),
      el('button', { type: 'button', class: 'btn btn-small btn-danger', text: 'Remove', onclick: () => row.remove() })
    );
    return row;
  }

  function renderGpioInputs(doc) {
    const inputs = getPath(doc, 'gpio.inputs') || [];
    const editor = el('div', { class: 'list-editor', dataset: { editor: 'gpio-inputs' } });
    const rows = el('div', { class: 'list-editor' });
    const addRow = (input) => rows.append(gpioInputRow(input));
    editor.append(el('h3', { class: 'subheading', text: 'Inputs' }), rows, el('div', {}, el('button', { type: 'button', class: 'btn btn-small', text: '+ Add input', onclick: () => addRow({ line: '', action: 'talk', target: '', active_low: true, debounce_ms: 20 }) })));
    for (const input of inputs) addRow(input);
    return editor;
  }

  function gpioInputRow(input) {
    const row = el('div', { class: 'list-row', dataset: { input: '1' } });
    const action = el('select', { dataset: { field: 'action' } });
    for (const name of ACTIONS) action.append(el('option', { value: name, text: name.replace('_', ' ') }));
    action.value = input.action || 'talk';
    const target = el('select', { dataset: { field: 'target' } });
    fillTargetSelect(target, input.target || '');
    row.append(
      el('label', { class: 'field' }, [el('span', { text: 'Line' }), el('input', { type: 'text', placeholder: 'e.g. GPIO22', dataset: { field: 'line' }, value: input.line || '' })]),
      el('label', { class: 'field' }, [el('span', { text: 'Action' }), action]),
      el('label', { class: 'field' }, [el('span', { text: 'Target' }), target]),
      el('label', { class: 'field' }, [el('span', { text: 'Debounce (ms)' }), el('input', { type: 'number', min: 0, dataset: { field: 'debounce_ms' }, value: input.debounce_ms != null ? input.debounce_ms : 20 })]),
      el('label', { class: 'field-check' }, [el('input', { type: 'checkbox', dataset: { field: 'active_low' }, ...(input.active_low ? { checked: '' } : {}) }), el('span', { text: 'active low' })]),
      el('button', { type: 'button', class: 'btn btn-small btn-danger', text: 'Remove', onclick: () => row.remove() })
    );
    return row;
  }

  function renderStreamdeckDevices(doc) {
    const devices = getPath(doc, 'streamdeck.devices') || [];
    const editor = el('div', { class: 'list-editor', dataset: { editor: 'streamdeck-devices' } });
    const rows = el('div', { class: 'list-editor' });
    const addRow = (device) => rows.append(streamdeckDeviceRow(device));
    editor.append(
      el('h3', { class: 'subheading', text: 'Devices' }),
      el('p', { class: 'help', text: 'Add one row per Stream Deck (Neo, Plus, Pedal, …). When this list is empty, the serial/mock/pedal fields above are used as a single deck.' }),
      rows,
      el('div', {}, el('button', { type: 'button', class: 'btn btn-small', text: '+ Add Stream Deck', onclick: () => addRow({ mock: '', serial: '', pedal_left: '', pedal_target: '', layout: {} }) }))
    );
    for (const device of devices) addRow(device);
    return editor;
  }

  function streamdeckDeviceRow(device) {
    const row = el('div', { class: 'list-row', dataset: { device: '1' } });
    const mock = el('select', { dataset: { field: 'mock' } });
    for (const [value, label] of DECK_MODELS) mock.append(el('option', { value, text: label }));
    mock.value = device.mock || '';
    const layout = el('textarea', { rows: 2, dataset: { field: 'layout' } });
    layout.value = device.layout && Object.keys(device.layout).length ? JSON.stringify(device.layout) : '';
    row.append(
      el('label', { class: 'field' }, [el('span', { text: 'Dummy model' }), mock]),
      el('label', { class: 'field' }, [el('span', { text: 'Serial' }), el('input', { type: 'text', placeholder: 'first unused', dataset: { field: 'serial' }, value: device.serial || '' })]),
      el('label', { class: 'field' }, [el('span', { text: 'Pedal left' }), el('input', { type: 'text', placeholder: 'user:4', dataset: { field: 'pedal_left' }, value: device.pedal_left || '' })]),
      el('label', { class: 'field' }, [el('span', { text: 'Pedal middle' }), el('input', { type: 'text', placeholder: 'conference:1', dataset: { field: 'pedal_target' }, value: device.pedal_target || '' })]),
      el('label', { class: 'field wide' }, [el('span', { text: 'Pedal layout JSON' }), layout, el('span', { class: 'help', text: '{"0":"user:4","1":"conference:1"} pins left/middle. Other keys are ignored.' })]),
      el('button', { type: 'button', class: 'btn btn-small btn-danger', text: 'Remove', onclick: () => row.remove() })
    );
    return row;
  }

  function collectDocument() {
    if (state.rawMode) {
      return JSON.parse($('#raw-json').value);
    }
    const fileDoc = state.fileDoc;
    const runningDoc = state.runningDoc || state.configDoc;
    const doc = JSON.parse(JSON.stringify(fileDoc || state.configDoc));
    for (const input of $$('#settings-form [data-path]', document)) {
      if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement)) continue;
      const path = input.dataset.path;
      const type = input.dataset.type;
      const nullable = input.dataset.nullable === '1';
      let value;
      if (type === 'bool') value = input.checked;
      else if (type === 'number') {
        const text = input.value.trim();
        if (text === '') value = nullable ? null : getPath(doc, path);
        else {
          value = Number(text);
          if (Number.isNaN(value)) throw new Error(`${path}: not a number`);
        }
      } else if (type === 'json') {
        const text = input.value.trim();
        if (text === '') value = nullable ? null : {};
        else {
          try {
            value = JSON.parse(text);
          } catch (error) {
            throw new Error(`${path}: invalid JSON (${error.message})`);
          }
        }
      } else if (type === 'select') {
        if (input.value === '' && nullable) value = null;
        else if (input.dataset.numeric === '1') {
          value = Number(input.value);
          if (Number.isNaN(value)) throw new Error(`${path}: not a number`);
        } else value = input.value;
      } else {
        const text = input.value;
        value = text.trim() === '' && nullable ? null : text;
      }
      if (fileDoc && !hasPath(fileDoc, path) && deepEqual(value, getPath(runningDoc, path))) {
        continue;
      }
      setPath(doc, path, value);
    }
    const outputs = {};
    for (const row of $$('[data-editor="gpio-outputs"] [data-output]')) {
      const line = $('[data-field="line"]', row).value.trim();
      if (!line) continue;
      outputs[row.dataset.output] = { line, active_low: $('[data-field="active_low"]', row).checked };
    }
    const targetOutputs = [];
    for (const row of $$('[data-editor="gpio-target-outputs"] [data-target-output]')) {
      const line = $('[data-field="line"]', row).value.trim();
      const target = $('[data-field="target"]', row).value.trim();
      if (!line || !target) continue;
      targetOutputs.push({
        line,
        target,
        when: $('[data-field="when"]', row).value || 'receiving',
        active_low: $('[data-field="active_low"]', row).checked,
      });
    }
    const inputs = [];
    for (const row of $$('[data-editor="gpio-inputs"] [data-input]')) {
      const line = $('[data-field="line"]', row).value.trim();
      if (!line) continue;
      const target = $('[data-field="target"]', row).value.trim();
      inputs.push({
        line,
        action: $('[data-field="action"]', row).value,
        target: target || null,
        active_low: $('[data-field="active_low"]', row).checked,
        debounce_ms: Number($('[data-field="debounce_ms"]', row).value || 20),
      });
    }
    if (hasPath(fileDoc || doc, 'gpio') || Object.keys(outputs).length || targetOutputs.length || inputs.length) {
      setPath(doc, 'gpio.outputs', outputs);
      setPath(doc, 'gpio.target_outputs', targetOutputs);
      setPath(doc, 'gpio.inputs', inputs);
    }
    const defaultDb = getPath(doc, 'audio.default_volume_db');
    if (typeof defaultDb === 'number' && Number.isFinite(defaultDb)) {
      setPath(doc, 'audio.default_volume', dbToLinear(defaultDb));
    }
    const devices = [];
    for (const row of $$('[data-editor="streamdeck-devices"] [data-device]')) {
      const mock = $('[data-field="mock"]', row).value.trim();
      const serial = $('[data-field="serial"]', row).value.trim();
      const pedalLeft = $('[data-field="pedal_left"]', row).value.trim();
      const pedalTarget = $('[data-field="pedal_target"]', row).value.trim();
      const layoutText = $('[data-field="layout"]', row).value.trim();
      let layout = {};
      if (layoutText) {
        try {
          layout = JSON.parse(layoutText);
        } catch (error) {
          throw new Error(`streamdeck.devices layout: invalid JSON (${error.message})`);
        }
      }
      devices.push({
        mock: mock || null,
        serial: serial || null,
        pedal_left: pedalLeft || null,
        pedal_target: pedalTarget || null,
        layout,
      });
    }
    if (devices.length) setPath(doc, 'streamdeck.devices', devices);
    else if (doc.streamdeck) delete doc.streamdeck.devices;
    return doc;
  }

  async function saveConfig(thenRestart) {
    const message = $('#settings-message');
    message.className = 'form-message';
    message.textContent = '';
    let doc;
    try {
      doc = collectDocument();
    } catch (error) {
      message.textContent = error.message;
      return;
    }
    try {
      const result = await api('PUT', '/api/config', { document: doc });
      message.className = 'form-message ok';
      message.textContent = `Saved to ${result.path}. ${thenRestart ? 'Restarting…' : 'Restart the service to apply the changes.'}`;
      await loadConfig();
      if (thenRestart) restartService(true);
      else flash('Configuration saved. Restart to apply.', 'ok');
    } catch (error) {
      message.textContent = error.message;
    }
  }

  $('#settings-save').addEventListener('click', () => saveConfig(false));
  $('#settings-save-restart').addEventListener('click', () => saveConfig(true));
  $('#settings-reload').addEventListener('click', loadConfig);
  $('#toggle-raw').addEventListener('click', () => {
    if (!state.rawMode) {
      try {
        $('#raw-json').value = JSON.stringify(collectDocument(), null, 2);
      } catch (error) {
        flash(error.message, 'error');
        return;
      }
    } else {
      try {
        state.configDoc = JSON.parse($('#raw-json').value);
        state.fileDoc = JSON.parse(JSON.stringify(state.configDoc));
        renderSettingsForm();
      } catch (error) {
        flash(`Raw JSON is invalid: ${error.message}`, 'error');
        return;
      }
    }
    state.rawMode = !state.rawMode;
    $('#raw-editor').classList.toggle('is-hidden', !state.rawMode);
    $('#settings-form').classList.toggle('is-hidden', state.rawMode);
    $('#toggle-raw').textContent = state.rawMode ? 'Form editor' : 'Raw editor';
  });

  bindDeckKeys();
  bindDeckEncoders();
  boot();
})();
