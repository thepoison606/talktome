/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'TalkToMeWatch',
  displayName: 'Talktome',
  icon: '../../assets/icon.png',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  frameworks: ['SwiftUI', 'WatchConnectivity', 'WatchKit', 'AVFoundation'],
};
