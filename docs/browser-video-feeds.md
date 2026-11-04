# Browser video feeds (first version)

## Send a webcam feed

1. Create a Feed in Admin and assign it to the receiving users in the matrix, as for audio feeds.
2. Log in as that Feed at `/` in a browser. Under **Video source (optional)** choose **Default camera** or a specific webcam, and grant camera permission.
3. Start the Feed if it is stopped. The local camera preview and **Camera live** confirm video capture. Audio source, gain and packet time work as before.
4. Select **Off — audio only** to turn off just video, or **Stop Feed** to stop both audio and video.

Camera capture is off after every page load. A selected camera restarts with a running feed after a signaling reconnect, but is never replaced silently by another camera when unplugged. Camera permission/device failures leave audio running and show an inline message. Select Off and then the desired camera to retry.

As with microphone input, camera input requires HTTPS or a loopback development origin (`localhost` / `127.0.0.1`). Two different logins on one computer should use separate browser profiles/private sessions so their saved identities and login cookies do not replace each other.

## Watch a feed

For a feed publishing video, the left-hand headphone icon (🎧) becomes a video emoji (🎥). Click it to open the picture **above** the normal volume, mute and reception Start/Stop controls; click again to close it. Volume and mute affect only audio. Stop reception also stops receiving video.

Closed video windows, videos on another target layer, and backgrounded pages do not subscribe to video. Reopening the window or returning to its layer resumes reception. While any video is expanded, targets use full-width rows and additional targets move to layers according to their measured heights. Rows retain their normal controls and are not squeezed smaller.

## Scope and constraints

- Sender and video receiver: web client only in this first version. iOS/Android apps, native Bridges and headless clients continue receiving audio. They are not sent video producer announcements.
- Only an authenticated Feed may publish its own camera stream. Viewing requires the same effective Feed assignment as audio in the receiver's current production.
- Capture aims for up to 1280×720 at 15 fps and a video bitrate cap of 1.2 Mbit/s. Actual resolution/rate depends on the camera, browser and available bandwidth. Each open receiver needs additional server outbound bandwidth.
- The router negotiates VP8 or H.264; it does not transcode. Browser codec compatibility is therefore required. See [mediasoup RTP negotiation](https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/).
- Video does not change the existing low-latency audio path. Frame-accurate audio/video synchronization is not provided.
- NDI/OMT video ingestion, screen sharing, recording and native mobile video reception are follow-up work.

## Validation

`npm test` covers camera permission denial, stopping while permission is pending, lazy subscriptions, Stop/Start, layer/background changes, producer replacement, rerendering and reconnection cleanup. A real local mediasoup server test exercises simultaneous audio/video production, codec negotiation, video consumption, replacement and authorization, plus compatibility with clients without video support.

Before merging, manually check a real webcam between current Chrome and Safari, then the receiver in iPhone Safari and a narrow/landscape viewport. Verify camera switching, audio-only mode, full-height controls, layers, mute/volume, Feed Stop/Start and reconnects. The implementation session's computer-use backend was unavailable, so these visual/device checks are still required.
