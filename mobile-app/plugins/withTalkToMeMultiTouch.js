const { withMainApplication } = require('expo/config-plugins');

const MARKER = '// talktome-independent-talk-pointers';

function enableIndependentPointers(contents, language) {
  if (contents.includes(MARKER)) return contents;
  if (!['kt', 'java'].includes(language) || !/super\.onCreate\(\);?/.test(contents)) {
    throw new Error('Unexpected MainApplication startup; update withTalkToMeMultiTouch before building.');
  }
  // Android's legacy touch dispatcher assigns every finger to the first target.
  // Enable RN's per-pointer hit testing before ReactSurfaceView is constructed.
  return contents.replace(/super\.onCreate\(\);?/, match => `${match}\n    ${MARKER}\n    com.facebook.react.config.ReactFeatureFlags.dispatchPointerEvents = true${language === 'java' ? ';' : ''}`);
}

module.exports = config => withMainApplication(config, mod => {
  mod.modResults.contents = enableIndependentPointers(mod.modResults.contents, mod.modResults.language);
  return mod;
});
module.exports.enableIndependentPointers = enableIndependentPointers;
