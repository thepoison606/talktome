import { Fragment, useEffect, useRef, useState } from 'react';
import { Animated, findNodeHandle, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { talkTargetIdentity, type TalkTarget } from '../protocol';
import { targetColorForeground } from '../protocol/clientDefaults';
import { session, useSessionStore } from '../session/store';
import { moveTargetOrder } from '../session/targetOrder';
import { PaletteIcon, TrashIcon } from './icons';
import { SettingsButton, SettingsFootnote, SettingsHint, SettingsSection, useSettingsStyles, useSettingsTheme } from './settingsChrome';
import { targetOrderDropIndex, targetOrderScrollStep, type TargetRowLayout } from './targetOrderDrag';

export function arrangeKind(target: TalkTarget): string {
  if (target.type === 'conference') return target.canTalk ? 'Conference' : 'Listen only';
  return target.type === 'feed' ? 'Feed' : 'User';
}

type Drag = {
  source: number;
  destination: number;
  startY: number;
  pageY: number;
  startScroll: number;
  moved: boolean;
  rows: TargetRowLayout[];
  targets: TalkTarget[];
  profileId: string | null;
  productionId: number | null;
};

export function ArrangeTargetsPage() {
  const targets = useSessionStore(state => state.targets);
  const allowReorder = useSessionStore(state => state.allowTargetRearrange);
  const allowAddRemove = useSessionStore(state => state.allowTargetAddRemove);
  const profileId = useSessionStore(state => state.activeProfileId);
  const productionId = useSessionStore(state => state.productionId);
  const colorOverrides = useSessionStore(state => state.targetAppearance?.colors);
  const styles = useSettingsStyles();
  const { palette } = useSettingsTheme();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [colorTargetKey, setColorTargetKey] = useState<string | null>(null);
  const [colors, setColors] = useState<{ name: string; value: string }[] | null>(null);
  const colorRequest = useRef<Promise<{ name: string; value: string }[]> | null>(null);
  const saving = useRef(false);
  const [dragged, setDragged] = useState<number | null>(null);
  const [dropY, setDropY] = useState<number | null>(null);
  const translation = useRef(new Animated.Value(0)).current;
  const drag = useRef<Drag | null>(null);
  const handleNodes = useRef(new Map<number, number>());
  const pendingHandle = useRef<number | null>(null);
  const layouts = useRef(new Map<string, TargetRowLayout>());
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const viewport = useRef({ top: 0, height: 0 });
  const contentHeight = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };
  const clearDrag = () => {
    stopTimer();
    drag.current = null;
    scroll.current?.getNativeScrollRef()?.setNativeProps({ scrollEnabled: true });
    setDragged(null);
    setDropY(null);
    translation.setValue(0);
  };

  // Cancel an in-flight gesture if its targets, production or permissions change remotely.
  useEffect(() => {
    clearDrag();
  }, [targets, allowReorder, profileId, productionId]);
  useEffect(() => setColorTargetKey(null), [profileId, productionId]);
  useEffect(() => {
    colorRequest.current = null;
    setColors(null);
  }, [profileId]);
  useEffect(() => () => {
    stopTimer();
    drag.current = null;
  }, []);

  const move = async (from: number, to: number) => {
    if (colorTargetKey || saving.current || !useSessionStore.getState().allowTargetRearrange) return;
    const next = moveTargetOrder(useSessionStore.getState().targets, from, to);
    if (!next) return;
    saving.current = true;
    setBusy(true);
    setMessage('Saving…');
    try {
      await session.saveTargetOrder(next);
      setMessage('Saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save target order');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const updateDrag = (pageY: number) => {
    const active = drag.current;
    if (!active) return;
    active.pageY = pageY;
    const offset = pageY - active.startY + scrollY.current - active.startScroll;
    if (!active.moved && Math.abs(offset) < 4) return;
    active.moved = true;
    translation.setValue(offset);
    const row = active.rows[active.source]!;
    active.destination = targetOrderDropIndex(active.rows, active.source, row.y + row.height / 2 + offset);
    const others = active.rows.filter((_, index) => index !== active.source);
    const before = others[active.destination];
    const last = others.at(-1);
    setDropY(active.destination === active.source ? null : before?.y ?? (last ? last.y + last.height : null));
  };

  const beginDrag = (index: number, event: GestureResponderEvent) => {
    const state = useSessionStore.getState();
    if (saving.current || drag.current || !state.allowTargetRearrange || targets !== state.targets || targets.length < 2) return false;
    const rows = targets.map(target => layouts.current.get(talkTargetIdentity(target)));
    if (rows.some(row => !row)) return false;
    const pageY = event.nativeEvent.pageY;
    const active: Drag = {
      source: index, destination: index, startY: pageY, pageY, startScroll: scrollY.current,
      moved: false, rows: rows as TargetRowLayout[], targets,
      profileId: state.activeProfileId, productionId: state.productionId,
    };
    drag.current = active;
    // Lock UIKit's scroll recognizer immediately, before the React state update commits.
    scroll.current?.getNativeScrollRef()?.setNativeProps({ scrollEnabled: false });
    setDragged(index);
    scroll.current?.getNativeScrollRef()?.measureInWindow((_x, y, _width, height) => {
      if (drag.current === active) viewport.current = { top: y, height };
    });
    timer.current = setInterval(() => {
      if (drag.current !== active || !active.moved) return;
      const step = targetOrderScrollStep(active.pageY, viewport.current.top, viewport.current.height);
      const next = Math.max(0, Math.min(Math.max(0, contentHeight.current - viewport.current.height), scrollY.current + step));
      if (next === scrollY.current) return;
      scrollY.current = next;
      scroll.current?.scrollTo({ y: next, animated: false });
      updateDrag(active.pageY);
    }, 30);
    return true;
  };

  const finishDrag = (event?: GestureResponderEvent) => {
    if (event) updateDrag(event.nativeEvent.pageY);
    const active = drag.current;
    const state = useSessionStore.getState();
    clearDrag();
    if (!event || !active?.moved || active.targets !== state.targets || !state.allowTargetRearrange
      || active.profileId !== state.activeProfileId || active.productionId !== state.productionId) return;
    void move(active.source, active.destination);
  };

  const remove = async (target: TalkTarget) => {
    if (saving.current || drag.current || !useSessionStore.getState().allowTargetAddRemove) return;
    saving.current = true;
    setBusy(true);
    setMessage('Saving…');
    try { await session.editTargetSelection(target, 'remove'); setMessage('Saved'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove target'); }
    finally { saving.current = false; setBusy(false); }
  };

  const toggleColors = async (target: TalkTarget) => {
    const key = talkTargetIdentity(target);
    if (colorTargetKey === key) { setColorTargetKey(null); return; }
    setColorTargetKey(key);
    setMessage('');
    if (colors) return;
    const request = colorRequest.current ??= session.targetColors();
    try {
      const palette = await request;
      if (colorRequest.current === request) setColors(palette);
    } catch (error) {
      if (colorRequest.current === request) {
        setColorTargetKey(null);
        setMessage(error instanceof Error ? error.message : 'Could not load target colors');
      }
    } finally {
      if (colorRequest.current === request) colorRequest.current = null;
    }
  };

  const saveColor = async (target: TalkTarget, color: string | null) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setMessage('Saving…');
    try {
      await session.saveTargetColor(target, color);
      setColorTargetKey(null);
      setMessage('Saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save target color');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <View
      style={styles.scroll}
      collapsable={false}
      onStartShouldSetResponderCapture={event => {
        const index = [...handleNodes.current].find(([, tag]) => tag === Number(event.nativeEvent.target))?.[0];
        pendingHandle.current = index ?? null;
        return index !== undefined && !colorTargetKey && !saving.current && !drag.current
          && useSessionStore.getState().allowTargetRearrange && targets.length > 1;
      }}
      onResponderGrant={event => {
        const index = pendingHandle.current;
        pendingHandle.current = null;
        // React Native uses this return value to block native responders. The owner
        // must be ABOVE the ScrollView so UIKit sees it as a JS-responder ancestor.
        return index !== null && beginDrag(index, event);
      }}
      onResponderTerminationRequest={() => !drag.current}
      onResponderMove={event => updateDrag(event.nativeEvent.pageY)}
      onResponderRelease={finishDrag}
      onResponderTerminate={() => finishDrag()}
    >
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        scrollEnabled={dragged === null}
        canCancelContentTouches={dragged === null}
        bounces={false}
        scrollEventThrottle={16}
        removeClippedSubviews={false}
        onLayout={event => {
          const height = event.nativeEvent.layout.height;
          if (drag.current && height !== viewport.current.height) clearDrag();
          viewport.current.height = height;
        }}
        onContentSizeChange={(_width, height) => { contentHeight.current = height; }}
        onScroll={event => {
          scrollY.current = event.nativeEvent.contentOffset.y;
          if (drag.current) updateDrag(drag.current.pageY);
        }}
      >
        {targets.length === 0 ? (
          <SettingsSection><SettingsFootnote>No targets available.</SettingsFootnote></SettingsSection>
        ) : (
          <SettingsSection style={[styles.orderList, localStyles.list]}>
            {targets.map((target, index) => {
              const key = talkTargetIdentity(target);
              const disabled = busy || colorTargetKey !== null || targets.length < 2;
              const override = target.color && colorOverrides?.[target.color];
              const buttonColor = override ?? target.color;
              return (
                <Fragment key={key}>
                  <Animated.View
                    onLayout={event => { layouts.current.set(talkTargetIdentity(target), event.nativeEvent.layout); }}
                    style={[
                      styles.orderRow, index > 0 && styles.orderRowDivider,
                      dragged === index && { backgroundColor: palette.card, zIndex: 2, elevation: 4, opacity: 0.85, transform: [{ translateY: translation }] },
                    ]}
                  >
                    {allowReorder ? (
                      <View
                        ref={node => {
                          const tag = node ? findNodeHandle(node) : null;
                          if (tag !== null) handleNodes.current.set(index, tag);
                          else handleNodes.current.delete(index);
                        }}
                        collapsable={false}
                        style={styles.orderButton}
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityLabel={`Reorder ${target.label}`}
                        accessibilityHint="Drag up or down to move this target."
                        accessibilityState={{ disabled }}
                        accessibilityValue={{ min: 1, max: targets.length, now: index + 1 }}
                        accessibilityActions={[{ name: 'decrement', label: 'Move up' }, { name: 'increment', label: 'Move down' }]}
                        onAccessibilityAction={event => {
                          if (drag.current) return;
                          const action = event.nativeEvent.actionName;
                          if (action === 'decrement' || action === 'increment') void move(index, index + (action === 'decrement' ? -1 : 1));
                        }}
                      >
                        <View pointerEvents="none" accessible={false} style={localStyles.grip}>
                          {[0, 1, 2].map(line => <View key={line} style={[localStyles.gripLine, { backgroundColor: disabled ? palette.disabled : palette.link }]} />)}
                        </View>
                      </View>
                    ) : null}
                    <View style={styles.orderText}>
                      <Text style={styles.orderName} numberOfLines={1}>{target.label}</Text>
                      <Text style={styles.orderKind}>{arrangeKind(target)}</Text>
                    </View>
                    <SettingsButton style={[styles.orderButton, localStyles.paletteButton, buttonColor && { backgroundColor: buttonColor }]}
                      accessibilityLabel={colorTargetKey === key ? `Close colors for ${target.label}` : `Change color for ${target.label}`}
                      disabled={busy || dragged !== null} onPress={() => void toggleColors(target)}>
                      <PaletteIcon color={override ? targetColorForeground(override) : target.color ? '#f1f5f9' : palette.link} />
                    </SettingsButton>
                    {allowAddRemove ? (
                      <SettingsButton style={styles.orderButton} accessibilityLabel={`Remove ${target.label}`}
                        disabled={busy || dragged !== null} onPress={() => void remove(target)}>
                        <TrashIcon color={palette.danger} />
                      </SettingsButton>
                    ) : null}
                  </Animated.View>
                  {colorTargetKey === key ? (
                    <View style={localStyles.colors}>
                      {colors ? [{ name: 'None', value: null }, ...colors].map(({ name, value }) => {
                        const color = value && colorOverrides?.[value];
                        const selected = (target.color ?? null) === value;
                        return (
                          <SettingsButton key={name} disabled={busy}
                            accessibilityLabel={`${name}${selected ? ', selected' : ''}`}
                            style={[localStyles.colorOption, { backgroundColor: color ?? value ?? '#1f2937' }]}
                            onPress={() => void saveColor(target, value)}>
                            <Text accessible={false} style={[localStyles.colorLabel, value === null && !selected && localStyles.noneLabel,
                              color && { color: targetColorForeground(color) }]}>
                              {selected ? '✓' : value === null ? name : ''}
                            </Text>
                          </SettingsButton>
                        );
                      }) : <SettingsFootnote>Loading colors…</SettingsFootnote>}
                    </View>
                  ) : null}
                </Fragment>
              );
            })}
            {dropY !== null ? <View pointerEvents="none" style={[localStyles.dropLine, { top: dropY - 1, backgroundColor: palette.link }]} /> : null}
          </SettingsSection>
        )}
        {message ? <SettingsFootnote>{message}</SettingsFootnote> : null}
        <SettingsHint
          full={`${allowReorder ? 'Drag a target by its handle to change the order. ' : ''}Changes are saved for this production and are shared with the web client.`}
          compact={allowReorder ? 'Drag the handles to reorder. Changes are saved automatically.' : 'Changes are saved for this production.'}
        />
      </ScrollView>
    </View>
  );
}

const localStyles = StyleSheet.create({
  list: { overflow: 'visible' },
  grip: { width: 20, gap: 4 },
  gripLine: { height: 2, borderRadius: 1 },
  paletteButton: { borderRadius: 8 },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8 },
  colorOption: { minHeight: 52, flexBasis: '29%', flexGrow: 1, borderRadius: 8, borderWidth: 1, borderColor: '#a3afc2', alignItems: 'center', justifyContent: 'center' },
  colorLabel: { color: '#f1f5f9', fontSize: 21, fontWeight: '600' },
  noneLabel: { fontSize: 14 },
  dropLine: { position: 'absolute', left: 8, right: 8, height: 2, zIndex: 3 },
});
