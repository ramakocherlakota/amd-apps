/* Gin rummy rules and computer strategy. No DOM; also runs under Node for tests.
   A card is a number 0-51: suit = floor(card / 13) (spades, hearts, diamonds, clubs),
   rank = card % 13 (0 = ace ... 12 = king). Aces are low only. */
(function (root) {
  "use strict";

  const SUITS = ["spades", "hearts", "diamonds", "clubs"];
  const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];
  const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const RANK_NAMES = ["ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king"];
  const RANK_PLURALS = ["aces", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "jacks", "queens", "kings"];

  const suit = (c) => Math.floor(c / 13);
  const rank = (c) => c % 13;
  const value = (c) => Math.min(rank(c) + 1, 10);
  const total = (cards) => cards.reduce((s, c) => s + value(c), 0);

  function cardName(c) {
    const r = RANK_NAMES[rank(c)];
    return (rank(c) === 0 || rank(c) > 9 ? r[0].toUpperCase() + r.slice(1) : r) + " of " + SUITS[suit(c)];
  }
  function shortName(c) { return RANK_LABELS[rank(c)] + SUIT_SYMBOLS[suit(c)]; }

  function bySuit(a, b) { return suit(a) - suit(b) || rank(a) - rank(b); }
  function byRank(a, b) { return rank(a) - rank(b) || suit(a) - suit(b); }

  function shuffled() {
    const d = [];
    for (let i = 0; i < 52; i++) d.push(i);
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  // ---------- Melds ----------
  function isSet(m) { return m.length >= 2 && rank(m[0]) === rank(m[1]); }

  function allMelds(hand) {
    const melds = [];
    const ranks = Array.from({ length: 13 }, () => []);
    for (const c of hand) ranks[rank(c)].push(c);
    for (const g of ranks) {
      if (g.length >= 3) melds.push(g.slice().sort(bySuit));
      if (g.length === 4) for (let i = 0; i < 4; i++) melds.push(g.filter((_, j) => j !== i).sort(bySuit));
    }
    for (let s = 0; s < 4; s++) {
      const cards = hand.filter((c) => suit(c) === s).sort(byRank);
      let start = 0;
      for (let i = 1; i <= cards.length; i++) {
        if (i === cards.length || rank(cards[i]) !== rank(cards[i - 1]) + 1) {
          const seq = cards.slice(start, i);
          for (let a = 0; a < seq.length; a++) {
            for (let b = a + 2; b < seq.length; b++) melds.push(seq.slice(a, b + 1));
          }
          start = i;
        }
      }
    }
    return melds;
  }

  // Every way to choose non-overlapping melds. `visit` gets (melds, deadwood).
  function arrangements(hand, visit) {
    const idx = new Map(hand.map((c, i) => [c, i]));
    const melds = allMelds(hand).map((cards) => ({
      cards,
      mask: cards.reduce((m, c) => m | (1 << idx.get(c)), 0),
      value: total(cards),
    }));
    const chosen = [];
    (function rec(start, used) {
      visit(chosen.map((m) => m.cards), hand.filter((c) => !(used & (1 << idx.get(c)))));
      for (let i = start; i < melds.length; i++) {
        if (melds[i].mask & used) continue;
        chosen.push(melds[i]);
        rec(i + 1, used | melds[i].mask);
        chosen.pop();
      }
    })(0, 0);
  }

  // The arrangement with the least deadwood.
  function best(hand) {
    let out = null;
    arrangements(hand, (melds, dead) => {
      const v = total(dead);
      // Ties: fewer deadwood cards, then fewer (longer) melds, which read more simply.
      if (!out || v < out.value || (v === out.value && (dead.length < out.deadwood.length ||
          (dead.length === out.deadwood.length && melds.length < out.melds.length)))) {
        out = { melds: melds.map((m) => m.slice()), deadwood: dead.slice(), value: v };
      }
    });
    out.deadwood.sort(bySuit);
    return out;
  }

  // ---------- Knocking and scoring ----------
  function fits(meld, c) {
    if (isSet(meld)) return rank(c) === rank(meld[0]) && meld.length < 4;
    if (suit(c) !== suit(meld[0])) return false;
    const rs = meld.map(rank);
    return rank(c) === Math.min(...rs) - 1 || rank(c) === Math.max(...rs) + 1;
  }

  // Lay off as many of `deadwood` onto `melds` as possible (repeating, so runs can grow).
  function layOff(melds, deadwood) {
    const ms = melds.map((m) => m.slice());
    let remaining = deadwood.slice();
    const laid = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of remaining) {
        const i = ms.findIndex((m) => fits(m, c));
        if (i >= 0) {
          ms[i].push(c);
          ms[i].sort(isSet(ms[i]) ? bySuit : byRank);
          laid.push(c);
          remaining = remaining.filter((x) => x !== c);
          changed = true;
          break;
        }
      }
    }
    return { melds: ms, laid, remaining };
  }

  /* Score a knock. Both hands have 10 cards (the knocker has already discarded).
     Returns who won, the points, and everything needed to show the hand. */
  function scoreKnock(knockerHand, defenderHand) {
    const k = best(knockerHand);
    const gin = k.value === 0;
    let d;
    if (gin) {
      const b = best(defenderHand);
      d = { melds: b.melds, laid: [], deadwood: b.deadwood, value: b.value };
    } else {
      arrangements(defenderHand, (melds, dead) => {
        const lo = layOff(k.melds, dead);
        const v = total(lo.remaining);
        if (!d || v < d.value) {
          d = { melds: melds.map((m) => m.slice()), laid: lo.laid, deadwood: lo.remaining.sort(bySuit), value: v };
        }
      });
    }
    let kind, winner, points;
    if (gin) { kind = "gin"; winner = "knocker"; points = 25 + d.value; }
    else if (d.value <= k.value) { kind = "undercut"; winner = "defender"; points = k.value - d.value + 25; }
    else { kind = "knock"; winner = "knocker"; points = d.value - k.value; }
    return { kind, winner, points, knocker: k, defender: d };
  }

  // Bonuses at the end of a game (standard scoring: 100 for the game, 25 per hand won,
  // and the winner's total doubles if the loser won no hands).
  function gameTotals(scores, handsWon, winner) {
    const loser = winner === "a" ? "b" : "a";
    const t = {
      a: scores.a + 25 * handsWon.a + (winner === "a" ? 100 : 0),
      b: scores.b + 25 * handsWon.b + (winner === "b" ? 100 : 0),
    };
    const shutout = handsWon[loser] === 0;
    if (shutout) t[winner] *= 2;
    return { totals: t, shutout };
  }

  // ---------- Computer strategy ----------
  /* ctx = { level: "easy" | "medium",
             stockLeft,                  // cards left in the deck
             seen: [cards],              // every card ever discarded (public)
             oppPicked: [cards] }        // cards the opponent took from the discard pile
     The computer only ever uses its own hand and public information.
     (A "strong" level that also avoided feeding the opponent was tried and, over
     thousands of simulated hands, played no better than medium, so it was dropped.) */

  // How many cards that could complete a pair/near-run are still unaccounted for.
  function liveCount(cards, hand, ctx) {
    const gone = new Set([...hand, ...(ctx.seen || []), ...(ctx.oppPicked || [])]);
    return cards.filter((c) => !gone.has(c)).length;
  }

  function potential(dead, hand, ctx) {
    let p = 0;
    for (let i = 0; i < dead.length; i++) {
      for (let j = i + 1; j < dead.length; j++) {
        const a = dead[i], b = dead[j];
        if (rank(a) === rank(b)) {
          const need = [0, 1, 2, 3].filter((s) => s !== suit(a) && s !== suit(b)).map((s) => s * 13 + rank(a));
          p += Math.min(liveCount(need, hand, ctx), 2) * 0.5;
        } else if (suit(a) === suit(b)) {
          const lo = Math.min(rank(a), rank(b)), hi = Math.max(rank(a), rank(b));
          const s = suit(a);
          if (hi - lo === 1) {
            const need = [lo - 1, hi + 1].filter((r) => r >= 0 && r <= 12).map((r) => s * 13 + r);
            p += Math.min(liveCount(need, hand, ctx), 2) * 0.5;
          } else if (hi - lo === 2) {
            p += liveCount([s * 13 + lo + 1], hand, ctx) * 0.6;
          }
        }
      }
    }
    return p;
  }

  // Lower is better: deadwood, minus credit for cards likely to become melds.
  function evaluate(hand, ctx) {
    const b = best(hand);
    if (ctx.level === "easy") return b.value;
    const weight = 2.5 * Math.max(0.3, Math.min(1, ctx.stockLeft / 31));
    return b.value - weight * potential(b.deadwood, hand, ctx);
  }

  // Should the computer take `card` from the discard pile?
  function shouldTake(hand, card, ctx) {
    const withCard = hand.concat([card]);
    let bestAfter = null;
    for (const d of withCard) {
      if (d === card) continue;
      const b = best(withCard.filter((x) => x !== d));
      if (!bestAfter || b.value < bestAfter.value) bestAfter = b;
    }
    const inMeld = bestAfter.melds.some((m) => m.includes(card));
    if (ctx.level === "easy") return inMeld && Math.random() < 0.75;
    if (inMeld) return true;
    const now = best(hand).value;
    return bestAfter.value <= 10 && bestAfter.value < now;
  }

  // Choose a discard from 11 cards, and whether to knock. `forbidden` is the card just
  // taken from the discard pile (it can't go straight back).
  function chooseDiscard(hand, ctx, forbidden) {
    const options = hand.filter((c) => c !== forbidden);
    // Can we go gin or knock?
    let low = null;
    for (const c of options) {
      const v = best(hand.filter((x) => x !== c)).value;
      if (!low || v < low.value) low = { card: c, value: v };
    }
    if (low.value <= 10) return { discard: low.card, knock: true, gin: low.value === 0, deadwood: low.value };

    if (ctx.level === "easy") {
      const dead = best(hand).deadwood.filter((c) => c !== forbidden);
      const pool = dead.length ? dead : options;
      const pick = Math.random() < 0.35
        ? pool[Math.floor(Math.random() * pool.length)]
        : pool.reduce((a, c) => (value(c) > value(a) ? c : a));
      return { discard: pick, knock: false, gin: false };
    }
    let choice = null;
    for (const c of options) {
      const score = evaluate(hand.filter((x) => x !== c), ctx);
      if (!choice || score < choice.score - 1e-9 || (Math.abs(score - choice.score) < 1e-9 && value(c) > value(choice.card))) {
        choice = { card: c, score };
      }
    }
    return { discard: choice.card, knock: false, gin: false };
  }

  // ---------- Words for hints and speech ----------
  function describeMeld(m) {
    if (isSet(m)) return (m.length === 4 ? "four " : "three ") + RANK_PLURALS[rank(m[0])];
    const rs = m.slice().sort(byRank).map((c) => RANK_NAMES[rank(c)]);
    return "a run of " + rs.join(", ") + " of " + SUITS[suit(m[0])];
  }

  // Why taking `card` helps (or not), for the hint button.
  function takeReason(hand, card) {
    const withCard = hand.concat([card]);
    let bestAfter = null;
    for (const d of withCard) {
      if (d === card) continue;
      const b = best(withCard.filter((x) => x !== d));
      if (!bestAfter || b.value < bestAfter.value) bestAfter = b;
    }
    const m = bestAfter.melds.find((x) => x.includes(card));
    return m ? `it makes ${describeMeld(m)}` : null;
  }

  const api = {
    SUITS, SUIT_SYMBOLS, RANK_LABELS, RANK_NAMES, RANK_PLURALS,
    suit, rank, value, total, cardName, shortName, bySuit, byRank, shuffled,
    isSet, allMelds, best, fits, layOff, scoreKnock, gameTotals,
    evaluate, shouldTake, chooseDiscard, describeMeld, takeReason,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Gin = api;
})(this);
