import { requireNativeModule } from 'expo-modules-core';

export type NativeClientVersion = { clientVersion: string | null; clientBuild: string | null };

/** Read the installed binary, including EAS-incremented build numbers. */
export function readNativeClientVersion(): NativeClientVersion {
  try {
    const application = requireNativeModule('ExpoApplication') as {
      nativeApplicationVersion?: string;
      nativeBuildVersion?: string;
    };
    return {
      clientVersion: application.nativeApplicationVersion || null,
      clientBuild: application.nativeBuildVersion || null,
    };
  } catch {
    // Existing development binaries may not contain the new native module yet.
    return { clientVersion: null, clientBuild: null };
  }
}
