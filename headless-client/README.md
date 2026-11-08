# Talktome Headless Client

`talktome-headless` turns a Raspberry Pi (or any small Linux board) into a
Talktome intercom panel. It logs in as a normal Talktome user over WebRTC,
drives an attached Elgato Stream Deck as the key panel, mirrors PGM/PRV
camera tally and talk state to GPIO lines, and exposes a local JSON-lines
socket so a custom display or volume rotaries can attach. It is written in
Rust and shipped as a Debian package for arm64, armhf and amd64.

The design and protocol details are in [specification.md](specification.md).

## Install

Download the `.deb` for your architecture from the GitHub release and install
it (dependencies such as `libasound2`, `libudev1` and `fonts-dejavu-core` are
pulled in automatically):

```bash
sudo apt install ./talktome-headless_<version>_arm64.deb
```

The package creates the `talktome-headless` system user and adds it to
`audio`, `plugdev` and `gpio` when those groups already exist (Raspberry Pi
OS has all three; Debian/Ubuntu often has no `gpio`). It installs the
systemd template `talktome-headless@.service`, the udev rule for Stream
Decks and example configurations under `/usr/share/talktome-headless/`.

## Configure

One configuration file per instance, JSON or TOML by file extension:

```bash
sudo cp /usr/share/talktome-headless/config.example.toml /etc/talktome-headless/cam1.toml
sudo editor /etc/talktome-headless/cam1.toml
sudo talktome-headless --instance cam1 check-config
```

`/etc/talktome-headless` is `0770 root:talktome-headless`. Copying the example
as root is fine; the service needs group-write on that directory so the web UI
can save the admin password and settings (it writes `<instance>.toml.tmp` then
renames). The packaged unit also sets `ReadWritePaths=/etc/talktome-headless`
because `ProtectSystem=strict` would otherwise make `/etc` read-only
(`saving the password failed: … Read-only file system`).

Minimum content: the server URL, the user's name and password and (for a
self-signed server certificate) `tls.ca_file`, `tls.fingerprint_sha256` or
`tls.insecure = true`. The password can live in
`/etc/talktome-headless/cam1.env` as `TALKTOME_USER_PASSWORD=...` instead of
the configuration file; every `TALKTOME_<SECTION>_<KEY>` variable overrides
the corresponding setting.

Everything else (audio devices, Stream Deck, GPIO lines, local socket, volumes, web port)
can be edited afterwards in the web interface (see below) or in the file.
Helpers for provisioning on the command line:

```bash
talktome-headless list-audio-devices   # ALSA ids for audio.input_device / output_device
talktome-headless list-streamdecks     # attached decks with serial numbers
talktome-headless list-gpio            # GPIO chips and line names (GPIO17, ...)
```

Create the user in Talktome Admin like any other operator and assign its
targets (users, conferences, feeds). The order of the targets in Admin is the
order of the keys on the deck.

## Run

```bash
sudo systemctl enable --now talktome-headless@cam1
journalctl -u talktome-headless@cam1 -f
```

Several instances can run on one device (for example two GPIO-only panels):
create `cam2.toml`, give it its own user, audio devices and GPIO lines, and
start `talktome-headless@cam2`. When more than one Stream Deck is attached,
bind each instance with `streamdeck.serial`.

Every new server connection authenticates again: Companion tokens are held in
server memory and do not survive its restart, even before their advertised
expiry. After a previously successful connection, retry waits grow from 1 to
2 to at most 3 seconds, plus less than 250 ms jitter. Before the first successful
registration they still back off to 30 seconds. HTTP connection establishment
times out after 2 seconds; the full HTTP request may take up to 15 seconds.

With `health.port` set (off by default), `GET http://<health.bind>:<health.port>/healthz`
(`health.bind` defaults to `127.0.0.1`) returns `200` while the client is
registered with both media transports connected, its audio devices are open
and the server heartbeat answers; otherwise `503`.

### Service exits 216/GROUP

`Failed to determine supplementary groups` / `status=216/GROUP` means a
drop-in names a group in `SupplementaryGroups=` that this machine does not
have (usually `gpio`); it happens before the configuration is read. The
packaged unit does not set that option: the package adds the service user
to `audio`, `plugdev` and `gpio` where those groups exist. Remove the
drop-in (or set `SupplementaryGroups=` empty), then `systemctl
daemon-reload`. `getent group audio plugdev gpio` shows which groups exist.

## Web interface

Every instance serves an administration web interface on
`http://<device>:<web.port>/` (default port 8080, `web.bind = "0.0.0.0"`; use
a different port per instance). It is built for phones as much as for
desktops:

- Login is always the user `admin`; the password comes from `web.password` or
  `TALKTOME_WEB_PASSWORD`. The default password `admin` works once and then
  forces a change (that dialog is not the login overlay). The new password is
  written to the configuration file; saving Settings does the same rewrite.
- **Status**: Talktome connection (state, server, user, production, transports,
  consumers, ICE servers, RTT, packet loss, receive concealment, reconnects,
  server heartbeat, PGM/PRV tally), audio devices with an input meter, every configured GPIO
  output (live state) and input (pressed, event count), the local control
  socket (path, optional loopback TCP, connected clients), Stream Deck and service
  details. Disconnect and reconnect tones follow **Play connection sounds**
  (`audio.play_connection_sounds`, default on). An admin `playConnectionSounds`
  update applies immediately and is saved to the configuration file when one
  is in use. Disabling sounds locally and using Save + Restart stays muted;
  an older enabled value from the server cannot re-enable them during login.
  A deliberate live Admin update can turn them on again.
- **Remote Control**: embeds the actual shared `public/index.html`, `client.js`
  and `/panel` UI assets at build time. A local transport adapter uses this
  instance's authenticated API and the same panel-command handler as server
  Admin. The UI therefore stays available without the server and shares its
  rendering, gestures, hotkeys and menus instead of maintaining a second copy.
  Target ordering remains managed in server Admin. It provides destination
  rows with icon, name, volume, mute and hold-to-talk (slide left to lock), a
  reply bar, and conference **Members** for per-person hear/mute and level.
  Talk is disabled when that user is offline. The reply bar follows the last
  incoming call unless Settings **Main / Reply pin** (`talk.main_target`,
  `TALKTOME_TALK_MAIN_TARGET`) pins it to a user or conference, matching the
  web client Main button. A pin that is not in this user’s destinations does
  not fall back to another target.
  Leaving the tab or page releases this browser's held talk inputs without
  releasing an unrelated physical input. Local API requests that time out
  before handling cannot apply later.
- **Stream Deck**: live rendering of the attached deck; keys, dials and touch
  points can be operated from the browser and behave like the hardware.
- **Settings**: every configuration value as a form (audio devices are listed
  from ALSA), plus a raw JSON editor. Saving writes the TOML/JSON file the
  instance was started with and keeps other file values even if the process
  has not restarted yet; secrets are never shown and stay unchanged unless
  replaced. `Save & restart` applies the change immediately.
- **Restart**: under systemd the service exits cleanly and `Restart=always`
  brings it back; without systemd the binary re-executes itself.

The interface is plain HTTP on the local network. Keep it on the production
LAN or a management network, or put a reverse proxy with TLS in front of it.

On a wide screen the Remote Control destinations fill a wrapping grid like the
web client so you do not have to zoom out; Settings sections sit two-across until
one is opened. Phones keep a single column.

## Testing without hardware (VM, CI, a board with no deck)

A USB Stream Deck is often not passed through to a Linux VM. Use a dummy
deck of a chosen type, then operate it from the **Stream Deck** tab (or
write input lines for scripts):

```toml
# /etc/talktome-headless/default.toml
[streamdeck]
enabled = true
mock = "mk2"          # mini, xl, plus, neo, pedal, …
```

Or in `/etc/talktome-headless/default.env` (overrides the file):

```bash
TALKTOME_STREAMDECK_MOCK=mk2
# older name, still works:
# TALKTOME_MOCK_STREAMDECK=mk2
```

Save & restart. The web Stream Deck view renders the keys; taps talk/lock
like hardware. Optional file input: `TALKTOME_SURFACE_MOCK_DIR=/tmp/tt` and
append lines such as `down 3` / `up 3` to `$TALKTOME_SURFACE_MOCK_DIR/streamdeck-inputs`.

With no Talktome server (so no live targets), the Remote Control tab and
mock decks can still show destinations using
`TALKTOME_DEMO_TARGETS=alice,bob,conference:News,feed:PGM` and
`TALKTOME_DEMO_REPLY=News`. Those names are paint-only and disappear as
soon as the client receives real targets.

Without a USB headset, capture a 440 Hz sine instead of a
microphone, and optionally write the mix to a WAV file:

```toml
[audio]
input_device = "tone"                 # or tone:1000 for 1 kHz
output_device = "wav:/tmp/heard.wav"  # skip if Pulse/ALSA playback works
```

`talktome-headless --instance default dev send-tone --target conference:1`
sends that sine to a target for 10 s using the running account.

GPIO lines from the example config (`GPIO17`, …) do not exist in a VM.
Turn GPIO off (`gpio.enabled = false`) or you will see `GPIO line "GPIO27"
not found on any chip`.

The local control socket still works without a Stream Deck or GPIO. Point
`examples/socket_panel.py --socket … --once` at the path shown on the
Status page (Local socket card).

## Audio processing (AEC / NS / AGC)

The browser client asks `getUserMedia` for `echoCancellation`,
`noiseSuppression` and `autoGainControl` — those run in Chrome/Safari, not
on the server. The headless client runs the same algorithm family
**in-process** with [sonora](https://crates.io/crates/sonora) (WebRTC M145
AEC3, Wiener noise suppression, AGC2, high-pass). Turn it on with
`audio.auto_processing = true` or the admin **Audio auto processing**
toggle for this user (`audioAutoProcessing`). While it is on, manual
`audio.input_gain_db` is ignored (AGC sets the level). Echo cancellation
only runs when both capture and playback are real ALSA devices — `tone`
and `wav:` skips AEC. Optional `audio.stream_delay_ms` overrides the
estimated loudspeaker-to-mic delay if residual echo remains.

## Latency

The default codec profile is `ultra-low` (5 ms Opus, no FEC), the same
profile the web client uses. The receive jitter buffer follows the
link like a browser does: its depth is the spread of packet delays over
the last 10 s, between `audio.jitter_min_ms` (20) and
`audio.jitter_max_ms` (400). On a quiet LAN it stays near the minimum; a
mobile caller whose packets stall and then arrive in bursts gets the
depth needed to play them without dropouts. Short gaps are filled with
Opus concealment, and extra depth is removed gradually instead of by
cutting audio. Configurations that still set `jitter_max_ms = 120` limit
how far it can adapt.

When **this client** sits on a mobile network, set `audio.network =
"mobile"` (Settings → Audio → Network). Every stream then starts at a
150 ms buffer (`jitter_start_ms`) instead of learning the link first, may
drop only to 60 ms once 10 s of arrivals look calm, and can grow to
600 ms; the client sends 20 ms frames with FEC (`profile = "standard"`).
The preset only fills values the file leaves out. The example configuration
sets all four explicitly, so in a copied file either use the Settings switch
(it writes all four, each stays editable) or delete `profile`,
`jitter_start_ms`, `jitter_min_ms` and `jitter_max_ms` together with setting
`network = "mobile"`; a leftover `jitter_max_ms = 120` would make the
mobile start depth fail validation.

Receive jitter uses the 48 kHz RTP clock and actual packet arrival times.
Talk-spurt timestamp jumps reset the playout depth instead of treating pauses
as network stalls. Receive decoding runs separately from signalling requests.
After a control stall, capture queues catch up to fresh audio instead of replaying
old microphone frames; the send RTP clock also advances across pauses.
The periodic `audio-health` log includes `receive_buffered_ms` and
`receive_target_ms` (the maximum depths across streams) for latency diagnosis.

The server Admin status page receives the build version at registration and
device reports every five seconds (actual playback device and the IPv4 route's
network type). Unknown network types and packet loss before any packets have
been measured stay unavailable; a measured loss of zero is reported as 0%.
Device detection runs separately so DNS cannot hold up live audio.

`audio.device_period_ms` (default 10) is the ALSA period; the
device buffer is two of those. `0` keeps the driver default, which on
many cards is several times larger.

On small ARM boards (for example a NanoPi NEO Core LTS), leave the period at 10 ms. A single
`audio-xrun` is one missed period; the stream stays open. If those
warnings keep coming, the log shows `audio-period-rejected` or
`audio-stream-error`, or the audio crackles, raise the period (20) and
set `audio.profile` to `low` or `standard`. A faster host on a quiet LAN
can try `device_period_ms = 5` and `jitter_min_ms = 10`.

A stream whose callback stops running for 2 s without an error (seen with
USB cards) is closed and reopened; the log shows `audio-stream-stalled`.
Every 5 minutes an `audio-health` line records playback and capture
callbacks and peak level, the number of incoming streams and the packets
received. If the output goes quiet, that line shows whether the device
stopped, the server stopped sending, or the audio arrived but was silent.

## Conference member mix

Like the web client, each conference card has **Members**: hear/mute and a
level per person. That is a local mix of the conference consumers, not a
server-side mute. The conference fader still scales the whole conference.

## Stream Deck

- **Function keys look different from intercom keys.** Status, VOL,
  MEMBERS, NEXT, MUTE, − / + and CLEAR are hollow: nearly page-dark with a
  light outline (blue while active, cyan inside the menu). Targets, members
  and Reply are filled cards; an offline target is a dimmed card without an
  outline.
- The top row is the command row: **status** (user name and production) at
  the left, **VOL** next to it, **NEXT** (when there are more targets than
  keys) one left of **Reply**, and **Reply** at the far right. Reply names
  the conference (or target) it talks to, with the last caller underneath.
  The Mini (three columns) shows status, **NEXT** and Reply; its **VOLUME**
  is a menu entry instead. While the server connection is lost, the status
  key shows the device's local IP.
  While the microphone is live (any key, a GPIO input, VOX, a talk lock
  or the remote panel), Reply turns red and reads **MIC ON** with the
  target being talked to, or "N targets".
- **Tap status to open the menu.** The deck switches to a page of its own
  with three entries side by side on the row under the status key, all in the
  menu colour: **CHANGE PRODUCTION** and **INFO** open another screen,
  **CLEAR / locks** acts at once. On the Mini **VOLUME** comes first and NEXT
  pages to INFO.
  - **CHANGE PRODUCTION** lists your productions. The active one is highlighted
    ("current"). Tap another production to switch to it: talking stops,
    the targets of the new production load, and the choice is saved as
    `user.production`, so it survives a restart. The list needs multiple
    productions enabled on the server; otherwise it shows "No productions".
  - **CLEAR / locks** clears all talk locks (greyed out when there are none).
  - **INFO** shows round trip, packet loss, server host, client / server
    version and the deck's local IP (the address it uses to reach the
    server). RTT and loss turn orange when they are a problem.

  Status shows **MENU / close** on the menu and **… / back** on a sub-page:
  tap it to go up one level. **NEXT** appears when a page has more entries
  than keys (small decks). The menu closes by itself after
  `streamdeck.volume_layer_timeout_s`. Holding status 2 s still pages the
  keys.
- **MENU → RESTART**: holding the key for two seconds restarts the headless
  client immediately, without waiting for release. Releasing it earlier cancels
  the action; the same RESTART key must remain visible in the menu while held.
  It uses the same graceful
  restart as the local web interface, including under systemd, and works while
  the server is unavailable. It does not reboot the device.
- Remaining keys are targets in the same order as the web client: **left to
  right, top to bottom**. Targets start on the row right under the
  command row; when there are fewer targets than keys, the empty keys are at
  the bottom. Hold to talk,
  tap to toggle a talk lock (purple with a lock badge). Feeds cannot be talked
  to; pressing a feed toggles its mute. Pressing a listen-only conference
  shows **LISTEN ONLY** on that key instead.
- `VOL` opens the volume layer: the command row becomes **VOL, MUTE, −, +**
  from the left (status is hidden). On the Mini
  it is **−, +, NEXT**: open it from MENU → VOLUME, close it by tapping the
  selected target again or let it time out. Tap a target to select it; holding a target 600 ms toggles
  its mute. Deck bars and readouts use a linear 0–100% scale. Steps use
  `streamdeck.volume_step_percent` (default 5 percentage points); this also
  applies to MAIN and member levels. With more targets than keys, **NEXT** pages them: it
  takes Reply's key on an MK.2 and MUTE's key on a Neo / Stream Deck +.
  The layer closes after
  `streamdeck.volume_layer_timeout_s`; paging keeps it open.
- When the selected audio output exposes an ALSA hardware playback control,
  `VOL` adds **MAIN** before the targets and initially selects it. Its percentage
  controls the real sound-card output, including other applications; target
  and conference-member levels stay unchanged. Use **− / +** in 5 percentage-point
  steps, or the corresponding dial on a Stream Deck +. Hardware mute is available
  through **MUTE**, holding MAIN, or pressing its dial when the control supports it.
  MAIN also works while disconnected from the server. Unsupported, virtual or
  ambiguous outputs have no MAIN entry; no software-gain fallback is applied.
  Detection uses the selected output card's ALSA controls, independent of board
  names: Master, PCM, Playback, DAC or Digital, then a single unambiguous
  playback-only control. This includes the WM8960's shared Playback control and
  the TLV320AIC3104's PCM control (reSpeaker 2-Mics Pi HAT V2). Microphone gain,
  ALC and speaker boost controls are not used as fallback master controls.
  MAIN input wakes the audio supervisor immediately. Target and member dial
  steps are accumulated against current audio state, independent of display
  updates; display snapshots are limited to roughly 30 updates per second.
  The admin user's **Audio settings** menu exposes the same live device control
  while the client is online. Changes apply immediately, independently of the
  settings dialog's Save/Cancel buttons. Mixer changes made outside Talktome
  are reflected in both menus. System volume is not saved in the user's profile
  or overwritten at login.
- Conference **member mix** uses the same overlay pattern. **MEMBERS** is
  added on decks that still have a free command-row cell (MK.2, Original,
  XL, Plus XL). Neo and Plus open the layer with a **long-press on VOL**,
  the Mini with a long-press on MENU → **VOLUME**; Stream Deck + / + XL also open it with a **long-press on a
  conference dial** (1 s), and a long-press on any dial leaves it again.
  Target keys then show that conference's members (select, MUTE/HEAR,
  − / +). The layer is exclusive with volume and uses the same timeout.
- Stream Deck +: the four dials control the same targets as the four keys
  above them (the bottom row of the current page). No separate dial paging.
- Stream Deck + XL: six dials can be paged independently (swipe the touch
  strip) so every target's volume can be adjusted.
- On the + and + XL touch strip, a small arrow at the right (left) edge
  shows that a swipe reaches a next (previous) page: key pages on the +,
  dial pages on the + XL. No arrow means everything fits on one page.
- The strip segment above a dial greys out like its key when that user
  (or conference member) is offline, bar included; a muted one keeps its
  red bar. Tapping a segment toggles that dial's mute. The web UI shows
  which target each dial currently controls.
- Neo: the two touch points switch key pages.
- Pedal: right = reply; left and middle are assignable (see **Pedal layout
  JSON** below).
- Several decks can run in one instance via `[[streamdeck.devices]]`
  (mixed models are allowed). Bind real hardware with `serial`.

### Pedal layout JSON

Visual decks (MK.2, Mini, XL, Plus, Neo, …) always place targets from the
production list. `streamdeck.layout` does **not** move those keys, command
keys, or dials.

On a **Stream Deck Pedal** the object pins the left and middle foot
switches to a specific user, conference, or feed:

```json
{
  "streamdeck": {
    "layout": {
      "0": "user:4",
      "1": "conference:1"
    }
  }
}
```

```toml
[streamdeck.layout]
"0" = "user:4"
"1" = "conference:1"
```

| Key | Switch | Dedicated field (used if that key is missing or invalid) |
| --- | --- | --- |
| `"0"` | Left | `streamdeck.pedal_left` |
| `"1"` | Middle | `streamdeck.pedal_target` |
| (not settable) | Right | Always **Reply** |

Values are the same target strings as GPIO / VOX: `user:<id>`,
`conference:<id>` (or `conf:<id>`), `feed:<id>`. IDs are the Talktome
server numeric ids. Layout JSON wins over the dedicated pedal fields.

**What this is for:** keep a camera pedal on one IFB or conference even
when the web-client target order changes; put two destinations on left and
middle; assign a listen-only feed (press mutes/unmutes). An unknown or
offline target still occupies the switch (the web mock shows the id in
dim text). Clear both the JSON key and the dedicated field to leave a
switch empty.

**What it cannot do:** rearrange MK.2 / XL / Neo keys, override Status /
VOL / MEMBERS / NEXT / Reply, or change the Pedal right switch. Extra
indexes in the object (`"5"`, `"10"`, …) are stored but ignored.

**With several decks**, put the map on that device. A non-empty
`streamdeck.devices` list does **not** inherit top-level `layout` /
`pedal_left` / `pedal_target`:

```toml
[[streamdeck.devices]]
mock = "pedal"
layout = { "0" = "user:4", "1" = "conference:1" }
```

## GPIO

Outputs (`gpio.outputs`): `tally` (PGM / camera on air), `tally_preview`
(PRV / preview), `talking`, `incoming`,
`connected` (only while registered **and** both media transports are up),
`locked`, `status`. Extra `[[gpio.target_outputs]]` rows drive a pin when a chosen
user, conference or feed is playing audio (`when = "receiving"`) or is
addressing this client (`when = "incoming"`). Inputs (`gpio.inputs`):
`talk` (hold = talk, tap = lock), `reply`, `lock_toggle`, `clear_locks`,
`mute_toggle`, `volume_up`, `volume_down`. After requesting input lines the
client samples the current level, so an already-held inverted button starts
talking immediately instead of waiting for the next edge. Lines are
addressed by kernel name (`GPIO17` on Raspberry Pi OS) or by `gpio.chip`
plus offset. Volume +/− steps use `streamdeck.volume_step_db`.

**Status light** (`gpio.outputs.status`): one LED that shows how the
client is doing without a screen:

| LED | Meaning |
|---|---|
| short flash (100 ms), then 2 s dark | the client is running but not registered on the server (offline, connecting, logging in, account in use, kicked) |
| 1 s on, 1 s off | registered, but media is not connected yet, audio devices are not open, the server heartbeat is missing, or media is interrupted |
| steady on | registered, media connected, audio OK |
| off | the client is not running |

```toml
[gpio.outputs]
status = { line = "GPIO24" }   # active_low = true for an LED wired to 3.3 V
```

It can also be picked in Settings → GPIO (*status light*).

**Several instances on one Pi** can share a GPIO chip, for example one
instance for the buttons (GPI) and another for the lamps (GPO). Each line
can belong to only one instance: give every instance its own lines and
remove the example `tally` / `talking` outputs (GPIO17 / GPIO27) from the
instance that should not drive them. Every line is requested separately,
so a line that is already taken only disables that line; the status page
shows it as *error: GPIO17 is already used by talktome-headless@cam1* and
everything else keeps working. `talktome-headless list-gpio` (or
`gpioinfo`) shows which instance holds which line.

## Local control socket (display / rotaries)

The Stream Deck and GPIO surfaces are optional. A custom OLED, encoder
board or MCU talks to the same talk/volume bus over a **JSON-lines Unix
socket** (optional loopback TCP for development).

Under systemd the path is `$RUNTIME_DIRECTORY/control.sock`
(`/run/talktome-headless/<instance>/control.sock`). Otherwise
`/tmp/talktome-headless-<instance>-control.sock`. The file is `0660`
(`talktome-headless` user and group). Add the panel process to that group
to connect. Disable with `socket.enabled = false`. Optional
`socket.tcp = "127.0.0.1:9876"` is **loopback only**.

Protocol version 1: after connect the server writes `hello` then
`snapshot`; it pushes a new `snapshot` on every state change. Commands are
one JSON object per line. Targets use the same strings as GPIO / VOX
(`user:4`, `conference:1`, `feed:2`, or `reply`). Volume rotaries should
send `volume-step` with `delta_db` (default `streamdeck.volume_step_db`).

| Client → server | Fields | Server → client |
| --- | --- | --- |
| `hello` | `client`, `id` | `hello` (protocol, version, instance) + `snapshot` |
| `get` / `snapshot` | | `snapshot` |
| `ping` | `id` | `pong` |
| `press` / `release` / `lock` | `target` | `ack` |
| `clear-locks` | | `ack` |
| `reply` | `action`: `press` or `release` | `ack` |
| `mute` | `target` | `ack` |
| `volume` | `target`, `value` (0–1) | `ack` |
| `volume-db` | `target`, `db` | `ack` |
| `volume-step` | `target`, `delta_db` | `ack` |
| `member-mute` | `target` (conference), `member` (`user:<id>`) | `ack` |
| `member-volume` | `target`, `member`, `value` | `ack` |
| `member-volume-db` | `target`, `member`, `db` | `ack` |
| `member-volume-step` | `target`, `member`, `delta_db` | `ack` |

Errors are `{ "op": "error", "error": "…" }`. A snapshot includes string
keys, `volume_db` per target/member, tally (`on_air` / `preview`), the
current reply destination, and `main_target` / `main_unavailable` when
Reply is pinned. `server_not_responding` and `heartbeat` (`ok`, `missing`,
`not offered`) report the v1.5.6 server heartbeat. `media_status` is the
web client's media line (`Server not responding`, `Media interrupted`, …).

Packaged example (also in the source tree):

```bash
# live text "display" of the snapshot
python3 /usr/share/talktome-headless/examples/socket_panel.py \
  --socket /run/talktome-headless/cam1/control.sock

# rotary: + / − steps conference 1 by 3 dB
python3 /usr/share/talktome-headless/examples/socket_panel.py \
  --socket /run/talktome-headless/cam1/control.sock \
  --rotary conference:1 --step 3

# one-shot from an MCU bridge
python3 /usr/share/talktome-headless/examples/socket_panel.py \
  --socket /run/talktome-headless/cam1/control.sock \
  --exec 'step conference:1 -0.5'
```

A rotary firmware only needs to write lines such as:

```json
{"op":"hello","client":"oled-knobs"}
{"op":"volume-step","target":"conference:1","delta_db":-0.5,"id":12}
{"op":"press","target":"user:4","id":13}
{"op":"release","target":"user:4","id":14}
```

An `ack` is only sent for commands that carry an `id`, and echoes it so
the panel can match replies. Talk presses are
attributed as `socket:<client>` so they do not steal a Stream Deck hold on
the same target.

## Diagnostics without hardware

```bash
# Send a 440 Hz tone to a target for 10 s using the configured account
talktome-headless --instance cam1 dev send-tone --target conference:1

# Record everything addressed to this user for 15 s
talktome-headless --instance cam1 dev record --out /tmp/heard.wav
```

`audio.input_device = "tone"` and `audio.output_device = "wav:/tmp/out.wav"`
do the same inside the running service.

## Media / ICE troubleshooting

The client registers as a normal user, then fails media setup if it cannot
parse the server's ICE candidates or reach the media ports:

- `setting remote answer: parse addr: invalid IP address syntax` — the
  server announced a **hostname** (or a bracketed IPv6 literal) as the
  WebRTC address. Current builds resolve hostnames to A/AAAA before
  applying the SDP. Check `journalctl` for `ice-candidate-resolved` /
  `send-ice-candidates`.
- `Unable to handle URL in gather_candidates_relay turns:…?transport=tcp`
  — webrtc-ice cannot speak TURNS. Current builds bridge those URLs to a
  local UDP TURN façade (`turn-bridge-listen`, `ice-url-rewritten`). The
  status page then shows `turn:127.0.0.1:<ephemeral>?transport=udp` as
  **ICE (webrtc)** — that is not a bundled TURN server and not an extra
  network hop. webrtc-ice only speaks TURN-over-UDP, so the process
  listens on localhost and forwards STUN/ChannelData over TCP/TLS to the
  real `turns:` host. Media still goes to that TURN server; localhost is
  only the façade. **ICE (server)** lists the original URLs.
- `could not listen udp fe80::… Invalid argument` and `No available ipv6
  IP address found` — IPv6 link-local gathering. Leave `ice.ipv6` off
  unless this device has a global IPv6 address.
- Direct UDP to the server's announced IP still works when that IP is
  reachable (ICE-lite). TURN is required when the announced address is
  not reachable from the device (different network, UDP blocked, or
  `iceTransportPolicy=relay`).

## Build from source

```bash
sudo apt install build-essential pkg-config cmake libasound2-dev libudev-dev
cd headless-client
cargo build --release
cargo test
```

The version comes from Git tags through `scripts/resolve-build-version.js`
(`TALKTOME_BUILD_VERSION`); `Cargo.toml` intentionally stays at `0.0.0`.
`cargo install cargo-deb` once, then `headless-client/scripts/build-deb.sh`
builds the package for the host (or `… build-deb.sh aarch64-unknown-linux-gnu`
with a multiarch cross toolchain, see the comments in the script).

Pull requests run the **Headless client** job in `Pull Request Checks`
(`cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`). The
`Headless Client Builds` workflow (`.github/workflows/headless-client-release.yml`)
builds arm64, armhf and amd64 packages inside Debian Bookworm containers so
they run on Bookworm and Trixie, smoke-tests them, and attaches them to the
draft release for every `v*` tag (or a manual run with a release version).
