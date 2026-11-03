import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseTiles, countsToNotation, tileName, analyzeHand, calculateShanten } from '../ui/engine.js';

const hand = text => parseTiles(text).counts;
const analyze = (text, options = {}) => analyzeHand({ counts: hand(text), ...options });
const tileIndices = items => items.map(item => item.index);
let assertions = 0;
function check(name, fn) {
  fn();
  assertions++;
  console.log(`PASS ${name}`);
}

check('notation, Chinese tiles, and red five physical count', () => {
  const parsed = parseTiles('一二三万 ０５p 789索 東風 南 白板 发财 红中');
  assert.equal(parsed.total, 13);
  assert.deepEqual(parsed.reds, [0, 1, 0]);
  assert.equal(parsed.counts[13], 2);
  assert.equal(countsToNotation(parsed.counts), '123m 55p 789s 12567z');
  assert.equal(tileName(33), '中');
  assert.throws(() => parseTiles('11111m'), /0–4/);
  assert.throws(() => parseTiles('8z'), /1–7/);
  assert.throws(() => parseTiles('0z'), /红五/);
  assert.throws(() => parseTiles('123'), /无法识别/);
});

check('normal two-sided tenpai', () => {
  const result = analyze('123m123p12345s55z');
  assert.equal(result.shanten, 0);
  assert.deepEqual(tileIndices(result.waits), [20, 23]);
  assert.equal(result.waitKinds, 2);
  assert.equal(result.liveTotal, 7);
});

check('seven pairs', () => {
  const result = analyze('1122m3344p5566s7z');
  assert.equal(result.shapeShanten.chiitoitsu, 0);
  assert.deepEqual(tileIndices(result.waits), [33]);
  assert.equal(result.liveTotal, 3);
  assert.equal(calculateShanten(hand('1122m3344p5566s77z')), -1);
});

check('four identical tiles are one distinct pair in seven pairs', () => {
  const result = analyze('1111m2233p4455s6z');
  assert.equal(result.shapeShanten.chiitoitsu, 2);
});

check('thirteen-sided kokushi', () => {
  const result = analyze('19m19p19s1234567z');
  assert.equal(result.shanten, 0);
  assert.equal(result.shapeShanten.kokushi, 0);
  assert.equal(result.waitKinds, 13);
  assert.equal(result.liveTotal, 39);
  assert.equal(calculateShanten(hand('119m19p19s1234567z')), -1);
});

check('structural waits survive exhausted stock', () => {
  const result = analyze('123m123p12345s55z', { visible: hand('3336666s') });
  assert.deepEqual(tileIndices(result.waits), [20, 23]);
  assert.deepEqual(result.waits.map(item => item.remaining), [0, 0]);
  assert.equal(result.waitKinds, 2);
  assert.equal(result.liveKinds, 0);
  assert.equal(result.liveTotal, 0);
});

check('known tiles reduce live stock', () => {
  const result = analyze('123m123p12345s55z', { visible: hand('36s') });
  assert.deepEqual(result.waits.map(item => item.remaining), [2, 3]);
  assert.equal(result.liveTotal, 5);
  assert.throws(() => analyze('123m123p12345s55z', { visible: hand('3333s') }), /超过/);
});

check('discarded tiles stay visible', () => {
  const result = analyze('123m123p12345s555z');
  const discard = result.discards.find(item => item.index === 31);
  assert.equal(discard.shanten, 0);
  assert.equal(discard.waitKinds, 2);
  const pairReturn = analyze('123m123p123s55566z').discards.find(item => item.index === 31);
  const returnWhite = pairReturn.improving.find(item => item.index === 31);
  assert.equal(returnWhite.remaining, 1);
  assert.equal(result.discards[0].shanten, 0);
});

check('open melds including four fixed melds', () => {
  const result = analyze('123m123p45s55z', { openMelds: 1 });
  assert.equal(result.shanten, 0);
  assert.equal(result.shapeShanten.chiitoitsu, null);
  assert.equal(result.shapeShanten.kokushi, null);
  assert.deepEqual(tileIndices(result.waits), [20, 23]);
  assert.equal(result.liveTotal, 8);
  const four = analyze('5z', { openMelds: 4 });
  assert.equal(four.shanten, 0);
  assert.deepEqual(tileIndices(four.waits), [31]);
  assert.equal(four.liveTotal, 3);
  assert.throws(() => analyze('123m'), /13 张/);
});

check('fifth copy can never be an effective draw', () => {
  const result = analyze('11112m123p123s11z');
  assert.equal(result.shanten, 0);
  assert.ok(result.waits.every(item => item.index !== 0));
  assert.ok(tileIndices(result.waits).includes(2));
});

check('quad copies cannot create false tenpai or a fifth-copy target', () => {
  const singleton = analyze('1111m222p333s444z');
  assert.equal(singleton.shapeShanten.normal, 1);
  assert.equal(singleton.shanten, 1);
  assert.equal(singleton.waitKinds, 0);
  assert.equal(singleton.improvingKinds, 30);
  const honor = analyze('123m123p123s1111z');
  assert.equal(honor.shapeShanten.normal, 1);
  assert.equal(honor.shanten, 1);
  const twoQuads = analyze('1111222233344z');
  assert.equal(twoQuads.shapeShanten.normal, 2);
  assert.equal(twoQuads.shanten, 2);
  const allSimples = analyze('2222m345p456678s');
  assert.equal(allSimples.shanten, 1);
  assert.ok(allSimples.improving.every(item => item.index !== 1));
});

check('analysis does not mutate supplied tile arrays', () => {
  const counts = hand('123m123p12345s555z');
  const visible = hand('12z');
  const before = JSON.stringify({ counts, visible });
  analyzeHand({ counts, visible });
  assert.equal(JSON.stringify({ counts, visible }), before);
});

// Independent whole-hand DFS (no suit frontier or cache) checks the cached
// algorithm against a second implementation, including partial and open hands.
function bruteNormal(source, openMelds) {
  const counts = source.slice();
  let best = 8;
  function visit(start, melds, taatsu, head) {
    while (start < 34 && !counts[start]) start++;
    if (start === 34) {
      best = Math.min(best, 8 - 2 * melds - Math.min(taatsu, 4 - melds) - head);
      return;
    }
    const i = start;
    if (melds < 4 && counts[i] >= 3) {
      counts[i] -= 3;
      visit(i, melds + 1, taatsu, head);
      counts[i] += 3;
    }
    if (melds < 4 && i < 27 && i % 9 < 7 && counts[i + 1] && counts[i + 2]) {
      counts[i]--; counts[i + 1]--; counts[i + 2]--;
      visit(i, melds + 1, taatsu, head);
      counts[i]++; counts[i + 1]++; counts[i + 2]++;
    }
    if (counts[i] >= 2) {
      counts[i] -= 2;
      if (!head) visit(i, melds, taatsu, 1);
      if (taatsu < 4) visit(i, melds, taatsu + 1, head);
      counts[i] += 2;
    }
    if (taatsu < 4 && i < 27) {
      for (const distance of [1, 2]) {
        if (i % 9 + distance < 9 && counts[i + distance]) {
          counts[i]--; counts[i + distance]--;
          visit(i, melds, taatsu + 1, head);
          counts[i]++; counts[i + distance]++;
        }
      }
    }
    counts[i]--;
    visit(i, melds, taatsu, head);
    counts[i]++;
  }
  visit(0, openMelds, 0, 0);
  return best;
}

let seed = 0x139af2;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function randomHand(total) {
  const counts = Array(34).fill(0);
  for (let n = 0; n < total;) {
    const index = Math.floor(random() * 34);
    if (counts[index] < 4) { counts[index]++; n++; }
  }
  return counts;
}

check('random independent brute-force normal shanten comparison (120 hands)', () => {
  for (let n = 0; n < 120; n++) {
    const openMelds = n % 5;
    const counts = randomHand(13 - 3 * openMelds + (n % 2));
    const result = analyzeHand({ counts, openMelds });
    assert.equal(result.shapeShanten.normal, bruteNormal(counts, openMelds), countsToNotation(counts));
    if (result.discards.length) {
      for (const discard of result.discards) {
        const after = counts.slice();
        after[discard.index]--;
        assert.equal(discard.shapeShanten.normal, bruteNormal(after, openMelds));
      }
    }
  }
});

const benchmarkStart = performance.now();
for (let n = 0; n < 40; n++) analyzeHand({ counts: randomHand(14) });
const elapsed = performance.now() - benchmarkStart;
console.log(`PASS ${assertions} groups; 40 fourteen-tile analyses: ${elapsed.toFixed(1)} ms (${(elapsed / 40).toFixed(1)} ms/hand).`);
const quadStart = performance.now();
analyze('1111m2222p3333s11z');
console.log(`PASS dense-quad fourteen-tile analysis: ${(performance.now() - quadStart).toFixed(1)} ms.`);

