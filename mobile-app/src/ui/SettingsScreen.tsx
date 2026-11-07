import {
  BackHandler,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ScreenStack, ScreenStackItem } from 'react-native-screens';

import { audioSessionStatusLabel } from '../audio/policy';
import { describeAudioRouteKind } from '../audio/routes';
import { loadTalkLinkToken } from '../talk/talkLink';
import { fgsStatusLabel } from '../background/fgs';
import { FEED_DIM_DB_OPTIONS, dimDbFromSliderPosition, sliderPositionFromDimDb } from '../session/operatorAudio';
import { mainButtonCandidates, mainButtonStorageKey, resolveMainButton } from '../session/mainButton';
import { session, useSessionStore } from '../session/store';
import { setSessionSheetDismissGestureEnabled, useSessionSheetOpen } from './sessionSheetState';
import { talkTargetIdentity, type TalkTarget } from '../protocol';
import { readNativeClientVersion } from '../protocol/clientVersion';
import { watchTargetCandidates, toggleWatchTarget, WATCH_REPLY_TARGET } from '../watch/selection';
import { describeWatchRemoteStatus, watchRemoteShortStatus, watchRemoteStatus } from '../watch/native';
import { PttAddDevicePage, PttDeviceDetailPage, PttDevicesPage } from './PttSettingsScreens';
import { ProfilesPage, SessionPage } from './SessionPage';
import {
  SettingsActionRow,
  SettingsFootnote,
  SettingsHeader,
  SettingsHint,
  SettingsNavRow,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
  SettingsThemeProvider,
  useSettingsStyles,
  useSettingsTheme,
} from './settingsChrome';
import { settingsPalette, settingsScheme } from './settingsTheme';
import { ArrangeTargetsPage, arrangeKind } from './ArrangeTargetsPage';
import { VolumeSlider } from './VolumeSlider';
import { IosSystemRoutePicker, iosSystemRoutePickerAvailable } from './IosSystemRoutePicker';

type SettingsPage =
  | { kind: 'session' }
  | { kind: 'profiles' }
  | { kind: 'layout' }
  | { kind: 'main-button' }
  | { kind: 'arrange' }
  | { kind: 'add-targets' }
  | { kind: 'audio' }
  | { kind: 'ptt' }
  | { kind: 'watch-targets' }
  | { kind: 'ptt-add' }
  | { kind: 'ptt-device'; id: string }
  | { kind: 'debug' };

const ROOT_PATH: SettingsPage[] = [{ kind: 'session' }];
const ACCESSORIES_PATH: SettingsPage[] = [{ kind: 'session' }, { kind: 'ptt' }];

const HIDDEN_HEADER = { hidden: true };

function pageKey(page: SettingsPage): string {
  return page.kind === 'ptt-device' ? `${page.kind}:${page.id}` : page.kind;
}

/**
 * The session sheet: Session is the root and settings categories / Profiles are pushed from it. App.tsx
 * presents it as a native sheet; the pages inside are a nested native stack, so slides and the
 * swipe back are iOS's own. Swiping back from Session closes the sheet. Mounted only while open,
 * so every opening starts on Session, or on Accessories (above Session) from the operator notice.
 */
export function SessionSheet({ onClose }: { onClose: () => void }) {
  const store = useSessionStore();
  const scheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const [path, setPath] = useState<SettingsPage[]>(() =>
    useSessionSheetOpen.getState().start === 'accessories' ? ACCESSORIES_PATH : ROOT_PATH,
  );
  const [sliderDragging, setSliderDragging] = useState(false);
  const targetEditorIndex = path.findIndex(page => page.kind === 'arrange');
  const targetEditorOpen = targetEditorIndex >= 0;
  useLayoutEffect(() => {
    setSessionSheetDismissGestureEnabled(!targetEditorOpen);
    return () => setSessionSheetDismissGestureEnabled(true);
  }, [targetEditorOpen]);
  const sheetColor = settingsPalette(settingsScheme(scheme)).sheet;

  useEffect(() => {
    session.refreshAudioDevices();
    return () => {
      void session.cancelButtonPairing();
    };
  }, []);

  const push = (page: SettingsPage) => setPath((current) => [...current, page]);
  const back = useCallback(() => setPath((current) => (current.length > 1 ? current.slice(0, -1) : current)), []);
  // iOS already removed the page (swipe back); keep our path in step. Index 0 is Session.
  const dismissedAt = (index: number) => {
    setPath((current) => current.slice(0, index));
    if (index === 0) {
      onClose();
    }
  };

  // Android back goes up one page, and closes the sheet from Session.
  const latest = useRef({ depth: path.length, back, onClose });
  latest.current = { depth: path.length, back, onClose };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const { depth, back: goBack, onClose: close } = latest.current;
      if (depth > 1) {
        goBack();
      } else {
        close();
      }
      return true;
    });
    return () => subscription.remove();
  }, []);

  const pageActions = {
    showPttList: back,
    onClose,
    onOpenProfiles: () => push({ kind: 'profiles' }),
    onOpenLayout: () => push({ kind: 'layout' }),
    onOpenMainButton: () => push({ kind: 'main-button' }),
    onOpenArrange: () => push({ kind: 'arrange' }),
    onOpenAddTargets: () => push({ kind: 'add-targets' }),
    onOpenAudio: () => push({ kind: 'audio' }),
    onOpenAccessories: () => push({ kind: 'ptt' }),
    onOpenWatchTargets: () => push({ kind: 'watch-targets' }),
    onOpenDebug: () => push({ kind: 'debug' }),
    onAddDevice: () => push({ kind: 'ptt-add' }),
    onOpenDevice: (id: string) => push({ kind: 'ptt-device', id }),
  };

  const renderPage = (page: SettingsPage, index: number) => (
    <SettingsSheet
      {...pageActions}
      header={headerForPage(
        page,
        store.bleBindings.find((item) => page.kind === 'ptt-device' && item.id === page.id)?.name,
      )}
      page={page}
      onBack={index > 0 ? back : undefined}
      scrollEnabled={!sliderDragging}
      onDimSliding={setSliderDragging}
    />
  );

  // Android: plain views, current page only. Inside react-native-screens the
  // sheet ignored every tap on several phones (thepoison606/talktome#186);
  // the hardware back button above still goes up one page.
  if (Platform.OS === 'android') {
    const index = path.length - 1;
    const page = path[index] ?? ROOT_PATH[0] ?? { kind: 'session' };
    return (
      <SettingsThemeProvider scheme={scheme}>
        <View key={pageKey(page)} style={[stackStyles.stack, { backgroundColor: sheetColor }]}>
          {renderPage(page, index)}
        </View>
      </SettingsThemeProvider>
    );
  }

  // Use the same native presentation system as the settings stack. A React Native
  // Modal around ScreenStack installs two surface touch handlers: every tap is
  // delivered twice and the second delivery terminates the first responder.
  const editor = targetEditorOpen ? (
    <ScreenStackItem
      key="target-editor-modal"
      screenId="target-editor-modal"
      headerConfig={HIDDEN_HEADER}
      stackPresentation="fullScreenModal"
      stackAnimation="none"
      gestureEnabled={false}
      contentStyle={{ backgroundColor: sheetColor }}
    >
      <SafeAreaView style={stackStyles.stack}>
        <ScreenStack style={stackStyles.stack}>
          {/* A real parent controller gives UIKit an interactive pop destination. */}
          <ScreenStackItem
            screenId="editor-parent"
            headerConfig={HIDDEN_HEADER}
            gestureEnabled={false}
            contentStyle={{ backgroundColor: sheetColor }}
          >
            {renderPage(path[targetEditorIndex - 1]!, targetEditorIndex - 1)}
          </ScreenStackItem>
          {path.slice(targetEditorIndex).map((page, offset) => {
            const index = targetEditorIndex + offset;
            return (
              <ScreenStackItem
                key={pageKey(page)}
                screenId={`editor:${pageKey(page)}`}
                headerConfig={HIDDEN_HEADER}
                gestureEnabled
                fullScreenSwipeEnabled={false}
                onDismissed={() => dismissedAt(index)}
                contentStyle={{ backgroundColor: sheetColor }}
              >
                {renderPage(page, index)}
              </ScreenStackItem>
            );
          })}
        </ScreenStack>
      </SafeAreaView>
    </ScreenStackItem>
  ) : null;

  const stackView = (
    <ScreenStack style={stackStyles.stack}>
      {/* Empty page under Session: swiping Session away lands here and closes the sheet. */}
      <ScreenStackItem
        screenId="close"
        headerConfig={HIDDEN_HEADER}
        gestureEnabled={false}
        contentStyle={{ backgroundColor: sheetColor }}
      >
        <View />
      </ScreenStackItem>
      {(targetEditorOpen ? path.slice(0, targetEditorIndex) : path).map((page, index) => (
        <ScreenStackItem
          key={pageKey(page)}
          screenId={pageKey(page)}
          headerConfig={HIDDEN_HEADER}
          gestureEnabled
          // Keep the back swipe on the edge while a page handles its own drag gestures.
          fullScreenSwipeEnabled={page.kind !== 'audio'}
          onDismissed={() => dismissedAt(index)}
          contentStyle={{ backgroundColor: sheetColor }}
        >
          {renderPage(page, index)}
        </ScreenStackItem>
      ))}
      {editor}
    </ScreenStack>
  );

  // iPad page sheets cannot be dismissed by tapping beside them.
  const content = Platform.OS === 'ios' && Platform.isPad ? (
    <View style={padStyles.backdrop}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View style={[
        padStyles.panel,
        { width: Math.min(PAD_SHEET_MAX_WIDTH, width - 48), height: Math.round(height * 0.86) },
      ]}>
        {stackView}
      </View>
    </View>
  ) : stackView;

  return <SettingsThemeProvider scheme={scheme}>{content}</SettingsThemeProvider>;
}

const stackStyles = StyleSheet.create({
  stack: {
    flex: 1,
  },
});

const PAD_SHEET_MAX_WIDTH = 620;

const padStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  panel: {
    borderRadius: 14,
    overflow: 'hidden',
  },
});

function SettingsSheet({
  header,
  page,
  onBack,
  onClose,
  scrollEnabled,
  onDimSliding,
  onOpenProfiles,
  onOpenLayout,
  onOpenMainButton,
  onOpenArrange,
  onOpenAddTargets,
  onOpenAudio,
  onOpenAccessories,
  onOpenWatchTargets,
  onOpenDebug,
  onAddDevice,
  onOpenDevice,
  showPttList,
}: {
  header: { title: string; backLabel: string };
  page: SettingsPage;
  onBack?: () => void;
  onClose: () => void;
  scrollEnabled: boolean;
  onDimSliding: (active: boolean) => void;
  onOpenProfiles: () => void;
  onOpenLayout: () => void;
  onOpenMainButton: () => void;
  onOpenArrange: () => void;
  onOpenAddTargets: () => void;
  onOpenAudio: () => void;
  onOpenAccessories: () => void;
  onOpenWatchTargets: () => void;
  onOpenDebug: () => void;
  onAddDevice: () => void;
  onOpenDevice: (id: string) => void;
  showPttList: () => void;
}) {
  const store = useSessionStore();
  const styles = useSettingsStyles();

  return (
    // Android presents the sheet inside the app's padded safe area, so no extra inset or status bar style here.
    <View style={styles.sheet}>
      <SettingsHeader
        title={header.title}
        backLabel={header.backLabel}
        onBack={onBack}
        onDone={onClose}
        onAdd={page.kind === 'arrange' && store.identity?.kind === 'user' && store.allowTargetAddRemove ? onOpenAddTargets : undefined}
      />

      {page.kind === 'arrange' ? <ArrangeTargetsPage /> : (
        <ScrollView scrollEnabled={scrollEnabled} style={styles.scroll} contentContainerStyle={styles.body}>
          {page.kind === 'session' ? (
            <SessionPage
              onClose={onClose}
              onOpenLayout={onOpenLayout}
              onOpenAudio={onOpenAudio}
              onOpenAccessories={onOpenAccessories}
              onOpenDebug={onOpenDebug}
              onOpenProfiles={onOpenProfiles}
            />
          ) : null}
          {page.kind === 'profiles' ? <ProfilesPage onClose={onClose} /> : null}

          {page.kind === 'layout' ? (
            <LayoutSettingsPage onOpenMainButton={onOpenMainButton} onOpenArrange={onOpenArrange} />
          ) : null}
          {page.kind === 'main-button' ? <MainButtonSettingsPage /> : null}
          {page.kind === 'add-targets' ? <AddTargetsPage /> : null}
          {page.kind === 'audio' ? <AudioSettingsPage onDimSliding={onDimSliding} /> : null}

          {page.kind === 'ptt' ? (
            <>
              <PttDevicesPage onAddDevice={onAddDevice} onOpenDevice={onOpenDevice} />
              {Platform.OS === 'ios' ? <WatchSettingsSection onOpenTargets={onOpenWatchTargets} /> : null}
            </>
          ) : null}

          {page.kind === 'watch-targets' ? <WatchTargetsSettingsPage /> : null}

          {page.kind === 'ptt-add' ? <PttAddDevicePage onBound={showPttList} /> : null}

          {page.kind === 'ptt-device' ? (
            <PttDeviceDetailPage deviceId={page.id} onDeleted={showPttList} />
          ) : null}

          {page.kind === 'debug' ? <DebugSettingsPage /> : null}
        </ScrollView>
      )}
    </View>
  );
}

function headerForPage(page: SettingsPage, deviceName?: string): { title: string; backLabel: string } {
  switch (page.kind) {
    case 'session':
      return { title: 'Session', backLabel: 'Session' };
    case 'profiles':
      return { title: 'Profiles', backLabel: 'Session' };
    case 'layout':
      return { title: 'Layout', backLabel: 'Session' };
    case 'main-button':
      return { title: 'Main button target', backLabel: 'Layout' };
    case 'arrange':
      return { title: 'Edit targets', backLabel: 'Layout' };
    case 'add-targets':
      return { title: 'Add targets', backLabel: 'Edit targets' };
    case 'audio':
      return { title: 'Audio', backLabel: 'Session' };
    case 'ptt':
      return { title: 'Accessories', backLabel: 'Session' };
    case 'watch-targets':
      return { title: 'Watch targets', backLabel: 'Accessories' };
    case 'ptt-add':
      return { title: 'Add a device', backLabel: 'Accessories' };
    case 'ptt-device':
      return { title: deviceName || 'Accessory', backLabel: 'Accessories' };
    case 'debug':
      return { title: 'Debug', backLabel: 'Session' };
  }
}

function LayoutSettingsPage({
  onOpenMainButton,
  onOpenArrange,
}: {
  onOpenMainButton: () => void;
  onOpenArrange: () => void;
}) {
  const store = useSessionStore();
  const audio = store.operatorAudio;
  const main = resolveMainButton({
    storedIdentity: store.mainButtonTargets[mainButtonStorageKey(store.activeProfileId, store.productionId)],
    targets: store.targets,
    replyTarget: store.replyTarget,
    canTalk: (target) => session.canTalkTo(target),
  });
  const canArrange = store.identity?.kind === 'user' && (store.allowTargetRearrange || store.allowTargetAddRemove);

  return (
    <>
      <SettingsSection>
        <SettingsSwitchRow
          label="Left-handed"
          value={store.leftHanded}
          onValueChange={(value) => session.setLeftHanded(value)}
        />
        <SettingsHint
          full="Moves the volume ring and the phone-landscape Reply column to the left, and slides right to lock — same as the web client. Tablets keep Reply on the bottom."
          compact="Volume and phone-landscape Reply move left. Slide right to lock."
        />
        <SettingsNavRow label="Main button target" value={main.label} onPress={onOpenMainButton} />
        <SettingsHint
          full="Chooses what the bottom button does. Reply follows the last caller. A named target always talks to that target. Cards still talk on their own, same as the web client."
          compact="Sets the bottom button. Cards still talk on their own."
        />
        <SettingsSwitchRow
          label="Big main button"
          value={store.bigMainButton}
          onValueChange={(value) => session.setBigMainButton(value)}
        />
        <SettingsHint
          full="Makes the bottom button taller so it is harder to miss. Off until you turn it on."
          compact="Taller bottom button. Off until you turn it on."
        />
        {canArrange ? (
          <SettingsNavRow label="Edit targets" onPress={onOpenArrange} />
        ) : null}
        <SettingsSwitchRow
          label="Lock multiple targets"
          value={store.lockMultipleTargets}
          onValueChange={(value) => session.setLockMultipleTargets(value)}
        />
        <SettingsHint
          full="Slide-to-lock adds targets to the locked set instead of replacing it. Tap a locked card to drop just that target — same as the web client."
          compact="Slide-to-lock adds targets. Tap a locked card to drop it."
        />
        <SettingsSwitchRow
          label="Horizontal volume fader"
          value={audio.volumeFader}
          onValueChange={(value) => session.setOperatorAudio({ volumeFader: value })}
        />
        <SettingsHint
          full="Replaces the plus/minus buttons in the volume overlay and conference member list with a slider."
          compact="Uses a slider instead of plus/minus."
        />
      </SettingsSection>
    </>
  );
}

function MainButtonSettingsPage() {
  const store = useSessionStore();
  const key = mainButtonStorageKey(store.activeProfileId, store.productionId);
  const stored = store.mainButtonTargets[key] ?? '';
  const selfId = store.identity?.kind === 'user' ? store.identity.id : null;
  const candidates = mainButtonCandidates(store.targets, selfId);
  const known = candidates.some((target) => talkTargetIdentity(target) === stored);

  return (
    <SettingsSection>
      <SettingsRow label="Reply" selected={!stored} onPress={() => session.setMainButtonTarget('')} />
      {candidates.map((target) => {
        const identity = talkTargetIdentity(target);
        const kind = target.type === 'conference' ? 'Conference' : 'User';
        return (
          <SettingsRow
            key={identity}
            label={target.label}
            value={kind}
            selected={stored === identity}
            onPress={() => session.setMainButtonTarget(identity)}
          />
        );
      })}
      {stored && !known ? <SettingsRow label="Unavailable target" value="Saved" selected /> : null}
      <SettingsHint
        full="Reply is the web client default. Pick a target to pin the bottom button. The choice is saved for this profile and production."
        compact="Reply, or pin one target. Saved for this production."
      />
    </SettingsSection>
  );
}

function AddTargetsPage() {
  const productionId = useSessionStore(state => state.productionId);
  const profileId = useSessionStore(state => state.activeProfileId);
  const allowed = useSessionStore(state => state.allowTargetAddRemove);
  const targets = useSessionStore(state => state.targets);
  const [available, setAvailable] = useState<TalkTarget[]>([]);
  const [message, setMessage] = useState('Loading…');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setAvailable([]);
    if (!allowed) { setMessage('This account cannot add or remove targets.'); return; }
    setMessage('Loading…');
    void session.availableTargets().then(items => { if (active) { setAvailable(items); setMessage(''); } })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load targets'); });
    return () => { active = false; };
  }, [productionId, profileId, allowed]);
  const selected = new Set(targets.map(talkTargetIdentity));
  const choices = allowed ? available.filter(target => !selected.has(talkTargetIdentity(target))) : [];
  const add = async (target: TalkTarget) => {
    if (busy || !allowed) return;
    setBusy(true); setMessage('Saving…');
    try { await session.editTargetSelection(target, 'add'); setMessage('Added'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add target'); }
    finally { setBusy(false); }
  };
  return <>
    <SettingsSection>{choices.map(target => <SettingsActionRow key={talkTargetIdentity(target)}
      label={`＋ ${target.label} · ${arrangeKind(target)}`} disabled={busy} onPress={() => void add(target)} />)}</SettingsSection>
    {message ? <SettingsFootnote>{message}</SettingsFootnote> : choices.length === 0 ? <SettingsFootnote>All available targets are already added.</SettingsFootnote> : null}
  </>;
}

function AudioSettingsPage({ onDimSliding }: { onDimSliding: (active: boolean) => void }) {
  const store = useSessionStore();
  const audio = store.operatorAudio;
  const styles = useSettingsStyles();
  const { scheme } = useSettingsTheme();

  return (
    <>
      <SettingsSection title="Incoming audio">
        <SettingsSwitchRow
          label="Dim feeds when addressed"
          value={audio.feedDimIncoming}
          onValueChange={(value) => session.setOperatorAudio({ feedDimIncoming: value })}
        />
        <SettingsSwitchRow
          label="Dim feeds while speaking"
          value={audio.feedDimSelf}
          onValueChange={(value) => session.setOperatorAudio({ feedDimSelf: value })}
        />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Dim amount</Text>
          <Text style={styles.rowValue}>{audio.feedDimDb} dB</Text>
        </View>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderHint}>{FEED_DIM_DB_OPTIONS[0]}</Text>
          <VolumeSlider
            light={scheme === 'light'}
            flex
            accessibilityLabel="Dim amount"
            value={sliderPositionFromDimDb(audio.feedDimDb)}
            stepCount={FEED_DIM_DB_OPTIONS.length}
            quantize={(position) => sliderPositionFromDimDb(dimDbFromSliderPosition(position))}
            onSliding={onDimSliding}
            onChange={(position) => session.setOperatorAudio({ feedDimDb: dimDbFromSliderPosition(position) })}
          />
          <Text style={styles.sliderHint}>{FEED_DIM_DB_OPTIONS[FEED_DIM_DB_OPTIONS.length - 1]}</Text>
        </View>
        <SettingsHint
          full="Same defaults as the web client: dim when someone calls you, not while you talk, by 15 dB."
          compact="Dim when called, not while you talk. Default 15 dB."
        />
      </SettingsSection>

      <SettingsSection title="Connection">
        <SettingsSwitchRow
          label="Play connection sounds"
          value={audio.playConnectionSounds}
          onValueChange={(value) => session.setOperatorAudio({ playConnectionSounds: value })}
        />
        <SettingsHint
          full="Plays the disconnected and reconnected tones. The server’s Play connection sounds default applies until you change this. Pause and sign-out stay silent either way."
          compact="Disconnected and reconnected tones. Uses the server default until you change it."
        />
      </SettingsSection>

      <SettingsSection title="Microphone and speaker">
        {Platform.OS === 'ios' && iosSystemRoutePickerAvailable ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <SettingsRow label="Audio output" value={store.audioOutputLabel} />
            </View>
            <View collapsable={false} style={{ width: 48, height: 48, marginRight: 10 }}>
              <IosSystemRoutePicker />
            </View>
          </View>
        ) : store.audioRoutes.map((route) => (
          <SettingsRow
            key={route.id}
            label={route.label}
            value={route.selected ? 'Selected' : describeAudioRouteKind(route.kind)}
            selected={route.selected}
            onPress={() => void session.selectAudioDevice(route.id)}
          />
        ))}
        <SettingsHint
          full={Platform.OS === 'ios'
            ? 'Choose the output with the iOS audio menu. Audio stays in communication mode so echo cancellation can run.'
            : 'In-call style combos: phone earpiece, speaker, or a connected headset. Audio stays in communication mode so echo cancellation can run.'}
          compact={Platform.OS === 'ios'
            ? 'Choose the output with the iOS audio menu.'
            : 'Earpiece, speaker, or headset. Stays in communication mode.'}
        />
      </SettingsSection>

      <SettingsSection title="Voice processing">
        <SettingsSwitchRow
          label="Echo cancellation"
          value={audio.echoCancellation}
          onValueChange={(value) => session.setOperatorAudio({ echoCancellation: value })}
        />
        <SettingsFootnote>
          {processingLine('Echo cancellation', audio.echoCancellation, store.captureEchoCancellation, store.audioVoiceProcessing)}
        </SettingsFootnote>
        <SettingsSwitchRow
          label="Noise suppression"
          value={audio.noiseSuppression}
          onValueChange={(value) => session.setOperatorAudio({ noiseSuppression: value })}
        />
        <SettingsFootnote>
          {processingLine('Noise suppression', audio.noiseSuppression, store.captureNoiseSuppression, store.audioVoiceProcessing)}
        </SettingsFootnote>
        <SettingsSwitchRow
          label="Auto gain"
          value={audio.autoGainControl}
          onValueChange={(value) => session.setOperatorAudio({ autoGainControl: value })}
        />
        <SettingsFootnote>
          {processingLine('Auto gain', audio.autoGainControl, store.captureAutoGainControl, store.audioVoiceProcessing)}
          {store.audioVoiceProcessing ? ' Voice-processing session is on.' : ' Voice-processing session is off.'}
        </SettingsFootnote>
      </SettingsSection>
    </>
  );
}

function WatchSettingsSection({ onOpenTargets }: { onOpenTargets: () => void }) {
  const selections = useSessionStore(state => state.watchTargetSelections);
  const profileId = useSessionStore(state => state.activeProfileId);
  const productionId = useSessionStore(state => state.productionId);
  const [status, setStatus] = useState(watchRemoteStatus);
  useEffect(() => {
    // Installation can change while this settings sheet remains open.
    const timer = setInterval(() => setStatus(watchRemoteStatus()), 2000);
    return () => clearInterval(timer);
  }, []);
  const selected = selections[mainButtonStorageKey(profileId, productionId)];
  const summary = selected === undefined ? 'All targets'
    : selected.length === 1 ? '1 target' : `${selected.length} targets`;
  return (
    <SettingsSection title="Apple Watch">
      <SettingsRow label="Remote" value={watchRemoteShortStatus(status)} />
      {status.appInstalled ? <SettingsNavRow label="Watch targets" value={summary} onPress={onOpenTargets} /> : null}
      <SettingsHint
        full={`${describeWatchRemoteStatus(status)} Choose one full-screen target, two fixed buttons, or a list for more targets. In full screen, hold and swipe left to lock; tap to stop. Audio stays on the iPhone.`}
        compact={`${describeWatchRemoteStatus(status)} Choose one or more targets. Audio stays on the iPhone.`}
      />
    </SettingsSection>
  );
}

function WatchTargetsSettingsPage() {
  const store = useSessionStore();
  const scope = mainButtonStorageKey(store.activeProfileId, store.productionId);
  const selected = store.watchTargetSelections[scope];
  const selfId = store.identity?.kind === 'user' ? store.identity.id : null;
  const candidates = watchTargetCandidates(store.targets, selfId);
  const known = new Set(candidates.map(talkTargetIdentity));
  const unavailable = (selected ?? []).filter(key => key !== WATCH_REPLY_TARGET && !known.has(key));
  const toggle = (key: string) => session.setWatchTargets(toggleWatchTarget(selected, key));
  return (
    <>
      <SettingsSection>
        <SettingsRow label="All talk targets" selected={selected === undefined} onPress={() => session.setWatchTargets(null)} />
        <SettingsHint
          full="All targets follows the phone. Tap targets below to choose a custom selection. One selected target fills the Watch screen; two use fixed buttons, more use the list. Saved for this profile and production."
          compact="One target fills the screen; two use buttons, more use the list. Saved for this production."
        />
      </SettingsSection>
      <SettingsSection title="Choose targets">
        <SettingsRow multiple label="Reply" value="Latest caller" selected={selected?.includes(WATCH_REPLY_TARGET)} onPress={() => toggle(WATCH_REPLY_TARGET)} />
        {candidates.map(target => {
          const key = talkTargetIdentity(target);
          return <SettingsRow multiple key={key} label={target.label}
            value={target.type === 'conference' ? 'Conference' : session.canTalkTo(target) ? 'User' : 'Offline'}
            selected={selected?.includes(key)} onPress={() => toggle(key)} />;
        })}
        {unavailable.map(key => <SettingsRow multiple key={key} label="Unavailable target" value="Saved" selected onPress={() => toggle(key)} />)}
        {selected?.length === 0 ? <SettingsHint full="No targets selected. Choose one or more targets to use the Watch remote." compact="Choose at least one Watch target." /> : null}
      </SettingsSection>
    </>
  );
}

function DebugSettingsPage() {
  const store = useSessionStore();
  const [{ clientVersion, clientBuild }] = useState(readNativeClientVersion);
  const [talkLinkToken, setTalkLinkToken] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadTalkLinkToken()
      .then((token) => {
        if (!cancelled) {
          setTalkLinkToken(token);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTalkLinkToken('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SettingsSection title="App">
        <SettingsRow label="Version" value={clientVersion || 'Unknown'} />
        <SettingsRow label="Build" value={clientBuild || 'Unknown'} />
      </SettingsSection>
      <SettingsSection title="Session">
        <SettingsRow
          label="Background"
          value={
            Platform.OS === 'ios'
              ? audioSessionStatusLabel({
                  platform: 'ios',
                  available: store.audioSessionAvailable,
                  active: store.audioSessionActive,
                  keepalive: store.audioKeepalive,
                })
              : fgsStatusLabel({
                  available: store.fgsAvailable,
                  running: store.fgsRunning,
                  platform: Platform.OS,
                })
          }
        />
        <SettingsRow label="Talk lock" value="Slide to lock" />
        <SettingsRow label="Server version" value={store.serverAppVersion || 'Unknown'} />
        <SettingsRow
          label="Incoming audio"
          value={`${store.activeRemoteCount} live / ${store.overBudget ? 'over budget' : 'ok'}`}
        />
        <SettingsRow label="Used mic" value={store.audioInputLabel || store.captureMicLabel} />
        <SettingsRow label="Used speaker" value={store.audioOutputLabel} />
        {store.capabilityReason ? <SettingsFootnote>{store.capabilityReason}</SettingsFootnote> : null}
        {store.mediaDebug ? <SettingsFootnote>{store.mediaDebug}</SettingsFootnote> : null}
        <SettingsHint
          full="Camera tally uses a red PGM frame or a green preview frame, same as the web client. Incoming audio follows the selected production."
          compact="PGM is a red frame, preview is green. Audio follows the production."
        />
      </SettingsSection>

      <SettingsSection title={Platform.OS === 'ios' ? 'Shortcuts' : 'Hardware PTT'}>
        {Platform.OS === 'ios' ? (
          <>
            <SettingsHint
              full="Lock Screen, Dynamic Island, and the home widget have Reply lock and Disconnect. On iOS 18, the same controls can be added to Control Center or the Action Button."
              compact="Lock Screen and the widget have Reply lock and Disconnect."
            />
            {talkLinkToken ? (
              <SettingsFootnote>
                {`talktome://talk is ignored unless the link includes ?token=${talkLinkToken}`}
              </SettingsFootnote>
            ) : null}
          </>
        ) : (
          <SettingsHint
            full="Android hardware PTT uses BLE, Classic serial, USB-C, and onboard keys. Pair accessories under Accessories."
            compact="Hardware PTT: BLE, serial, USB-C, and phone keys."
          />
        )}
      </SettingsSection>

      {Platform.OS === 'android' ? (
        <SettingsSection title="Battery">
          <SettingsActionRow label="Battery settings" onPress={() => void session.openBatteryEducation()} />
          <SettingsHint
            full="Set TalkToMe to Unrestricted (Samsung: Device care) if the session dies after Home or screen-off. This does not promise every OEM."
            compact="Set TalkToMe to Unrestricted if the session dies after Home."
          />
        </SettingsSection>
      ) : null}

      {store.pttHardwareLog.length > 0 ? (
        <SettingsSection title="PTT hardware">
          {store.pttHardwareLog.slice(-12).map((line, index) => (
            <SettingsFootnote key={`${index}-${line}`}>{line}</SettingsFootnote>
          ))}
        </SettingsSection>
      ) : null}
    </>
  );
}

function processingLine(
  label: string,
  requested: boolean,
  applied: boolean | null,
  voiceProcessing: boolean,
): string {
  if (applied === true) {
    return `${label} is on.`;
  }
  if (applied === false) {
    return requested ? `${label} was requested but the track reports off.` : `${label} is off.`;
  }
  if (requested && voiceProcessing) {
    return `${label} is requested and the call session is using voice processing.`;
  }
  if (requested) {
    return `${label} is requested.`;
  }
  return `${label} is off.`;
}
