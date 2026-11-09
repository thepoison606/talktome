# Talktome Headless Client — Specification

`headless-client/` is a **Rust** Talktome endpoint for small Linux boards
(Raspberry Pi first) that behaves like a normal Talktome *user* without a
browser: it talks and listens over the same WebRTC path browsers use, is
driven from a directly attached Elgato Stream Deck and/or GPIO buttons, can
attach a custom display or rotary panel over a local JSON-lines socket, and
drives GPIO outputs for the user's PGM/PRV camera tally. It is packaged as a Debian
package (`talktome-headless`) for arm64, armhf and amd64.

This document replaces the earlier Node-oriented draft. Decisions that were
taken during review are recorded in §19.

---

## 1. Context and goals

Existing Talktome endpoints include:

- the **browser client** (`public/client.js`) — a normal user over Socket.IO
  signalling and mediasoup `WebRtcTransport`s;
- the **Bridge** (`bridge-client/`) — a Tauri/Rust desktop app that uses the
  bridge HTTP/SSE API and *plain RTP* (`PlainTransport`, unencrypted) to
  connect studio audio interfaces, NDI and OMT.

The headless client also replaces the earlier experimental radio gateway.
The prototype and its deployment scripts have been removed.

The headless client fills the remaining gap: a **dedicated hardware
intercom panel / beltpack** that is a first-class Talktome user. It must:

1. Run headless on a Raspberry Pi (or similar) under systemd, without a
   display, keyboard or webview.
2. Register as a **normal user** (`kind: "user"`) with the user's own
   credentials — not with the admin API key and not as a bridge port — so
   that everything the server does for a user (target routing, reply,
   talk lock, camera tally, Companion targeting, per-target volume feedback)
   works unchanged.
3. Use **WebRTC** (ICE + DTLS-SRTP) exactly like the browser, including the
   deployment's **STUN/TURN** servers and `iceTransportPolicy`, so it works
   from **mobile networks** (LTE, roaming Wi-Fi, carrier-grade NAT).
4. Present the user's **targets** (users, conferences, feeds) on a directly
   attached **Stream Deck**: hold a key to talk, tap to lock, adjust volume
   and mute per target, see who is calling and whether the camera is on air.
5. Bring the user's **camera tally** and talk/incoming state to **GPIO
   outputs**, and accept PTT/lock/reply on **GPIO inputs**.
6. Support **several independent instances on one device** (one special
   case: two GPIO-only instances, no Stream Deck). The normal deployment is
   one instance per device.
7. Be built and released by CI as **`.deb` packages** for the Raspberry Pi
   OS variants in use (arm64, armhf) plus amd64 for testing on a PC.
8. Require **no Talktome server changes** for the first release.
9. Expose a **local JSON-lines Unix socket** so a custom display, rotary
   encoder board or MCU can attach to the same talk/volume bus as the Stream
   Deck and GPIO (optional loopback TCP for development).

## 2. Non-goals

- No changes to the Bridge or the server.
- No Companion-specific HTTP endpoint on the device. Bitfocus Companion
  connects to the *server* and targets the user; the server forwards
  `api-talk-command` / `api-target-audio-command` to the user's socket and
  this client executes them (§9.4). This keeps a TX-keying surface off the
  device and needs no extra token.
- No cloud/remote management. Configuration is a file under
  `/etc/talktome-headless/` plus environment overrides (§12); the local web
  interface (§13.1) edits that file.
- No video, no data channels, no NDI/OMT.
- No ICE restart. The server does not expose `transport.restartIce()` and
  the browser client does not use it either; recovery is by recreating the
  transports (§6.6). Adding a `restart-ice` event server-side is an
  optional follow-up (§18).

---

## 3. Architecture

```text
                 +--------------------------------------------------+
                 |             talktome-headless (1 instance)        |
                 |                                                  |
   Stream Deck   |  surfaces::streamdeck ----+                      |
   (USB HID) <-->|  surfaces::gpio ----------+--> talk (targets,    |
   GPIO in/out<->|  surfaces::local_api -----+    hold/lock/reply,  |
   OLED/rotary   |                           |    per-target audio) |
   (Unix/TCP) <--+                           |        |      |      |
                 |                           |        |      |      |
                 |     signalling <----------+--------+      |      |
                 |     (Socket.IO v4 client,                 |      |
                 |      login, register-user,                |      |
                 |      reconnect)                           v      |
                 |          ^                    rtc (webrtc-rs:    |
                 |          |                    send PC + recv PC, |
                 |          |                    remote_sdp, ortc)  |
                 |          |                         ^   |         |
                 |          |                         |   v         |
                 |          |                    audio (cpal ALSA,  |
                 |          |                    opus, jitter,      |
                 |          |                    mixer, VOX)        |
                 |     health (sd_notify, /healthz, tracing)        |
                 +----------|------------------------|--------------+
                            |  wss:// Socket.IO      |  SRTP over ICE (UDP/TCP, TURN)
                            v                        v
                       Talktome server (Socket.IO + mediasoup WebRtcTransport)
                            ^
                            |  REST /api/v1/companion/... (Companion, optional)
                       Bitfocus Companion
```

Repository layout (standalone crate, like `bridge-client/src-tauri`):

```text
headless-client/
  Cargo.toml                       # bin "talktome-headless", [package.metadata.deb]
  build.rs                         # embeds the build version (§14.3)
  specification.md                 # this document
  README.md                        # install / run / configure
  assets/{disconnected,reconnected}.wav  # connection cues (web client mp3s, as WAV)
  src/
    main.rs                        # CLI (clap): --instance, --config, subcommands
    run.rs                         # wires session, audio, surfaces, web, health
    config.rs                      # schema, JSON/TOML loading, env overrides, validation
    state.rs                       # shared snapshot, commands and status views
    talk.rs                        # target model, hold/lock/reply, Companion commands, audio state
    tls.rs                         # rustls client config (CA file, pinned fingerprint, insecure)
    devtools.rs                    # `dev send-tone` / `dev record`
    health.rs                      # sd_notify + watchdog, /healthz, structured logging
    signalling/
      socketio.rs                  # minimal Socket.IO v4 / Engine.IO v4 client (WebSocket, rustls)
      session.rs                   # login, register-user, reconnect, conflict policy, event routing
      http.rs                      # REST: login, targets, productions, server version
      panel.rs                     # admin remote panel commands and audio settings
      alerts.rs                    # connection-loss / reconnect cues
    rtc/
      mod.rs                       # transports lifecycle, produce/consume, recovery
      remote_sdp.rs                # mediasoup params -> SDP for webrtc-rs
      sdp.rs                       # local SDP parsing
      ortc.rs                      # local SDP -> rtpParameters / rtpCapabilities
      types.rs                     # mediasoup / protocol types
      ice_addr.rs                  # hostname ICE candidates -> literal IPs
      turn_bridge.rs               # local UDP TURN facade for turns:/TCP servers
    audio/
      io.rs                        # cpal (ALSA) capture/playback, devices, tone / wav, recovery
      processing.rs                # sonora AEC3 / NS / AGC2
      resample.rs                  # device-rate resampling (rubato)
      codec.rs                     # Opus encode/decode (libopus, static)
      jitter.rs                    # per-consumer adaptive jitter buffer
      mixer.rs                     # per-source gain/mute/dim, sum to output
      vox.rs                       # level trigger (RMS, hysteresis, hang)
      cues.rs                      # connection cue playback
    surfaces/
      mod.rs                       # Surface trait + event bus
      streamdeck/{mod,layout,render}.rs
      gpio.rs
      local_api.rs                 # JSON-lines Unix/TCP control socket
      mock.rs                      # test backends (PNG keys / in-memory lines)
    web/                           # admin web interface (axum): auth, status, config, deck view
      mod.rs auth.rs config_api.rs
      assets/{index.html,style.css,app.js}
  deploy/
    systemd/talktome-headless@.service
    udev/60-talktome-streamdeck.rules
    config.example.json
    config.example.toml
  examples/
    socket_panel.py                # display + rotary integration example
  scripts/
    build-deb.sh                   # local cargo-deb build (host or cross target)
  debian/
    postinst prerm postrm          # system user, groups, udev reload; purge removes /etc/talktome-headless
```

Crates: `tokio`, `webrtc` (webrtc-rs), `tokio-tungstenite` + `rustls`,
`reqwest` (rustls), `serde`/`serde_json`/`toml`, `cpal`, `opus` (static
libopus via `opusic-sys`), `rubato`, `elgato-streamdeck` (+ `image`,
`ab_glyph`), `gpiocdev`, `axum`, `sd-notify`, `tracing`, `clap`. TLS is
rustls everywhere; the binary has no OpenSSL dependency.

---

## 4. Identity and authentication

The server (`serverCore.js`, `register-user`) accepts a user registration
only if the socket carries one of:

- a browser session cookie whose `kind`/`userId` match, or
- Companion auth in the Socket.IO handshake (`auth.token` / `auth.apiKey`,
  `Authorization: Bearer`, `x-api-key`): either the **global Companion API
  key** (may register *any* user — the gateway shortcut) or a **user-scoped
  token** from `POST /api/v1/companion/auth/login` that may register only
  that user.

The headless client uses the **user-scoped token**:

```text
config: server.url, user.name, user.password
        |
POST {url}/api/v1/companion/auth/login { name, password }
        |  -> { token, expiresInMs (12 h), user: { id, name, ... }, productions: [...] }
        v
Socket.IO connect (wss, default namespace) with auth: { token }
        |
register-user { id: user.id, name: user.name, kind: "user", force, productionId }
        |
   +----+------------------+--------------------------+
   | accepted (ack has no  | { conflict: true,        | { error }
   |  error/conflict)      |   existing: {socketId,   |  -> log `registration-error`,
   |                       |   name} }                |     back off, re-login if it
   v                       v                          |     looks like an auth error
 running            conflict policy (below)           v
```

- Tokens live in server memory for 12 h and vanish on a server restart. A
  failed connect / `register-user` error `Authenticated identity does not
  match registration` triggers a fresh login. The password is therefore
  required in the config; there is no long-lived device token in the
  server today (follow-up in §18).
- No admin API key is stored on the device.
- **Conflict policy** (`registration.conflict`):
  `takeover` (default): wait `registration.takeover_delay_ms` (default
  1500) and retry with `force: true`; the previous session receives
  `session-kicked { reason: "duplicate-login" }`. This is correct for a
  dedicated panel account that must always be online.
  `wait`: retry without `force` every `registration.retry_ms` (default
  5000) until the other session disappears; surfaces show a "conflict"
  state meanwhile.
- If this instance itself receives `session-kicked`, it stops media,
  shows "kicked" on the surfaces and, under `takeover`, retries after
  `registration.kicked_retry_ms` (default 10000) so two panels
  misconfigured with the same account do not flap every second.
- `productionId`: from `user.production` (name or id) if set, otherwise
  `null` (server picks the Default production). `active-production-reset`
  and `available-productions-updated` are honoured by reloading targets;
  the latter also refreshes the user's productions from
  `GET /users/:id/productions`. The web Settings page offers those
  productions as a dropdown and stores the chosen id.

---

## 5. Signalling (Socket.IO)

The client implements the subset of Socket.IO v4 / Engine.IO v4 that the
server uses: WebSocket transport only, default namespace, JSON events,
acknowledgements, ping/pong. Connection URL:
`wss://host:port/socket.io/?EIO=4&transport=websocket`.

Events **sent** by the client (all with ack unless noted):

```text
register-user            { id, name, kind:"user", force, productionId, clientType:"headless" }
                         -> { ok, productionId, productions, targetAudioStates,
                              userAudioSettings }  // settings or null
get-router-rtp-capabilities            -> RtpCapabilities
create-send-transport    null          -> { id, iceParameters, iceCandidates, dtlsParameters,
                                            iceServers, iceTransportPolicy }
create-recv-transport    null          -> same shape
connect-send-transport   { dtlsParameters }        -> {} | { error }
connect-recv-transport   { dtlsParameters }        -> {} | { error }
produce                  { kind:"audio", rtpParameters, appData:{ type:"talk" } } -> { id }
pause-producer           { producerId }             -> {} | { error }
resume-producer          { producerId }             -> {} | { error }
producer-close           { producerId }             -> {}
consume                  { producerId, rtpCapabilities } -> { id, producerId, kind, rtpParameters }
resume-consumer          { consumerId }             -> {} | { error }
close-consumer           { consumerId }             -> {}
request-active-producers (no payload)  -> [ { peerId, speakerUserId, producerId, appData } ]
talk-targets-updated     { reason, targets:[{type,id}] }             (no ack)
ptt-state                { talking, lockActive, target, targets, reason } (no ack)
target-audio-state-snapshot { reason, states:[{targetType,targetId,volume,muted}] } (no ack)
api-talk-command-result / api-target-audio-command-result
                         { commandId, ok, reason, action, targetType, targetId, target,
                           targets, talking, lockActive }              (no ack)
set-active-production    { productionId }           -> {} | { error }
user-audio-settings-update { settings }             -> { ok, settings }
user-logout              (no payload, on clean shutdown)
connection-health        (no payload) -> true
                         v1.5.6+. Emitted every 500 ms while registered.
                         A server that never acks does not raise a warning.
media-network-stats      { roundTripMs, packetLossPercent, packetsLost,
                           packetsReceived, packetsDiscarded }   (every 5 s, no ack)
```

Events **received**:

```text
new-producer        { peerId, speakerUserId, producerId, appData }
                    appData is what the *recipient* should see:
                    { type:"user", id:<speakerUserId>, targetPeer } for direct talk,
                    { type:"conference", id } or { type:"feed", id }
producer-closed     { peerId, speakerUserId, producerId, appData }
consumer-closed     { consumerId }
incoming-talk-state { state: { addressedNow:[{ fromUserId, fromName, targetType, targetId,
                      replyTargetType, replyTargetId, canReply, at }], replyTarget } }
user-list           [ { socketId, userId, feedId, guestId, kind, name } ]   (online peers)
user-targets-updated (no payload; reload targets via REST)
conference-list     [...]  conference-members-updated  available-productions-updated
active-production-reset { productionId }
cut-camera          { productionId, pgm, prv }  (v1.5.4+; older servers send a bool
                    which is treated as PGM). Sent at registration and on every change.
session-kicked      { reason, bySocketId }
api-talk-command    { commandId, action:"press"|"release"|"lock-toggle", targetType, targetId, inputKey }
api-target-audio-command { commandId, action:"volume-up"|"volume-down"|"mute-toggle",
                           targetType, targetId, step }
user-audio-settings-updated { settings }   (admin PUT; same camelCase object as
                           register-user ack `userAudioSettings`)
```

REST (with `Authorization: Bearer <token>` where the server checks it):

```text
POST /api/v1/companion/auth/login                      { name, password }
GET  /login/options                                    -> { appVersion, guestLogin, sso }
GET  /users/:id/targets?includeMemberships=1&productionId=<id>
     -> [ { targetType:"user"|"conference"|"feed", targetId, name, canTalk, members[], ... } ]
        in the admin-defined button order (same order as the browser's number keys)
GET  /users/:id/productions                            -> [ { id, name } ]
```

Reconnect: exponential backoff 1 s → 30 s with jitter. On reconnect the
client re-logs-in if the token is rejected, re-registers, and rebuilds the
media state from scratch (§6.6) — the same behaviour as the browser after a
socket loss.

---

## 6. WebRTC transport

### 6.1 Engine

`webrtc` (webrtc-rs) 0.17. Chosen over `str0m` because it ships an ICE
agent with TURN **over UDP**, candidate re-gathering and ICE restart, at
the cost of speaking SDP to it. webrtc-ice 0.17 cannot allocate
TURN-over-TCP or TURNS (`turns:host:443?transport=tcp`) itself — those
URLs are rewritten to a local UDP TURN façade that forwards framed
STUN/ChannelData over TCP or TLS to the real server. str0m remains the
fallback if webrtc-rs proves too heavy on armhf (the transport is behind
a small trait).

### 6.2 Mapping mediasoup signalling to SDP

mediasoup is **ICE-lite** and signals ORTC-style parameters, not SDP.
`rtc::remote_sdp` reproduces what `mediasoup-client`'s `RemoteSdp` does:

- **Send transport**: create `RTCPeerConnection` (Opus-only
  `MediaEngine`, header extensions registered from router capabilities),
  add the local audio track, `create_offer()`, extract `rtpParameters`
  from the local SDP (`rtc::ortc`: `mid`, `ssrc`, `cname`, Opus PT,
  header-extension ids, `rtcp.mux/reducedSize`), then synthesise the
  **answer**: `a=ice-lite`, `a=ice-ufrag/pwd` from `iceParameters`,
  `a=candidate` lines from `iceCandidates` (udp and tcp), `a=fingerprint`
  from `dtlsParameters.fingerprints` (sha-256 preferred), `a=setup:passive`
  (client is DTLS client), `a=rtcp-mux`, `a=rtcp-rsize`, `a=recvonly`,
  same PT/extension ids as the offer. `connect-send-transport` is sent with
  `dtlsParameters: { role: "client", fingerprints: [local] }` when the
  first offer is created (`produce` follows once the ack arrives).
- **Receive transport**: the remote is the offerer. For each `consume`
  ack, `remote_sdp` adds an `m=audio` section (`a=mid`, `a=sendonly`,
  `a=ssrc`/`cname` from `rtpParameters.encodings`/`rtcp`, PT/extensions
  from `rtpParameters`) and applies it via `set_remote_description(offer)`
  → `create_answer()` → `set_local_description()`. Closed consumers become
  `port 0`/inactive sections so mids stay stable.
- `rtpCapabilities` sent in `consume` are the router capabilities filtered
  to Opus and the extensions webrtc-rs registered.

### 6.3 ICE configuration

`iceServers` and `iceTransportPolicy` from the `create-*-transport` ack
are passed through to `RTCConfiguration` (`relay` → `RTCIceTransportPolicy::Relay`).
Optional overrides in config (`ice.servers`, `ice.transport_policy`) exist
for testing only; by default the client uses whatever the server hands to
browsers.

webrtc-rs requires **literal IP addresses** in `a=candidate` lines.
Hostname announced addresses (common when the Talktome media network is
configured with a DNS name) are resolved to A/AAAA records before the
remote SDP is applied. Bracketed IPv6 literals are unwrapped.

`turns:` and `turn:?transport=tcp` URLs are not spoken natively by
webrtc-ice 0.17. The client binds `127.0.0.1:<ephemeral>` and presents
`turn:127.0.0.1:…?transport=udp` to webrtc-rs, bridging each ICE
agent's UDP socket onto its own TCP or TLS connection to the real TURN
server. TURNS uses the same CA store as the Talktome HTTPS client
(`tls.ca_file` / system roots, or `tls.insecure`); the Talktome leaf
fingerprint is not applied to the TURN host.

Local ICE gathering is IPv4-only unless `ice.ipv6` is true. IPv6
link-local addresses cannot be bound by webrtc-ice (EINVAL) and IPv6
STUN lookup fails when the only IPv6 addresses on the box are
link-local.

### 6.4 Producer

One "warm" Opus producer with `appData: { type: "talk" }`, created paused
right after the send transport connects (like `ensureWarmTalkProducer` in
the browser). Talking = `resume-producer`; silence = `pause-producer`. The
producer is also paused locally (no RTP written) so no audio leaks while
the server-side pause is in flight.

### 6.5 Consumers

`new-producer` (and the initial `request-active-producers` list) →
`consume` → `resume-consumer`. Each consumer is a `TrackRemote`; RTP is
read, depacketized and handed to `audio::jitter` keyed by the recipient
appData (`user:<speakerUserId>`, `conference:<id>`, `feed:<id>`), which is
also the key for volume/mute (§9.3). Conference consumers additionally
carry the speaker user id so the local mix can hear/mute and level each
member independently (same idea as the browser conference-members modal).
`producer-closed`/`consumer-closed`
tear the consumer down. `request-active-producers` is re-sent after every
`incoming-talk-state` with a non-empty `addressedNow` and every
`user-targets-updated`, as the browser does.

### 6.6 Recovery on network change

Trigger: ICE connection state `failed`, or `disconnected` for longer than
`network.ice_disconnect_grace_ms` (default 4000), on either peer
connection; or Socket.IO disconnect. Action: close both peer connections
(the server closes its transports on socket disconnect or on the next
transport creation), then `create-send-transport` … `produce` … and
re-consume everything from `request-active-producers`. Talk state is
preserved: if a key is still held or locked when recovery completes, the
new producer is resumed and `talk-targets-updated` re-sent. Typical
recovery time on LTE→Wi-Fi is one ICE gathering + DTLS round trip.

While registered the client also emits `connection-health` every 500 ms
(v1.5.6). After the server has answered `true` once, two seconds without a
fresh ack sets `server_not_responding` and the status line
`Server not responding`. A pre-1.5.6 server never acks, so that warning
stays off. The playback device plays the web client's disconnect tone once
when the socket drops, the heartbeat is lost, or a transport enters
`disconnected` or `failed`, and the reconnect tone once when the socket is
up, the heartbeat is healthy, and neither transport is `disconnected`,
`failed` or `connecting`. Shutdown and `session-kicked` stay silent.
`audio.play_connection_sounds` (default true) turns both tones off. A
`user-audio-settings-updated` object with `playConnectionSounds` overrides
that for the running session and stops a tone that is already playing.

`register-user` sends `clientType: "headless"`. v1.5.9 only displays
`ios-app` and `android-app`; any other value is ignored and the admin
status falls back to the WebSocket `User-Agent` (`talktome-headless/<version>`,
which that server describes as a generic browser).

### 6.7 Interop notes (from the spike, §15 step 1)

Verified end to end against the repo's server (`node server.js`, mediasoup
3.x) with `talktome-headless dev send-tone` on one user and `dev record` on
another: a 440 Hz tone produced by the Rust client was received, decoded and
written to WAV by the second instance (289 packets for a 6 s tone; the first
~200 ms are lost while ICE/DTLS complete, as in a browser).

- Engine: `webrtc` crate **0.17.x** (pion-derived API). The 0.20+ line is a
  new sans-IO rewrite with a different API; it is the future migration
  target but was not used.
- Opus payload type: taken from the router's `preferredPayloadType`
  (100 on this server) and registered as webrtc-rs' codec PT, so no PT
  mapping is needed for produce or consume.
- Header extensions: webrtc-rs assigns its own ids in the send offer
  (`sdes:mid`, `ssrc-audio-level`, `abs-send-time`, `transport-cc`); the
  `produce` parameters use those local ids. For consumers the router's
  preferred ids (`mid`=1, `abs-send-time`=4, `ssrc-audio-level`=6 here) are
  echoed into our remote offer and adopted by webrtc-rs as answerer.
- DTLS roles: send transport = local offer `actpass`, synthesized answer
  `passive`, `connect-send-transport { role: "client" }`. Receive transport
  = synthesized offer `actpass`; **webrtc-rs must be forced to answer as
  DTLS client** (`SettingEngine::set_answering_dtls_role(Client)`) because
  it otherwise answers an `a=ice-lite` offer with `setup:passive` while we
  tell mediasoup we are the client — both sides then wait for a ClientHello.
- ICE: webrtc-rs discards STUN responses whose source address differs from
  the signalled candidate. The server's announced address therefore has to
  be the address it actually replies from (the README's LAN-IP rule); a
  server announcing `127.0.0.1` while bound on another interface never
  connects.
- Renegotiation on the receive transport (new remote offer per consumer,
  answer, `connect-recv-transport` once) works; `on_track` fires with the
  consumer's SSRC.
- Stats: webrtc-rs leaves the ICE candidate-pair RTT at 0 and has no
  `packetsLost` on inbound RTP. `remote-inbound-rtp` (from mediasoup's
  Receiver Reports) carries loss and an RTT that is already in
  milliseconds, but only once the producer has sent RTP, i.e. while
  talking. The client therefore reports that RTT while it is fresh (10 s),
  otherwise the smoothed `connection-health` round trip, and counts
  receive loss from consumer RTP sequence gaps.

---

## 7. Audio pipeline

- **Devices**: `cpal` on ALSA; `audio.input_device` / `audio.output_device`
  are ALSA names as listed by `talktome-headless list-audio-devices`
  (e.g. `plughw:CARD=Headset,DEV=0`). A Pi's headphone jack has no input;
  a USB headset or USB audio interface is expected.
  `audio.device_period_ms` (default 10, `0` = driver default) is requested
  as the ALSA period; cpal then uses a two-period device buffer. A size the
  card rejects is opened again with the driver default and logged as
  `audio-period-rejected`. Native ALSA defaults are often 512–2048 frames
  (about 21–85 ms per period), which is most of the gap versus a Mac browser.
- **Capture**: mono, device rate → `rubato` → 48 kHz, then either
  sonora APM (when `audio.auto_processing` / server
  `audioAutoProcessing` is on) or manual `audio.input_gain_db`
  (same range as `userInputGainDb`, −30…40 dB). RMS level for VOX and
  meters is taken after that. Encoded frames wait in a queue of four; a
  fuller queue would play audio that is already late.
- **Encode**: libopus 48 kHz mono, `application = voip`, complexity 5
  (so a quad Cortex-A7 can finish a 5 ms frame). Frame size
  `audio.profile` = `ultra-low` (5 ms, no FEC, 48 kbit/s) by default,
  matching `QUALITY_PROFILES` in `public/client.js`. `low` (10 ms, no FEC,
  64 kbit/s) and `standard` (20 ms, FEC, 64 kbit/s) are the stable choices.
  The offer keeps `minptime=10` (router and browser) and sets `ptime` to
  the frame size. Frames go straight to a `TrackLocalStaticSample`.
- **Decode**: per consumer, RTP → Opus decode with PLC/FEC → jitter buffer
  → mixer. The playout target is the spread of packet arrival delays over
  the last 10 s plus one frame, between `audio.jitter_min_ms` (20) and
  `audio.jitter_max_ms` (400); for its first 10 s a stream does not go
  below `audio.jitter_start_ms` (20). `audio.network = "mobile"` fills
  start/min/max with 150/60/600 ms and `profile = "standard"` where the
  file leaves them out. So a link that stalls and then bursts
  (mobile networks) keeps the burst instead of losing it. A late packet is
  bridged with up to five frames of Opus concealment (25 ms at the web
  client's 5 ms frames, 100 ms at 20 ms) before the stream goes quiet and
  re-primes. Excess depth is shed gradually: quiet 2.5 ms
  stretches first, otherwise one sample in 100 (one in 25 when far too
  deep). Only a depth beyond the maximum plus four frames is cut, with a
  5 ms crossfade.
- **Mixer**: `out = Σ source_i × volume_i × (muted_i ? 0 : 1) × dim_i`,
  soft-clipped. `dim_i` implements `dimFeedsWhileSpeaking` (feeds dimmed by
  `audio.dim_db`, default −15 dB, while the user talks) and
  `dimWhenAddressed` (feeds dimmed while `addressedNow` is non-empty).
  Live `user-audio-settings-updated` can change those dim knobs.
- **Playback**: 48 kHz → device rate, stereo or mono as the device offers
  (mono mix duplicated). A copy of the 48 kHz mix is analysed by AEC as
  the far-end; playback itself is not delayed.
- **VOX** (`vox.enabled`, `vox.target`, `vox.threshold_db`,
  `vox.hang_ms`): a level trigger that acts like holding a key for the
  configured target; mirrors `voiceTriggerEnabled/Target/ThresholdDb`.
- **Hot-plug**: a buffer underrun or overrun (`cpal::ErrorKind::Xrun`, log
  event `audio-xrun`) is left to cpal, which prepares the same stream and
  continues. Any other stream error, or a device that disappears, drops
  that direction and retries every `audio.reopen_ms` (default 2000);
  surfaces show "no audio device". A stream whose callback has not run
  for 2 s is treated as hung (`audio-stream-stalled`), closed and reopened
  at once; ALSA can keep a stream RUNNING without calling back or
  reporting an error.
- **Health log**: every 5 minutes `audio-health` logs, per direction, the
  device, callback count and peak (dBFS), plus mixer sources, sources with
  a packet in the last 500 ms, packets delivered to a stream and packets
  for an unknown consumer in that interval.
- **Processing** (`audio.auto_processing`, default off; same boolean as
  browser `audioAutoProcessing`): in-process sonora (WebRTC M145 APM) at
  10 ms / 48 kHz — high-pass, Wiener NS, AGC2, and AEC3 when **both**
  capture and playback are real devices (not `tone` / `wav:`). Manual
  `input_gain_db` is ignored while this is on. `audio.stream_delay_ms`
  overrides the estimated AEC delay (capture period + playback period,
  clamped 0–500 ms). Register ack `userAudioSettings` and the
  `user-audio-settings-updated` event apply the admin toggle live.

---

## 8. Talk model

Targets come from `GET /users/:id/targets?includeMemberships=1` in the
admin-defined order; online state per target from `user-list`. A target is
one of `user:<id>`, `conference:<id>`, `feed:<id>` (feeds are listen-only,
`canTalk: false`), plus the virtual **reply** target.

- **Hold** a talk key → `talk-targets-updated { targets: [t] }` then
  `resume-producer`; release → `pause-producer` then
  `talk-targets-updated { targets: [] }` (unless other keys are still held
  or locked, in which case the target list is re-sent without it).
  Multiple simultaneously held keys talk to the union of their targets.
- **Tap** (press and release within `talk.tap_ms`, default 250 ms) → toggle
  a **talk lock** on that target. Locks keep the producer resumed. If
  `talk.lock_multiple` is false (mirrors `lockMultipleTargets`), locking a
  new target clears the previous lock. Any press-and-hold while locks are
  active adds to the target list; release restores the locked set. A
  dedicated "clear locks" action exists for GPIO and the **CLEAR** key in
  the deck's status menu.
- **Reply** → talks to `incoming-talk-state.state.replyTarget` (falls back
  to the most recent `addressedNow` entry) unless `talk.main_target` pins
  Reply / Main to a user or conference (`user:4`, `conference:1`; env
  `TALKTOME_TALK_MAIN_TARGET`). Empty pin = dynamic last incoming, matching
  the web client Main button. A pin that is not in this user's assigned
  destinations is unavailable and does **not** fall back to another target.
  Remote Control, Stream Deck Reply, GPIO `reply`, and the local socket
  `reply` command all share that resolution. No target → no-op with an
  error flash.
- `ptt-state { talking, lockActive, target, targets, reason }` is emitted on
  every change, mirroring the browser, so Companion/Admin see the panel's
  state.
- Local guards: no talking while not registered or while the send
  transport is not connected (key turns amber, press is queued until the
  producer exists or dropped after 2 s).

---

## 9. Per-target audio state, tally and Companion

### 9.1 Volume and mute

Per target key `user:<id>` / `conference:<id>` / `feed:<id>`:
`volume` 0.0–1.0 internally (0 dB = unity, −60 dB = mute), `muted` bool.
Surfaces and Settings show and step levels in **dB**
(`audio.default_volume_db`, `streamdeck.volume_step_db`, default 3 dB).
Applied in the mixer. Changes come from the deck (§10), GPIO (§11), the
web UI, and Companion (§9.4). The browser
keeps this state client-local and only *reports* it; the headless client
does the same: state is persisted in
`$STATE_DIRECTORY/audio-state.json` (`/var/lib/talktome-headless/<instance>/`)
and reported with `target-audio-state-snapshot` after registration and on
every change (debounced 200 ms) so Companion feedback shows the panel's
levels.

### 9.2 Camera tally

From v1.5.4 the server scopes tally to the peer's production and has two
buses: **PGM** (program / on air) and **PRV** (preview). `POST /cut-camera`
takes `{ user, bus: "pgm"|"prv", productionId? }`; omitting `bus` keeps
PGM. Each registered operator socket receives
`cut-camera { productionId, pgm, prv }` at registration and whenever either
bus changes. A legacy boolean payload is still accepted as PGM only.

The client mirrors PGM to GPIO `tally` and the deck status key ("ON AIR",
red). PRV drives GPIO `tally_preview` (optional) and the status key
("PREVIEW", green). When both buses are set, PGM wins on the status key
(same as the web client); both GPIO lines can be on together.
`POST /cut-camera` is unauthenticated on the server; that is pre-existing
and out of scope.

### 9.3 Indicators

Derived states available to all surfaces: `connected` (registered and both
transports connected), `talking`, `locked` (per target), `incoming` (per
target, from `addressedNow`), `online` (per target, from `user-list`),
`muted`/`volume` (per target), `on_air` (PGM), `preview` (PRV),
`conflict`/`kicked`/`no_audio`. The status page also shows the Talktome
server version from `GET /login/options`.

### 9.4 Companion commands

`api-talk-command` `press` / `release` / `lock-toggle` and
`api-target-audio-command` `volume-up` / `volume-down` (step default 0.1) /
`mute-toggle` are executed exactly like a local key, with `targetType`
`user|conference|feed|reply` and `inputKey` treated as an independent
virtual key so a Companion press does not cancel a physically held key.
Every command is answered with the matching `-result` event carrying the
`commandId`, `ok`, and `reason` (`target-not-available`,
`unsupported-action`, `not-connected`).

---

## 10. Stream Deck surface

- **Library**: `elgato-streamdeck` (hidapi). Supported: Original, Original
  V2, MK.2, Mini, Mini MK.2, XL, XL V2, Stream Deck +, Stream Deck + XL,
  Neo, Pedal. Each device is opened by **serial**. One instance can drive
  several decks via `[[streamdeck.devices]]` (mixed models). If that list is
  empty, `streamdeck.serial` selects a single deck (`null` = first unused).
  Separate systemd instances on one machine must not share a serial.
- **udev**: `deploy/udev/60-talktome-streamdeck.rules` grants group
  `plugdev` read/write on Elgato HID devices (vendor `0fd9`); the service
  user is in `plugdev`.
- **Rendering**: `image` + `ab_glyph`; font from `streamdeck.font_path`
  (default `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`, package
  dependency `fonts-dejavu-core`). Keys use the web client's colours. Intercom keys (targets, members,
  Reply) are filled cards: dark grey idle, purple (`#8b5cf6`) while talking,
  darker purple with a lock badge when locked, green (`#22c55e`) blinking
  while that target addresses us and steady while we only hear it (purple /
  green blink when both), a dimmed card when the target is offline, a red
  tint plus a mute badge when muted. Function keys (status, VOL, MEMBERS,
  NEXT, MUTE, − / +) are hollow: page-dark with a light outline, blue while
  active, cyan inside the menu. A volume bar appears on feeds and in the
  volume layer, not on talk keys or on decks with dials.
  Brightness from `streamdeck.brightness` (default 60).
- **Layout** (auto from the production target order on visual decks; Pedal
  left/middle overridable in `streamdeck.layout` / `pedal_left` /
  `pedal_target`):
  - The **top row** is the command row: status (connection, user name,
    production, "ON AIR" / "PREVIEW" when tally is on) at the left, **VOL** next to it,
    a **NEXT** key immediately left of Reply when paging is needed, and
    **Reply** at the far right. Reply names the conference it talks to
    (same as the web client), with the last caller underneath. The Mini
    (3 columns) shows status, **NEXT** and Reply; its **VOLUME** is a menu
    entry (root menu, first entry; a long press opens the member layer). With the server connection
    lost, the status key shows the device's local IP.
    While the microphone is live (any key, a GPIO input, VOX, a talk lock
    or the remote panel), Reply turns red and reads **MIC ON** with the
    target being talked to, or "N targets". The status subtitle is the
    production **name** (resolved from `user.production` or the server's
    active production, never the raw id). Tap status: menu (see below).
    Hold status 2 s: next key page.
  - **Menu** (tap status): the deck switches to a page of its own. The
    command row holds only status and **NEXT** when a page does not fit;
    every other key is blank. Status reads **MENU / close** on the root and
    **PRODUCTION / back** or **INFO / back** on a sub-page; a tap goes up one
    level. The root lists three entries (four on the Mini, with VOLUME first) on the target keys (starting on the
    row under the command row, left to right: **CHANGE PRODUCTION**,
    **CLEAR / locks**, **INFO**); the Mini pages its four entries with NEXT. They use the status key's menu colour; CHANGE PRODUCTION and INFO
    open another screen.
    - **CHANGE PRODUCTION** opens the production page. It lists the user's
      productions (`GET /users/:id/productions`, refreshed after
      `available-productions-updated`) in server order; the active one is
      highlighted and labelled "current". Tap a production to switch: talk
      stops, the client sends `set-active-production`, reloads its targets
      and saves the choice as `user.production` in the configuration file
      (kept across restarts; offline the choice is saved and used on the
      next registration). Any production tap closes the menu.
    - **CLEAR / locks** clears all talk locks; dimmed when none are active.
    - **INFO** opens a read-only page: round trip, packet loss, server host,
      client / server version and local IP (the source address of the route
      to the server, looked up when the page opens). RTT ≥ 250 ms and loss
      ≥ 2 % use the warning colour.
    The menu closes by itself after `streamdeck.volume_layer_timeout_s`.
    Dials do nothing while it is open. Without productions (server
    multi-production off) the production page shows "No productions".
  - Remaining keys: targets in **left-to-right, top-to-bottom** order like
    the web client. Targets start on the row right under the command row;
    with fewer targets than keys the empty keys stay at the bottom. Feeds show
    name + volume; press toggles mute. Pressing a listen-only conference
    shows **LISTEN ONLY** on that key instead.
  - **Volume layer**: **VOL** toggles it. The command row becomes **VOL,
    MUTE, −, +** from the left (status is hidden). Target keys never move.
    On the Mini the row is **−, +, NEXT**; the layer closes on its timeout
    or when the selected target (or member) is tapped again. Tap a target to
    select it; `streamdeck.volume_step_db` (default 3 dB; legacy
    `volume_step` 0–1 values become 3 dB); hold a target 600 ms toggles
    mute. With more targets than keys the layer keeps a **NEXT** key: where
    the controls cover the idle NEXT cell, Reply gives way (MK.2, Original),
    or MUTE on 4-column decks (Neo, Plus); the member layer does the same.
    The Mini keeps NEXT in its third cell.
    The layer times out after `streamdeck.volume_layer_timeout_s` (8 s);
    paging restarts the timer.
  - **Conference members**: a shared **member layer** lists the people in a
    conference on the target keys (name, hear/mute, per-member volume). It is
    exclusive with the volume layer and uses the same timeout. Tap a member
    to select them for MUTE / − / +; hold 600 ms to hear/mute. **NEXT** (and
    Neo touch points) page members while the layer is open.
    - **MK.2 / Original / XL / Plus XL**: a **MEMBERS** key occupies the first
      free command-row cell (after Status, VOL, paging, Reply). Tap to enter
      or leave the layer.
    - **Neo / Plus**: no spare command key. **Hold VOL 600 ms** to open
      the member layer; a short tap still opens volume. On the **Mini** the
      same holds for the **VOLUME** menu entry.
    - **Stream Deck + / + XL**: **hold a conference dial 1 s** to open that
      conference's member layer (a short press still mutes). In the member
      layer, dials mix the visible members; a short press mutes that member,
      and **holding any dial 1 s leaves the layer**. A release between
      600 ms and 1 s does nothing, on both kinds of dial.
  - **Stream Deck +**: four dials line up with the four keys of the bottom
    row; dial *n* is the same target as that key (current key page). Rotate
    = volume, press = mute. No separate dial paging. Strip swipe pages keys.
  - **Stream Deck + XL**: six dials are paged independently of the keys
    (swipe the touch strip; there is no DIALS key) so every target can
    be mixed.
  - **Strip page arrows** (+ and + XL): a small arrow at the right edge of
    the strip when a next page exists, at the left edge when a previous one
    does, for whatever the swipe pages (keys on the +, dials on the + XL).
  - **Strip segments** follow their key: a muted target or member stays
    grey even while audio arrives (red bar, MUTED), an offline one greys
    out with a grey bar; tapping a segment toggles that dial's mute. The
    web UI labels each dial with its current target.
  - **Neo** touch points act as previous/next **key** page.
  - **Pedal**: three foot switches. Right is always **Reply** and cannot be
    remapped. Left and middle are pinned with `streamdeck.layout` (JSON
    object, also the Settings "Pedal layout overrides" field) or the
    dedicated strings `pedal_left` / `pedal_target`:
    - Values are `user:<id>`, `conference:<id>` (alias `conf:<id>`), or
      `feed:<id>` — the same ids as GPIO / VOX.
    - `"0"` is the left switch, `"1"` the middle. Layout JSON wins over the
      dedicated fields when both are set. A missing or unparsable layout
      value falls back to `pedal_left` / `pedal_target`; with neither, the
      switch stays empty.
    - Extra indexes (`"2"`, `"5"`, …) are stored but ignored. Visual decks
      (MK.2, XL, Neo, Plus, Mini, …) never apply this map: their keys stay
      in automatic target order.
    - Typical use: keep a camera pedal on one IFB/conference when the web
      client reorders cards, or put two destinations on left and middle.
    The web view still renders key images for the three switches.
    Per-device maps live on `streamdeck.devices[].layout`.
  - **Several devices**: `[[streamdeck.devices]]` (serial and/or mock per
    deck). An empty list uses the top-level `serial` / `mock` fields as a
    single deck. Multiple instances on one machine can still each bind one
    serial instead.
- The surface runs in its own task; rendering is diffed so only changed
  keys are re-sent (key images are JPEG/BMP per model, generated by the
  library).

---

## 11. GPIO surface

- **Library**: `gpiocdev` (Linux GPIO character device v2). Lines are
  addressed by **line name** (e.g. `GPIO17`, robust across Pi 4/5 where the
  chip number differs) or `chip` + `offset`. On Raspberry Pi OS the service
  user is added to group `gpio` (which owns `/dev/gpiochip*`); that group is
  not created on other Debian images, and the unit must not require it.
- **Outputs** (`gpio.outputs`): `tally` (PGM / on air), `tally_preview`
  (PRV), `talking`,
  `incoming`, `connected` (only while registered **and** both media
  transports are up), `locked`, `status`; each with `active_low`.
- **Status light** (`gpio.outputs.status`): a pattern instead of a level,
  re-evaluated every 50 ms (the timer only runs when the output is
  configured):
  - not registered (Disconnected, Connecting, LoggingIn, Registering,
    Conflict, Kicked): a 100 ms flash followed by 2 s dark (2.1 s cycle),
    so it does not read as the 1 s / 1 s blink below;
  - registered but not healthy (state Registered, or Ready with audio
    devices not open, server heartbeat missing, or media status
    "Media interrupted" / "Media failed"): 1 s on, 1 s off;
  - Ready with audio OK: steady on.
  The line is released (inactive) on shutdown, so a dark LED means the
  client is not running.
- **Target outputs** (`gpio.target_outputs`): a list of
  `{ line, target, when, active_low }`. `when` is `receiving` (audio is
  currently playing from that user/conference/feed) or `incoming` (that
  target is addressing us). Add or remove rows in Settings.
- **Inputs** (`gpio.inputs`): a list of `{ line, action, target, active_low,
  debounce_ms }` with actions `talk` (hold = talk, tap = lock, same rules as
  a deck key), `reply`, `lock_toggle`, `clear_locks`, `mute_toggle`,
  `volume_up`, `volume_down`. After the lines are requested, the **current
  level** is sampled so an already-held (typically inverted) button starts
  talking immediately instead of waiting for the next edge. Edge events are
  debounced in software (one window for all inputs: the largest `debounce_ms`, default 20) in addition to the
  kernel debounce where available. Talk/lock to an offline **user** is
  ignored.
- GPIO-only instances (the two-instances-per-Pi case) simply omit the
  `streamdeck` section; two instances must not share lines. Several
  instances may use different lines of the same chip (e.g. one for inputs,
  one for outputs): every output and every input is a separate line request
  with consumer `talktome-headless@<instance>`. A line that cannot be
  requested (typically "already used by talktome-headless@<other>", read
  from the kernel's line info) is marked on that output/input in the status
  view and summarised in the GPIO error; the remaining lines keep working.
- A mock GPIO backend (env `TALKTOME_MOCK_GPIO=1`) writes line states to
  `<dir>/gpio-outputs.json` and polls `<line> press|release` lines appended
  to `<dir>/gpio-inputs`, where `<dir>` is `TALKTOME_SURFACE_MOCK_DIR`
  (default: the temporary directory).

---

## 11.1 Local control socket

A thin JSON-lines view of the same command bus and snapshot watch that the
Stream Deck, GPIO and web Remote Control tab use. Intended for a custom
OLED, volume rotary encoders, or an MCU on the same machine — not for
remote/Companion HTTP (that still goes through the Talktome server).

- **Transport**: Unix socket, mode `0660`. Default path is
  `$RUNTIME_DIRECTORY/control.sock` (`/run/talktome-headless/<instance>/control.sock`
  with the packaged unit). Without systemd:
  `/tmp/talktome-headless-<instance>-control.sock`. Override with
  `socket.path`. Optional `socket.tcp` binds **loopback only**
  (`127.0.0.1`, `::1`, `localhost`); other addresses fail validation.
  Disable with `socket.enabled = false`. Env: `TALKTOME_SOCKET_ENABLED`,
  `TALKTOME_SOCKET_PATH`, `TALKTOME_SOCKET_TCP`.
- **Framing**: one UTF-8 JSON object per line, max 64 KiB. Protocol version
  advertised in `hello` (`protocol: 1`). Several clients may connect; each
  gets its own `hello` + current `snapshot` and then push updates.
- **Snapshot**: string target keys (`user:1`, `conference:2`, `feed:3`),
  `kind`, talk flags (`held`, `locked`, `incoming`, `receiving`, `muted`,
  `can_talk`, `online`), linear `volume` and `volume_db`, conference
  `members` with the same fields, `reply` (effective Main / Reply
  destination), `main_target`, `main_unavailable`, PGM/PRV (`on_air` /
  `preview`), connection, `server_not_responding`, `heartbeat`,
  `media_status`, instance, user.
- **Commands**: `press` / `release` / `lock` / `clear-locks` / `reply` /
  `mute` / `volume` (0–1) / `volume-db` / `volume-step` (`delta_db`,
  default `streamdeck.volume_step_db`) / `member-mute` /
  `member-volume` / `member-volume-db` / `member-volume-step` / `ping` /
  `get`. Talk is attributed as `InputSource::Companion("socket:<client>")`
  so it does not release a Stream Deck or GPIO hold on the same target.
  An `ack` is only sent for commands that carry an `id`, which it echoes
  (as does `pong`). Unknown ops and bad targets
  return `{ "op": "error", "error": "…" }`.
- **Example**: `examples/socket_panel.py` (packaged under
  `/usr/share/talktome-headless/examples/`) paints a text display from
  snapshots and maps `+`/`−` to `volume-step` for a rotary.

---

## 12. Configuration

One schema, loaded from `/etc/talktome-headless/<instance>.json` **or**
`<instance>.toml` (format by extension; `--config <path>` overrides the
location). Environment variables `TALKTOME_<SECTION>_<KEY>` override single
values (e.g. `TALKTOME_USER_PASSWORD`), which is also how the systemd
`EnvironmentFile` can supply the password separately from the config file.

```jsonc
{
  "instance": "cam1",                       // defaults to the file name
  "server": { "url": "https://talktome.local:8443" },
  "tls": {                                  // one of:
    "ca_file": "/etc/talktome-headless/server-ca.pem",   // custom CA
    "fingerprint_sha256": "AB:CD:...",                    // or pin the leaf cert
    "insecure": false                                     // or accept anything (dev only)
  },
  "user": { "name": "Cam 1", "password": "…", "production": null },
  "registration": { "conflict": "takeover", "takeover_delay_ms": 1500,
                    "retry_ms": 5000, "kicked_retry_ms": 10000 },
  "audio": { "input_device": "plughw:CARD=Headset,DEV=0",
             "output_device": "plughw:CARD=Headset,DEV=0",
             "profile": "ultra-low", "device_period_ms": 10, "input_gain_db": 0,
             "auto_processing": false,
             "dim_db": -15, "dim_feeds_while_speaking": false,
             "dim_when_addressed": true,
             "play_connection_sounds": true, "stream_delay_ms": null,
             "network": "lan", "jitter_start_ms": 20,
             "jitter_min_ms": 20, "jitter_max_ms": 400, "reopen_ms": 2000,
             "default_volume": 0.9, "default_volume_db": null },
  "vox": { "enabled": false, "target": "conference:1", "threshold_db": -32, "hang_ms": 600 },
  "talk": { "tap_ms": 250, "lock_multiple": false, "main_target": null },
  "ice": { "servers": null, "transport_policy": null, "ipv6": false },   // null = use the server's
  "network": { "ice_disconnect_grace_ms": 4000 },
  "streamdeck": { "enabled": true, "serial": null, "mock": null, "brightness": 60,
                  "font_path": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                  "volume_step_db": 3, "volume_layer_timeout_s": 8,
                  "pedal_left": null, "pedal_target": "conference:1",
                  "layout": { "0": "user:4", "1": "conference:1" },
                  "devices": [] },
  "gpio": { "enabled": true, "chip": null,
            "outputs": { "tally": { "line": "GPIO17", "active_low": false },
                         "tally_preview": { "line": "GPIO24" },
                         "talking": { "line": "GPIO27" } },
            "inputs": [ { "line": "GPIO22", "action": "talk", "target": "conference:1",
                          "active_low": true, "debounce_ms": 20 },
                        { "line": "GPIO23", "action": "reply", "active_low": true } ],
            "target_outputs": [ { "line": "GPIO18", "target": "conference:1", "when": "receiving" } ] },
  "socket": { "enabled": true, "path": null, "tcp": null },  // Unix JSONL; tcp is loopback-only
  "web": { "enabled": true, "bind": "0.0.0.0", "port": 8080, "password": "admin" },
  "health": { "port": null, "bind": "127.0.0.1" },  // optional /healthz listener
  "log": { "level": "info", "format": "auto" }, // auto = JSON unless stderr is a terminal
  "state_dir": null                          // default: $STATE_DIRECTORY or /var/lib/talktome-headless/<instance>
}
```

`talktome-headless check-config` validates a file and prints the
effective configuration with the password redacted.
`list-audio-devices`, `list-streamdecks` and `list-gpio` help with
provisioning; `dev send-tone` and `dev record` test audio with the
configured account.

---

## 13. systemd, health and logging

`deploy/systemd/talktome-headless@.service` (one unit per instance):

```ini
[Unit]
Description=Talktome headless intercom client (%i)
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/bin/talktome-headless --instance %i
EnvironmentFile=-/etc/talktome-headless/%i.env
WatchdogSec=30
Restart=always
RestartSec=2
User=talktome-headless
Group=talktome-headless
StateDirectory=talktome-headless/%i
StateDirectoryMode=0750
RuntimeDirectory=talktome-headless/%i
ReadWritePaths=/etc/talktome-headless
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictRealtime=false
Nice=-5
```

`RuntimeDirectory=` provides the control socket path (§11.1).
`ProtectSystem=strict` remounts `/etc` read-only. The web UI persists the
admin password and settings by writing `/etc/talktome-headless/<instance>.toml.tmp`
and renaming it over the live file, so `ReadWritePaths=/etc/talktome-headless`
is required. `postinst` creates that directory as `0770 root:talktome-headless`
so the service user can create the temp file (group `r-x` / `0750` is not
enough).

The unit does **not** set `SupplementaryGroups=audio plugdev gpio`:
systemd looks those names up at spawn time and exits `216/GROUP`
(`Failed to determine supplementary groups: No such file or directory`)
if any of them is missing — usually `gpio` on Debian/Ubuntu that is not
Raspberry Pi OS. `User=` already applies the groups recorded for
`talktome-headless` in the user database; `postinst` adds that user to
`audio`, `plugdev` and `gpio` only when those groups exist.

- `sd_notify(READY=1)` after the config is loaded and surfaces are open;
  `WATCHDOG=1` from the main loop while signalling and audio tasks are
  alive; `STATUS=` mirrors the connection state for `systemctl status`.
- Optional `GET /healthz` on `health.bind:health.port` (default bind
  `127.0.0.1`, off until a port is set): `200` when registered with both
  transports connected, the audio devices open and the server heartbeat
  answering, else `503` with a JSON body describing the failing component.
- Logging via `tracing`; JSON lines unless stderr is a terminal (`log.format
  = "auto"`), human format on a TTY. Event names include: `client-start`,
  `client-stop`, `login`, `login-failed`, `socket-connected`,
  `socket-disconnected`, `registered`, `registration-conflict`,
  `registration-error`, `session-kicked`, `transports-created`,
  `transport-state`, `ice-state`, `media-recovery`, `producer-created`,
  `consumer-created`, `consumer-track`, `incoming-stream`,
  `consumer-closed`, `targets-loaded`, `production-changed`, `talk-start`,
  `talk-stop`, `incoming`, `tally`, `audio-device-lost`,
  `audio-device-restored`, `audio-stream-stalled`, `audio-health`,
  `streamdeck-connected`,
  `streamdeck-disconnected`, `gpio-input`, `socket-listening`,
  `companion-command`.

### 13.1 Web interface

Each instance serves a local administration UI (`web.bind:web.port`,
default `0.0.0.0:8080`; one port per instance) built with axum and plain
HTML/CSS/JS embedded in the binary. It follows the Talktome Admin panel's
look (dark navy, cards, blue primary) and is laid out for phones first,
because in the field it is opened from a smartphone. The favicon and
header mark are an ASCII-art waveform in a dark terminal window (hashes
and dots, with window chrome), so the panel is not the same icon as Admin
or the black-on-white Bridge. An opaque apple-touch icon is served for
home-screen bookmarks.

- **Login**: the user is always `admin`; the password is `web.password`
  (or `TALKTOME_WEB_PASSWORD`). The default `admin` is accepted once and then
  a password change is enforced (a separate dialog, not the login overlay);
  the new password is written into the configuration file (`web.password`).
  Sessions are in-memory cookies
  (`HttpOnly`, `SameSite=Strict`, 12 h); five failed logins throttle further
  attempts for 30 s.
- **Status**: connection (state, detail, server, user id, production,
  registration age, reconnects, send/receive transport state, consumers,
  producer id, ICE URLs announced by the server and the local webrtc-rs
  façade when TURNS is bridged, RTT and packet loss, receive
  concealment, PGM/PRV tally, Talktome server version), audio devices and
  input level, GPIO backend with every configured output (driven state)
  and input (pressed, event count), local control socket (Unix path,
  optional loopback TCP, client count), Stream Deck model / serial / page, and
  service details (version, uptime, config path, supervisor, ports).
- **Remote Control**: the same destination layout as the browser client
  (`public/index.html`): wrapping target rows with icon, name, volume
  slider and mute / hold-to-talk (slide left to lock), a reply bar, and a
  conference members dialog for per-person hear/mute and level. Talk is
  disabled when that **user** is offline.
- **Stream Deck**: the rendered key images of every attached deck (PNG per
  key, cached by content hash), dials with the currently assigned target,
  and touch points; pressing in the browser injects the same input the
  hardware would produce. Several decks (mixed models) can be shown at once.
- **Settings**: a form over the whole schema (§12), audio devices listed from
  ALSA, GPIO named outputs plus dynamically added per-target outputs,
  target dropdowns for VOX/GPIO/pedal, JSON fields for ICE overrides and
  Pedal layout (`{"0":"user:4","1":"conference:1"}`; visual decks ignore
  extra indexes), and a raw JSON editor. The form edits the **configuration file**,
  not the in-memory process: after Save, values already in the file (the
  Talktome user, devices, …) stay put when another field is changed, even
  though they only apply after restart. Saving validates with the same
  rules as startup and rewrites the file in its own format (TOML or JSON);
  secrets are redacted in the API and kept unless replaced; environment
  overrides in effect are shown because they win on the next start.
- **Restart**: `POST /api/restart` shuts the client down cleanly; under
  systemd the process exits 0 and `Restart=always` starts it again, otherwise
  the binary re-executes itself with the same arguments. `Save & restart`
  chains both.
- The API (`/api/session`, `/api/login`, `/api/logout`, `/api/status`, `/api/config`,
  `/api/config/audio-devices`, `/api/streamdeck`, `/api/streamdeck/key/{n}`,
  `/api/streamdeck/{device}/key/{n}`, `/api/streamdeck/input`, `/api/talk`, `/api/audio`, `/api/password`,
  `/api/restart`) is JSON and can be scripted with the session cookie.
- Transport is plain HTTP: keep the port on the production or management
  network or front it with a TLS reverse proxy.

---

## 14. Packaging and CI/CD

### 14.1 Debian package

`cargo-deb` with `[package.metadata.deb]`: package `talktome-headless`,
section `sound`, depends listed explicitly so cross-built packages need no
`dpkg-shlibdeps` (`libc6 (>= 2.34)`, `libasound2t64 | libasound2`,
`libudev1`, `adduser`, `fonts-dejavu-core`); recommends `alsa-utils`.
Assets: `/usr/bin/talktome-headless`,
`/lib/systemd/system/talktome-headless@.service`,
`/lib/udev/rules.d/60-talktome-streamdeck.rules`,
`/usr/share/talktome-headless/config.example.{json,toml}` and
`/usr/share/talktome-headless/examples/socket_panel.py`.
`postinst` creates system user `talktome-headless` (groups `audio`,
`plugdev`, `gpio` when they exist), creates `/etc/talktome-headless/` as
`0770 root:talktome-headless` so the service can rewrite instance configs,
reloads udev rules; `prerm` stops running instances; `postrm purge`
removes `/etc/talktome-headless` including configs and passwords.

### 14.2 Targets

- `arm64` — Raspberry Pi 3/4/5/Zero 2 W on 64-bit Raspberry Pi OS.
- `armhf` (`armv7-unknown-linux-gnueabihf`) — 32-bit Raspberry Pi OS on
  Pi 2/3/4.
- `amd64` — Debian/Ubuntu PCs for testing.

All packages are built inside a `debian:bookworm` container so the
binaries link against glibc 2.36 and run on Bookworm **and** Trixie. arm64
and armhf are cross-compiled with Debian multiarch toolchains
(`crossbuild-essential-*`, `libasound2-dev:<arch>`, `libudev-dev:<arch>`);
libopus is compiled statically by `opusic-sys` (cmake).

### 14.3 Versioning

Git tags remain the single source of truth (`scripts/resolve-build-version.js`).
`Cargo.toml` keeps `0.0.0`. `build.rs` embeds `TALKTOME_BUILD_VERSION`
(falling back to `git describe`) into `--version`. The Debian version is
derived as: release `1.2.5` → `1.2.5`; development `1.2.5-dev.3` →
`1.2.5~dev.3+g<sha>` (tilde sorts before the release).

### 14.4 Workflows

- `.github/workflows/ci.yml` (Pull Request Checks) has a `headless-client`
  job: `cargo fmt --check`, `cargo clippy --locked -D warnings`,
  `cargo test --locked`.
- `.github/workflows/headless-client-release.yml` (modelled on
  `bridge-client-release.yml`): version job → build matrix
  `amd64 | arm64 | armhf` in `debian:bookworm` → `cargo deb --target …
  --deb-version …` → upload artifacts → install smoke test of the arm64 deb
  on `ubuntu-24.04-arm` in `debian:bookworm` and `debian:trixie` containers
  and of the amd64 deb in `debian:trixie` (`apt-get install ./…deb`, `--version`,
  `check-config` on the example) → on tags, or a manual run with
  `release_version`, upload to the draft release with
  `scripts/upload-release-asset.sh`. Manual runs also accept `source_ref`.

---

## 15. Implementation order

1. **Spike (gate)**: Socket.IO client, login, `register-user`, send
   transport with webrtc-rs, `produce` a test tone; a second instance
   consumes and writes the decoded audio to a WAV file. Run against the
   repo's server (`node server.js`). Record §6.7.
2. `config` (JSON/TOML/env, validation, CLI) and `signalling`
   (reconnect, re-login, conflict policy, `session-kicked`).
3. `rtc`: send/recv transports, `remote_sdp`, `ortc`, consume/resume/close,
   recovery by recreation.
4. `audio`: capture → Opus → track; tracks → decode → jitter → mixer →
   playback; dim; VOX; device recovery.
5. `talk`: targets from REST + `user-list`, hold/lock/reply, `ptt-state`,
   Companion commands and results, per-target audio state persistence and
   snapshot.
6. `surfaces::gpio` (tally first, then inputs, LEDs) with the mock backend.
7. `surfaces::streamdeck` (discovery by serial, layout, rendering, dials,
   touch strip, paging, volume layer) with the PNG mock backend.
8. `health`, systemd unit, udev rule, example configs, README.
8a. `web`: login/password, status, Stream Deck view and input, talk/audio
    control, configuration editor writing back to the file, restart.
9. Packaging (`cargo-deb`, maintainer scripts, version mapping).
10. CI job and release workflow.
11. Two instances on one host: independent users, audio devices and GPIO
    (mock), no cross-talk, independent restart.

---

## 16. Verification

- **Unit**: Socket.IO framing and acks; `remote_sdp` output against
  fixtures taken from `mediasoup-client`; `ortc` extraction from webrtc-rs
  offers; jitter buffer; mixer gain/dim/mute math; layout engine for every
  deck model; config parsing (JSON, TOML, env overrides, validation).
- **Integration (CI-capable)**: start the repo's server; two headless
  instances with mock surfaces register as two users; A talks to B and the
  decoded audio on B is verified (tone detection); Companion-style commands
  via `POST /api/v1/companion/users/:id/talk` and `/target-audio` produce
  the expected `command-result`; `POST /cut-camera` toggles the mock tally
  line; killing A leaves B registered.
  Test hooks built into the client for this: virtual audio devices
  (`audio.input_device = "tone[:hz]"`, `audio.output_device = "wav:<path>"`),
  the file-driven mock surface (`TALKTOME_SURFACE_MOCK_DIR`), the mock GPIO
  backend (`TALKTOME_MOCK_GPIO=1`) and the mock Stream Deck
  (`TALKTOME_MOCK_STREAMDECK=<model>`, renders `deck.png`). The full
  scenario (talk both ways, no cross-talk, Companion commands, tally,
  `SIGKILL` of one instance while the other stays healthy, restart) was run
  against the real server during development.
- **Manual on hardware**: real Stream Deck models, GPIO tally into a camera
  tally input, LTE → Wi-Fi handover with the deployment's TURN server,
  `iceTransportPolicy=relay`, 2 h soak.

## 17. Success criteria

- From the server's point of view the panel is an ordinary user: it shows
  online in Admin, can be targeted by Companion, receives tally, and
  routes exactly like the browser.
- Audio flows both ways over ICE + DTLS-SRTP, including through TURN when
  direct paths are blocked, with no server changes.
- A network change (LTE ↔ Wi-Fi) recovers automatically within seconds
  without operator action.
- Stream Deck keys talk/lock/reply and adjust volume/mute per target; GPIO
  `tally` (PGM) and optional `tally_preview` (PRV) follow production-scoped
  `cut-camera`.
- Two instances on one Pi run independently.
- `.deb` packages for arm64, armhf and amd64 are produced by CI and install
  cleanly on Bookworm and Trixie.

## 18. Follow-ups (not in this release)

- Server: `restart-ice` event (`transport.restartIce()` → new
  `iceParameters`) to avoid full transport recreation on handover.
- Server: long-lived device tokens so the password need not live on the
  device; authentication for `POST /cut-camera`.
- HTTPS for the web interface (currently plain HTTP, meant for the LAN or a
  reverse proxy).
- Bridge: deliver `cut-camera` to bridge sessions
  (`queueBridgeControlEvent` filter).

## 19. Decision log

- Rust, not Node; standalone crate in `headless-client/`.
- Normal-user identity via user-scoped Companion login token; no admin API
  key on the device.
- webrtc-rs with SDP synthesis (TURN built in) over str0m.
- TURN is mandatory whenever the server configures one; devices are mobile.
- Talk keys: hold = talk, tap = lock toggle.
- Registration conflict: configurable, default take over.
- Multi-instance kept (systemd template); Stream Deck bound by serial;
  GPIO-only instances are the two-per-Pi case.
- Config: one schema, JSON or TOML by file extension, env overrides.
- Packages: arm64, armhf, amd64, built on Bookworm.
- Capture APM: sonora 0.2 (pure-Rust WebRTC M145 AEC3/NS/AGC2), not
  `webrtc-audio-processing` (Bookworm's package is pre-AEC3; the Rust
  crate's bundled C++ build does not fit the `.deb` matrix). MSRV 1.91.
- Web interface added after review: fixed `admin` login with forced
  password change, status incl. GPIO, live Stream Deck view, settings saved
  to the TOML/JSON file, restart.
- Local JSON-lines Unix socket for custom OLED / rotary / MCU panels (same
  command bus as Stream Deck and GPIO). Optional loopback TCP for
  development; no Companion HTTP endpoint on the device.
- Dropped from the earlier draft: Companion HTTP trigger endpoint, radio
  TX/RX echo state machine, references to a gateway design document that is
  not in this repository.
