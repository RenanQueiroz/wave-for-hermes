import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConfigContext, ExpoConfig } from 'expo/config';

import configureApp, {
  resolveAndroidVersionCode,
  resolveAppVariant,
  resolveVersionName,
} from '../../app.config.ts';

const staticConfig = (
  JSON.parse(
    readFileSync(new URL('../../app.json', import.meta.url), 'utf8'),
  ) as { expo: ExpoConfig }
).expo;
const easConfig = JSON.parse(
  readFileSync(new URL('../../eas.json', import.meta.url), 'utf8'),
) as {
  build: Record<string, { env?: { APP_VARIANT?: string } }>;
};

test('app variants have distinct names, native identities, and schemes', () => {
  assert.deepEqual(identityFor('development'), {
    name: 'Wave (Dev)',
    scheme: 'wave-dev',
    iosBundleIdentifier: 'com.renanqueiroz.wave.dev',
    androidPackage: 'com.renanqueiroz.wave.dev',
    addGeneratedScheme: true,
  });
  assert.deepEqual(identityFor('preview'), {
    name: 'Wave (Preview)',
    scheme: 'wave-preview',
    iosBundleIdentifier: 'com.renanqueiroz.wave.preview',
    androidPackage: 'com.renanqueiroz.wave.preview',
    addGeneratedScheme: false,
  });
  assert.deepEqual(identityFor('production'), {
    name: 'Wave',
    scheme: 'wave',
    iosBundleIdentifier: 'com.renanqueiroz.wave',
    androidPackage: 'com.renanqueiroz.wave',
    addGeneratedScheme: false,
  });
});

test('local Expo commands default to development and reject unknown variants', () => {
  assert.equal(resolveAppVariant(undefined), 'development');
  assert.throws(() => resolveAppVariant('staging'), /APP_VARIANT must be/);
  assert.throws(() => resolveAppVariant('toString'), /APP_VARIANT must be/);
});

test('the release workflow versionCode override is validated strictly', () => {
  assert.equal(resolveAndroidVersionCode(undefined), undefined);
  assert.equal(resolveAndroidVersionCode(''), undefined);
  assert.equal(resolveAndroidVersionCode('233'), 233);
  assert.equal(resolveAndroidVersionCode('2100000000'), 2_100_000_000);
  for (const bad of ['0', '-3', '1.5', '2100000001', 'abc', '01']) {
    assert.throws(
      () => resolveAndroidVersionCode(bad),
      /WAVE_ANDROID_VERSION_CODE must be/,
    );
  }
});

test('the version name is single-sourced from package.json and semver-shaped', () => {
  assert.match(resolveVersionName(), /^\d+\.\d+\.\d+$/);
  assert.equal(resolveVersionName('0.1.0'), '0.1.0');
  for (const bad of ['1.0', 'v1.0.0', '1.0.0-beta', '']) {
    assert.throws(() => resolveVersionName(bad), /must be a plain x\.y\.z/);
  }
});

test('the resolved config carries the package.json version', () => {
  const previous = process.env.APP_VARIANT;
  process.env.APP_VARIANT = 'production';
  try {
    const config = configureApp({
      config: structuredClone(staticConfig),
    } as ConfigContext);
    assert.match(config.version ?? '', /^\d+\.\d+\.\d+$/);
    assert.equal(config.android?.versionCode, 1);
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
});

test('EAS profiles select their matching app variants', () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(easConfig.build).map(([profile, build]) => [
        profile,
        build.env?.APP_VARIANT,
      ]),
    ),
    {
      development: 'development',
      preview: 'preview',
      production: 'production',
    },
  );
});

function identityFor(variant: string) {
  const previous = process.env.APP_VARIANT;
  process.env.APP_VARIANT = variant;

  try {
    const config = configureApp({
      config: structuredClone(staticConfig),
    } as ConfigContext);
    const devClientPlugin = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-dev-client',
    );

    assert.ok(Array.isArray(devClientPlugin));
    return {
      name: config.name,
      scheme: config.scheme,
      iosBundleIdentifier: config.ios?.bundleIdentifier,
      androidPackage: config.android?.package,
      addGeneratedScheme: (
        devClientPlugin[1] as { addGeneratedScheme?: boolean }
      ).addGeneratedScheme,
    };
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
  }
}
