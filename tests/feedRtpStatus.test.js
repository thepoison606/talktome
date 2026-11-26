const test = require('node:test');
const assert = require('node:assert/strict');
const { describeFeedRtp, sampleFeedProducer } = require('../src/server/feedRtpStatus');

function makeProducer(kind) {
  return {
    kind,
    __startedAt: 1000,
    stats: [],
    async getStats() { return this.stats; },
  };
}

test('Bridge feed warns per track when RTP never arrives or stops and clears on recovery or pause', async () => {
  const audio = makeProducer('audio');
  const video = makeProducer('video');
  const bridge = {
    isBridgePeer: true,
    producers: new Map([['a', audio], ['v', video]]),
    plainSendTransport: { tuple: { protocol: 'udp', localPort: 41001 } },
    plainVideoSendTransport: { tuple: { protocol: 'udp', localPort: 41002 } },
  };
  const missing = now => describeFeedRtp(bridge, now).missingRtp;

  await sampleFeedProducer(audio, 4000);
  assert.deepEqual(missing(4000), []);

  video.stats = [{ type: 'inbound-rtp', packetCount: 100 }];
  assert.equal(await sampleFeedProducer(audio, 10000), true);
  await sampleFeedProducer(video, 10000);
  assert.deepEqual(missing(10000), ['audio']);
  assert.deepEqual(describeFeedRtp(bridge, 10000).mediaPorts, [
    { kind: 'audio', protocol: 'udp', port: 41001 },
    { kind: 'video', protocol: 'udp', port: 41002 },
  ]);

  audio.stats = [{ type: 'inbound-rtp', packetCount: 1 }];
  assert.equal(await sampleFeedProducer(audio, 13000), true);
  await sampleFeedProducer(video, 19000);
  assert.deepEqual(missing(19000), ['video']);

  video.paused = true;
  assert.deepEqual(missing(19000), []);
  video.paused = false;
  video.__startedAt = 20000;
  await sampleFeedProducer(video, 22000);
  assert.deepEqual(missing(22000), []);
});

test('browser feeds show the selected server-side WebRTC port', () => {
  const browser = {
    producers: new Map([['v', makeProducer('video')]]),
    sendTransport: {
      iceCandidates: [{ protocol: 'udp', port: 40000 }],
    },
  };
  assert.deepEqual(describeFeedRtp(browser, 1000).mediaPorts, []);

  browser.sendTransport.iceSelectedTuple = { protocol: 'tcp', localPort: 40000, remotePort: 55123 };
  assert.deepEqual(describeFeedRtp(browser, 1000), {
    missingRtp: [],
    mediaPorts: [{ kind: 'video', protocol: 'tcp', port: 40000 }],
  });
});
