import { readWatchTargetSelections } from '../watch/selection';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  isSavedProfile,
  profileIdentity,
  type ProfileBundle,
  type RememberedGuest,
  type SavedProfile,
} from './profileModel';

export {
  profileCanAutoConnect,
  profileIdentity,
  upsertProfile,
  type ProfileBundle,
  type RememberedGuest,
  type SavedProfile,
} from './profileModel';

const LEGACY_PROFILE_KEY = 'talktome.remembered-profile';
const LEGACY_PASSWORD_KEY = 'talktome.remembered-password';
const PROFILES_KEY = 'talktome.saved-profiles';
const PASSWORDS_KEY = 'talktome.profile-passwords';

type RememberedProfile = {
  serverAddress: string;
  username: string;
  rememberPassword: boolean;
  allowInsecureLocalTLS?: boolean;
  leftHanded?: boolean;
  guest?: RememberedGuest;
};

function readMainButtonTargets(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''),
  );
}

export async function loadProfileBundle(): Promise<ProfileBundle> {
  const raw = await AsyncStorage.getItem(PROFILES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ProfileBundle>;
      return {
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles.filter(isSavedProfile) : [],
        lastProfileId: typeof parsed.lastProfileId === 'string' ? parsed.lastProfileId : null,
        // Keys absent from storage stay undefined so server defaults can apply.
        leftHanded: typeof parsed.leftHanded === 'boolean' ? parsed.leftHanded : undefined,
        lockMultipleTargets:
          typeof parsed.lockMultipleTargets === 'boolean' ? parsed.lockMultipleTargets : undefined,
        mainButtonTargets: readMainButtonTargets(parsed.mainButtonTargets),
        watchTargetSelections: readWatchTargetSelections(parsed.watchTargetSelections),
        bigMainButton: parsed.bigMainButton === true,
      };
    } catch {
      // fall through to legacy
    }
  }
  return migrateLegacyProfile();
}

export async function saveProfileBundle(bundle: ProfileBundle): Promise<void> {
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(bundle));
}

export async function passwordForProfile(profileId: string): Promise<string | undefined> {
  const passwords = await loadPasswords();
  return passwords[profileId];
}

export async function savePasswordForProfile(profileId: string, password: string | undefined): Promise<void> {
  const passwords = await loadPasswords();
  if (password) {
    passwords[profileId] = password;
  } else {
    delete passwords[profileId];
  }
  await SecureStore.setItemAsync(PASSWORDS_KEY, JSON.stringify(passwords));
}

export async function removeProfile(profileId: string, bundle: ProfileBundle): Promise<ProfileBundle> {
  const next: ProfileBundle = {
    ...bundle,
    profiles: bundle.profiles.filter((item) => item.id !== profileId),
    lastProfileId: bundle.lastProfileId === profileId ? null : bundle.lastProfileId,
  };
  await saveProfileBundle(next);
  await savePasswordForProfile(profileId, undefined);
  return next;
}

async function loadPasswords(): Promise<Record<string, string>> {
  try {
    const raw = await SecureStore.getItemAsync(PASSWORDS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

async function migrateLegacyProfile(): Promise<ProfileBundle> {
  const raw = await AsyncStorage.getItem(LEGACY_PROFILE_KEY);
  if (!raw) {
    return { profiles: [], lastProfileId: null };
  }
  try {
    const profile = JSON.parse(raw) as RememberedProfile;
    const id = profileIdentity(profile.serverAddress, profile.username);
    const password = profile.rememberPassword
      ? ((await SecureStore.getItemAsync(LEGACY_PASSWORD_KEY)) ?? undefined)
      : undefined;
    const saved: SavedProfile = {
      id,
      serverAddress: profile.serverAddress,
      username: profile.username,
      rememberPassword: profile.rememberPassword,
      allowInsecureLocalTLS: profile.allowInsecureLocalTLS,
      guest: profile.guest,
    };
    const bundle: ProfileBundle = {
      profiles: [saved],
      lastProfileId: id,
      leftHanded: Boolean(profile.leftHanded),
    };
    await saveProfileBundle(bundle);
    if (password) {
      await savePasswordForProfile(id, password);
    }
    await AsyncStorage.removeItem(LEGACY_PROFILE_KEY);
    await SecureStore.deleteItemAsync(LEGACY_PASSWORD_KEY);
    return bundle;
  } catch {
    return { profiles: [], lastProfileId: null };
  }
}
