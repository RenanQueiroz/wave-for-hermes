const { withAppBuildGradle } = require('expo/config-plugins');

// Prebuild's template signs *release* builds with the debug keystore, and the
// generated android/ directory is gitignored, so release signing has to be
// injected here. The WAVE_UPLOAD_* environment variables are provided by the
// release workflow (and by a maintainer running a local release proof); when
// they are absent the template's debug fallback keeps every local development
// flow byte-identical to stock prebuild output.
const SIGNING_CONFIGS_ANCHOR = 'signingConfigs {';
const RELEASE_SIGNING_ANCHOR =
  '            // Caution! In production, you need to generate your own keystore file.\n' +
  '            // see https://reactnative.dev/docs/signed-apk-android.\n' +
  '            signingConfig signingConfigs.debug';

const RELEASE_SIGNING_CONFIG = `signingConfigs {
        release {
            def waveStoreFile = System.getenv("WAVE_UPLOAD_STORE_FILE")
            if (waveStoreFile != null) {
                storeFile file(waveStoreFile)
                storePassword System.getenv("WAVE_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("WAVE_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("WAVE_UPLOAD_KEY_PASSWORD")
            }
        }`;

const RELEASE_SIGNING_ASSIGNMENT =
  '            signingConfig System.getenv("WAVE_UPLOAD_STORE_FILE") != null ? signingConfigs.release : signingConfigs.debug';

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    const { contents } = gradleConfig.modResults;
    if (contents.includes('WAVE_UPLOAD_STORE_FILE')) return gradleConfig;

    if (
      !contents.includes(SIGNING_CONFIGS_ANCHOR) ||
      !contents.includes(RELEASE_SIGNING_ANCHOR)
    ) {
      // Failing prebuild beats silently publishing a debug-signed "release".
      throw new Error(
        'with-android-release-signing: the generated android/app/build.gradle no longer matches the ' +
          'expected Expo template anchors. Update plugins/with-android-release-signing.js for the new template.',
      );
    }

    gradleConfig.modResults.contents = contents
      .replace(SIGNING_CONFIGS_ANCHOR, RELEASE_SIGNING_CONFIG)
      .replace(RELEASE_SIGNING_ANCHOR, RELEASE_SIGNING_ASSIGNMENT);
    return gradleConfig;
  });
};
