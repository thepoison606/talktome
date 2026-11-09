import {
  asRecord, PANEL_AUDIO_DEFAULTS, parsePanelAudioSettings, parsePanelAudioState, parsePanelCommand,
  parsePanelSettings, positiveId, type PanelAudioSettings, type PanelAudioState, type PanelClientReport,
  type PanelCommand, type PanelCommandResult, type PanelSettings,
} from '../protocol/remotePanel';
import { defaultAudioPreference, talkTargetIdentity, type TalkTarget } from '../protocol';
import type { AudioProfileName } from '../protocol/clientDefaults';
import { mainButtonStorageKey } from './mainButton';
import { EMPTY_CONFERENCE_LISTEN, setConferenceMemberLevel, setConferenceMemberListening, type ConferenceListenState } from './conferenceListen';
import type { SessionUiState } from './state';

export type PanelSessionState = Pick<SessionUiState,
  'identity' | 'operatorReady' | 'activeProfileId' | 'productionId' | 'productions' | 'mainButtonTargets'
  | 'audioPreferences' | 'conferenceListen' | 'stoppedFeedKeys' | 'operatorAudio' | 'leftHanded'
  | 'lockMultipleTargets' | 'audioRoutes' | 'audioSessionAvailable' | 'talking' | 'talkingTargetKeys'
  | 'lockedTargetKeys' | 'targets' | 'replyTarget' | 'bigMainButton'>;

export type RemotePanelHost = {
  systemAudioRouting?: boolean;
  state(): PanelSessionState;
  subscribe(listener: (state: PanelSessionState, previous: PanelSessionState) => void): () => void;
  defaultAudioProfile(): AudioProfileName;
  applyAudioSettings(settings: PanelAudioSettings): Promise<void>;
  applyAudioStates(states: PanelAudioState[], replace: boolean): Promise<void>;
  applyConferenceListen(state: ConferenceListenState): Promise<void>;
  applyStoppedFeeds(keys: string[]): Promise<void>;
  applyMainButtons(targets: Record<string, string>): Promise<void>;
  applyHotkeys?(storage: Record<string, string>): Promise<void>;
  readHotkeys?(productionId: number | null): unknown;
  selectAudioRoute(id: string): Promise<void>;
  selectProduction(id: number): Promise<void>;
  refreshTargets(): Promise<void>;
  press(inputKey: string, target: TalkTarget): Promise<void>;
  release(inputKey: string): Promise<void>;
  lock(target: TalkTarget): Promise<void>;
  unlock(target: TalkTarget): Promise<void>;
  stopTalk(): Promise<void>;
  discardRemoteHolds(): void;
  report(report: PanelClientReport): void;
  audioSnapshot(states: PanelAudioState[], revision: number): void;
  saveAudioSettings(settings: PanelAudioSettings, revision: number): Promise<{ ok?: boolean }>;
};

const BROWSER_ONLY_AUDIO_KEYS = ['userInputGainDb', 'voiceTriggerEnabled', 'voiceTriggerTarget', 'voiceTriggerThresholdDb'] as const;

/** Maps the server's browser panel contract onto the native operator runtime. */
export class RemotePanelCoordinator {
  private enabled = false;
  private revision = 0;
  private storage: Record<string, string> = {};
  private wireProductionId: number | null = null;
  private audioBase: PanelAudioSettings = { ...PANEL_AUDIO_DEFAULTS };
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private inputTokens = new Map<string, symbol>();
  private applying = 0;
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private lastAudioSettings = '';
  private pendingMainButtons = false;
  private pendingRouteId?: string;
  private initializing = false;

  constructor(private readonly host: RemotePanelHost) {}

  get audioProfile(): AudioProfileName | undefined {
    return this.enabled ? this.audioBase.audioProfile : undefined;
  }

  reset(): void {
    this.epoch++;
    this.enabled = false;
    this.applying = 0;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    clearInterval(this.heartbeat); this.heartbeat = undefined;
    this.inputTokens.clear();
    this.storage = {};
    this.pendingMainButtons = false;
    this.pendingRouteId = undefined;
    this.initializing = false;
    this.wireProductionId = null;
    this.lastAudioSettings = '';
    this.queue = Promise.resolve();
    this.host.discardRemoteHolds();
  }

  disconnected(): void {
    this.epoch++;
    this.enabled = false;
    this.applying = 0;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    clearInterval(this.heartbeat); this.heartbeat = undefined;
    this.inputTokens.clear();
    this.host.discardRemoteHolds();
  }

  noteProduction(id: number | null): void {
    this.wireProductionId = id;
  }

  async restoreRegistration(value: unknown): Promise<void> {
    this.reset();
    const registration = asRecord(value);
    const settings = parsePanelSettings(registration?.panelSettings);
    if (!settings || this.host.state().identity?.kind !== 'user') return; // Older servers and guests.
    this.enabled = true;
    this.initializing = true;
    this.wireProductionId = positiveId(registration?.productionId);
    this.revision = settings.revision;
    this.audioBase = { ...PANEL_AUDIO_DEFAULTS, audioProfile: this.host.defaultAudioProfile() };
    const audio = parsePanelAudioSettings(registration?.userAudioSettings);
    const epoch = this.epoch;
    await this.withApplying(async () => {
      if (audio) {
        // Native capture has no manual gain or level-triggered Talk.
        this.audioBase = { ...audio, userInputGainDb: 18, voiceTriggerEnabled: false, voiceTriggerTarget: '', voiceTriggerThresholdDb: -32 };
        await this.host.applyAudioSettings(this.audioBase);
        this.ensureCurrent(epoch);
      }
      if (Array.isArray(registration?.targetAudioStates)) {
        const states = registration.targetAudioStates.map(parsePanelAudioState).filter((state): state is PanelAudioState => state !== null);
        if (states.length || settings.revision > 0) await this.host.applyAudioStates(states, true);
        this.ensureCurrent(epoch);
      }
      this.storage = this.ownStorage(settings.storage);
      // Import legacy device-local preferences on the first connection.
      if (settings.revision > 0 || Object.keys(this.storage).length > 0) await this.applyStoredPreferences(false);
    });
    this.ensureCurrent(epoch);
    this.initializing = false;
  }

  async operatorReady(): Promise<void> {
    if (!this.enabled || !this.host.state().operatorReady) return;
    const epoch = this.epoch;
    if (this.pendingMainButtons) await this.withApplying(() => this.applyMainButtons());
    if (this.pendingRouteId) {
      const id = this.pendingRouteId;
      this.pendingRouteId = undefined;
      const state = this.host.state();
      if (state.audioSessionAvailable && state.audioRoutes.some(route => route.id === id)) {
        await this.withApplying(() => this.host.selectAudioRoute(id));
      }
    }
    this.ensureCurrent(epoch);
    this.unsubscribe?.();
    this.unsubscribe = this.host.subscribe((state, previous) => {
      if (this.applying || !this.enabled) return;
      if (['audioPreferences', 'conferenceListen', 'stoppedFeedKeys', 'operatorAudio', 'leftHanded',
        'lockMultipleTargets', 'mainButtonTargets', 'productionId', 'targets', 'audioRoutes', 'talking',
        'talkingTargetKeys', 'lockedTargetKeys', 'replyTarget'].some(key => state[key as keyof PanelSessionState] !== previous[key as keyof PanelSessionState])) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.publish(true), 100);
      }
    });
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => this.publish(true), 5000);
    this.publish(true);
  }

  report(): PanelClientReport | undefined {
    const state = this.host.state();
    if (!this.enabled || this.initializing || state.identity?.kind !== 'user') return undefined;
    const userId = positiveId(state.identity.id);
    if (userId == null) return undefined;
    const productionId = state.productionId ?? this.wireProductionId;
    const storage = { ...this.storage };
    storage[`conferenceListenExclusions:user:${userId}`] = JSON.stringify(state.conferenceListen.excluded);
    storage[`conferenceMemberLevels:user:${userId}`] = JSON.stringify(state.conferenceListen.levels);
    storage[`stoppedFeeds:user:${userId}`] = JSON.stringify(Object.fromEntries(state.stoppedFeedKeys.map(key => [key, true])));
    const mainKey = mainButtonStorageKey(state.activeProfileId, state.productionId);
    const mainIdentity = state.mainButtonTargets[mainKey];
    const wireMainKey = `mainButtonTarget:user:${userId}:${productionId ?? 'default'}`;
    if (mainIdentity) storage[wireMainKey] = mainIdentity; else delete storage[wireMainKey];
    const hotkeys = this.host.readHotkeys?.(productionId);
    if (hotkeys !== undefined) storage[`targetHotkeys:${userId}${productionId == null ? '' : `:production:${productionId}`}`] = JSON.stringify(hotkeys);
    if (productionId != null) storage[`activeProduction:${userId}`] = String(productionId);
    else delete storage[`activeProduction:${userId}`];
    const output = state.audioRoutes.find(route => route.selected);
    if (state.audioSessionAvailable) storage.preferredAudioOutputDeviceId = output?.id ?? state.operatorAudio.audioRouteId;
    const allTargets = [...state.targets, ...(state.replyTarget && !state.targets.some(target => talkTargetIdentity(target) === talkTargetIdentity(state.replyTarget!)) ? [state.replyTarget] : [])];
    const targetsForKeys = (keys: string[]) => allTargets.filter(target => keys.includes(talkTargetIdentity(target)))
      .map(({ type, id }) => ({ type, id }));
    // Guests can be a reply destination without having an assigned card.
    const runtimeTargets = targetsForKeys(state.talkingTargetKeys);
    const audioStates = state.targets.filter(target => ['user', 'conference', 'feed'].includes(target.type)).map(target => ({
      targetType: target.type as PanelAudioState['targetType'], targetId: Number(target.id),
      ...(state.audioPreferences[talkTargetIdentity(target)] ?? defaultAudioPreference()),
    }));
    return {
      revision: this.revision, storage, audioStates,
      runtime: {
        devices: state.audioSessionAvailable ? state.audioRoutes.map(route => ({ kind: 'audiooutput', deviceId: route.id, label: route.label })) : [],
        inputDeviceId: '', outputDeviceId: output?.id ?? state.operatorAudio.audioRouteId,
        outputSupported: state.audioSessionAvailable, talking: state.talking,
        targets: runtimeTargets, lockedTargets: targetsForKeys(state.lockedTargetKeys),
      },
    };
  }

  publish(localChanges = false): void {
    const report = this.report();
    if (!report || this.applying || !this.host.state().operatorReady) return;
    this.host.report(report);
    if (!localChanges) return;
    this.host.audioSnapshot(report.audioStates, this.revision);
    const settings = this.currentAudioSettings();
    const serialized = JSON.stringify(settings);
    if (serialized !== this.lastAudioSettings) {
      this.lastAudioSettings = serialized;
      const epoch = this.epoch;
      void this.host.saveAudioSettings(settings, this.revision).then(result => {
        if (result?.ok === false && epoch === this.epoch) this.lastAudioSettings = '';
      }).catch(() => { if (epoch === this.epoch) this.lastAudioSettings = ''; });
    }
  }

  handleCompanionAudio(value: unknown): Promise<PanelCommandResult> {
    const raw = asRecord(value);
    if (!raw || !['volume-up', 'volume-down', 'mute-toggle'].includes(String(raw.action))) {
      return Promise.resolve({ ok: false, error: 'Unsupported Companion audio action.' });
    }
    const targetType = raw.targetType ?? 'conference';
    const targetId = positiveId(raw.targetId);
    if (!['user', 'conference', 'feed'].includes(String(targetType)) || targetId === null) {
      return Promise.resolve({ ok: false, error: 'Invalid Companion audio target.' });
    }
    const epoch = this.epoch;
    const execute = () => {
      // Resolve relative changes inside the command queue, so rapid encoder
      // turns and mute toggles always use the previous command's new value.
      const current = this.host.state().audioPreferences[`${targetType}-${targetId}`] ?? defaultAudioPreference();
      const step = typeof raw.step === 'number' && Number.isFinite(raw.step) ? Math.max(0.01, Math.min(1, raw.step)) : 0.1;
      const audio = parsePanelAudioState({ targetType, targetId,
        volume: raw.action === 'mute-toggle' ? current.volume : Math.max(0, Math.min(1, current.volume + (raw.action === 'volume-up' ? step : -step))),
        muted: raw.action === 'mute-toggle' ? !current.muted : current.muted });
      if (!audio) return { ok: false as const, error: 'Invalid Companion audio target.' };
      return this.execute({ kind: 'target-audio', audio }, epoch);
    };
    const result = this.queue.catch(() => {}).then(execute);
    this.queue = result;
    return result;
  }

  handleCompanionTalk(value: unknown): Promise<PanelCommandResult> {
    try {
      if (!value || typeof value !== 'object') throw new Error('Invalid Companion command.');
      const raw = value as Record<string, unknown>;
      if (!['press', 'release', 'lock-toggle'].includes(String(raw.action))) throw new Error('Unsupported Companion talk action.');
      const targetType = raw.targetType ?? 'conference';
      // Keep independent Companion buttons separate from local and panel holds.
      // Legacy modules without an input key use a stable per-target identity.
      const key = typeof raw.inputKey === 'string' && raw.inputKey.trim()
        ? raw.inputKey.trim() : `${targetType}:${targetType === 'reply' ? '' : raw.targetId}`;
      const command = parsePanelCommand({ kind: 'talk', action: raw.action === 'lock-toggle' ? 'lock' : raw.action,
        targetType, targetId: raw.targetId, inputKey: `panel:companion:${key}` });
      if (raw.action !== 'lock-toggle') return this.handleCommand(command);
      const epoch = this.epoch;
      const execute = () => {
        if (command.kind !== 'talk') throw new Error('Invalid Companion talk command.');
        const target = this.resolveTalkTarget(command);
        const action = this.host.state().lockedTargetKeys.includes(talkTargetIdentity(target)) ? 'unlock' : 'lock';
        return this.execute({ ...command, action }, epoch);
      };
      const result = this.queue.catch(() => {}).then(execute).catch(error => ({ ok: false as const, error: message(error) }));
      this.queue = result;
      return result;
    } catch (error) { return Promise.resolve({ ok: false, error: message(error) }); }
  }

  handleCommand(value: unknown): Promise<PanelCommandResult> {
    let command: PanelCommand;
    try { command = parsePanelCommand(value); }
    catch (error) { return Promise.resolve({ ok: false, error: message(error) }); }
    const epoch = this.epoch;
    let inputToken: symbol | undefined;
    if (command.kind === 'talk') {
      if (command.action === 'press') {
        inputToken = Symbol(command.inputKey);
        this.inputTokens.set(command.inputKey!, inputToken);
      } else if (command.action === 'release') this.inputTokens.delete(command.inputKey!);
      else if (command.action === 'stop') this.inputTokens.clear();
    }
    const execute = () => this.execute(command, epoch, inputToken);
    // Releases must cancel a press that is still waiting for microphone access.
    if (command.kind === 'talk' && (command.action === 'release' || command.action === 'stop')) return execute();
    const result = this.queue.catch(() => {}).then(execute);
    this.queue = result;
    return result;
  }

  private async execute(command: PanelCommand, epoch: number, inputToken?: symbol): Promise<PanelCommandResult> {
    try {
      if (!this.enabled || epoch !== this.epoch || this.host.state().identity?.kind !== 'user') throw new Error('User session is not ready.');
      if (command.panelSettings && command.panelSettings.revision < this.revision) throw new Error('Stale panel command.');
      await this.withApplying(async () => {
        if (command.panelSettings) {
          this.revision = command.panelSettings.revision;
          this.storage = this.ownStorage(command.panelSettings.storage);
        }
        if (command.kind === 'talk') {
          if (command.action === 'release') return this.host.release(command.inputKey!);
          if (command.action === 'stop') return this.host.stopTalk();
          if (!this.host.state().operatorReady) throw new Error('Media is not ready.');
          const target = this.resolveTalkTarget(command);
          if (command.action === 'press') {
            if (this.inputTokens.get(command.inputKey!) !== inputToken) return;
            await this.host.press(command.inputKey!, target);
          }
          else if (command.action === 'lock') await this.host.lock(target);
          else await this.host.unlock(target);
        } else if (command.kind === 'target-audio') {
          const state = this.host.state();
          if (state.operatorReady && !state.targets.some(target => target.type === command.audio.targetType && Number(target.id) === command.audio.targetId)) throw new Error('Audio target is not assigned.');
          await this.host.applyAudioStates([command.audio], false);
        } else if (command.kind === 'audio-settings') {
          const unsupported = BROWSER_ONLY_AUDIO_KEYS.filter(key => command.settings[key] !== this.audioBase[key]);
          if (unsupported.length) throw new Error(`Mobile client does not support: ${unsupported.join(', ')}.`);
          this.audioBase = command.settings;
          await this.host.applyAudioSettings(command.settings);
        } else if (command.kind === 'preferences') {
          this.validatePreferencePatch(command.patch);
          if (!command.panelSettings) {
            for (const [key, value] of Object.entries(command.patch)) {
              if (value === null) delete this.storage[key]; else this.storage[key] = value;
            }
          }
          await this.applyStoredPreferences(true,
            !this.host.systemAudioRouting || Object.hasOwn(command.patch, 'preferredAudioOutputDeviceId'));
        } else if (command.kind === 'production') {
          if (!this.host.state().productions.some(production => production.id === command.productionId)) throw new Error('Production is not assigned.');
          await this.host.selectProduction(command.productionId);
          this.ensureCurrent(epoch);
          this.wireProductionId = command.productionId;
          await this.applyMainButtons();
        } else if (command.kind === 'order') {
          await this.host.refreshTargets();
        }
      });
      if (epoch !== this.epoch) throw new Error('User session changed.');
      if (command.kind === 'audio-settings') this.lastAudioSettings = JSON.stringify(this.currentAudioSettings());
      const report = this.report();
      this.publish(true);
      return { ok: true, report };
    } catch (error) {
      if (epoch === this.epoch && command.kind === 'audio-settings') {
        this.lastAudioSettings = '';
        this.publish(true);
      }
      return { ok: false, error: message(error), ...(epoch === this.epoch ? { report: this.report() } : {}) };
    }
  }

  private resolveTalkTarget(command: Extract<PanelCommand, { kind: 'talk' }>): TalkTarget {
    const state = this.host.state();
    // The host supplies the actual Reply target, including transient guests.
    const reply = state.replyTarget;
    const target = command.targetType === 'reply' ? reply
      : state.targets.find(target => target.type === command.targetType && Number(target.id) === command.targetId);
    if (!target || !target.canTalk || target.type === 'feed') throw new Error('Talk target is not available.');
    return target;
  }

  private currentAudioSettings(): PanelAudioSettings {
    const state = this.host.state();
    return {
      ...this.audioBase, ...(typeof this.audioBase.bigMainButton === 'boolean' ? { bigMainButton: state.bigMainButton } : {}), dimAmountDb: state.operatorAudio.feedDimDb,
      dimFeedsWhileSpeaking: state.operatorAudio.feedDimSelf, dimWhenAddressed: state.operatorAudio.feedDimIncoming,
      audioAutoProcessing: state.operatorAudio.echoCancellation && state.operatorAudio.noiseSuppression && state.operatorAudio.autoGainControl,
      playConnectionSounds: state.operatorAudio.playConnectionSounds,
      leftHandMode: state.leftHanded, lockMultipleTargets: state.lockMultipleTargets,
    };
  }

  private ownStorage(storage: Record<string, string>): Record<string, string> {
    const userId = positiveId(this.host.state().identity?.id);
    if (userId == null) return {};
    return Object.fromEntries(Object.entries(storage).filter(([key]) => this.preferenceKey(key, userId)));
  }

  private preferenceKey(key: string, userId: number): boolean {
    return ['preferredAudioInputDeviceId', 'preferredAudioInputDeviceExplicit', 'preferredAudioOutputDeviceId',
      `activeProduction:${userId}`, `stoppedFeeds:user:${userId}`, `conferenceListenExclusions:user:${userId}`,
      `conferenceMemberLevels:user:${userId}`].includes(key)
      || new RegExp(`^(mainButtonTarget:user:${userId}:(default|[0-9]+)|targetHotkeys:${userId}(?::production:[0-9]+)?)$`).test(key);
  }

  private validatePreferencePatch(patch: Record<string, string | null>): void {
    const userId = positiveId(this.host.state().identity?.id)!;
    for (const [key, value] of Object.entries(patch)) {
      if (!this.preferenceKey(key, userId)) throw new Error('Client preference belongs to another user.');
      if (key.startsWith('targetHotkeys:')) {
        if (!this.host.applyHotkeys) throw new Error('Keyboard shortcuts require an updated mobile app.');
        if (value !== null) jsonObject(value);
      }
      if ((key === 'preferredAudioInputDeviceId' && value) || (key === 'preferredAudioInputDeviceExplicit' && value === 'true')) throw new Error('Mobile microphone selection is managed by the audio route.');
    }
  }

  private async applyStoredPreferences(verifyRoute: boolean, applyOutput = !this.host.systemAudioRouting): Promise<void> {
    const epoch = this.epoch;
    const userId = positiveId(this.host.state().identity?.id)!;
    let conference: ConferenceListenState = EMPTY_CONFERENCE_LISTEN;
    const exclusions = jsonObject(this.storage[`conferenceListenExclusions:user:${userId}`]);
    const levels = jsonObject(this.storage[`conferenceMemberLevels:user:${userId}`]);
    for (const [conferenceId, users] of Object.entries(exclusions)) {
      if (positiveId(conferenceId) == null || !Array.isArray(users)) continue;
      for (const user of users) if (positiveId(user) != null) conference = setConferenceMemberListening(conference, conferenceId, Number(user), false);
    }
    for (const [conferenceId, members] of Object.entries(levels)) {
      if (positiveId(conferenceId) == null) continue;
      for (const [userId, value] of Object.entries(asRecord(members) ?? {})) {
        if (positiveId(userId) != null && typeof value === 'number' && Number.isFinite(value)) conference = setConferenceMemberLevel(conference, conferenceId, Number(userId), value);
      }
    }
    await this.host.applyConferenceListen(conference);
    this.ensureCurrent(epoch);
    const stopped = Object.entries(jsonObject(this.storage[`stoppedFeeds:user:${userId}`]))
      .filter(([key, value]) => /^feed-\d+$/.test(key) && value === true).map(([key]) => key);
    await this.host.applyStoppedFeeds(stopped);
    this.ensureCurrent(epoch);
    this.pendingMainButtons = true;
    await this.applyMainButtons();
    this.ensureCurrent(epoch);
    await this.host.applyHotkeys?.(this.storage);
    this.ensureCurrent(epoch);
    const routeId = this.storage.preferredAudioOutputDeviceId;
    if (applyOutput && verifyRoute && routeId === '') throw new Error('Choose a specific mobile audio route.');
    if (applyOutput && routeId) {
      const state = this.host.state();
      const available = state.audioSessionAvailable && state.audioRoutes.some(route => route.id === routeId);
      if (available && !state.audioRoutes.some(route => route.id === routeId && route.selected)) await this.host.selectAudioRoute(routeId);
      else if (!available && verifyRoute) throw new Error('Audio route is not available on this device.');
      else if (!available) this.pendingRouteId = routeId;
    }
  }

  private async applyMainButtons(): Promise<void> {
    const epoch = this.epoch;
    const state = this.host.state();
    if (!state.activeProfileId) return;
    const userId = positiveId(state.identity?.id)!;
    const prefix = `mainButtonTarget:user:${userId}:`;
    const targets = { ...state.mainButtonTargets };
    for (const key of Object.keys(targets)) if (key.startsWith(`${state.activeProfileId}:`)) delete targets[key];
    for (const [key, value] of Object.entries(this.storage)) {
      if (!key.startsWith(prefix) || (value !== '' && !/^(user|conference)-\d+$/.test(value))) continue;
      const suffix = key.slice(prefix.length);
      const id = positiveId(suffix);
      const nativeDefault = state.productions.length === 0 || (state.operatorReady && state.productionId === null);
      const productionId = nativeDefault && id === this.wireProductionId ? null : id;
      if (value) targets[mainButtonStorageKey(state.activeProfileId, productionId)] = value;
    }
    await this.host.applyMainButtons(targets);
    this.ensureCurrent(epoch);
    this.pendingMainButtons = !state.operatorReady;
  }

  private ensureCurrent(epoch: number): void {
    if (epoch !== this.epoch || !this.enabled) throw new Error('User session changed.');
  }

  private async withApplying<T>(action: () => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    this.applying++;
    clearTimeout(this.timer);
    try { return await action(); } finally { if (epoch === this.epoch) this.applying--; }
  }
}

function jsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  const result = asRecord(JSON.parse(value));
  if (!result) throw new Error('Invalid panel preference data.');
  return result;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
