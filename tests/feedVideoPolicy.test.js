const test = require('node:test');
const assert = require('node:assert/strict');
const { FEED_VIDEO_CODECS, canPublishFeedMedia, canReceiveFeedVideo } = require('../src/server/feedVideoPolicy');
const { packRows } = require('../public/targetLayers');

test('only an opted-in feed may publish its own video; audio retains existing authorization', () => {
  const peer = { kind: 'feed', feedId: 7, feedVideo: true };
  const args = { peer, kind: 'video', appData: { type: 'feed', id: 7 } };
  assert(canPublishFeedMedia(args));
  for (const patch of [ { peer: { ...peer, feedVideo: false } }, { peer: { ...peer, kind: 'user' } },
    { appData: { type: 'feed', id: 8 } }, { appData: { type: 'user', id: 7 } }, { kind: 'screen' } ]) {
    assert.equal(canPublishFeedMedia({ ...args, ...patch }), false);
  }
  assert(canPublishFeedMedia({ ...args, kind: 'audio', peer: {} }));
  assert.deepEqual(FEED_VIDEO_CODECS.map(c => c.mimeType), ['video/VP8', 'video/H264']);
});

test('video cannot leak to other productions, unassigned targets or old/native clients', () => {
  const args = { producer: { kind: 'video', appData: { type: 'feed', id: 7 } },
    recipient: { kind: 'user', feedVideo: true }, sameProduction: true, assignedFeedIds: [7] };
  assert(canReceiveFeedVideo(args));
  assert(canReceiveFeedVideo({ ...args, recipient: { kind: 'guest', feedVideo: true } }));
  for (const patch of [ { sameProduction: false }, { assignedFeedIds: [] },
    { recipient: { kind: 'user' } }, { recipient: { kind: 'feed', feedVideo: true } },
    { producer: { ...args.producer, paused: true } }, { producer: { ...args.producer, closed: true } } ]) {
    assert.equal(canReceiveFeedVideo({ ...args, ...patch }), false);
  }
});

test('a video row moves targets to another layer while remaining rows keep their full height', () => {
  assert.deepEqual(packRows([80, 260, 80, 80, 80], 440, 8), [0, 0, 0, 1, 1]);
  assert.deepEqual(packRows([80, 260, 80, 80], 320, 8), [0, 1, 2, 2]);
  assert.deepEqual(packRows([80, 80, 80, 80], 320, 8), [0, 0, 0, 1]);
  assert.deepEqual(packRows([500, 80], 320, 8), [0, 1]);
});
