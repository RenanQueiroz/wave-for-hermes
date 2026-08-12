import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConfigContext, ExpoConfig } from 'expo/config';

import configureApp, { resolveAppVariant } from '../../app.config.ts';

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
    name: 'wave (Dev)',
    scheme: 'wave-dev',
    iosBundleIdentifier: 'com.renanqueiroz.wave.dev',
    androidPackage: 'com.renanqueiroz.wave.dev',
    addGeneratedScheme: true,
  });
  assert.deepEqual(identityFor('preview'), {
    name: 'wave (Preview)',
    scheme: 'wave-preview',
    iosBundleIdentifier: 'com.renanqueiroz.wave.preview',
    androidPackage: 'com.renanqueiroz.wave.preview',
    addGeneratedScheme: false,
  });
  assert.deepEqual(identityFor('production'), {
    name: 'wave',
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
