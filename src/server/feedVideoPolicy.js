'use strict';

// Both codecs are negotiated by mediasoup; no server-side transcoding.
const FEED_VIDEO_CODECS = [
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000,
    parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
];

function isFeedVideoAllowed(feed, defaults = {}) {
  if (!feed) return false;
  return feed.allow_feed_video == null ? defaults.allowFeedVideo === true : Boolean(feed.allow_feed_video);
}

function canPublishFeedMedia({ peer, kind, appData, allowed = false }) {
  if (kind === 'audio') return true; // Existing audio authorization still applies.
  return allowed === true && kind === 'video' && peer?.feedVideo === true && peer.kind === 'feed'
    && appData?.type === 'feed' && peer.feedId != null
    && String(peer.feedId) === String(appData.id);
}

function canReceiveFeedVideo({ producer, recipient, sameProduction, assignedFeedIds = [], allowed = false }) {
  return allowed === true && producer?.kind === 'video' && producer.appData?.type === 'feed'
    && !producer.closed && !producer.paused
    && recipient?.feedVideo === true && ['user', 'guest'].includes(recipient.kind)
    && sameProduction === true
    && assignedFeedIds.some(id => String(id) === String(producer.appData.id));
}

module.exports = { isFeedVideoAllowed, FEED_VIDEO_CODECS, canPublishFeedMedia, canReceiveFeedVideo };
