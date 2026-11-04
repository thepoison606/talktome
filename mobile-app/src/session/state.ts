import type { FeedVideoSnapshot } from '../media/feedVideoReceiver';
import { create } from 'zustand';
import type { WatchTargetSelections } from '../watch/selection';

import type { CertificateProbe } from '../servers/tlsTrust';
import type {
  IncomingTalkState,
  LoginOptions,
  OperatorIdentity,
  PeerSession,
  Production,
  TargetAudioPreference,
  TalkTarget,
} from '../protocol';
import { EMPTY_CAMERA_TALLY, type CameraTallyState } from '../protocol';
import { EMPTY_CONFERENCE_LISTEN, type ConferenceListenState } from './conferenceListen';
import { DEFAULT_OPERATOR_AUDIO, type OperatorAudioSettings } from './operatorAudio';
import { emptyAudioRouteSnapshot, type AudioRoute } from '../audio/routes';
import type { BleConnectionKind, BleDeviceState } from '../ble/native';
import { DEFAULT_BLE_RELEASE_TIMEOUT_MS, type BleDeviceBinding } from '../ble/bindings';
import { DEFAULT_BLE_TARGET, type BleTargetSelection } from '../ble/target';
import type { SavedProfile } from './remembered';
import type { SignalingHealth } from './connectionHealth';

export type SessionUiState = {
  hydrated: boolean;
  status: 'idle' | 'connecting' | 'choose-production' | 'ready' | 'paused' | 'error';
  statusMessage: string;
  serverAddress: string;
  username: string;
  rememberPassword: boolean;
  allowInsecureLocalTLS: boolean;
  leftHanded: boolean;
  lockMultipleTargets: boolean;
  edgeTalkAffordance: boolean;
  /** Empty string means Reply. A talk-target identity pins the bottom button. */
  mainButtonTargets: Record<string, string>;
  watchTargetSelections: WatchTargetSelections;
  bigMainButton: boolean;
  replyTarget: TalkTarget | null;
  loginOptions: LoginOptions | null;
  pendingCertificate: CertificateProbe | null;
  identity: OperatorIdentity | null;
  productions: Production[];
  productionId: number | null;
  productionName: string | null;
  cameraTally: CameraTallyState;
  serverAppVersion: string | null;
  profiles: SavedProfile[];
  activeProfileId: string | null;
  paused: boolean;
  addingProfile: boolean;
  openLoginScanner: boolean;
  operatorReady: boolean;
  allowTargetRearrange: boolean;
  allowTargetAddRemove: boolean;
  targets: TalkTarget[];
  talkingTargetKeys: string[];
  lockedTargetKeys: string[];
  talking: boolean;
  talkLocked: boolean;
  incoming: IncomingTalkState;
  peers: PeerSession[];
  audioPreferences: Record<string, TargetAudioPreference>;
  speakingTargetKeys: string[];
  activeFeedKeys: string[];
  videoFeedKeys: string[];
  feedVideos: FeedVideoSnapshot;
  stoppedFeedKeys: string[];
  conferenceListen: ConferenceListenState;
  operatorAudio: OperatorAudioSettings;
  audioRoutes: AudioRoute[];
  audioInputLabel: string;
  audioOutputLabel: string;
  audioVoiceProcessing: boolean;
  captureMicLabel: string;
  captureEchoCancellation: boolean | null;
  captureNoiseSuppression: boolean | null;
  captureAutoGainControl: boolean | null;
  conflictName?: string;
  error: string | null;
  capabilityReason: string;
  overBudget: boolean;
  activeRemoteCount: number;
  mediaDebug: string;
  signalingLabel: string;
  signalingStatus: SignalingHealth;
  sendTransportState: string;
  recvTransportState: string;
  sendIceState: string;
  recvIceState: string;
  mediaIceError: string | null;
  mediaReady: boolean;
  /** TalkToMe 1.5.6 heartbeat: the socket still looks up, but acks have stopped. */
  serverHeartbeatInterrupted: boolean;
  /** Set when a heard feed fails to open. Cleared on the next successful resync. */
  audioNotice: string;
  fgsRunning: boolean;
  fgsAvailable: boolean;
  audioSessionAvailable: boolean;
  audioSessionActive: boolean;
  audioKeepalive: boolean;
  bleKind: BleConnectionKind;
  bleName: string;
  bleMessage: string;
  bleScanning: boolean;
  blePairingActive: boolean;
  blePairingMessage: string;
  blePairingFoundId: string | null;
  bleDevices: BleDeviceState[];
  bleBindings: BleDeviceBinding[];
  bleFocusedDeviceId: string;
  bleReleaseTimeoutMs: number;
  bleShortPressLocks: boolean;
  bleTargetKind: 'reply' | 'target';
  bleTargetType: string;
  bleTargetId: string;
  bleTargetLabel: string;
  pttHardwareLog: string[];
  bondedSerialDevices: { id: string; name: string; pttHint: boolean }[];
};

export const FOREGROUND_REASON =
  'In-app talk. Backgrounding keeps the session while the process is alive. The app does not wake for a new caller.';
export const HOLD_HINT = 'Hold to talk. Slide to lock.';

export const initialState: SessionUiState = {
  hydrated: false,
  status: 'idle',
  statusMessage: '',
  serverAddress: '',
  username: '',
  rememberPassword: true,
  allowInsecureLocalTLS: false,
  leftHanded: false,
  lockMultipleTargets: false,
  edgeTalkAffordance: true,
  mainButtonTargets: {},
  watchTargetSelections: {},
  bigMainButton: false,
  replyTarget: null,
  loginOptions: null,
  pendingCertificate: null,
  identity: null,
  productions: [],
  productionId: null,
  productionName: null,
  cameraTally: EMPTY_CAMERA_TALLY,
  serverAppVersion: null,
  profiles: [],
  activeProfileId: null,
  paused: false,
  addingProfile: false,
  openLoginScanner: false,
  operatorReady: false,
  allowTargetRearrange: true,
  allowTargetAddRemove: false,
  targets: [],
  talkingTargetKeys: [],
  lockedTargetKeys: [],
  talking: false,
  talkLocked: false,
  incoming: { addressedNow: [] },
  peers: [],
  audioPreferences: {},
  speakingTargetKeys: [],
  activeFeedKeys: [],
  videoFeedKeys: [],
  feedVideos: {},
  stoppedFeedKeys: [],
  conferenceListen: EMPTY_CONFERENCE_LISTEN,
  operatorAudio: DEFAULT_OPERATOR_AUDIO,
  audioRoutes: emptyAudioRouteSnapshot().routes,
  audioInputLabel: 'Unknown',
  audioOutputLabel: 'Unknown',
  audioVoiceProcessing: false,
  captureMicLabel: 'Microphone',
  captureEchoCancellation: null,
  captureNoiseSuppression: null,
  captureAutoGainControl: null,
  error: null,
  capabilityReason: FOREGROUND_REASON,
  overBudget: false,
  activeRemoteCount: 0,
  mediaDebug: '',
  signalingLabel: 'disconnected',
  signalingStatus: 'disconnected',
  sendTransportState: 'idle',
  recvTransportState: 'idle',
  sendIceState: 'idle',
  recvIceState: 'idle',
  mediaIceError: null,
  mediaReady: false,
  serverHeartbeatInterrupted: false,
  audioNotice: '',
  fgsRunning: false,
  fgsAvailable: false,
  audioSessionAvailable: false,
  audioSessionActive: false,
  audioKeepalive: false,
  bleKind: 'idle',
  bleName: '',
  bleMessage: '',
  bleScanning: false,
  blePairingActive: false,
  blePairingMessage: '',
  blePairingFoundId: null,
  bleDevices: [],
  bleBindings: [],
  bleFocusedDeviceId: '',
  bleReleaseTimeoutMs: DEFAULT_BLE_RELEASE_TIMEOUT_MS,
  bleShortPressLocks: true,
  bleTargetKind: 'reply',
  bleTargetType: '',
  bleTargetId: '',
  bleTargetLabel: '',
  pttHardwareLog: [],
  bondedSerialDevices: [],
};

type SessionStore = SessionUiState & {
  setField: <K extends keyof SessionUiState>(key: K, value: SessionUiState[K]) => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  ...initialState,
  setField: (key, value) => set({ [key]: value } as Pick<SessionStore, typeof key>),
}));

export function bleSelectionFromState(state: SessionUiState): BleTargetSelection {
  if (state.bleTargetKind !== 'target' || !state.bleTargetType || state.bleTargetId === '') {
    return DEFAULT_BLE_TARGET;
  }
  return {
    kind: 'target',
    type: state.bleTargetType as TalkTarget['type'],
    id: state.bleTargetId,
    label: state.bleTargetLabel || state.bleTargetId,
  };
}

export function bleFieldsFromSelection(
  selection: BleTargetSelection,
  shortPressLocks: boolean,
): Pick<
  SessionUiState,
  | 'bleShortPressLocks'
  | 'bleTargetKind'
  | 'bleTargetType'
  | 'bleTargetId'
  | 'bleTargetLabel'
> {
  if (selection.kind === 'reply') {
    return {
      bleShortPressLocks: shortPressLocks,
      bleTargetKind: 'reply',
      bleTargetType: '',
      bleTargetId: '',
      bleTargetLabel: '',
    };
  }
  return {
    bleShortPressLocks: shortPressLocks,
    bleTargetKind: 'target',
    bleTargetType: selection.type,
    bleTargetId: String(selection.id),
    bleTargetLabel: selection.label,
  };
}

export { looksLikeTlsFailure } from '../servers/tlsFailure';
