import assert from 'node:assert/strict';
import test from 'node:test';

import { compositeOverlay } from '../../src/utils/colors.ts';
import { projectWaveMaterialColors } from '../../src/hooks/wave-material-colors.ts';

test('composites translucent theme surfaces into opaque colors', () => {
  assert.equal(
    compositeOverlay('#141414', 'rgba(255, 255, 255, 0.08)'),
    'rgb(39, 39, 39)',
  );
  assert.equal(
    compositeOverlay('#ffffff', 'rgba(0, 0, 0, 0.06)'),
    'rgb(240, 240, 240)',
  );
});

test('supports alpha hex and leaves unsupported native colors untouched', () => {
  assert.equal(compositeOverlay('#000', '#ffffff80'), 'rgb(128, 128, 128)');
  assert.equal(
    compositeOverlay('#141414', 'systemBackground'),
    'systemBackground',
  );
});

test('projects colorful Android Material roles onto Wave semantic colors', () => {
  const systemAccent = '#00BBD4FF';
  const colors = projectWaveMaterialColors(
    {
      primary: systemAccent,
      secondary: systemAccent,
      tertiary: systemAccent,
      surfaceTint: systemAccent,
      scrim: '#00000099',
    } as never,
    {
      background: '#000000',
      backgroundElement: '#212225',
      backgroundSelected: '#2E3135',
      border: '#3B3D42',
      card: '#181818',
      destructive: '#F15757',
      destructiveForeground: '#FFFFFF',
      primary: '#F5F5F5',
      primaryForeground: '#262626',
      text: '#FFFFFF',
      textSecondary: '#B0B4BA',
    },
  );

  assert.equal(colors.primary, '#F5F5F5');
  assert.equal(colors.onPrimary, '#262626');
  assert.equal(colors.secondary, '#FFFFFF');
  assert.equal(colors.tertiary, '#B0B4BA');
  assert.equal(colors.surfaceTint, '#F5F5F5');
  assert.equal(colors.error, '#F15757');
  assert.equal(colors.scrim, '#00000099');
  assert.ok(
    Object.entries(colors)
      .filter(([role]) => role !== 'scrim')
      .every(([, color]) => color !== systemAccent),
  );
});
