import type { ExpoConfig } from 'expo/config';

const { resolveIosSigning } = require('./scripts/ios-signing');
const iosSigning = resolveIosSigning(__dirname);

const config: ExpoConfig = {
  name: 'TalkToMe',
  slug: 'talktome',
  version: process.env.TALKTOME_MOBILE_VERSION || '1.1.1',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  scheme: 'talktome',
  ios: {
    supportsTablet: true,
    icon: './assets/icon.png',
    bundleIdentifier: iosSigning.bundleIdentifier,
    buildNumber: process.env.TALKTOME_MOBILE_BUILD_NUMBER || '60',
    appleTeamId: iosSigning.appleTeamId,
    entitlements: {
      'com.apple.security.application-groups': [iosSigning.appGroup],
    },
    infoPlist: {
      CFBundleDisplayName: 'Talktome',
      ITSAppUsesNonExemptEncryption: false,
      NSMicrophoneUsageDescription:
        'Talktome uses the microphone so you can talk to other operators.',
      NSLocalNetworkUsageDescription:
        'Talktome connects to your self-hosted intercom on the local network.',
      NSBluetoothAlwaysUsageDescription: 'Talktome connects to wireless PTT buttons and speaker mics.',
      NSCameraUsageDescription: 'Talktome uses the camera to scan server and login QR codes.',
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      NSSupportsLiveActivities: true,
      NSSupportsLiveActivitiesFrequentUpdates: true,
      UIBackgroundModes: ['audio', 'bluetooth-central'],
      UISupportedInterfaceOrientations: [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ],
      'UISupportedInterfaceOrientations~ipad': [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationPortraitUpsideDown',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ],
    },
  },
  android: {
    // Android Java packages cannot contain a hyphen.
    package: process.env.TALKTOME_ANDROID_PACKAGE || 'com.talktome.mobile',
    versionCode: Number(process.env.TALKTOME_MOBILE_BUILD_NUMBER || 60),
    adaptiveIcon: {
      backgroundColor: '#000000',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'RECORD_AUDIO',
      'MODIFY_AUDIO_SETTINGS',
      'INTERNET',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MICROPHONE',
      'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'POST_NOTIFICATIONS',
      'BLUETOOTH',
      'BLUETOOTH_ADMIN',
      'BLUETOOTH_SCAN',
      'BLUETOOTH_CONNECT',
      'ACCESS_FINE_LOCATION',
      'CAMERA',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    '@bacons/apple-targets',
    '@preeternal/react-native-cookie-manager',
    [
      '@config-plugins/react-native-webrtc',
      {
        cameraPermission:
          'Talktome uses the camera to scan server and login QR codes.',
        microphonePermission:
          'Talktome uses the microphone so you can talk to other operators.',
      },
    ],
    './plugins/withTalkToMeJitsiWebrtc',
    './plugins/withTalkToMeFgs',
    [
      'expo-camera',
      {
        cameraPermission: 'Talktome uses the camera to scan server and login QR codes.',
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    './plugins/withTalkToMeBle',
    './plugins/withTalkToMeOrientation',
    './plugins/withTalkToMeMultiTouch',
    './plugins/withTalkToMePresence',
    './plugins/withTalkToMeXcodeWarnings',
    './plugins/withTalkToMeScenes',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#000000',
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        imageWidth: 200,
      },
    ],
    './plugins/withTalkToMeSplash',
    './plugins/withTalkToMeAndroidIcons',
  ],
  owner: process.env.TALKTOME_EXPO_OWNER || 'talktomecomm',
  extra: {
    eas: {
      projectId: process.env.TALKTOME_EAS_PROJECT_ID || '28c1fc0f-12d6-4b3a-a40d-dbf24dd2dcd2',
    },
  },
};

export default config;
