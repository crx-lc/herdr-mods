import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, flatten, byId, textOf, symbols, clockFixture } from './render-fixture.mjs';
import { formatPrice, formatChange } from '../quotes.js';

for (const width of [180, 279, 280, 300, 340, 379, 380, 400, 440, 700]) {
  test(`production render retains full primary text and actions at ${width} logical px`, () => {
    const f = fixture(), tree = f.resize(width);
    for (const symbol of symbols) {
      assert.equal(textOf(byId(tree, `quotr-symbol-${symbol}`)), symbol);
      const quote = f.view.watch.quotes[symbol];
      assert.equal(textOf(byId(tree, `quotr-price-${symbol}`)), quote ? formatPrice(quote) : 'Unavailable');
      assert.equal(textOf(byId(tree, `quotr-change-${symbol}`)), quote ? formatChange(quote.changePercent) : '—');
      for (const kind of ['symbol', 'price', 'change']) {
        const primary = byId(tree, `quotr-${kind}-${symbol}`);
        assert.ok(primary);
        assert.equal(primary.attrs.truncate, undefined);
        assert.deepEqual(primary.attrs.flex_wrap, []);
      }
      assert.ok(byId(tree, `quotr-remove-${symbol}`).attrs.on_click);
    }
    for (const action of ['reorder', 'refresh', 'pause']) assert.ok(byId(tree, `quotr-${action}`).attrs.on_click);
    assert.match(textOf(tree), /Stale · last updated.*Source unavailable/);
    assert.match(textOf(tree), /Yahoo Finance.*Binance Spot.*24h change/);
    assert.equal(byId(tree, 'quotr-content').attrs.max_w[0], 440);
    assert.equal(f.edits.length, 0, 'render/measurement did not save');
    assert.equal(f.stats.phase, 'event');
  });
}

test('shrink/grow changes secondary layout before primary text and ignores transient measurements', () => {
  const f = fixture();
  let tree = f.resize(440);
  const widePaths = flatten(tree).filter(e => e.attrs.h?.[0] === 22 && e.attrs.w?.[0] === 56).length;
  assert.ok(widePaths > 0, 'wide panel contains real chart boxes');
  for (const width of [340, 280, 180, 440, 340, 440]) {
    tree = f.resize(width);
    assert.equal(flatten(tree).some(e => e.attrs.h?.[0] === 31.5 && e.attrs.w?.[0] === 31.5), width >= 380, 'logos compact first');
    assert.equal(flatten(tree).some(e => e.attrs.w?.[0] === 56), width >= 380, 'sparklines compact first');
    assert.equal(textOf(byId(tree, `quotr-symbol-${symbols[1]}`)), symbols[1]);
  }
  const previous = f.view.size, count = f.stats.notifications;
  const callback = byId(tree, 'quotr').attrs.on_size_change[0];
  for (const size of [null, {}, { width: 0, height: 640 }, { width: -1, height: 640 }, { width: NaN, height: 640 }, { width: Infinity, height: 640 }, { width: 440, height: 0 }, { width: 440.1, height: 640.1 }]) callback(size, f.cx);
  assert.equal(f.view.size, previous); assert.equal(f.stats.notifications, count);
  const initial = fixture().render();
  assert.equal(flatten(initial).some(e => e.attrs.w?.[0] === 56), false, 'unknown width starts compact');
});

test('small height keeps the panel and all actions reachable in vertical scroll', () => {
  const f = fixture();
  for (const width of [180, 280, 340, 440]) {
    const tree = f.resize(width, 60);
    assert.deepEqual(tree.attrs.overflow_y_scrollbar, []);
    assert.ok(byId(tree, 'quotr-refresh')); assert.ok(byId(tree, 'quotr-content'));
    assert.ok(byId(tree, `quotr-remove-${symbols[0]}`));
    assert.equal(byId(tree, 'quotr-list').attrs.overflow_y_scrollbar, undefined);
  }
  const tall = f.resize(340, 640);
  assert.deepEqual(byId(tall, 'quotr-list').attrs.overflow_y_scrollbar, []);
  assert.equal(tall.attrs.overflow_y_scrollbar, undefined);
  assert.equal(f.edits.length, 0);
});

test('production actions, dialogs and reorder controls survive narrow/wide transitions', () => {
  const f = fixture(); let tree = f.resize(280);
  const before = f.calls.length;
  byId(tree, 'quotr-row-Q').attrs.on_click[0]();
  assert.equal(f.calls.length, before + 1); assert.equal(f.calls.at(-1)[1].props.detail.symbol, 'Q');
  assert.equal(f.calls.at(-1)[1].width, 440, 'dialog sizing remains distinct');
  byId(tree, 'quotr-reorder').attrs.on_click[0]({}, f.cx);
  for (const width of [280, 440, 340]) {
    tree = f.resize(width);
    for (const dir of ['top', 'up', 'down', 'bottom']) assert.ok(byId(tree, `quotr-move-${dir}-STALE`));
    const n = f.calls.length; byId(tree, 'quotr-row-Q').attrs.on_click[0](); assert.equal(f.calls.length, n);
  }
  byId(tree, 'quotr-move-top-STALE').attrs.on_click[0]({}, f.cx);
  tree = f.render(); assert.equal(f.view.watch.preferences.symbols[0], 'STALE');
  byId(tree, 'quotr-remove-MISSING').attrs.on_click[0]({}, f.cx);
  assert.equal(f.view.watch.preferences.symbols.includes('MISSING'), false);
  byId(tree, 'quotr-pause').attrs.on_click[0]({}, f.cx);
  assert.equal(f.view.watch.preferences.paused, true);
  byId(tree, 'quotr-refresh').attrs.on_click[0]({}, f.cx); assert.equal(f.view.watch.manual, true);
  assert.equal(f.edits.length, 3, 'only explicit user actions save watchlist');
});

test('clock compacts date and stacks event/countdown while preserving phase and schedule failures', async (t) => {
  // A neutral current schedule relative to now, with a close still ahead.
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const { clockText, marketClock, nyParts } = await import('../marketclock.js');
  const schedule = { fetchedAt: now, business: true, date: nyParts(now).date, next: '2099-01-05',
    pre: now - 7200000, open: now - 3600000, close: now + 600000, post: now + 7200000 };
  const expected = clockText(marketClock(schedule, now), now);
  const c = await clockFixture(schedule);
  for (const width of [416, 316, 256, 156, 416]) {
    const tree = c.resize(width), text = textOf(tree);
    assert.match(text, /NY/); assert.match(text, /Open/);
    assert.ok(text.includes(expected.countdown));
    assert.equal(tree.kind, width < 380 ? 'v' : 'h');
    assert.equal(text.includes(expected.day), width >= 380, 'date is secondary');
  }
  const absent = await clockFixture();
  for (const width of [256, 416]) {
    const text = textOf(absent.resize(width));
    assert.match(text, /Market schedule unavailable/); assert.doesNotMatch(text, /Closes|Opens/);
  }
});


test('non-checking init and repeated load/resize do not save layout or watchlist', () => {
  for (let reload = 0; reload < 2; reload++) {
    const f = fixture({ checking: false });
    for (const width of [301, 280, 440, 301]) f.resize(width);
    assert.equal(f.edits.length, 0);
    // Async network loops are queued, not executed by this structural harness.
    assert.ok(f.pending.length >= 2);
  }
});

test('detail render stays on its own production path across panel widths', () => {
  const f = fixture();
  f.view.detail = { ...f.view.watch.quotes.Q, error: 'Neutral cached error' };
  f.view.range = '1D'; f.view.pending = new Set(); f.view.historyErrors = {};
  for (const width of [280, 440]) {
    f.view.size = { width, height: 640 };
    const tree = f.render();
    assert.ok(byId(tree, 'quotr-detail')); assert.equal(byId(tree, 'quotr-content'), undefined);
    assert.match(textOf(tree), /day change vs prev close/); assert.match(textOf(tree), /Cached quote · Neutral cached error/);
    for (const range of ['1D', '1W', '1M', '1Y']) assert.ok(byId(tree, `quotr-range-${range}`));
  }
});
