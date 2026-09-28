const { withAppBuildGradle } = require('expo/config-plugins')

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const marker = '// Kampus local release signing'
    if (!config.modResults.contents.includes(marker)) {
      config.modResults.contents += `
${marker}
if (System.getenv('KAMPUS_KEYSTORE_FILE')) {
    android.signingConfigs.create('kampusRelease') {
        storeFile file(System.getenv('KAMPUS_KEYSTORE_FILE'))
        storePassword System.getenv('KAMPUS_KEYSTORE_PASSWORD')
        keyAlias 'kampus-android'
        keyPassword System.getenv('KAMPUS_KEYSTORE_PASSWORD')
    }
    android.buildTypes.release.signingConfig = android.signingConfigs.kampusRelease
}
`
    }
    return config
  })
}
