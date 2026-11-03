import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { analyzeHand, calculateShanten, countsToNotation, parseTiles, tilePool } from '../ui/engine.js';

const counts = text => parseTiles(text).counts;
const analyze = (text, extra = {}) => analyzeHand({ counts: counts(text), rules: 'sanma', ...extra });
const indices = items => items.map(item => item.index);
let checks = 0;
function check(name, callback) {
  callback();
  checks++;
  console.log(`PASS ${name}`);
}

check('backward-compatible default and explicit rule validation', () => {
  const hand = counts('123m123p12345s55z');
  assert.deepEqual(analyzeHand({ counts: hand }), analyzeHand({ counts: hand, rules: 'yonma' }));
  assert.equal(calculateShanten(hand), calculateShanten(hand, 0, 'yonma'));
  assert.equal(analyzeHand({ counts: hand }).rules, 'yonma');
  assert.throws(() => analyzeHand({ counts: hand, rules: 'other' }), /规则/);
  assert.throws(() => calculateShanten(hand, 0, 'other'), /规则/);
});

check('sanma 108-tile pool and absent manzu input rejection', () => {
  assert.equal(tilePool().length, 34);
  assert.equal(tilePool('sanma').length * 4, 108);
  assert.deepEqual(tilePool('sanma').slice(0, 3), [0, 8, 9]);
  for (let n = 2; n <= 8; n++) {
    assert.throws(() => analyze(`${n}m`, { openMelds: 4 }), /三麻牌池/);
    assert.throws(() => analyze('1z', { openMelds: 4, visible: counts(`${n}m`) }), /已见牌/);
    assert.throws(() => calculateShanten(counts(`${n}m`), 4, 'sanma'), /三麻牌池/);
  }
  assert.throws(() => analyze('0m', { openMelds: 4 }), /赤五万/);
  assert.equal(parseTiles('0p0s').total, 2);
  assert.throws(() => parseTiles(' '.repeat(1025)), /1024/);
});

check('pinzu/souzu sequences remain valid without chi actions', () => {
  const result = analyze('111m123p12345s55z');
  assert.equal(result.shanten, 0);
  assert.deepEqual(indices(result.waits), [20, 23]);
  assert.equal(result.waitKinds, 2);
  assert.equal(result.liveTotal, 7);
  assert.equal(calculateShanten(counts('111m123p123456s55z'), 0, 'sanma'), -1);
});

check('sanma seven pairs with terminal manzu pairs', () => {
  const result = analyze('1199m2233p4455s6z');
  assert.equal(result.shapeShanten.chiitoitsu, 0);
  assert.deepEqual(indices(result.waits), [32]);
  assert.equal(result.liveTotal, 3);
  assert.equal(calculateShanten(counts('1199m2233p4455s66z'), 0, 'sanma'), -1);
});

check('sanma kokushi still has thirteen structural waits', () => {
  const result = analyze('19m19p19s1234567z');
  assert.equal(result.shapeShanten.kokushi, 0);
  assert.equal(result.waitKinds, 13);
  assert.equal(result.liveTotal, 39);
  assert.ok(result.waits.every(item => item.index === 0 || item.index >= 8));
});

check('north is ordinary honor; extracted north consumes visible stock only', () => {
  const result = analyze('111999m123p123s4z', { visible: counts('44z') });
  assert.equal(result.openMelds, 0);
  assert.equal(result.shanten, 0);
  assert.deepEqual(indices(result.waits), [30]);
  assert.equal(result.waits[0].remaining, 1);
  assert.equal(result.liveTotal, 1);
  const exhausted = analyze('111m123p123s4455z', { visible: counts('44z') });
  assert.deepEqual(indices(exhausted.waits), [30, 31]);
  assert.deepEqual(exhausted.waits.map(item => item.remaining), [0, 2]);
  assert.equal(exhausted.waitKinds, 2);
  assert.equal(exhausted.liveKinds, 1);
  assert.throws(() => analyze('111999m123p123s4z', { visible: counts('4444z') }), /超过/);
});

check('open meld count and north extraction are independent', () => {
  const result = analyze('123p45s44z', { openMelds: 2, visible: counts('44z') });
  assert.equal(result.tileCount, 7);
  assert.equal(result.shanten, 0);
  assert.equal(result.shapeShanten.chiitoitsu, null);
  assert.deepEqual(indices(result.waits), [20, 23]);
  assert.equal(result.liveTotal, 8);
  const four = analyze('4z', { openMelds: 4, visible: counts('44z') });
  assert.deepEqual(indices(four.waits), [30]);
  assert.equal(four.liveTotal, 1);
});

check('quad fallback cannot use nonexistent manzu target sequences', () => {
  // Four-player can retain two 1m in a future 123m sequence. Sanma cannot.
  const sanma = analyze('1111m111122233z');
  const yonma = analyze('1111m111122233z', { rules: 'yonma' });
  assert.equal(sanma.shapeShanten.normal, 2);
  assert.equal(sanma.shanten, 2);
  assert.equal(yonma.shapeShanten.normal, 1);
  assert.deepEqual(indices(yonma.improving), [1, 2]);
  assert.ok(sanma.improving.every(item => item.index === 0 || item.index >= 8));
  const another = analyze('11119m123p123s11z');
  assert.equal(another.shapeShanten.normal, 1);
  assert.deepEqual(indices(another.improving), [8, 27]);
});

check('14-tile ranking carries sanma rules and keeps discarded tiles seen', () => {
  const result = analyze('111m123p123s44455z');
  assert.equal(result.rules, 'sanma');
  assert.equal(result.mode, 'discard');
  const discardNorth = result.discards.find(item => item.index === 30);
  assert.equal(discardNorth.shanten, 0);
  assert.equal(discardNorth.waits.find(item => item.index === 30).remaining, 1);
  for (const row of result.discards) {
    assert.ok(row.improving.every(item => item.index === 0 || item.index >= 8));
    assert.ok(row.improving.every(item => item.remaining >= 0 && item.remaining <= 4));
  }
});

// A second implementation scans the full 34-tile hand. It has no suit cache,
// forbids manzu sequences independently, and is used on hands without quads.
function bruteNormal(source, openMelds) {
  const hand = source.slice();
  let best = 8;
  function scan(index, melds, taatsu, head) {
    while (index < 34 && !hand[index]) index++;
    if (index === 34) {
      best = Math.min(best, 8 - 2 * melds - Math.min(taatsu, 4 - melds) - head);
      return;
    }
    if (melds < 4 && hand[index] >= 3) {
      hand[index] -= 3;
      scan(index, melds + 1, taatsu, head);
      hand[index] += 3;
    }
    const sequenceSuit = index >= 9 && index < 27;
    if (melds < 4 && sequenceSuit && index % 9 < 7 && hand[index + 1] && hand[index + 2]) {
      hand[index]--; hand[index + 1]--; hand[index + 2]--;
      scan(index, melds + 1, taatsu, head);
      hand[index]++; hand[index + 1]++; hand[index + 2]++;
    }
    if (hand[index] >= 2) {
      hand[index] -= 2;
      if (!head) scan(index, melds, taatsu, 1);
      if (taatsu < 4) scan(index, melds, taatsu + 1, head);
      hand[index] += 2;
    }
    if (taatsu < 4 && sequenceSuit) for (const d of [1, 2]) {
      if (index % 9 + d < 9 && hand[index + d]) {
        hand[index]--; hand[index + d]--;
        scan(index, melds, taatsu + 1, head);
        hand[index]++; hand[index + d]++;
      }
    }
    hand[index]--;
    scan(index, melds, taatsu, head);
    hand[index]++;
  }
  scan(0, openMelds, 0, 0);
  return best;
}

let seed = 0x369112;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
const pool = tilePool('sanma');
function randomHand(total) {
  const hand = Array(34).fill(0);
  for (let n = 0; n < total;) {
    const index = pool[Math.floor(random() * pool.length)];
    if (hand[index] < 3) { hand[index]++; n++; }
  }
  return hand;
}

check('120 random sanma hands independently agree on ordinary shanten', () => {
  for (let i = 0; i < 120; i++) {
    const openMelds = i % 5;
    const hand = randomHand(13 - 3 * openMelds + i % 2);
    const result = analyzeHand({ counts: hand, openMelds, rules: 'sanma' });
    assert.equal(result.shapeShanten.normal, bruteNormal(hand, openMelds), countsToNotation(hand));
    assert.ok(result.improving.every(item => pool.includes(item.index)));
    for (const row of result.discards) {
      const after = hand.slice();
      after[row.index]--;
      assert.equal(row.shapeShanten.normal, bruteNormal(after, openMelds));
      assert.ok(row.improving.every(item => pool.includes(item.index)));
    }
  }
});

const start = performance.now();
for (let i = 0; i < 40; i++) analyzeHand({ counts: randomHand(14), rules: 'sanma' });
const elapsed = performance.now() - start;
console.log(`PASS ${checks} groups; 40 sanma fourteen-tile analyses: ${elapsed.toFixed(1)} ms (${(elapsed / 40).toFixed(1)} ms/hand).`);
