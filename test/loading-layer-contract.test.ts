import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('the blocking loader renders above every interactive game overlay', () => {
  const css = readFileSync('src/style.css', 'utf8');
  const zIndexFor = (selector: string): number => {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `${selector} must have a CSS rule`);
    const block = css.slice(start, css.indexOf('}', start));
    const value = block.match(/z-index:\s*(\d+)/)?.[1];
    assert.ok(value, `${selector} must declare a numeric z-index`);
    return Number(value);
  };

  const loader = zIndexFor('#loading');
  assert.ok(loader > zIndexFor('#phone-button'));
  assert.ok(loader > zIndexFor('#profile-popup'));
  assert.ok(loader > zIndexFor('#onboarding-flow'));
});
