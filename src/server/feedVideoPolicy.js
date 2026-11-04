'use strict';

// Both codecs are negotiated by mediasoup; no server-side transcoding.
const FEED_VIDEO_CODECS = [
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000,
    parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
];

function canPublishFeedMedia({ peer, kind, appData }) {
  if (kind === 'audio') return true; // Existing audio authorization still applies.
  return kind === 'video' && peer?.feedVideo === true && peer.kind === 'feed'
    && appData?.type === 'feed' && peer.feedId != null
    && String(peer.feedId) === String(appData.id);
}

function canReceiveFeedVideo({ producer, recipient, sameProduction, assignedFeedIds = [] }) {
  return producer?.kind === 'video' && producer.appData?.type === 'feed'
    && !producer.closed && !producer.paused
    && recipient?.feedVideo === true && ['user', 'guest'].includes(recipient.kind)
    && sameProduction === true
    && assignedFeedIds.some(id => String(id) === String(producer.appData.id));
}

module.exports = { FEED_VIDEO_CODECS, canPublishFeedMedia, canReceiveFeedVideo };
