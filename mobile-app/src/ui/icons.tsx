import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { colors } from './theme';

type IconProps = {
  color?: string;
  size?: number;
};

const iconEvents = { pointerEvents: 'none' as const };

export const WEB_CONFERENCE_GLYPH = '📡';
export const WEB_FEED_GLYPH = '🎧';

/** Target-row avatar fills from the web client (`#targets-list .user-icon` / `.conf-icon` / `.feed-icon`). */
export const WEB_AVATAR = {
  user: '#446cc2',
  conference: '#4f9b8b',
  // TalkToMe 1.5.17: feeds have their own green so a sending feed no longer looks offline.
  feed: '#5f804b',
  offline: '#475569',
  glyph: '#ffffff',
  offlineGlyph: '#e2e8f0',
} as const;

const WALKIE_TALKIE = require('../../assets/icons/walkie-talkies-white.png') as ImageSourcePropType;
const SPEAKER_ON = require('../../assets/icons/speaker-white.png') as ImageSourcePropType;
const SPEAKER_MUTED = require('../../assets/icons/speaker-muted.png') as ImageSourcePropType;
const PLAY = require('../../assets/icons/play-rounded.png') as ImageSourcePropType;
const REPLY = require('../../assets/icons/reply.png') as ImageSourcePropType;
const PALETTE = require('../../assets/icons/palette.png') as ImageSourcePropType;

export function targetAvatarBackground(
  type: 'user' | 'guest' | 'conference' | 'feed',
  dimmed: boolean,
): string {
  if (dimmed) {
    return WEB_AVATAR.offline;
  }
  if (type === 'conference') {
    return WEB_AVATAR.conference;
  }
  if (type === 'feed') {
    return WEB_AVATAR.feed;
  }
  return WEB_AVATAR.user;
}

function AssetIcon({
  source,
  color,
  size,
  tint = true,
}: {
  source: ImageSourcePropType;
  color?: string;
  size: number;
  tint?: boolean;
}) {
  return (
    <Image
      source={source}
      accessible={false}
      resizeMode="contain"
      resizeMethod="resize"
      style={{ width: size, height: size, tintColor: tint ? color : undefined }}
      {...iconEvents}
    />
  );
}

function GlyphIcon({ glyph, size }: { glyph: string; size: number }) {
  return (
    <View style={[styles.box, { width: size, height: size }]} {...iconEvents}>
      <Text style={[styles.glyph, { fontSize: size * 0.72, lineHeight: size }]}>{glyph}</Text>
    </View>
  );
}

export function ConferenceIcon({ size = 22 }: IconProps) {
  return <GlyphIcon glyph={WEB_CONFERENCE_GLYPH} size={size} />;
}

export function HeadphonesIcon({ size = 22 }: IconProps) {
  return <GlyphIcon glyph={WEB_FEED_GLYPH} size={size} />;
}

export function PersonIcon({
  color = WEB_AVATAR.glyph,
  size = 22,
  letter,
}: IconProps & { letter?: string }) {
  const initial = (letter ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.box, { width: size, height: size }]} {...iconEvents}>
      <Text style={[styles.initial, { color, fontSize: size * 0.52, lineHeight: size }]}>{initial}</Text>
    </View>
  );
}

export function SpeakerIcon({ color = colors.text, muted = false, size = 20 }: IconProps & { muted?: boolean }) {
  return (
    <AssetIcon
      source={muted ? SPEAKER_MUTED : SPEAKER_ON}
      color={color}
      size={size}
      tint={!muted}
    />
  );
}

export function PhoneIcon({ color = colors.text, size = 18 }: IconProps) {
  const width = size * 0.46;
  const height = size * 0.82;
  return (
    <View style={[styles.box, { width: size, height: size }]} {...iconEvents}>
      <View
        style={[
          styles.phoneBody,
          {
            width,
            height,
            borderColor: color,
            borderRadius: width * 0.28,
          },
        ]}
      />
      <View style={[styles.phoneEar, { backgroundColor: color, width: width * 0.34 }]} />
      <View style={[styles.phoneMouth, { backgroundColor: color, width: width * 0.22 }]} />
    </View>
  );
}

export function StopIcon({ color = colors.text, size = 14 }: IconProps) {
  return <View style={{ width: size, height: size, borderRadius: 3, backgroundColor: color }} {...iconEvents} />;
}

export function PlayIcon({ color = colors.text, size = 18 }: IconProps) {
  return <Image source={PLAY} style={{ width: size, height: size, tintColor: color }} {...iconEvents} />;
}

export function LockIcon({ color = colors.text, size = 16 }: IconProps) {
  return (
    <View style={[styles.box, { width: size, height: size }]} {...iconEvents}>
      <View style={[styles.lockShackle, { borderColor: color, width: size * 0.55, height: size * 0.4 }]} />
      <View style={[styles.lockBody, { backgroundColor: color, width: size * 0.72, height: size * 0.48 }]} />
    </View>
  );
}

export function ListenOnlyIcon({ color = colors.muted, size = 14 }: IconProps) {
  return (
    <View style={[styles.box, { width: size, height: size }]} {...iconEvents}>
      <View style={[styles.micCapsule, { backgroundColor: color, width: size * 0.36, height: size * 0.5 }]} />
      <View style={[styles.micStand, { backgroundColor: color, height: size * 0.18 }]} />
      <View style={[styles.slash, { width: size * 0.92, backgroundColor: color, height: 1.5 }]} />
    </View>
  );
}

export function ReplyArrowIcon({ color = colors.text, size = 18 }: IconProps) {
  return <AssetIcon source={REPLY} color={color} size={size} />;
}

export function WalkieTalkieIcon({ color = colors.text, size = 22 }: IconProps) {
  return <AssetIcon source={WALKIE_TALKIE} color={color} size={size} />;
}

export function ChevronIcon({
  color = colors.text,
  size = 16,
  direction = 'up',
}: IconProps & { direction?: 'up' | 'down' }) {
  return (
    <View
      style={[
        styles.box,
        { width: size, height: size, transform: [{ rotate: direction === 'down' ? '180deg' : '0deg' }] },
      ]}
      {...iconEvents}
    >
      <View
        style={[
          styles.chevron,
          {
            borderBottomColor: color,
            borderLeftWidth: size * 0.38,
            borderRightWidth: size * 0.38,
            borderBottomWidth: size * 0.42,
          },
        ]}
      />
    </View>
  );
}

export function QrIcon({ color = colors.text, size = 20 }: IconProps) {
  const inset = size * 0.16;
  const finder = size * 0.28;
  return (
    <View style={[styles.box, { width: size, height: size }]} {...iconEvents}>
      <View style={[styles.qrFrame, { width: size, height: size, borderColor: color }]} />
      <View style={[styles.qrFinder, { top: inset, left: inset, width: finder, height: finder, borderColor: color }]} />
      <View style={[styles.qrFinder, { top: inset, right: inset, width: finder, height: finder, borderColor: color }]} />
      <View style={[styles.qrFinder, { bottom: inset, left: inset, width: finder, height: finder, borderColor: color }]} />
    </View>
  );
}

export function PaletteIcon({ color = colors.text, size = 20 }: IconProps) {
  return <AssetIcon source={PALETTE} color={color} size={size} />;
}

export function TrashIcon({ color = colors.danger, size = 20 }: IconProps) {
  const lid = size * 0.12;
  const can = size * 0.62;
  return (
    <View style={[styles.box, { width: size, height: size }]} {...iconEvents}>
      <View
        style={[
          styles.trashHandle,
          {
            borderColor: color,
            width: size * 0.28,
            height: size * 0.16,
            top: size * 0.04,
          },
        ]}
      />
      <View
        style={[
          styles.trashLid,
          {
            backgroundColor: color,
            width: size * 0.78,
            height: lid,
            top: size * 0.18,
          },
        ]}
      />
      <View
        style={[
          styles.trashCan,
          {
            borderColor: color,
            width: size * 0.62,
            height: can,
            top: size * 0.32,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    textAlign: 'center',
    includeFontPadding: false,
  },
  initial: {
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
  phoneBody: {
    borderWidth: 2,
  },
  phoneEar: {
    position: 'absolute',
    top: '22%',
    height: 3,
    borderRadius: 1,
  },
  phoneMouth: {
    position: 'absolute',
    bottom: '22%',
    height: 3,
    borderRadius: 1,
  },
  slash: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
    transform: [{ rotate: '-38deg' }],
  },
  micCapsule: {
    width: 8,
    height: 11,
    borderRadius: 4,
  },
  micStand: {
    width: 2,
    height: 5,
    marginTop: 1,
  },
  lockShackle: {
    position: 'absolute',
    top: 0,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  lockBody: {
    position: 'absolute',
    bottom: 0,
    borderRadius: 2,
  },
  trashHandle: {
    position: 'absolute',
    borderWidth: 2,
    borderBottomWidth: 0,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  trashLid: {
    position: 'absolute',
    borderRadius: 1,
  },
  trashCan: {
    position: 'absolute',
    borderWidth: 2,
    borderTopWidth: 0,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  qrFrame: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 4,
  },
  qrFinder: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 1,
  },
  chevron: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginBottom: 1,
  },
});
