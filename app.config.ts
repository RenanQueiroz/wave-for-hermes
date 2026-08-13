import type { ConfigContext, ExpoConfig } from 'expo/config';

import packageJson from './package.json' with { type: 'json' };

type AppVariant = 'development' | 'preview' | 'production';

const variantDetails: Record<
  AppVariant,
  { nameSuffix: string; identifierSuffix: string; schemeSuffix: string }
> = {
  development: {
    nameSuffix: ' (Dev)',
    identifierSuffix: '.dev',
    schemeSuffix: '-dev',
  },
  preview: {
    nameSuffix: ' (Preview)',
    identifierSuffix: '.preview',
    schemeSuffix: '-preview',
  },
  production: {
    nameSuffix: '',
    identifierSuffix: '',
    schemeSuffix: '',
  },
};

export function resolveAppVariant(value = process.env.APP_VARIANT): AppVariant {
  if (value === undefined || value === '') return 'development';
  if (Object.hasOwn(variantDetails, value)) return value as AppVariant;

  throw new Error(
    `APP_VARIANT must be development, preview, or production; received ${JSON.stringify(value)}.`,
  );
}

// The release workflow derives the Android versionCode from the main-branch
// commit count so every published APK installs over its predecessors; local
// builds keep the app.json baseline. Anything malformed fails the build.
export function resolveAndroidVersionCode(
  value = process.env.WAVE_ANDROID_VERSION_CODE,
): number | undefined {
  if (value === undefined || value === '') return undefined;
  const versionCode = /^[1-9]\d{0,9}$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(versionCode) || versionCode > 2_100_000_000) {
    throw new Error(
      `WAVE_ANDROID_VERSION_CODE must be a positive integer no greater than 2100000000; received ${JSON.stringify(value)}.`,
    );
  }
  return versionCode;
}

// package.json is the single source of truth for the human-facing version:
// it flows from here into the native version name, the release workflow's
// tag and APK name, and the in-app version display. app.json deliberately
// has no version field. The release tag format (v<version>-<versionCode>)
// and the updater's feed parser both rely on the plain x.y.z shape.
export function resolveVersionName(value = packageJson.version): string {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(
      `package.json version must be a plain x.y.z semver; received ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveAppVariant();
  const versionCodeOverride = resolveAndroidVersionCode();
  const versionName = resolveVersionName();
  const details = variantDetails[variant];
  const iosBundleIdentifier = config.ios?.bundleIdentifier;
  const androidPackage = config.android?.package;
  const scheme = config.scheme;
  const name = config.name;
  const slug = config.slug;

  if (!name || !slug || !iosBundleIdentifier || !androidPackage) {
    throw new Error(
      'app.json must define the app name, slug, production iOS bundle identifier, and production Android package.',
    );
  }
  if (typeof scheme !== 'string') {
    throw new Error('app.json must define one production URL scheme.');
  }

  const devClientPlugin: [string, { addGeneratedScheme: boolean }] = [
    'expo-dev-client',
    { addGeneratedScheme: variant === 'development' },
  ];

  return {
    ...config,
    name: `${name}${details.nameSuffix}`,
    version: versionName,
    slug,
    scheme: `${scheme}${details.schemeSuffix}`,
    ios: {
      ...config.ios,
      bundleIdentifier: `${iosBundleIdentifier}${details.identifierSuffix}`,
    },
    android: {
      ...config.android,
      package: `${androidPackage}${details.identifierSuffix}`,
      ...(versionCodeOverride === undefined
        ? {}
        : { versionCode: versionCodeOverride }),
    },
    plugins: [...(config.plugins ?? []), devClientPlugin],
  };
};
