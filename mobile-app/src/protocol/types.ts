// Derived from talktome-apple IntercomProtocol.swift @ 004d6e76 by Daniel Jocher.

import type { Production } from './productions';

export type SessionKind = 'user' | 'feed' | 'guest';
export type PeerKind = 'guest' | 'user' | 'feed';
export type TalkTargetType = 'user' | 'conference' | 'feed' | 'guest';
export type ProduceAppDataType = 'talk' | 'user' | 'conference' | 'guest' | 'feed';

export type OperatorIdentity = {
  id: number | string;
  name: string;
  kind: SessionKind;
  guestId?: string;
  guestProfileUserId?: number;
  productions?: Production[];
};

export type LoginRequest = {
  name: string;
  password: string;
};

export type LoginTokenRequest = {
  token: string;
};

export type LoginOptions = {
  guestLogin: { enabled: boolean; label: string };
  sso: { enabled: boolean };
};

export type HealthResponse = {
  ok: boolean;
  appVersion?: string;
  serverStartedAt?: string;
};

export type ConferenceMember = {
  userId: number;
  name: string;
};

export type TalkTarget = {
  type: TalkTargetType;
  id: number | string;
  label: string;
  canTalk: boolean;
  members?: ConferenceMember[];
};

export type TalkTargetResponse = {
  targetType: TalkTargetType;
  targetId: number;
  name: string;
  canTalk?: boolean;
  members?: unknown;
};

export type SignalingTalkTarget = {
  type: 'user' | 'conference' | 'guest';
  id: number | string;
};

export type ActiveProducerRoute =
  | { kind: 'directUser'; targetPeerId?: string }
  | { kind: 'conference'; id: number }
  | { kind: 'feed'; id: number }
  | { kind: 'guest'; id: string }
  | { kind: 'talk' }
  | { kind: 'unknown'; type: string };

export type ActiveProducer = {
  kind?: 'audio' | 'video';
  peerId: string;
  producerId: string;
  speakerUserId?: number | null;
  appData: Record<string, unknown>;
  route: ActiveProducerRoute;
};

export type IncomingTalkEntry = {
  fromUserId?: number;
  fromGuestId?: string;
  fromName?: string;
  targetType: TalkTargetType;
  targetId: number | string;
  replyTargetType?: 'user' | 'conference' | 'guest';
  replyTargetId?: number | string;
  at?: number;
};

export type IncomingTalkState = {
  userId?: number;
  addressedNow: IncomingTalkEntry[];
  replyTarget?: IncomingTalkEntry;
};

export type PeerSession = {
  socketId: string;
  userId?: number;
  feedId?: number;
  kind: PeerKind;
  name?: string;
};

export type RegisterUserConflict = {
  socketId?: string;
  name?: string;
};

export type RegisterUserResponse =
  | { ok: true; allowTargetRearrange?: unknown; allowTargetAddRemove?: unknown; targetAudioStates?: unknown; panelSettings?: unknown; userAudioSettings?: unknown; productionId?: unknown; productions?: unknown }
  | { conflict: true; existing?: RegisterUserConflict }
  | { error: string };

export type SessionKickInfo = {
  reason?: string;
  bySocketId?: string;
};

export type WebRTCTransportOptions = {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown[];
  dtlsParameters: unknown;
  iceServers: IceServer[];
  iceTransportPolicy?: IceTransportPolicy;
};

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type IceTransportPolicy = 'all' | 'relay';

export type ConsumerOptions = {
  id: string;
  producerId: string;
  kind: string;
  rtpParameters: unknown;
};

export function talkTargetIdentity(target: Pick<TalkTarget, 'type' | 'id'>): string {
  return `${target.type}-${target.id}`;
}

export function talkTargetFromResponse(row: TalkTargetResponse): TalkTarget {
  const target: TalkTarget = {
    type: row.targetType,
    id: row.targetId,
    label: row.name,
    canTalk: row.canTalk ?? true,
  };
  if (row.targetType === 'conference') {
    target.members = parseConferenceMemberList(row.members);
  }
  return target;
}

function parseConferenceMemberList(value: unknown): ConferenceMember[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<number>();
  const members: ConferenceMember[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as { userId?: unknown; id?: unknown; name?: unknown };
    const userId = Number(row.userId ?? row.id);
    if (!Number.isFinite(userId) || seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    members.push({
      userId,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : `User ${userId}`,
    });
  }
  return members;
}
