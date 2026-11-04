import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { colors } from './theme';

/** Video-only stream: feed audio remains in the normal intercom audio graph. */
export function FeedVideoPlayer({ streamURL, error, stopped, height }: {
  streamURL?: string; error?: string; stopped: boolean; height: number;
}) {
  const [aspect, setAspect] = useState(16 / 9);
  const [width, setWidth] = useState(0);
  const pictureWidth = Math.max(0, Math.min(width - 4, (height - 4) * aspect));
  return <View style={[styles.panel, { height }]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    {streamURL && !stopped ? <View style={styles.frame}>
      <RTCView key={streamURL}
        streamURL={streamURL} objectFit="contain" mirror={false}
        style={{ width: pictureWidth, height: pictureWidth / aspect }}
        onDimensionsChange={({ nativeEvent: { width, height: videoHeight } }) => {
          if (width > 0 && videoHeight > 0) setAspect(width / videoHeight);
        }}
      />
    </View> : <Text style={styles.notice}>{stopped ? 'Video stopped' : error || 'Waiting for video…'}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  frame: { backgroundColor: '#000', padding: 2 },
  notice: { color: colors.muted, fontSize: 12, padding: 8, textAlign: 'center' },
});
