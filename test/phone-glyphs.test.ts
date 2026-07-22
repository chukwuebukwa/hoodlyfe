import assert from 'node:assert/strict';
import test from 'node:test';
import {phoneGlyph, type PhoneGlyphName} from '../src/game/ui/phone-glyphs.ts';

const REQUIRED_PHONE_GLYPHS: PhoneGlyphName[] = [
  'profile',
  'wallet',
  'briefcase-business',
  'map',
  'car-front',
  'settings',
  'radio',
  'users',
  'phone',
  'message-circle',
  'music-2'
];

test('phone apps render accessible decorative SVG glyphs instead of letter placeholders', () => {
  const rendered = REQUIRED_PHONE_GLYPHS.map((name) => phoneGlyph(name));
  for (const glyph of rendered) {
    assert.match(glyph, /^<svg class="phone-glyph"/);
    assert.match(glyph, /aria-hidden="true"/);
    assert.doesNotMatch(glyph, /<script|on\w+=/i);
  }
  assert.equal(new Set(rendered).size, REQUIRED_PHONE_GLYPHS.length);
});
