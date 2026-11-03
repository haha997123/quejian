/**
 * Offline riichi mahjong shape analysis. A winning shape is not a yaku verdict.
 * `visible` contains every known tile outside the concealed hand, including
 * fixed open melds. Red fives share the four-copy limit with ordinary fives.
 */
const SUITS = ['m', 'p', 's', 'z'];
const SUIT_NAMES = ['万', '筒', '索'];
const HONOR_NAMES = ['东', '南', '西', '北', '白', '发', '中'];
const POW5 = Array.from({ length: 9 }, (_, i) => 5 ** i);
const suitedCache = new Map([[0, [0]]]);
const honorCache = new Map([[0, [0]]]);
const exactSuitCache = new Map();
const exactHonorCache = new Map();
const exactTerminalsCache = new Map();
let suitedTargets;
let honorTargets;
let terminalTargets;

function validateRules(rules) {
  if (rules !== 'yonma' && rules !== 'sanma') throw new Error('规则必须为 yonma（四麻）或 sanma（三麻）。');
  return rules;
}

/** Legal tile indices. Sanma removes 2m–8m; North remains an ordinary honor. */
export function tilePool(rules = 'yonma') {
  validateRules(rules);
  return Array.from({ length: 34 }, (_, index) => index).filter(index => rules !== 'sanma' || index === 0 || index >= 8);
}

function validateRuleCounts(counts, rules, label = '手牌') {
  validateCounts(counts, label);
  if (rules === 'sanma') {
    for (let index = 1; index <= 7; index++) {
      if (counts[index]) throw new Error(`三麻牌池没有${tileName(index)}，请从${label}中移除 2–8 万（包括赤五万）。`);
    }
  }
}

export function tileName(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 34) throw new Error('牌编号必须是 0–33。');
  return index < 27 ? `${index % 9 + 1}${SUIT_NAMES[Math.floor(index / 9)]}` : HONOR_NAMES[index - 27];
}

export function validateCounts(counts, label = '手牌') {
  if (!Array.isArray(counts) || counts.length !== 34) throw new Error(`${label}需要 34 个牌种的计数。`);
  for (let i = 0; i < 34; i++) {
    if (!Number.isInteger(counts[i]) || counts[i] < 0 || counts[i] > 4) {
      throw new Error(`${label}的${tileName(i)}数量必须在 0–4 之间。`);
    }
  }
  return counts;
}

/** Accepts 123m456p789s123z, Chinese suits/honors, and 0m/0p/0s red fives. */
export function parseTiles(text) {
  if (typeof text !== 'string') throw new Error('请用文字输入手牌。');
  if (text.length > 1024) throw new Error('手牌输入过长，请限制在 1024 个字符以内。');
  const chineseNumbers = '一二三四五六七八九';
  let source = text.toLowerCase()
    .replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10))
    .replace(/[一二三四五六七八九]/g, ch => String(chineseNumbers.indexOf(ch) + 1))
    .replace(/[万萬]/g, 'm').replace(/[筒饼餅]/g, 'p').replace(/[索条條]/g, 's').replace(/字/g, 'z')
    .replace(/东风|東風|东風|東风/g, '东').replace(/南[风風]/g, '南').replace(/西[风風]/g, '西').replace(/北[风風]/g, '北')
    .replace(/白板/g, '白').replace(/发财|發財/g, '发').replace(/红中|紅中/g, '中')
    .replace(/[\s,，、;；|/\-]/g, '');
  const counts = Array(34).fill(0);
  const reds = [0, 0, 0];
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    const group = /^(\d+)([mpsz])/.exec(rest);
    if (group) {
      const suit = SUITS.indexOf(group[2]);
      for (const digit of group[1]) {
        let number = Number(digit);
        if (number === 0) {
          if (suit === 3) throw new Error('字牌没有红五，字牌编号是 1–7z。');
          number = 5;
          reds[suit]++;
        }
        if (number < 1 || number > (suit === 3 ? 7 : 9)) throw new Error('数牌编号是 1–9，字牌编号是 1–7。');
        counts[(suit === 3 ? 27 : suit * 9) + number - 1]++;
      }
      position += group[0].length;
      continue;
    }
    const honor = '东南西北白发中'.indexOf(rest[0].replace('東', '东').replace('發', '发'));
    if (honor >= 0) {
      counts[27 + honor]++;
      position++;
      continue;
    }
    throw new Error(`无法识别“${rest.slice(0, 8)}”。可输入 123m456p789s东南白，m=万、p=筒、s=索、z=字。`);
  }
  validateCounts(counts);
  return { counts, reds, total: counts.reduce((a, b) => a + b, 0) };
}

export function countsToNotation(counts) {
  validateCounts(counts);
  const parts = [];
  for (let suit = 0; suit < 4; suit++) {
    const start = suit === 3 ? 27 : suit * 9;
    const length = suit === 3 ? 7 : 9;
    let digits = '';
    for (let n = 0; n < length; n++) digits += String(n + 1).repeat(counts[start + n]);
    if (digits) parts.push(digits + SUITS[suit]);
  }
  return parts.join(' ');
}

// Each independent suit has possible (melds, taatsu, head) decompositions.
// At fixed meld/head counts only the largest taatsu count can be useful.
// A base-five key makes the decomposition cache share all repeated analysis.
function decompositions(key, honors = false) {
  const cache = honors ? honorCache : suitedCache;
  const existing = cache.get(key);
  if (existing) return existing;
  let first = 0;
  while (Math.floor(key / POW5[first]) % 5 === 0) first++;
  const n = Math.floor(key / POW5[first]) % 5;
  const unit = POW5[first];
  const best = Array(10).fill(-1);
  const add = (nextKey, meld, taatsu, head) => {
    for (const state of decompositions(nextKey, honors)) {
      const m = (state & 7) + meld;
      const t = Math.min(4, ((state >> 3) & 7) + taatsu);
      const p = (state >> 6) + head;
      if (m <= 4 && p <= 1) {
        const slot = m * 2 + p;
        if (t > best[slot]) best[slot] = t;
      }
    }
  };
  add(key - unit, 0, 0, 0); // An isolated tile can always be discarded.
  if (n >= 3) add(key - 3 * unit, 1, 0, 0);
  if (n >= 2) {
    add(key - 2 * unit, 0, 1, 0);
    add(key - 2 * unit, 0, 0, 1);
  }
  if (!honors) {
    const next = first < 8 && Math.floor(key / POW5[first + 1]) % 5 > 0;
    const after = first < 7 && Math.floor(key / POW5[first + 2]) % 5 > 0;
    if (next && after) add(key - unit - POW5[first + 1] - POW5[first + 2], 1, 0, 0);
    if (next) add(key - unit - POW5[first + 1], 0, 1, 0);
    if (after) add(key - unit - POW5[first + 2], 0, 1, 0);
  }
  const states = [];
  for (let slot = 0; slot < best.length; slot++) {
    if (best[slot] >= 0) states.push(Math.floor(slot / 2) | (best[slot] << 3) | ((slot % 2) << 6));
  }
  cache.set(key, states);
  return states;
}

function unconstrainedNormalShanten(counts, openMelds, rules) {
  let states = [openMelds];
  for (let suit = 0; suit < 4; suit++) {
    const start = suit === 3 ? 27 : suit * 9;
    const length = suit === 3 ? 7 : 9;
    let key = 0;
    for (let i = 0; i < length; i++) key += counts[start + i] * POW5[i];
    // In sanma, 1m and 9m can form pairs/triplets but never sequences.
    const options = decompositions(key, suit === 3 || (rules === 'sanma' && suit === 0));
    const best = Array(10).fill(-1);
    for (const left of states) {
      for (const right of options) {
        const m = (left & 7) + (right & 7);
        const p = (left >> 6) + (right >> 6);
        if (m > 4 || p > 1) continue;
        const t = Math.min(4, ((left >> 3) & 7) + ((right >> 3) & 7));
        const slot = m * 2 + p;
        if (t > best[slot]) best[slot] = t;
      }
    }
    states = [];
    for (let slot = 0; slot < best.length; slot++) {
      if (best[slot] >= 0) states.push(Math.floor(slot / 2) | (best[slot] << 3) | ((slot % 2) << 6));
    }
  }
  let result = 8;
  for (const state of states) {
    const melds = state & 7;
    const taatsu = Math.min((state >> 3) & 7, 4 - melds);
    result = Math.min(result, 8 - 2 * melds - taatsu - (state >> 6));
  }
  return result;
}

// With four identical tiles, the usual meld/taatsu formula can accidentally
// require a fifth copy (for example a triplet plus a single-tile pair wait).
// Compare against legal completed suit shapes in these uncommon hands. This
// independently maximizes retained tiles, with no target using over four copies.
function buildTargets(honors, terminalsOnly = false) {
  const length = honors ? 7 : 9;
  const allowed = terminalsOnly ? [0, 8] : Array.from({ length }, (_, index) => index);
  const meldTypes = allowed.map(index => [index, index, index]);
  if (!honors && !terminalsOnly) for (let i = 0; i < 7; i++) meldTypes.push([i, i + 1, i + 2]);
  const targets = Array.from({ length: 10 }, () => []);
  const keys = Array.from({ length: 10 }, () => new Set());
  const vector = Array(length).fill(0);
  function save(melds) {
    for (const pair of [-1, ...allowed]) {
      if (pair >= 0 && vector[pair] > 2) continue;
      if (pair >= 0) vector[pair] += 2;
      const slot = melds * 2 + (pair >= 0 ? 1 : 0);
      const key = vector.reduce((sum, n, index) => sum + n * POW5[index], 0);
      if (!keys[slot].has(key)) {
        keys[slot].add(key);
        targets[slot].push(Uint8Array.from(vector));
      }
      if (pair >= 0) vector[pair] -= 2;
    }
  }
  function walk(melds, start) {
    save(melds);
    if (melds === 4) return;
    for (let type = start; type < meldTypes.length; type++) {
      const tiles = meldTypes[type];
      for (const tile of tiles) vector[tile]++;
      if (tiles.every(tile => vector[tile] <= 4)) walk(melds + 1, type);
      for (const tile of tiles) vector[tile]--;
    }
  }
  walk(0, 0);
  return targets;
}

function exactSuitMatches(counts, start, length, honors, terminalsOnly = false) {
  const cache = terminalsOnly ? exactTerminalsCache : honors ? exactHonorCache : exactSuitCache;
  let key = 0;
  let total = 0;
  for (let i = 0; i < length; i++) {
    key += counts[start + i] * POW5[i];
    total += counts[start + i];
  }
  if (cache.has(key)) return cache.get(key);
  if (terminalsOnly && !terminalTargets) terminalTargets = buildTargets(false, true);
  if (honors && !honorTargets) honorTargets = buildTargets(true);
  if (!honors && !terminalsOnly && !suitedTargets) suitedTargets = buildTargets(false);
  const targets = terminalsOnly ? terminalTargets : honors ? honorTargets : suitedTargets;
  const scores = Array(10).fill(-100);
  for (let slot = 0; slot < 10; slot++) {
    // Two available manzu kinds cannot supply every meld/head combination.
    if (!targets[slot].length) continue;
    scores[slot] = 0;
    const bound = Math.min(total, Math.floor(slot / 2) * 3 + slot % 2 * 2);
    for (const target of targets[slot]) {
      let score = 0;
      for (let i = 0; i < length; i++) score += Math.min(counts[start + i], target[i]);
      if (score > scores[slot]) scores[slot] = score;
      if (score === bound) break;
    }
  }
  cache.set(key, scores);
  return scores;
}

function exactNormalShanten(counts, openMelds, rules) {
  const meldLimit = 4 - openMelds;
  let scores = Array(10).fill(-100);
  scores[0] = 0;
  for (let suit = 0; suit < 4; suit++) {
    const options = exactSuitMatches(counts, suit === 3 ? 27 : suit * 9, suit === 3 ? 7 : 9, suit === 3, rules === 'sanma' && suit === 0);
    const combined = Array(10).fill(-100);
    for (let left = 0; left < 10; left++) {
      if (scores[left] < 0) continue;
      for (let right = 0; right < 10; right++) {
        if (options[right] < 0) continue;
        const melds = Math.floor(left / 2) + Math.floor(right / 2);
        const pair = left % 2 + right % 2;
        if (melds <= meldLimit && pair <= 1) {
          const slot = melds * 2 + pair;
          combined[slot] = Math.max(combined[slot], scores[left] + options[right]);
        }
      }
    }
    scores = combined;
  }
  return meldLimit * 3 + 2 - scores[meldLimit * 2 + 1] - 1;
}

function normalShanten(counts, openMelds, rules) {
  return counts.includes(4) ? exactNormalShanten(counts, openMelds, rules) : unconstrainedNormalShanten(counts, openMelds, rules);
}

const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
function shapes(counts, openMelds, rules) {
  const normal = normalShanten(counts, openMelds, rules);
  let chiitoitsu = null;
  let kokushi = null;
  if (!openMelds) {
    let pairs = 0;
    let distinct = 0;
    for (const n of counts) {
      if (n) distinct++;
      if (n >= 2) pairs++;
    }
    chiitoitsu = 6 - pairs + Math.max(0, 7 - distinct);
    let unique = 0;
    let hasPair = 0;
    for (const index of ORPHANS) {
      if (counts[index]) unique++;
      if (counts[index] >= 2) hasPair = 1;
    }
    kokushi = 13 - unique - hasPair;
  }
  return { normal, chiitoitsu, kokushi };
}

function minimum(shapeShanten) {
  return Math.min(...Object.values(shapeShanten).filter(value => value !== null));
}

/** General shape shanten: -1 complete, 0 tenpai, 1 one shanten, etc. */
export function calculateShanten(counts, openMelds = 0, rules = 'yonma') {
  validateRules(rules);
  validateRuleCounts(counts, rules);
  if (!Number.isInteger(openMelds) || openMelds < 0 || openMelds > 4) throw new Error('副露面子数量必须在 0–4 之间。');
  return minimum(shapes(counts, openMelds, rules));
}

function drawAnalysis(counts, visible, openMelds, rules) {
  const shapeShanten = shapes(counts, openMelds, rules);
  const shanten = minimum(shapeShanten);
  const improving = [];
  for (const index of tilePool(rules)) {
    if (counts[index] === 4) continue;
    counts[index]++;
    const next = minimum(shapes(counts, openMelds, rules));
    counts[index]--;
    if (next < shanten) {
      const remaining = 4 - counts[index] - visible[index];
      improving.push({ index, tile: index, name: tileName(index), remaining, liveCount: remaining, shanten: next });
    }
  }
  const waits = shanten === 0 ? improving.filter(item => item.shanten === -1) : [];
  return {
    shanten,
    shapeShanten,
    improving,
    waits,
    liveTotal: improving.reduce((sum, item) => sum + item.remaining, 0),
    waitKinds: waits.length,
    improvingKinds: improving.length,
    liveKinds: improving.filter(item => item.remaining > 0).length,
  };
}

/**
 * Analyze concealed tiles before drawing (13 - 3 * openMelds) or before
 * discarding (14 - 3 * openMelds). Counts and visible inputs are never mutated.
 */
export function analyzeHand({ counts, visible = Array(34).fill(0), openMelds = 0, rules = 'yonma' }) {
  validateRules(rules);
  validateRuleCounts(counts, rules);
  validateRuleCounts(visible, rules, '已见牌');
  if (!Number.isInteger(openMelds) || openMelds < 0 || openMelds > 4) throw new Error('副露面子数量必须在 0–4 之间。');
  for (let i = 0; i < 34; i++) {
    if (counts[i] + visible[i] > 4) throw new Error(`${tileName(i)}的手牌与已见牌合计超过了 4 张。`);
  }
  const tileCount = counts.reduce((a, b) => a + b, 0);
  const drawCount = 13 - openMelds * 3;
  if (tileCount !== drawCount && tileCount !== drawCount + 1) {
    throw new Error(`已有 ${openMelds} 组副露时，请输入 ${drawCount} 张（摸牌前）或 ${drawCount + 1} 张（切牌前）手牌；当前 ${tileCount} 张。`);
  }
  const hand = counts.slice();
  const seen = visible.slice();
  const base = { tileCount, openMelds, rules, mode: tileCount === drawCount ? 'draw' : 'discard' };
  if (base.mode === 'draw') return { ...base, ...drawAnalysis(hand, seen, openMelds, rules), discards: [] };
  const shapeShanten = shapes(hand, openMelds, rules);
  const discards = [];
  for (let index = 0; index < 34; index++) {
    if (!hand[index]) continue;
    hand[index]--;
    seen[index]++; // A discarded tile is still known: it does not replenish stock.
    discards.push({ index, tile: index, name: tileName(index), ...drawAnalysis(hand, seen, openMelds, rules) });
    seen[index]--;
    hand[index]++;
  }
  discards.sort((a, b) => a.shanten - b.shanten || b.liveTotal - a.liveTotal || b.improvingKinds - a.improvingKinds || a.index - b.index);
  return {
    ...base,
    shanten: minimum(shapeShanten),
    shapeShanten,
    improving: [],
    waits: [],
    liveTotal: discards[0]?.liveTotal ?? 0,
    waitKinds: discards[0]?.waitKinds ?? 0,
    improvingKinds: discards[0]?.improvingKinds ?? 0,
    liveKinds: discards[0]?.liveKinds ?? 0,
    discards,
  };
}
