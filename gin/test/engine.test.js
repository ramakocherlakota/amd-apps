// Run with: node gin/test/engine.test.js
const G = require("../engine.js");
const assert = require("assert");

// Card helper: c("7H") -> card number
const S = { S: 0, H: 1, D: 2, C: 3 };
const R = { A: 0, J: 10, Q: 11, K: 12 };
function c(s) {
  const r = s.slice(0, -1), su = s.slice(-1);
  return S[su] * 13 + (R[r] !== undefined ? R[r] : Number(r) - 1);
}
const cs = (str) => str.split(" ").map(c);

let n = 0;
function t(name, fn) { fn(); n++; }

t("names", () => {
  assert.equal(G.cardName(c("AS")), "Ace of spades");
  assert.equal(G.cardName(c("10D")), "10 of diamonds");
  assert.equal(G.cardName(c("QC")), "Queen of clubs");
  assert.equal(G.value(c("KH")), 10);
  assert.equal(G.value(c("AH")), 1);
});

t("best arrangement picks least deadwood when a card could go two ways", () => {
  // 7H could be in the run 7-8-9H or the set of 7s; using it in the run and
  // keeping 7S 7D as deadwood (14) is worse than set 7S7D7H + deadwood 8H 9H (17)?
  // Best: run 7H8H9H + deadwood 7S 7D = 14.
  const b = G.best(cs("7H 8H 9H 7S 7D"));
  assert.equal(b.value, 14);
  // With a 4th seven both melds work: set 7S7D7C + run 7H8H9H
  const b2 = G.best(cs("7H 8H 9H 7S 7D 7C KS"));
  assert.equal(b2.value, 10);
});

t("a long run stays in one piece", () => {
  const b = G.best(cs("4C 5C 6C 7C 8C 9C 10C AD 2D AC"));
  assert.equal(b.melds.length, 1);
  assert.equal(b.melds[0].length, 7);
});

t("ace is low only", () => {
  assert.equal(G.best(cs("QS KS AS")).value, 21);
  assert.equal(G.best(cs("AS 2S 3S")).value, 0);
});

t("gin scoring: 25 + opponent deadwood, no layoffs", () => {
  const k = cs("AS 2S 3S 4S 5H 5D 5C 9C 10C JC");
  const d = cs("6S 7S KH KD 2C 3C 8H 8D QH QS");
  const r = G.scoreKnock(k, d);
  assert.equal(r.kind, "gin");
  assert.equal(r.points, 25 + G.best(d).value);
  assert.equal(r.defender.laid.length, 0);
});

t("knock with layoffs, including a chain onto a run", () => {
  // Knocker: run 4-5-6H, set of 9s, run 10-J-QS... deadwood 2C (2)
  const k = cs("4H 5H 6H 9S 9D 9C 10S JS QS 2C");
  // Defender can lay off 7H then 8H (chain) and 9H onto the 9s; KS onto the spade run.
  const d = cs("7H 8H 9H KS 3D 4D 6C 6D KC KD");
  const r = G.scoreKnock(k, d);
  assert.equal(r.kind, "knock");
  assert.deepEqual(r.defender.laid.slice().sort(), cs("7H 8H 9H").sort());
  // Remaining defender: set KC KD + KS? KS laid off or in set of kings:
  // best is set KS KC KD (0) + lay off 7H 8H 9H, deadwood 3D 4D 6C 6D = 19,
  // or lay off KS and keep KC KD as deadwood = 39. So expect 19.
  assert.equal(r.defender.value, 19);
  assert.equal(r.points, 19 - 2);
});

t("undercut: defender scores difference + 25", () => {
  const k = cs("AS 2S 3S 4H 4D 4C 7C 8C 9C 9H");      // deadwood 9
  const d = cs("5S 6S 7S JH JD JC 2H 3H AD 4S");      // deadwood 2H 3H AD = 6 < 9
  const r = G.scoreKnock(k, d);
  assert.equal(r.kind, "undercut");
  assert.equal(r.winner, "defender");
  assert.equal(r.defender.value, 6);
  assert.equal(r.points, 9 - 6 + 25);
});

t("game totals: game bonus, boxes, shutout doubles", () => {
  const g = G.gameTotals({ a: 105, b: 0 }, { a: 4, b: 0 }, "a");
  assert.equal(g.totals.a, (105 + 100 + 100) * 2);
  assert.ok(g.shutout);
  const h = G.gameTotals({ a: 102, b: 60 }, { a: 3, b: 2 }, "a");
  assert.deepEqual(h.totals, { a: 102 + 75 + 100, b: 60 + 50 });
});

t("computer won't discard the card it just took, and knocks when it can", () => {
  const hand = cs("4H 5H 6H 9S 9D 9C 10S JS QS 2C KD");
  const ctx = { level: "medium", stockLeft: 20, seen: [], oppPicked: [] };
  const m = G.chooseDiscard(hand, ctx, c("KD"));
  assert.notEqual(m.discard, c("KD"));
  assert.ok(m.knock);
  assert.equal(m.discard, c("2C"));   // the KD must stay; keep 10 deadwood... 2C out leaves KD=10
  const m2 = G.chooseDiscard(hand, ctx, null);
  assert.equal(m2.discard, c("KD"));
  assert.equal(m2.deadwood, 2);
});

t("computer takes a discard that completes a meld", () => {
  const hand = cs("7H 8H KS KD 2C 5D 9S JC QD 3S");
  const ctx = { level: "medium", stockLeft: 20, seen: [], oppPicked: [] };
  assert.ok(G.shouldTake(hand, c("9H"), ctx));
  assert.ok(!G.shouldTake(hand, c("4C"), ctx));
});

console.log(`${n} rule tests passed`);

// ---------- Computer vs computer ----------
function playHand(levels, dealer) {
  const deck = G.shuffled();
  const hands = [[], []];
  for (let i = 0; i < 10; i++) { hands[0].push(deck.pop()); hands[1].push(deck.pop()); }
  const discard = [deck.pop()];
  const mem = [ { picked: [], discarded: [] }, { picked: [], discarded: [] } ];
  const seen = [discard[0]];
  const ctxFor = (p) => ({ level: levels[p], stockLeft: deck.length, seen: seen.slice(),
    oppPicked: mem[1 - p].picked });
  let p = 1 - dealer;
  // Upcard: non-dealer, then dealer, may take it; otherwise non-dealer draws.
  let first = true, passes = 0;
  for (let turn = 0; turn < 200; turn++) {
    let taken = null;
    if (first) {
      if (G.shouldTake(hands[p], discard[discard.length - 1], ctxFor(p))) {
        taken = discard.pop(); hands[p].push(taken); mem[p].picked.push(taken); first = false;
      } else {
        passes++;
        if (passes === 1) { p = 1 - p; continue; }
        p = 1 - dealer; hands[p].push(deck.pop()); first = false;
      }
    } else {
      const top = discard[discard.length - 1];
      if (G.shouldTake(hands[p], top, ctxFor(p))) { taken = discard.pop(); hands[p].push(taken); mem[p].picked.push(taken); }
      else hands[p].push(deck.pop());
    }
    assert.equal(hands[p].length, 11);
    const m = G.chooseDiscard(hands[p], ctxFor(p), taken);
    assert.notEqual(m.discard, taken);
    hands[p] = hands[p].filter((x) => x !== m.discard);
    discard.push(m.discard); seen.push(m.discard); mem[p].discarded.push(m.discard);
    if (m.knock) {
      const r = G.scoreKnock(hands[p], hands[1 - p]);
      assert.equal(G.best(hands[p]).value, m.deadwood);
      const winner = r.winner === "knocker" ? p : 1 - p;
      return { winner, points: r.points, kind: r.kind };
    }
    if (deck.length <= 2) return { winner: -1, points: 0, kind: "draw" };
    p = 1 - p;
  }
  throw new Error("hand did not end");
}

function match(levels, hands) {
  const pts = [0, 0], wins = [0, 0], kinds = {};
  for (let i = 0; i < hands; i++) {
    const r = playHand(levels, i % 2);
    kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    if (r.winner >= 0) { pts[r.winner] += r.points; wins[r.winner]++; }
  }
  return { levels, wins, pts, kinds };
}

const N = Number(process.argv[2] || 300);
for (const lv of [["medium", "easy"], ["easy", "medium"]]) {
  const r = match(lv, N);
  console.log(`${lv[0]} vs ${lv[1]} over ${N} hands: hands won ${r.wins[0]}-${r.wins[1]}, points ${r.pts[0]}-${r.pts[1]}`, JSON.stringify(r.kinds));
}
