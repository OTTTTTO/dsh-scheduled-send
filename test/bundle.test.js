import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ui-polish spec: button carries a text label and the open state shows the badge
test('alarm button text label + scheduling badge present in bundle', () => {
  const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(src.includes('"⏰ 定时"') || src.includes("'⏰ 定时'") || src.includes("⏰ 定时"), 'button label ⏰ 定时');
  assert.ok(src.includes("定时发送中"), 'scheduling-in-progress badge');
  assert.ok(src.includes("定时发送") && src.includes("到点切换模型"), 'popover card sections');
});
