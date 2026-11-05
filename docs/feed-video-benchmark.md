# Feed video forwarding benchmark

Measured on 2026-11-05 on an Apple M3 Pro (macOS arm64), mediasoup 3.29.0.
This is an isolated forwarding measurement, not a production capacity limit.

## Reproduce

From the repository root, with dependencies installed:

```sh
node scripts/benchmark-feed-video.cjs --subscribers 1,10,50,100,200 --seconds 10 --mbps 2.4 --output /tmp/feed-video-benchmark.json
```

The script starts its own worker/router and loopback UDP sockets. It does not
connect to or change the running Talktome server. Every receiver has an independent
SRTP encryption context. The input is synthetic H.264-shaped RTP at 30 fps;
receivers count packets without decoding the picture. Each step warms up for
3.25 seconds and samples for 10 seconds.

## Results

| Open video streams | Worker CPU (% of one core) | Outbound UDP (Mbit/s) | Worker RAM (MiB) | Media packets received |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1.7 | 2.9 | 9.1 | 100.00% |
| 10 | 6.8 | 25.0 | 14.3 | 99.88% |
| 50 | 22.5 | 125.3 | 34.9 | 100.00% |
| 100 | 24.9 | 250.6 | 71.1 | 100.00% |
| 200 | 46.4 | 501.2 | 115.5 | 99.94% |

Input RTP remained approximately 2.43 Mbit/s and 30 fps throughout. Output includes
SRTP, RTCP and padding/probing; it excludes IP/Ethernet overhead. Worker counters
reported approximately 100% media forwarding in every step. The 50-stream
counter was 100.33% because asynchronous statistics snapshots straddle a frame
boundary. Small sink shortfalls can also reflect local UDP delivery/sampling.
These measurements do not establish loss-free operation or a maximum capacity.

CPU varied with scheduling and warm-up, so use the broad trend rather than
interpolating a precise capacity from adjacent rows. The benchmark's separate
Node source/sink process used about 23% of a core at 100 streams and 39% at 200;
this is test-generator overhead, not Talktome's application CPU.

## What this means for deployment

Bandwidth grows per **open player**, not just per connected user. A Bridge feed
targeting 2.4 Mbit/s needs roughly 250 Mbit/s outbound for 100 players, or about
113 GB/hour. Two such feeds open per user approximately double this. Encoding
happens in the source browser/Bridge, and decoding on the receiving client;
the server forwards encoded packets without transcoding.

On a 100 Mbit/s uplink, network capacity would be reached well before this test's
200-stream load. On faster networks, worker CPU, packet rate and host limits can
become the constraint. Measure the actual deployment with realistic headroom.
The test excludes WebRTC ICE/DTLS, WAN/TURN, receiver feedback, retransmissions,
congestion, audio traffic and the full Talktome application workload. It also
uses a single source and short steady-state intervals. Multiple sources, real
clients and a longer soak test are necessary before making capacity promises.

## Threads and useful status metrics

Talktome currently creates one mediasoup worker and one router. The worker is
already a separate C++ process; its media processing uses one CPU core. Adding
JavaScript threads would not automatically distribute this router. Scaling
across cores requires multiple workers/routers and explicit routing between them,
including cross-production connections. See the official
[mediasoup scalability documentation](https://mediasoup.org/documentation/v3/scalability/).

A useful future Status display would show worker CPU as a percentage of one
core, network transmit Mbit/s, active video consumers, and RAM. Whole-host CPU
alone could hide a saturated media core. CPU time can be sampled through
[WorkerResourceUsage](https://mediasoup.org/documentation/v3/mediasoup/api/#WorkerResourceUsage).
