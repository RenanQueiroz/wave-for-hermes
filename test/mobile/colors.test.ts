import assert from 'node:assert/strict';
import test from 'node:test';

import { compositeOverlay } from '../../src/utils/colors.ts';

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
