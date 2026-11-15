const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildWebRtcListenInfos,
  normalizeIceServer,
  resolveClientIceConfig,
} = require("../src/server/webrtcConfig");

test("uses direct ICE by default", () => {
  assert.deepEqual(resolveClientIceConfig({}), {
    iceServers: [],
    iceTransportPolicy: "all",
  });
});

test("parses standard ICE server JSON without exposing unrelated properties", () => {
  const config = resolveClientIceConfig({
    TALKTOME_ICE_SERVERS_JSON: JSON.stringify([
      { urls: "stun:stun.example.com:3478" },
      {
        urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"],
        username: "talktome",
        credential: "secret",
        ignored: "value",
      },
    ]),
    TALKTOME_ICE_TRANSPORT_POLICY: "relay",
  });

  assert.deepEqual(config, {
    iceServers: [
      { urls: "stun:stun.example.com:3478" },
      {
        urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"],
        username: "talktome",
        credential: "secret",
      },
    ],
    iceTransportPolicy: "relay",
  });
});

test("supports TURN shorthand environment variables", () => {
  assert.deepEqual(resolveClientIceConfig({
    TURN_URLS: "turn:one.example.com:3478, turns:two.example.com:5349",
    TURN_USERNAME: "user",
    TURN_PASSWORD: "password",
  }).iceServers, [{
    urls: ["turn:one.example.com:3478", "turns:two.example.com:5349"],
    username: "user",
    credential: "password",
  }]);
});

test("rejects invalid ICE configuration", () => {
  assert.throws(
    () => resolveClientIceConfig({ TALKTOME_ICE_SERVERS_JSON: "{" }),
    /not valid JSON/
  );
  assert.throws(
    () => normalizeIceServer({ urls: "https://turn.example.com" }),
    /Unsupported ICE server URL/
  );
  assert.throws(
    () => resolveClientIceConfig({ TURN_URLS: "turn:example.com", TURN_USERNAME: "user" }),
    /username and credential/
  );
  assert.throws(
    () => resolveClientIceConfig({ TALKTOME_ICE_TRANSPORT_POLICY: "invalid" }),
    /must be either/
  );
  assert.throws(
    () => resolveClientIceConfig({
      TALKTOME_ICE_SERVERS_JSON: JSON.stringify([{ urls: "stun:stun.example.com" }]),
      TALKTOME_ICE_TRANSPORT_POLICY: "relay",
    }),
    /requires at least one turn:/
  );
});

test("builds modern UDP and TCP listen infos", () => {
  assert.deepEqual(buildWebRtcListenInfos({
    mediaRoute: { announcedAddress: "203.0.113.20" },
    env: {},
  }), [
    { protocol: "udp", ip: "0.0.0.0", announcedAddress: "203.0.113.20" },
    { protocol: "tcp", ip: "0.0.0.0", announcedAddress: "203.0.113.20" },
  ]);
});

test("builds UDP and TCP listen infos for every automatic interface", () => {
  assert.deepEqual(buildWebRtcListenInfos({
    mediaRoute: {
      mode: "auto",
      announcedAddress: "192.168.10.20",
      candidateAddresses: ["192.168.10.20", "10.20.30.40", "192.168.10.20"],
    },
    env: { TALKTOME_MEDIA_INTERNAL_IP: "172.16.0.10" },
  }), [
    { protocol: "udp", ip: "192.168.10.20" },
    { protocol: "udp", ip: "10.20.30.40" },
    { protocol: "tcp", ip: "192.168.10.20" },
    { protocol: "tcp", ip: "10.20.30.40" },
  ]);
});

test("optionally exposes a separately bound internal address", () => {
  assert.deepEqual(buildWebRtcListenInfos({
    mediaRoute: { announcedAddress: "203.0.113.20" },
    env: { TALKTOME_MEDIA_INTERNAL_IP: "192.168.1.20" },
  }), [
    {
      protocol: "udp",
      ip: "192.168.1.20",
      announcedAddress: "203.0.113.20",
      exposeInternalIp: true,
    },
    {
      protocol: "tcp",
      ip: "192.168.1.20",
      announcedAddress: "203.0.113.20",
      exposeInternalIp: true,
    },
  ]);

  assert.throws(
    () => buildWebRtcListenInfos({
      mediaRoute: { announcedAddress: "203.0.113.20" },
      env: { TALKTOME_MEDIA_INTERNAL_IP: "not-an-ip" },
    }),
    /bindable IPv4 or IPv6/
  );
});

test("selected adapters offer UDP and TCP on each chosen local address", () => {
  const route = { mode: "interface", announcedAddress: "192.168.10.20", candidateAddresses: ["192.168.10.20", "10.20.30.40"] };
  assert.deepEqual(buildWebRtcListenInfos({ mediaRoute: route, env: {} }), [
    { protocol: "udp", ip: "192.168.10.20" },
    { protocol: "udp", ip: "10.20.30.40" },
    { protocol: "tcp", ip: "192.168.10.20" },
    { protocol: "tcp", ip: "10.20.30.40" },
  ]);
});

test("a single selected adapter binds ICE sockets to that adapter instead of a wildcard", () => {
  const { resolveTransportMediaRoute } = require("../src/server/mediaNetwork");
  const env = { TALKTOME_MEDIA_INTERFACE: "en0" };
  const mediaRoute = resolveTransportMediaRoute({
    env,
    availableInterfaces: [
      { name: "en7", address: "192.168.178.37" },
      { name: "en0", address: "192.168.178.166" },
    ],
  });
  assert.deepEqual(buildWebRtcListenInfos({ mediaRoute, env }), [
    { protocol: "udp", ip: "192.168.178.166" },
    { protocol: "tcp", ip: "192.168.178.166" },
  ]);
});
