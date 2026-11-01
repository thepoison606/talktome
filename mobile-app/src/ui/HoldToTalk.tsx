import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type GestureResponderEvent, type PointerEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createHoldGesture, type HoldTouch } from '../talk/holdGesture';

const mountedGestures = new Set<ReturnType<typeof createHoldGesture>>();

// Android's move event may belong to the first pointer only. The legacy touch
// payload still contains every finger, so the operator surface forwards it here.
export function moveTalkTouches(touches: readonly HoldTouch[]) {
  mountedGestures.forEach(gesture => gesture.move(touches));
}
export function endTalkTouches(touches: readonly HoldTouch[]) {
  mountedGestures.forEach(gesture => gesture.end(touches));
}

type Props = {
  accessibilityLabel: string;
  disabled?: boolean;
  locked?: boolean;
  leftHanded?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress: (inputKey: string) => void;
  onLock: (inputKey: string) => void;
  onRelease: (inputKey: string) => void;
  children: ReactNode;
};

export function HoldToTalk({
  accessibilityLabel,
  disabled,
  locked,
  leftHanded = false,
  style,
  onPress,
  onLock,
  onRelease,
  children,
}: Props) {
  const inputKey = useId();
  const viewRef = useRef<View>(null);
  const gestureRef = useRef<ReturnType<typeof createHoldGesture> | null>(null);
  if (!gestureRef.current) gestureRef.current = createHoldGesture();
  const gesture = gestureRef.current;
  useEffect(() => {
    mountedGestures.add(gesture);
    return () => { mountedGestures.delete(gesture); gesture.cancel(); };
  }, [gesture]);
  useEffect(() => { if (disabled) gesture.cancel(); }, [disabled, gesture]);
  const options = {
    disabled, locked, leftHanded,
    onPress: () => onPress(inputKey),
    onLock: () => onLock(inputKey),
    onRelease: () => onRelease(inputKey),
  };
  const pointerTouch = (event: PointerEvent) => ({ identifier: event.nativeEvent.pointerId, pageX: event.nativeEvent.pageX });
  const endPointer = (event: PointerEvent) => {
    gesture.end([pointerTouch(event)]);
    const id = event.nativeEvent.pointerId;
    if (viewRef.current?.hasPointerCapture(id)) viewRef.current.releasePointerCapture(id);
  };

  return (
    <View
      ref={viewRef}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(locked) }}
      style={[styles.hit, disabled && styles.disabled, style]}
      {...(Platform.OS === 'android' ? {
        onPointerDown: (event: PointerEvent) => {
          if (disabled) return;
          // Keep move/up events when sliding past the button edge to lock.
          viewRef.current?.setPointerCapture(event.nativeEvent.pointerId);
          gesture.start(pointerTouch(event), options);
        },
        onPointerMove: (event: PointerEvent) => gesture.move([pointerTouch(event)]),
        onPointerUp: endPointer,
        onPointerCancel: endPointer,
      } : {
        onTouchStart: (event: GestureResponderEvent) => gesture.start(event.nativeEvent, options),
        onTouchMove: (event: GestureResponderEvent) => gesture.move(event.nativeEvent.changedTouches),
        onTouchEnd: (event: GestureResponderEvent) => gesture.end(event.nativeEvent.changedTouches),
        onTouchCancel: (event: GestureResponderEvent) => gesture.end(event.nativeEvent.changedTouches),
      })}
      onAccessibilityTap={() => {
        if (disabled) return;
        if (locked) onPress(inputKey);
        else onLock(inputKey);
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
});
