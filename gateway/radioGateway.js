#!/usr/bin/env node

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { io } = require("socket.io-client");

const radioConfigPath = path.resolve(process.env.TALKTOME_RADIO_CONFIG || "gateway/radio-config.json");
const radioConfig = loadRadioConfig(radioConfigPath);

function loadRadioConfig(filePath) {
  if (!fs.existsSync(filePath)) return {};

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`[radio-gateway] failed to read ${filePath}: ${error.message}`);
    return {};
  }
}

function stringSetting(envName, configKey, fallback) {
  return String(process.env[envName] ?? radioConfig[configKey] ?? fallback);
}

function numberSetting(envName, configKey, fallback) {
  const value = Number(process.env[envName] ?? radioConfig[configKey] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function booleanSetting(envName, configKey, fallback) {
  const value = process.env[envName] ?? radioConfig[configKey];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

function getDefaultTxRtpIp() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

const config = {
  gpio: stringSetting("TALKTOME_RADIO_GPIO", "gpio", "17"),
  audioDevice: stringSetting("TALKTOME_RADIO_AUDIO_DEVICE", "audioDevice", "plughw:CARD=CODEC,DEV=0"),
  sampleRate: numberSetting("TALKTOME_RADIO_SAMPLE_RATE", "sampleRate", 48000),
  channels: numberSetting("TALKTOME_RADIO_CHANNELS", "channels", 1),
  pttLeadMs: numberSetting("TALKTOME_RADIO_PTT_LEAD_MS", "pttLeadMs", 300),
  pttTailMs: numberSetting("TALKTOME_RADIO_PTT_TAIL_MS", "pttTailMs", 250),
  rxOnThreshold: numberSetting("TALKTOME_RADIO_RX_ON_THRESHOLD", "rxOnThreshold", 0.002),
  rxOffThreshold: numberSetting("TALKTOME_RADIO_RX_OFF_THRESHOLD", "rxOffThreshold", 0.003),
  rxHangMs: numberSetting("TALKTOME_RADIO_RX_HANG_MS", "rxHangMs", 600),
  rxPreRollMs: numberSetting("TALKTOME_RADIO_RX_PRE_ROLL_MS", "rxPreRollMs", 500),
  rxResumeLeadMs: numberSetting("TALKTOME_RADIO_RX_RESUME_LEAD_MS", "rxResumeLeadMs", 150),
  rxWarmupMs: numberSetting("TALKTOME_RADIO_RX_WARMUP_MS", "rxWarmupMs", 500),
  rxGainDb: numberSetting("TALKTOME_RADIO_RX_GAIN_DB", "rxGainDb", 6),
  txEnabled: booleanSetting("TALKTOME_RADIO_TX_ENABLED", "txEnabled", true),
  txRtpIp: stringSetting("TALKTOME_RADIO_TX_RTP_IP", "txRtpIp", getDefaultTxRtpIp()),
  txRtpPort: numberSetting("TALKTOME_RADIO_TX_RTP_PORT", "txRtpPort", 5006),
  txGainDb: numberSetting("TALKTOME_RADIO_TX_GAIN_DB", "txGainDb", 0),
  txReleaseHoldMs: numberSetting("TALKTOME_RADIO_TX_RELEASE_HOLD_MS", "txReleaseHoldMs", 900),
  txStopGraceMs: numberSetting("TALKTOME_RADIO_TX_STOP_GRACE_MS", "txStopGraceMs", 150),
  txRxMuteTailMs: numberSetting("TALKTOME_RADIO_TX_RX_MUTE_TAIL_MS", "txRxMuteTailMs", 600),
  rxSegmentsDir: stringSetting("TALKTOME_RADIO_RX_SEGMENTS_DIR", "rxSegmentsDir", "gateway/rx-segments"),
  talkToMeUrl: stringSetting("TALKTOME_SERVER_URL", "talkToMeUrl", "https://localhost:8443"),
  gatewayUserId: stringSetting("TALKTOME_GATEWAY_USER_ID", "gatewayUserId", ""),
  gatewayConferenceId: stringSetting("TALKTOME_GATEWAY_CONFERENCE_ID", "gatewayConferenceId", ""),
  gatewayName: stringSetting("TALKTOME_GATEWAY_NAME", "gatewayName", "Baofeng Gateway"),
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio || "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal || code}`));
    });
  });
}

async function initPtt() {
  await run("pinctrl", ["set", config.gpio, "op", "dl"]);
}

async function setPtt(enabled) {
  await run("pinctrl", ["set", config.gpio, enabled ? "dh" : "dl"]);
}

async function withPtt(callback) {
  await initPtt();
  await setPtt(true);
  await delay(config.pttLeadMs);
  try {
    await callback();
  } finally {
    await delay(config.pttTailMs);
    await setPtt(false).catch((error) => {
      console.error(`[radio-gateway] failed to release PTT: ${error.message}`);
    });
  }
}

async function playFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Audio file not found: ${resolvedPath}`);
  }

  await withPtt(() => run("aplay", ["-D", config.audioDevice, resolvedPath]));
}

function calculateRms(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  if (!sampleCount) return 0;

  let sumSquares = 0;
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}

function createRecorderProcess() {
  const args = [
    "-D",
    config.audioDevice,
    "-f",
    "S16_LE",
    "-r",
    String(config.sampleRate),
    "-c",
    String(config.channels),
    "-t",
    "raw",
  ];

  return spawn("arecord", args, {
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
  });
}

function createSocket() {
  return io(config.talkToMeUrl, {
    transports: ["websocket"],
    rejectUnauthorized: false,
  });
}

function emitWithAck(socket, event, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${event} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.emit(event, payload, (response = {}) => {
      clearTimeout(timer);
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

function emitNoPayloadWithAck(socket, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${event} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.emit(event, (response = {}) => {
      clearTimeout(timer);
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

function waitForSocketConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
  });
}

function waitForSocketDisconnect(socket) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve();
      return;
    }
    socket.once("disconnect", resolve);
  });
}

function createFfmpegRtpProcess({ ip, port, payloadType, ssrc }) {
  const rtpUrl = `rtp://${ip}:${port}?pkt_size=1200`;
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    "s16le",
    "-ar",
    String(config.sampleRate),
    "-ac",
    String(config.channels),
    "-i",
    "pipe:0",
    ...(config.rxGainDb
      ? ["-af", `volume=${config.rxGainDb}dB,alimiter=limit=0.95`]
      : []),
    "-ac",
    "2",
    "-c:a",
    "libopus",
    "-application",
    "voip",
    "-frame_duration",
    "20",
    "-b:a",
    "64000",
    "-payload_type",
    String(payloadType),
    "-ssrc",
    String(ssrc),
    "-f",
    "rtp",
    rtpUrl,
  ];

  return spawn("ffmpeg", args, {
    stdio: ["pipe", "inherit", "inherit"],
    env: process.env,
  });
}

function buildGatewayProducerRtpParameters({ payloadType, ssrc }) {
  return {
    codecs: [
      {
        mimeType: "audio/opus",
        payloadType,
        clockRate: 48000,
        channels: 2,
        parameters: {
          "sprop-stereo": 0,
        },
        rtcpFeedback: [],
      },
    ],
    encodings: [{ ssrc }],
    rtcp: {
      cname: "talktome-radio-gateway",
      reducedSize: true,
      mux: true,
    },
  };
}

function buildReceiveSdp({ port, rtpParameters }) {
  const codec = (rtpParameters?.codecs || []).find((entry) => (
    String(entry?.mimeType || "").toLowerCase() === "audio/opus"
  )) || rtpParameters?.codecs?.[0];
  const payloadType = Number(codec?.payloadType || 100);
  const clockRate = Number(codec?.clockRate || 48000);
  const channels = Number(codec?.channels || 2);
  const parameters = codec?.parameters && typeof codec.parameters === "object"
    ? Object.entries(codec.parameters)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}=${value}`)
        .join(";")
    : "";

  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=Talktome Radio Gateway TX",
    "c=IN IP4 0.0.0.0",
    "t=0 0",
    `m=audio ${port} RTP/AVP ${payloadType}`,
    `a=rtpmap:${payloadType} opus/${clockRate}/${channels}`,
    parameters ? `a=fmtp:${payloadType} ${parameters}` : null,
    "a=rtcp-mux",
    "a=recvonly",
    "",
  ].filter((line) => line !== null).join("\n");
}

function createFfmpegRtpPlaybackProcess(sdp) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-protocol_whitelist",
    "pipe,udp,rtp",
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-analyzeduration",
    "0",
    "-probesize",
    "32",
    "-f",
    "sdp",
    "-i",
    "pipe:0",
    ...(config.txGainDb
      ? ["-af", `volume=${config.txGainDb}dB,alimiter=limit=0.95`]
      : []),
    "-ac",
    "2",
    "-ar",
    String(config.sampleRate),
    "-f",
    "alsa",
    config.audioDevice,
  ];

  const ffmpeg = spawn("ffmpeg", args, {
    stdio: ["pipe", "inherit", "inherit"],
    env: process.env,
  });
  ffmpeg.stdin.end(sdp);
  return ffmpeg;
}

function waitForProcessClose(child, timeoutMs = 1500) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("close", onClose);
    };
    child.once("close", onClose);
  });
}

function startTalkToRadioTx(socket, options = {}) {
  if (!config.txEnabled) {
    console.log("[radio-gateway] TX path disabled");
    return () => {};
  }

  let activeTx = null;
  let pendingTxProducer = null;
  let txQueue = Promise.resolve();
  let txPortOffset = 0;
  let txPttActive = false;
  let txPttDesired = false;
  let txPttQueue = Promise.resolve();
  let txReleaseTimer = null;

  function cancelTxRelease() {
    if (txReleaseTimer) {
      clearTimeout(txReleaseTimer);
      txReleaseTimer = null;
    }
  }

  function scheduleTxRelease(reason) {
    cancelTxRelease();
    txReleaseTimer = setTimeout(() => {
      txReleaseTimer = null;
      pendingTxProducer = null;
      void setTxPttActive(false, reason).catch((error) => {
        console.error(`[radio-gateway] failed to release radio TX PTT: ${error.message}`);
      });
    }, Math.max(0, config.txReleaseHoldMs));
  }

  function setTxActivity(active) {
    if (typeof options.onTxActivityChange === "function") {
      options.onTxActivityChange(Boolean(active));
    }
  }

  function enqueueTxTask(task) {
    txQueue = txQueue.then(task, task);
    return txQueue;
  }

  function getNextTxPort() {
    const basePort = Number(config.txRtpPort);
    const port = basePort + (txPortOffset % 20);
    txPortOffset += 1;
    return port;
  }

  function setTxPttActive(enabled, reason) {
    txPttDesired = Boolean(enabled);
    txPttQueue = txPttQueue.then(() => applyTxPttState(reason), () => applyTxPttState(reason));
    return txPttQueue.catch((error) => {
      console.error(`[radio-gateway] failed to ${enabled ? "enable" : "release"} radio TX PTT (${reason}): ${error.message}`);
      throw error;
    });
  }

  async function applyTxPttState(reason) {
    if (txPttDesired) {
      if (txPttActive) return;
      await initPtt();
      await setPtt(true);
      txPttActive = true;
      setTxActivity(true);
      console.log(`[radio-gateway] radio TX PTT on (${reason})`);
      return;
    }

    if (!txPttActive) return;
    await delay(config.pttTailMs);
    if (txPttDesired) return;
    await setPtt(false);
    txPttActive = false;
    setTxActivity(false);
    console.log(`[radio-gateway] radio TX PTT off (${reason})`);
  }

  async function startPendingTx(reason) {
    if (activeTx || !pendingTxProducer) return;
    const payload = pendingTxProducer;
    pendingTxProducer = null;
    console.log(`[radio-gateway] starting pending radio TX (${reason})`);
    try {
      await startTxForProducer(payload);
    } catch (error) {
      console.error(`[radio-gateway] failed to start pending radio TX: ${error.message}`);
      await stopTx("pending-start-failed", { keepPtt: true });
    }
  }

  async function stopTx(reason = "stop", { keepPtt = true } = {}) {
    const session = activeTx;
    if (!session) {
      if (!keepPtt) {
        await setTxPttActive(false, reason);
      }
      return;
    }

    console.log(`[radio-gateway] stopping radio TX (${reason})`);
    if (session.consumerId) {
      await emitWithAck(socket, "close-consumer", { consumerId: session.consumerId }, 500).catch((error) => {
        console.warn(`[radio-gateway] failed to close TX consumer ${session.consumerId}: ${error.message}`);
      });
    }
    try {
      session.ffmpeg?.kill("SIGTERM");
    } catch {}
    const closed = await waitForProcessClose(session.ffmpeg, config.txStopGraceMs);
    if (!closed) {
      try {
        session.ffmpeg?.kill("SIGKILL");
      } catch {}
      await waitForProcessClose(session.ffmpeg, 500);
    }

    if (!keepPtt) {
      await setTxPttActive(false, reason);
    }
    if (activeTx === session) {
      activeTx = null;
    }
    await startPendingTx(reason);
  }

  async function startTxForProducer(payload) {
    const producerId = payload?.producerId;
    if (!producerId) return;
    if (payload.peerId === socket.id) return;
    if (activeTx) {
      pendingTxProducer = payload;
      console.log(`[radio-gateway] queued pending radio TX producer ${producerId}`);
      return;
    }

    const txPort = getNextTxPort();
    console.log(`[radio-gateway] preparing radio TX for producer ${producerId} on ${config.txRtpIp}:${txPort}`);
    const consumer = await emitWithAck(socket, "consume-plain", {
      producerId,
      ip: config.txRtpIp,
      port: txPort,
    });
    const sdp = buildReceiveSdp({
      port: txPort,
      rtpParameters: consumer.rtpParameters,
    });
    const ffmpeg = createFfmpegRtpPlaybackProcess(sdp);
    const session = { producerId, consumerId: consumer.id, ffmpeg, port: txPort, starting: true };
    activeTx = session;

    ffmpeg.on("error", (error) => {
      console.error(`[radio-gateway] failed to start TX ffmpeg: ${error.message}`);
      void enqueueTxTask(async () => {
        if (activeTx === session) {
          await stopTx("ffmpeg-error", { keepPtt: true });
        }
      });
    });
    ffmpeg.on("exit", (code, signal) => {
      if (activeTx === session && code !== 0 && signal !== "SIGTERM") {
        console.error(`[radio-gateway] TX ffmpeg exited with ${signal || code}`);
        void enqueueTxTask(async () => {
          if (activeTx === session) {
            await stopTx("ffmpeg-exit", { keepPtt: true });
          }
        });
      }
    });

    if (!txPttActive) {
      await setTxPttActive(true, "media-fallback");
      await delay(config.pttLeadMs);
    }
    if (activeTx !== session || ffmpeg.exitCode !== null || ffmpeg.signalCode !== null) {
      throw new Error(`TX ffmpeg exited before producer ${producerId} could be resumed`);
    }
    await emitWithAck(socket, "resume-consumer", { consumerId: consumer.id });
    session.starting = false;
    console.log(`[radio-gateway] transmitting Talktome producer ${producerId} to radio`);
  }

  socket.on("new-producer", (payload) => {
    cancelTxRelease();
    if (payload?.peerId !== socket.id) {
      void setTxPttActive(true, "new-producer").catch((error) => {
        console.error(`[radio-gateway] failed to prepare radio TX PTT: ${error.message}`);
      });
    }
    void enqueueTxTask(() => startTxForProducer(payload)).catch((error) => {
      console.error(`[radio-gateway] failed to start radio TX: ${error.message}`);
      return stopTx("start-failed");
    });
  });

  socket.on("producer-closed", ({ producerId } = {}) => {
    void enqueueTxTask(async () => {
      if (pendingTxProducer?.producerId && String(pendingTxProducer.producerId) === String(producerId)) {
        pendingTxProducer = null;
      }
      if (activeTx?.producerId && String(activeTx.producerId) === String(producerId)) {
        await stopTx("producer-closed", { keepPtt: true });
      }
    });
  });

  socket.on("consumer-closed", ({ consumerId, producerId } = {}) => {
    void enqueueTxTask(async () => {
      const matchesConsumer = activeTx?.consumerId && String(activeTx.consumerId) === String(consumerId);
      const matchesProducer = activeTx?.producerId && String(activeTx.producerId) === String(producerId);
      if (matchesConsumer || matchesProducer) {
        await stopTx("consumer-closed", { keepPtt: true });
      }
    });
  });

  socket.on("incoming-talk-state", ({ state } = {}) => {
    const addressedNow = Array.isArray(state?.addressedNow) ? state.addressedNow : [];
    const shouldTransmit = addressedNow.length > 0;
    cancelTxRelease();
    if (!shouldTransmit) {
      scheduleTxRelease("server-talk-state");
      return;
    }
    void enqueueTxTask(() => setTxPttActive(true, "server-talk-state")).catch((error) => {
      console.error(`[radio-gateway] failed to queue radio TX PTT on: ${error.message}`);
    });
  });

  void emitNoPayloadWithAck(socket, "request-active-producers", 5000)
    .then((producers) => {
      if (!Array.isArray(producers)) return;
      for (const producer of producers) {
        if (activeTx) break;
        void enqueueTxTask(() => startTxForProducer(producer)).catch((error) => {
          console.error(`[radio-gateway] failed to start active radio TX: ${error.message}`);
          return stopTx("active-start-failed");
        });
      }
    })
    .catch((error) => {
      console.warn(`[radio-gateway] failed to request active producers for TX: ${error.message}`);
    });

  console.log(`[radio-gateway] TX path listening on ${config.txRtpIp}:${config.txRtpPort}-${config.txRtpPort + 19}`);
  return async () => {
    socket.off("new-producer");
    socket.off("producer-closed");
    socket.off("consumer-closed");
    socket.off("incoming-talk-state");
    cancelTxRelease();
    await enqueueTxTask(() => stopTx("shutdown", { keepPtt: false }));
  };
}

async function runRxStreamSession() {
  const userId = Number(config.gatewayUserId);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error("Set TALKTOME_GATEWAY_USER_ID to the Talktome user id for this radio gateway.");
  }

  const conferenceId = Number(config.gatewayConferenceId);
  if (!Number.isFinite(conferenceId) || conferenceId <= 0) {
    throw new Error("Set TALKTOME_GATEWAY_CONFERENCE_ID to the Talktome conference id this radio should talk into.");
  }

  const socket = createSocket();
  socket.on("disconnect", (reason) => {
    console.warn(`[radio-gateway] Talktome socket disconnected: ${reason}`);
  });

  await waitForSocketConnect(socket);
  console.log(`[radio-gateway] connected to ${config.talkToMeUrl}`);

  await emitWithAck(socket, "register-user", {
    id: userId,
    name: config.gatewayName,
    kind: "user",
    force: true,
  });
  console.log(`[radio-gateway] registered user ${config.gatewayName} (${userId})`);
  let txRxMuted = false;
  let txRxMuteUntil = 0;
  const cleanupTx = startTalkToRadioTx(socket, {
    onTxActivityChange(active) {
      txRxMuted = Boolean(active);
      txRxMuteUntil = active ? Number.POSITIVE_INFINITY : Date.now() + Math.max(0, config.txRxMuteTailMs);
    },
  });

  const transportInfo = await emitWithAck(socket, "create-plain-send-transport", {});
  console.log(`[radio-gateway] plain RTP target ${transportInfo.ip}:${transportInfo.port}`);

  const payloadType = Number(transportInfo.payloadType || 100);
  const ssrc = Number(transportInfo.ssrc || 11111111);
  const rtpParameters = buildGatewayProducerRtpParameters({ payloadType, ssrc });
  const producer = await emitWithAck(socket, "produce-plain", {
    kind: "audio",
    appData: { type: "conference", id: conferenceId },
    rtpParameters,
  });
  const producerId = producer.id;
  console.log(`[radio-gateway] prepared radio RX producer ${producerId} for conference ${conferenceId}`);

  let recorder = null;
  const ffmpeg = createFfmpegRtpProcess({
    ip: transportInfo.ip,
    port: transportInfo.port,
    payloadType,
    ssrc,
  });
  const bytesPerSecond = config.sampleRate * config.channels * 2;
  const maxEncoderDelayBytes = Math.max(0, Math.floor(bytesPerSecond * config.rxResumeLeadMs / 1000));
  const encoderDelayChunks = [];
  let encoderDelayBytes = 0;
  let rxActive = false;
  let warmingUp = config.rxWarmupMs > 0;
  let lastAboveThresholdAt = 0;
  let producerToggle = Promise.resolve();
  let encoderSawInput = false;

  function writeToEncoder(chunk) {
    if (!ffmpeg.stdin.destroyed) {
      ffmpeg.stdin.write(chunk);
      if (!encoderSawInput) {
        encoderSawInput = true;
        console.log("[radio-gateway] encoder receiving live input");
      }
    }
  }

  function writeDelayedToEncoder(chunk) {
    if (!maxEncoderDelayBytes) {
      writeToEncoder(chunk);
      return;
    }

    encoderDelayChunks.push(chunk);
    encoderDelayBytes += chunk.length;

    while (encoderDelayBytes > maxEncoderDelayBytes && encoderDelayChunks.length > 1) {
      const delayedChunk = encoderDelayChunks.shift();
      encoderDelayBytes -= delayedChunk.length;
      writeToEncoder(delayedChunk);
    }
  }

  function setProducerPaused(paused) {
    producerToggle = producerToggle
      .then(() => emitWithAck(socket, paused ? "pause-producer" : "resume-producer", { producerId }, 3000))
      .catch((error) => {
        console.error(`[radio-gateway] failed to ${paused ? "pause" : "resume"} producer ${producerId}: ${error.message}`);
    });
    return producerToggle;
  }

  recorder = createRecorderProcess();
  recorder.stdout.on("data", (chunk) => {
    writeDelayedToEncoder(chunk);

    if (warmingUp) {
      return;
    }

    const rms = calculateRms(chunk);
    const now = Date.now();
    const rxMutedByTx = txRxMuted || now < txRxMuteUntil;
    if (rxMutedByTx) {
      if (rxActive) {
        rxActive = false;
        console.log(JSON.stringify({ event: "rx-muted", rms, at: new Date(now).toISOString() }));
        void setProducerPaused(true);
      }
      return;
    }

    if (!rxActive && rms >= config.rxOnThreshold) {
      rxActive = true;
      lastAboveThresholdAt = now;
      console.log(JSON.stringify({ event: "rx-on", rms, at: new Date(now).toISOString() }));
      void setProducerPaused(false);
      return;
    }

    if (!rxActive) {
      return;
    }

    if (rms >= config.rxOffThreshold) {
      lastAboveThresholdAt = now;
    }
    if (now - lastAboveThresholdAt >= config.rxHangMs) {
      rxActive = false;
      console.log(JSON.stringify({ event: "rx-off", rms, at: new Date(now).toISOString() }));
      void setProducerPaused(true);
    }
  });

  recorder.on("error", (error) => {
    console.error(`[radio-gateway] failed to start arecord: ${error.message}`);
    socket.disconnect();
    process.exitCode = 1;
  });
  ffmpeg.on("error", (error) => {
    console.error(`[radio-gateway] failed to start ffmpeg: ${error.message}`);
    recorder?.kill("SIGTERM");
    socket.disconnect();
    process.exitCode = 1;
  });
  ffmpeg.on("exit", (code, signal) => {
    console.error(`[radio-gateway] ffmpeg exited with ${signal || code}`);
    recorder?.kill("SIGTERM");
    socket.disconnect();
    if (code !== 0) process.exitCode = 1;
  });

  await emitWithAck(socket, "pause-producer", { producerId });
  if (warmingUp) {
    console.log(`[radio-gateway] warming RTP path with live input for ${config.rxWarmupMs}ms`);
    await delay(config.rxWarmupMs);
    warmingUp = false;
  }

  const handleSigint = () => {
    void (async () => {
      await setProducerPaused(true);
      await cleanupTx();
      recorder?.kill("SIGTERM");
      ffmpeg.kill("SIGTERM");
      socket.disconnect();
      process.exit(130);
    })();
  };
  process.once("SIGINT", handleSigint);

  await waitForSocketDisconnect(socket);
  process.off("SIGINT", handleSigint);
  await cleanupTx();
  recorder?.kill("SIGTERM");
  ffmpeg.kill("SIGTERM");
}

async function streamRxToTalkToMe() {
  while (true) {
    try {
      await runRxStreamSession();
    } catch (error) {
      console.error(`[radio-gateway] stream session failed: ${error.message}`);
    }
    console.log("[radio-gateway] reconnecting in 2s...");
    await delay(2000);
  }
}

function createWavHeader(dataLength) {
  const bytesPerSample = 2;
  const blockAlign = config.channels * bytesPerSample;
  const byteRate = config.sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(config.channels, 22);
  header.writeUInt32LE(config.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

function finalizeWavSegment(segment) {
  if (!segment) return;

  try {
    const fd = fs.openSync(segment.path, "r+");
    fs.writeSync(fd, createWavHeader(segment.bytesWritten), 0, 44, 0);
    fs.closeSync(fd);
    console.log(JSON.stringify({
      event: "segment-saved",
      path: segment.path,
      bytes: segment.bytesWritten,
    }));
  } catch (error) {
    console.error(`[radio-gateway] failed to finalize WAV segment: ${error.message}`);
  }
}

function createSegmentFile() {
  fs.mkdirSync(config.rxSegmentsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(config.rxSegmentsDir, `rx-${timestamp}.wav`);
  const fd = fs.openSync(filePath, "w");
  fs.writeSync(fd, Buffer.alloc(44));

  return {
    fd,
    path: filePath,
    bytesWritten: 0,
  };
}

function writeSegmentChunk(segment, chunk) {
  fs.writeSync(segment.fd, chunk);
  segment.bytesWritten += chunk.length;
}

function closeSegmentFile(segment) {
  if (!segment) return;
  try {
    fs.closeSync(segment.fd);
  } catch {}
  finalizeWavSegment(segment);
}

function monitorRx() {
  const recorder = createRecorderProcess();

  let rxActive = false;
  let lastAboveThresholdAt = 0;
  let lastLogAt = 0;
  let peakRms = 0;

  recorder.stdout.on("data", (chunk) => {
    const rms = calculateRms(chunk);
    const now = Date.now();
    peakRms = Math.max(peakRms, rms);

    if (!rxActive && rms >= config.rxOnThreshold) {
      rxActive = true;
      lastAboveThresholdAt = now;
      console.log(JSON.stringify({ event: "rx-on", rms, at: new Date(now).toISOString() }));
      return;
    }

    if (rxActive && rms >= config.rxOffThreshold) {
      lastAboveThresholdAt = now;
    }

    if (rxActive && now - lastAboveThresholdAt >= config.rxHangMs) {
      rxActive = false;
      console.log(JSON.stringify({ event: "rx-off", rms, at: new Date(now).toISOString() }));
      return;
    }

    if (now - lastLogAt >= 1000) {
      lastLogAt = now;
      console.log(JSON.stringify({ event: "level", rms, peakRms, rxActive }));
      peakRms = 0;
    }
  });

  recorder.on("error", (error) => {
    console.error(`[radio-gateway] failed to start arecord: ${error.message}`);
    process.exitCode = 1;
  });

  recorder.on("exit", (code, signal) => {
    if (code !== 0) {
      console.error(`[radio-gateway] arecord exited with ${signal || code}`);
      process.exitCode = 1;
    }
  });

  process.on("SIGINT", () => {
    recorder.kill("SIGTERM");
    process.exit(130);
  });
}

function recordRxSegments() {
  const recorder = createRecorderProcess();
  const bytesPerSecond = config.sampleRate * config.channels * 2;
  const maxPreRollBytes = Math.max(0, Math.floor(bytesPerSecond * config.rxPreRollMs / 1000));
  const preRollChunks = [];
  let preRollBytes = 0;
  let rxActive = false;
  let lastAboveThresholdAt = 0;
  let currentSegment = null;

  function rememberPreRoll(chunk) {
    if (!maxPreRollBytes) return;
    preRollChunks.push(chunk);
    preRollBytes += chunk.length;

    while (preRollBytes > maxPreRollBytes && preRollChunks.length > 1) {
      const removed = preRollChunks.shift();
      preRollBytes -= removed.length;
    }
  }

  function startSegment(now, rms) {
    rxActive = true;
    lastAboveThresholdAt = now;
    currentSegment = createSegmentFile();
    for (const chunk of preRollChunks) {
      writeSegmentChunk(currentSegment, chunk);
    }
    console.log(JSON.stringify({
      event: "segment-start",
      path: currentSegment.path,
      rms,
      preRollMs: config.rxPreRollMs,
      at: new Date(now).toISOString(),
    }));
  }

  function stopSegment(now, rms) {
    rxActive = false;
    const finishedSegment = currentSegment;
    currentSegment = null;
    closeSegmentFile(finishedSegment);
    console.log(JSON.stringify({ event: "segment-stop", rms, at: new Date(now).toISOString() }));
  }

  recorder.stdout.on("data", (chunk) => {
    const rms = calculateRms(chunk);
    const now = Date.now();

    rememberPreRoll(chunk);

    if (!rxActive && rms >= config.rxOnThreshold) {
      startSegment(now, rms);
    }

    if (rxActive) {
      writeSegmentChunk(currentSegment, chunk);
      if (rms >= config.rxOffThreshold) {
        lastAboveThresholdAt = now;
      }
      if (now - lastAboveThresholdAt >= config.rxHangMs) {
        stopSegment(now, rms);
      }
    }
  });

  recorder.on("error", (error) => {
    console.error(`[radio-gateway] failed to start arecord: ${error.message}`);
    process.exitCode = 1;
  });

  recorder.on("exit", (code, signal) => {
    if (currentSegment) {
      closeSegmentFile(currentSegment);
      currentSegment = null;
    }
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`[radio-gateway] arecord exited with ${signal || code}`);
      process.exitCode = 1;
    }
  });

  process.on("SIGINT", () => {
    recorder.kill("SIGTERM");
    process.exit(130);
  });
}

function percentile(sortedValues, percentileValue) {
  if (!sortedValues.length) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((percentileValue / 100) * (sortedValues.length - 1))),
  );
  return sortedValues[index];
}

function summarizeRmsValues(values) {
  const sortedValues = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    samples: values.length,
    min: sortedValues[0] || 0,
    p10: percentile(sortedValues, 10),
    p25: percentile(sortedValues, 25),
    p50: percentile(sortedValues, 50),
    p75: percentile(sortedValues, 75),
    p90: percentile(sortedValues, 90),
    p95: percentile(sortedValues, 95),
    p99: percentile(sortedValues, 99),
    max: sortedValues[sortedValues.length - 1] || 0,
    avg: values.length ? sum / values.length : 0,
  };
}

function formatLevel(value) {
  return Number(value).toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function suggestRxSettings({ noise, carrier, quietSpeech }) {
  const noiseCeiling = Math.max(noise.p99, noise.p95, noise.avg);
  const signalCandidates = [
    carrier.p50,
    carrier.p75,
    carrier.p90,
    quietSpeech.p10,
    quietSpeech.p25,
    quietSpeech.p50,
  ].filter((value) => value > noiseCeiling * 1.5);
  const weakestSignal = signalCandidates.length
    ? Math.min(...signalCandidates)
    : Math.max(carrier.p90, quietSpeech.p25, quietSpeech.p50);

  const rxOnThreshold = clamp(
    Math.max(noiseCeiling * 8, weakestSignal * 0.5),
    0.0001,
    0.02,
  );
  const rxOffThreshold = clamp(
    Math.max(noiseCeiling * 6, rxOnThreshold * 0.6),
    0.0001,
    Math.max(0.0001, rxOnThreshold * 0.95),
  );

  return {
    rxOnThreshold: Number(rxOnThreshold.toFixed(6)),
    rxOffThreshold: Number(rxOffThreshold.toFixed(6)),
    rxHangMs: config.rxHangMs,
    rxResumeLeadMs: config.rxResumeLeadMs,
    rxWarmupMs: config.rxWarmupMs,
    rxGainDb: config.rxGainDb,
  };
}

function promptLine(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function measureRmsFor(durationMs) {
  const recorder = createRecorderProcess();
  const values = [];

  return new Promise((resolve, reject) => {
    let stopping = false;
    let settled = false;
    const resolveStats = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(summarizeRmsValues(values));
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const finish = () => {
      if (stopping) return;
      stopping = true;
      recorder.kill("SIGTERM");
    };
    const timer = setTimeout(finish, durationMs);

    recorder.stdout.on("data", (chunk) => {
      values.push(calculateRms(chunk));
    });
    recorder.on("error", (error) => {
      rejectOnce(error);
    });
    recorder.on("close", (code, signal) => {
      if (stopping || signal === "SIGTERM") {
        resolveStats();
        return;
      }
      rejectOnce(new Error(`arecord exited with ${signal || code}`));
    });
  });
}

async function runCalibrationStep({ title, instruction, durationMs }) {
  console.log(`\n${title}`);
  console.log(instruction);
  await promptLine("Enter druecken zum Messen...");
  console.log(`Messe ${Math.round(durationMs / 1000)}s...`);
  const stats = await measureRmsFor(durationMs);
  console.log(
    `RMS avg=${formatLevel(stats.avg)} p50=${formatLevel(stats.p50)} p90=${formatLevel(stats.p90)} p99=${formatLevel(stats.p99)} max=${formatLevel(stats.max)}`,
  );
  return stats;
}

function writeRadioConfig(settings, measurements) {
  const existing = loadRadioConfig(radioConfigPath);
  const nextConfig = {
    ...existing,
    ...settings,
    calibration: {
      updatedAt: new Date().toISOString(),
      measurements,
    },
  };

  fs.mkdirSync(path.dirname(radioConfigPath), { recursive: true });
  fs.writeFileSync(radioConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}

async function calibrateRx() {
  console.log("Talktome Radio RX Kalibrierung");
  console.log(`Audio device: ${config.audioDevice}`);
  console.log(`Config file: ${radioConfigPath}`);

  const noise = await runCalibrationStep({
    title: "1/3 Idle Noise",
    instruction: "Niemand sendet auf dem Funkkanal. Gateway-Funkgeraet bleibt empfangsbereit.",
    durationMs: 5000,
  });
  const carrier = await runCalibrationStep({
    title: "2/3 Remote PTT ohne Sprache",
    instruction: "Am anderen Funkgeraet PTT gedrueckt halten, aber nicht sprechen.",
    durationMs: 3000,
  });
  const quietSpeech = await runCalibrationStep({
    title: "3/3 Leise Sprache",
    instruction: "Am anderen Funkgeraet PTT gedrueckt halten und leise ein paar Worte sprechen.",
    durationMs: 5000,
  });

  const settings = suggestRxSettings({ noise, carrier, quietSpeech });
  const measurements = {
    noise,
    carrier,
    quietSpeech,
  };

  console.log("\nVorschlag:");
  console.log(`TALKTOME_RADIO_RX_ON_THRESHOLD=${formatLevel(settings.rxOnThreshold)}`);
  console.log(`TALKTOME_RADIO_RX_OFF_THRESHOLD=${formatLevel(settings.rxOffThreshold)}`);
  console.log(`TALKTOME_RADIO_RX_HANG_MS=${settings.rxHangMs}`);
  console.log(`TALKTOME_RADIO_RX_RESUME_LEAD_MS=${settings.rxResumeLeadMs}`);
  console.log(`TALKTOME_RADIO_RX_GAIN_DB=${settings.rxGainDb}`);

  const answer = await promptLine(`\nIn ${radioConfigPath} speichern? [Y/n] `);
  if (answer && !["y", "yes", "j", "ja"].includes(answer.toLowerCase())) {
    console.log("Nicht gespeichert.");
    return;
  }

  writeRadioConfig(settings, measurements);
  console.log(`Gespeichert: ${radioConfigPath}`);
}

async function testPtt(seconds) {
  await initPtt();
  await setPtt(true);
  await delay(seconds * 1000);
  await setPtt(false);
}

function printUsage() {
  console.log(`Usage:
  node gateway/radioGateway.js ptt <seconds>
  node gateway/radioGateway.js play <file.wav>
  node gateway/radioGateway.js monitor-rx
  node gateway/radioGateway.js record-rx
  node gateway/radioGateway.js calibrate-rx
  node gateway/radioGateway.js stream

Environment:
  TALKTOME_RADIO_CONFIG=gateway/radio-config.json
  TALKTOME_RADIO_GPIO=17
  TALKTOME_RADIO_AUDIO_DEVICE=plughw:CARD=CODEC,DEV=0
  TALKTOME_RADIO_RX_ON_THRESHOLD=0.002
  TALKTOME_RADIO_RX_OFF_THRESHOLD=0.003
  TALKTOME_RADIO_RX_HANG_MS=600
  TALKTOME_RADIO_RX_PRE_ROLL_MS=500
  TALKTOME_RADIO_RX_RESUME_LEAD_MS=150
  TALKTOME_RADIO_RX_WARMUP_MS=500
  TALKTOME_RADIO_RX_GAIN_DB=6
  TALKTOME_RADIO_TX_ENABLED=true
  TALKTOME_RADIO_TX_RTP_IP=<auto-detected-pi-ip>
  TALKTOME_RADIO_TX_RTP_PORT=5006
  TALKTOME_RADIO_TX_GAIN_DB=0
  TALKTOME_RADIO_RX_SEGMENTS_DIR=gateway/rx-segments
  TALKTOME_SERVER_URL=https://talktome.local:8443
  TALKTOME_GATEWAY_USER_ID=1
  TALKTOME_GATEWAY_CONFERENCE_ID=1
  TALKTOME_GATEWAY_NAME=Baofeng Gateway`);
}

async function main() {
  const [command, arg] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "ptt") {
    await testPtt(Number(arg || 2));
    return;
  }

  if (command === "play") {
    if (!arg) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    await playFile(arg);
    return;
  }

  if (command === "monitor-rx") {
    monitorRx();
    return;
  }

  if (command === "record-rx") {
    recordRxSegments();
    return;
  }

  if (command === "calibrate-rx") {
    await calibrateRx();
    return;
  }

  if (command === "stream" || command === "stream-rx") {
    await streamRxToTalkToMe();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[radio-gateway] ${error.message}`);
  process.exitCode = 1;
});
