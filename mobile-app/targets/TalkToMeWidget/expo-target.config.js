/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = (config) => ({
  type: 'widget',
  name: 'TalkToMeWidget',
  displayName: 'Talktome',
  bundleIdentifier: '.widget',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents'],
  entitlements: {
    'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}`],
  },
});
