import type { ConfigContext, ExpoConfig } from 'expo/config';

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

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveAppVariant();
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
    slug,
    scheme: `${scheme}${details.schemeSuffix}`,
    ios: {
      ...config.ios,
      bundleIdentifier: `${iosBundleIdentifier}${details.identifierSuffix}`,
    },
    android: {
      ...config.android,
      package: `${androidPackage}${details.identifierSuffix}`,
    },
    plugins: [...(config.plugins ?? []), devClientPlugin],
  };
};
