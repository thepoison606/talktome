# Video feeds (feature preview)

## Enable feed video

**Admin → Config → Client defaults → Allow Feed-Video** controls the inherited permission. It is **off** by default. Each Feed has its own **Allow Feed-Video** switch in **Admin → Feeds**; changing it creates an explicit on/off override. **Use client default** clears the override. This permission is enforced by the server for browser and Bridge publishers, and applies to all receivers of that feed.

Turning video off closes its producers and consumers immediately while feed audio continues. Browser camera tracks are stopped; the Bridge stops its video capture after receiving the updated runtime configuration. Camera/source selections remain saved for re-enabling. A running browser feed resumes its previously selected camera when video is allowed again. Old clients cannot bypass the server permission. Permissions survive restarts and configuration backups; feeds in older backups inherit the default.

At the current 1.2 Mbit/s target, one running feed sends approximately 0.54 GB/hour to the server. Each open player adds approximately 1.2 Mbit/s / 0.54 GB/hour to server outbound traffic, plus protocol overhead. Ten simultaneous players of one feed therefore mean about 12 Mbit/s and 5.4 GB/hour outbound. Actual bitrate varies with content and encoder behavior. Collapsed/background/off-layer players do not subscribe, but a running permitted source still sends its single upstream stream. Video encoding happens in the browser/Bridge and decoding on the receiving device; mediasoup forwards packets without transcoding. CPU/memory limits require a benchmark on the intended server.

## Send a webcam feed

1. Create a Feed in Admin and assign it to the receiving users in the matrix, as for audio feeds.
2. Log in as that Feed at `/` in a browser. Open **Video source (optional)**. If Safari has not exposed the camera list yet, grant camera access; the chooser then shows all available cameras immediately. Choose a specific webcam or **Default camera**. The brief permission probe is not broadcast and is stopped before a source is selected.
3. Start the Feed if it is stopped. The local camera preview and **Camera live** confirm video capture. Audio source, gain and packet time work as before.
4. Select **Off — audio only** to turn off just video, or **Stop Feed** to stop both audio and video.

Camera capture is off after every page load. A selected camera restarts with a running feed after a signaling reconnect, but is never replaced silently by another camera when unplugged. Camera permission/device failures leave audio running and show an inline message. Select Off and then the desired camera to retry.

As with microphone input, camera input requires HTTPS or a loopback development origin (`localhost` / `127.0.0.1`). Two different logins on one computer should use separate browser profiles/private sessions so their saved identities and login cookies do not replace each other.

## Watch a feed

For a feed publishing video, the left-hand headphone icon (🎧) becomes a TV emoji (📺). Click it to open the picture **above** the normal volume, mute and reception Start/Stop controls; click again to close it. Volume and mute affect only audio. Stop reception also stops receiving video.

Closed video windows, videos on another target layer, and backgrounded pages do not subscribe to video. Reopening the window or returning to its layer resumes reception. Expanded feeds retain the responsive grid column width (one, two, three or four columns, as determined by the media queries). Additional complete grid rows move to layers according to their measured heights, including the tallest target in each row. Rows retain their normal controls and are not squeezed smaller.

## Scope and constraints

- Video sources: browser webcam or NDI/OMT in the native Bridge. Receivers: web client and iOS/Android apps from this feature branch. Older native apps, audio-only Bridges and headless clients keep their existing audio-only behavior.
- Only an authenticated Feed may publish its own camera stream. Viewing requires the same effective Feed assignment as audio in the receiver's current production.
- Capture aims for up to 1280×720 at 15 fps and a video bitrate cap of 1.2 Mbit/s. Actual resolution/rate depends on the camera, browser and available bandwidth. Each open receiver needs additional server outbound bandwidth.
- The router negotiates VP8 or H.264; it does not transcode. Browser codec compatibility is therefore required. See [mediasoup RTP negotiation](https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/).
- Video does not change the existing low-latency audio path. Frame-accurate audio/video synchronization is not provided.
- Screen sharing, recording and mobile camera publishing are outside this preview.

## Validation

`npm test` covers camera permission denial, stopping while permission is pending, lazy subscriptions, Stop/Start, layer/background changes, producer replacement, rerendering and reconnection cleanup. A real local mediasoup server test exercises simultaneous audio/video production, codec negotiation, video consumption, replacement and authorization, plus compatibility with clients without video support.

Before merging, manually check a real webcam between current Chrome and Safari, then the receiver in iPhone Safari and a narrow/landscape viewport. Verify camera switching, audio-only mode, full-height controls, layers, mute/volume, Feed Stop/Start and reconnects. The implementation session's computer-use backend was unavailable, so these visual/device checks are still required.

## Send an NDI or OMT feed through the Bridge

Use the Bridge and server from `feature/video-feeds`; older Bridge versions only publish audio. In **Admin → Feeds**, enable **Use this feed as bridge input** and select the Bridge. Keep the audio input and channel selection as before. Under **Video source (optional)**, choose a discovered NDI or OMT source, then save. The same selector is available on the Feed card inside the native Bridge. **Off** removes only video. For video-only sources, leave the audio input empty.

Video and audio can come from the same network source or from separate sources (for example an NDI picture and a sound card). The new video path is independent of audio: video failures and video-source changes restart only video. A missing source is retried automatically. Feed video is visible only to assigned, video-capable receivers; older native apps and audio-only Bridges remain audio-only receivers.

The Bridge uses the installed NDI Runtime and bundled OMT/VMX runtime. No NDI SDK/runtime is redistributed. It decodes network video to BGRA, scales it to at most 1280×720 at 15 fps, and encodes H.264 Baseline in software at a target of 1.2 Mbit/s. Each source requires an additional network receiver and encoder, so CPU, source bandwidth and memory increase per enabled Feed. This is a preview implementation, not an NDI/OMT passthrough or video output. Progressive sources with square pixels are recommended. Frame-accurate audio/video synchronization is not guaranteed.

The H.264 sender uses separate RTP/RTCP from audio, periodic keyframes and sender reports. Its license notices are included in the Bridge's `licenses` resources. Existing audio-only FFmpeg builds do not need video codecs added.

### Native validation

Run `cargo test --manifest-path bridge-client/src-tauri/Cargo.toml --lib` for frame validation, real H.264 encode/decode, RTP fragmentation/reassembly and RTCP clock mapping. With NDI installed and the bundled OMT runtime prepared, also run:

```sh
cargo test --manifest-path bridge-client/src-tauri/Cargo.toml --lib video_loopback -- --ignored --nocapture --test-threads=1
```

These integration tests publish actual synthetic NDI/OMT pictures, receive them in a separate process, encode/send RTP, then reconstruct and decode a picture. OMT discovery is checked, but its media test explicitly uses loopback port 6400 (must be free) to avoid SDK address races on hosts with virtual/link-local adapters. This does not override production address selection. The macOS test host reproduced such a discovery-selected link-local connection with no media, including in the pre-existing OMT audio test. Real multi-interface/remote-source checks remain necessary.

Before merging, also check real OBS NDI/OMT sources on Windows and macOS, browser video playback in Safari/Chrome, audio continuity when changing video sources, source resolution changes, source loss/recovery and server reconnects.

## iOS and Android receivers

In the operator grid, a feed advertising video has a TV icon (📺). Tap it to expand the picture above the existing feed controls; tap it again to collapse. Volume/mute still affect only audio. Stop reception also releases the video connection; Start resumes it if the feed remains expanded. Video-only feeds are supported.

The player stays within its target column, preserving the video aspect ratio with a small uniform black frame. Complete rows move to another layer when a video is expanded, without shrinking or clipping the audio controls. The tapped feed stays on the visible layer. Only expanded feeds on the current layer in the foreground subscribe to video. Layer changes, collapse, backgrounding, target removal and disconnect close video consumers and release native streams. Returning to the foreground or visible layer reconnects them. Receiver failures show an inline notice and retry without restarting intercom audio. Video reception does not request camera permission and is separate from the audio consumer budget.

Validation: the mobile test suite covers lazy video subscriptions, delayed consume/resume cleanup, server-close races, retry, audio isolation, Stop/Start and row packing. `npm run typecheck` and iOS bundle export verify the shared app implementation. Native visual/device checks are recorded separately below; app-store/test distribution is not part of this feature preview.

Native preview check (2026-11-04): Android standalone APK built locally and installed separately as `com.talktome.mobile.videopreview`. A real 640×360 H.264 RTP test pattern through an isolated Talktome server/Bridge session rendered at 15 fps. Stop/Start, layer departure/return, background/foreground, phone landscape and a two-column tablet layout were exercised; native renderer release/recreation was confirmed in logcat. Emulator display-density changes required restarting the app before testing the tablet configuration. iOS bundle export passes; a native iPhone/iPad run remains outstanding because the local Simulator service did not respond.
