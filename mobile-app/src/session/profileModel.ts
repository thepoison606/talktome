import type { WatchTargetSelections } from '../watch/selection';

export type RememberedGuest = {
  guestId: string;
  guestProfileUserId: number;
  name: string;
};

export type SavedProfile = {
  id: string;
  serverAddress: string;
  username: string;
  rememberPassword: boolean;
  loginToken?: boolean;
  allowInsecureLocalTLS?: boolean;
  productionId?: number | null;
  productionName?: string | null;
  guest?: RememberedGuest;
};

export type ProfileBundle = {
  profiles: SavedProfile[];
  lastProfileId: string | null;
  /** Undefined until the user toggles it, so a server default can apply. */
  leftHanded?: boolean;
  /** Undefined until the user toggles it, so a server default can apply. */
  lockMultipleTargets?: boolean;
  /** Profile+production key → talk-target identity. Missing key means Reply. */
  mainButtonTargets?: Record<string, string>;
  /** Profile+production key → selected Watch targets; missing key means all. */
  watchTargetSelections?: WatchTargetSelections;
  /** Undefined means off. */
  bigMainButton?: boolean;
};

export function profileIdentity(serverAddress: string, username: string): string {
  const server = serverAddress.trim().replace(/\/+$/, '').toLowerCase();
  return `${server}::${username.trim().toLowerCase()}`;
}

export function upsertProfile(profiles: SavedProfile[], next: SavedProfile): SavedProfile[] {
  const without = profiles.filter((item) => item.id !== next.id);
  return [next, ...without];
}

export function profileCanAutoConnect(profile: SavedProfile, password?: string): boolean {
  return Boolean(profile.guest) || Boolean(password);
}

export function isSavedProfile(value: unknown): value is SavedProfile {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as SavedProfile;
  return typeof item.id === 'string' && typeof item.serverAddress === 'string' && typeof item.username === 'string';
}
