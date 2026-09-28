#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir"
if [[ -f .env.android ]]; then
  set -a
  source .env.android
  set +a
fi
export ANDROID_HOME=${ANDROID_HOME:-"$HOME/Library/Android/sdk"}
if [[ -z ${JAVA_HOME:-} ]]; then
  java_binary=$(command -v javac)
  export JAVA_HOME="$(cd "$(dirname "$java_binary")/.." && pwd)"
fi
if [[ ! -d "$ANDROID_HOME/platforms/android-36" || ! -x "$JAVA_HOME/bin/java" ]]; then
  printf '%s\n' 'Android SDK 36 ve JDK 21 yollarını .env.android içinde tanımlayın.' >&2
  exit 1
fi
key_dir="$HOME/.config/kampus/android-release"
install -d -m 700 "$key_dir"
if [[ ! -f "$key_dir/release.jks" ]]; then
  if [[ ! -f "$key_dir/password" ]]; then
    (umask 077; openssl rand -hex 32 > "$key_dir/password")
  fi
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$key_dir/release.jks" \
    -storepass:file "$key_dir/password" -keypass:file "$key_dir/password" \
    -alias kampus-android -keyalg RSA -keysize 3072 -validity 10000 \
    -dname 'CN=Kampus Android, O=Kampus, C=TR' >/dev/null 2>&1
  chmod 600 "$key_dir/release.jks"
fi
export KAMPUS_KEYSTORE_FILE="$key_dir/release.jks"
export KAMPUS_KEYSTORE_PASSWORD
KAMPUS_KEYSTORE_PASSWORD=$(cat "$key_dir/password")
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @kampus/mobile exec expo prebuild --platform android --no-install
cd apps/mobile/android
./gradlew assembleRelease --no-daemon --max-workers=4 -PreactNativeArchitectures=arm64-v8a,x86_64
cd "$project_dir"
mkdir -p apklar artifacts/mobile-build
app_version=$(node -p "require('./apps/mobile/app.json').expo.version")
if [[ ! "$app_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf '%s\n' 'Uygulama sürümü geçerli değil.' >&2
  exit 1
fi
apk_path="apklar/kampus-$app_version.apk"
cp apps/mobile/android/app/build/outputs/apk/release/app-release.apk "$apk_path"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose "$apk_path"
shasum -a 256 "$apk_path" > "artifacts/mobile-build/kampus-$app_version.apk.sha256"
printf 'APK hazır: %s\n' "$apk_path"
