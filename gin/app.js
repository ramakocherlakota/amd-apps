/* Gin Rummy against the computer, built for low vision.
   Rules and computer strategy live in engine.js; this file is the table, the turn
   flow, speech and hints. Progress is kept in localStorage. */
(function () {
  "use strict";
  const G = window.Gin;
  const VS = "︎"; // ask iOS to draw suit symbols as text, not emoji

  // ---------- Storage ----------
  const KEY = "gin.v1.";
  function load(name, fallback) {
    try {
      const raw = localStorage.getItem(KEY + name);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(name, value) {
    try { localStorage.setItem(KEY + name, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  const DEFAULT_SETTINGS = {
    level: "medium",
    order: "melds",
    theme: "yellow",
    size: "large",
    speakCards: true,
    autoSpeak: true,
    rate: 0.85,
    voice: "",
  };
  const settings = Object.assign({}, DEFAULT_SETTINGS, load("settings", {}));
  const stats = Object.assign({ games: 0, won: 0 }, load("stats", {}));
  let game = load("game", null);
  let selected = null;     // card chosen for discarding (not saved)
  let cpuTimer = null;
  let cpuDelay = 1100;     // pause before the computer moves, so you can follow along

  const other = (who) => (who === "you" ? "cpu" : "you");
  const top = () => game.discard[game.discard.length - 1];
  const persist = () => save("game", game);

  // ---------- Speech ----------
  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    fillVoiceSelect();
  }
  function pickVoice() {
    if (settings.voice) {
      const chosen = voices.find((v) => v.voiceURI === settings.voice);
      if (chosen) return chosen;
    }
    const good = (v) => /enhanced|premium/i.test(v.name + " " + v.voiceURI);
    const us = (v) => /en[-_]US/i.test(v.lang);
    return voices.find((v) => good(v) && us(v)) || voices.find(good) ||
      voices.find((v) => us(v) && v.default) || voices.find(us) || voices[0] || null;
  }
  function speak(text) {
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "en-US"; }
    u.rate = Number(settings.rate) || 0.85;
    synth.speak(u);
  }
  const name = (c) => G.cardName(c);
  const short = (c) => G.RANK_LABELS[G.rank(c)] + G.SUIT_SYMBOLS[G.suit(c)] + VS;
  function list(items) {
    if (items.length <= 1) return items.join("");
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }
  function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

  // ---------- Game setup ----------
  function newGame() {
    game = {
      scores: { you: 0, cpu: 0 },
      wins: { you: 0, cpu: 0 },
      dealer: "cpu",           // you get the first choice of the up card in game one
      handNo: 0,
      over: false,
    };
    startHand();
  }

  function startHand() {
    const deck = G.shuffled();
    const hands = { you: [], cpu: [] };
    for (let i = 0; i < 10; i++) {
      hands[other(game.dealer)].push(deck.pop());
      hands[game.dealer].push(deck.pop());
    }
    const up = deck.pop();
    Object.assign(game, {
      handNo: game.handNo + 1,
      deck, hands,
      discard: [up],
      seen: [up],
      youPicked: [], cpuPicked: [],
      phase: "upcard",
      upTurn: other(game.dealer),
      passes: 0,
      mustDraw: false,
      justTaken: null,
      drawn: null,
      result: null,
      msg: "",
    });
    selected = null;
    closePanels();
    persist();
    if (game.upTurn === "cpu") {
      setMessage(`New hand. I deal. The first card up is the ${short(up)}.`);
      render();
      scheduleCpu();
    } else {
      const say = `New hand. ${game.dealer === "cpu" ? "I dealt" : "You dealt"}. ` +
        `The first card up is the ${name(up)}. You get first choice: take it, or pass.`;
      setMessage(`New hand. The first card up is the ${short(up)}. Take it, or pass?`);
      render();
      speakIf(say);
    }
  }

  function speakIf(text) { if (settings.autoSpeak) speak(text); }

  // ---------- Your moves ----------
  function takeUpcard() {
    if (game.phase !== "upcard" || game.upTurn !== "you") return;
    takeFromDiscard();
  }

  function pass() {
    if (game.phase !== "upcard" || game.upTurn !== "you") return;
    game.passes++;
    if (game.passes === 1) {
      game.upTurn = "cpu";
      setMessage(`You passed on the ${short(top())}.`);
      persist();
      render();
      scheduleCpu();
    } else {
      // Both passed: the non-dealer must draw from the deck. You passed second,
      // so you're the dealer and I (the non-dealer) draw.
      game.phase = "cpu";
      setMessage(`You passed too. I'll draw from the deck…`);
      persist();
      render();
      scheduleCpu();
    }
  }

  function drawFromDeck() {
    if (game.phase !== "draw") return;
    const c = game.deck.pop();
    game.hands.you.push(c);
    game.drawn = c;
    game.justTaken = null;
    game.mustDraw = false;
    game.phase = "discard";
    selected = null;
    setMessage(`You drew the ${short(c)}. Now tap a card to throw away.`);
    persist();
    render();
    speakIf(`You drew the ${name(c)}. Now choose a card to throw away.`);
  }

  function takeFromDiscard() {
    if (!(game.phase === "draw" && !game.mustDraw) && !(game.phase === "upcard" && game.upTurn === "you")) return;
    const c = game.discard.pop();
    game.hands.you.push(c);
    game.youPicked.push(c);
    game.drawn = c;
    game.justTaken = c;
    game.phase = "discard";
    selected = null;
    setMessage(`You took the ${short(c)}. Now tap a card to throw away.`);
    persist();
    render();
    speakIf(`You took the ${name(c)}. Now choose a card to throw away.`);
  }

  function tapCard(c) {
    if (game.phase === "discard") {
      if (selected === c) {
        speak(`${name(c)} is chosen. Tap the Discard button to throw it away.`);
        return;
      }
      selected = c;
      render();
      if (!settings.speakCards) return;
      if (c === game.justTaken) {
        speak(`${name(c)}. You just took this card, so you can't throw it straight back.`);
        return;
      }
      const after = G.best(game.hands.you.filter((x) => x !== c)).value;
      let say = `${name(c)} chosen. Tap Discard to throw it away.`;
      if (after === 0) say += " If you throw this one, you have gin!";
      else if (after <= 10) say += ` Or knock: your deadwood would be ${after}.`;
      speak(say);
    } else if (settings.speakCards) {
      speak(cardRole(c));
    }
  }

  function cardRole(c) {
    const b = G.best(game.hands.you);
    const m = b.melds.find((x) => x.includes(c));
    return m ? `${name(c)}. Part of ${G.describeMeld(m)}.` : `${name(c)}. A loose card, ${plural(G.value(c), "point")}.`;
  }

  function discard(knock) {
    if (game.phase !== "discard" || selected === null || selected === game.justTaken) return;
    const c = selected;
    const rest = game.hands.you.filter((x) => x !== c);
    const dw = G.best(rest).value;
    if (knock && dw > 10) return;
    game.hands.you = rest;
    game.discard.push(c);
    game.seen.push(c);
    game.drawn = null;
    game.justTaken = null;
    selected = null;
    if (knock) {
      resolveKnock("you");
      return;
    }
    if (game.deck.length <= 2) { handDrawn(); return; }
    game.phase = "cpu";
    setMessage(`You threw away the ${short(c)}. My turn…`);
    persist();
    render();
    scheduleCpu();
  }

  // ---------- Computer's moves ----------
  function ctx() {
    return { level: settings.level, stockLeft: game.deck.length, seen: game.seen, oppPicked: game.youPicked };
  }

  function scheduleCpu() {
    clearTimeout(cpuTimer);
    cpuTimer = setTimeout(cpuAct, cpuDelay);
  }

  function cpuAct() {
    if (game.phase === "upcard" && game.upTurn === "cpu") {
      const c = top();
      if (G.shouldTake(game.hands.cpu, c, ctx())) {
        cpuTakeAndDiscard(c, `I'll take the ${name(c)}.`, `I took the ${short(c)}`);
        return;
      }
      game.passes++;
      if (game.passes === 1) {
        game.upTurn = "you";
        setMessage(`I passed on the ${short(c)}. Do you want it?`);
        persist();
        render();
        speakIf(`I pass on the ${name(c)}. Do you want it? Take it, or pass.`);
      } else {
        // Both passed: the non-dealer must draw from the deck. I passed second,
        // so I'm the dealer and you (the non-dealer) draw.
        game.phase = "draw";
        game.mustDraw = true;
        setMessage(`I passed on the ${short(c)} too. Draw a card from the deck.`);
        persist();
        render();
        speakIf(`I pass on the ${name(c)} too. Since we both passed, you draw from the deck.`);
      }
      return;
    }
    if (game.phase !== "cpu") return;
    const c = top();
    if (game.passes === 2 && game.discard.length && game.seen.length === 1) {
      // First turn after we both passed on the up card: I must draw from the deck.
      game.hands.cpu.push(game.deck.pop());
      cpuDiscard(null, "I drew from the deck.", "I drew from the deck");
      return;
    }
    if (G.shouldTake(game.hands.cpu, c, ctx())) {
      cpuTakeAndDiscard(c, `I took your ${name(c)}.`, `I took the ${short(c)}`);
    } else {
      game.hands.cpu.push(game.deck.pop());
      cpuDiscard(null, "I drew from the deck.", "I drew from the deck");
    }
  }

  function cpuTakeAndDiscard(c, say, show) {
    game.discard.pop();
    game.hands.cpu.push(c);
    game.cpuPicked.push(c);
    cpuDiscard(c, say, show);
  }

  function cpuDiscard(taken, say, show) {
    const m = G.chooseDiscard(game.hands.cpu, ctx(), taken);
    game.hands.cpu = game.hands.cpu.filter((x) => x !== m.discard);
    game.discard.push(m.discard);
    game.seen.push(m.discard);
    if (m.knock) {
      resolveKnock("cpu", `${say} I threw away the ${name(m.discard)}, and ${m.gin ? "I have gin!" : "I'm knocking."}`);
      return;
    }
    if (game.deck.length <= 2) { handDrawn(); return; }
    game.phase = "draw";
    game.mustDraw = false;
    const d = top();
    setMessage(`${show} and threw away the ${short(d)}. Your turn: draw a card.`);
    persist();
    render();
    speakIf(`${say} I threw away the ${name(d)}. Your turn. Draw from the deck, or take the ${name(d)}.`);
  }

  // ---------- End of a hand ----------
  function resolveKnock(knocker, lead) {
    const defender = other(knocker);
    const r = G.scoreKnock(game.hands[knocker], game.hands[defender]);
    const winner = r.winner === "knocker" ? knocker : defender;
    game.scores[winner] += r.points;
    game.wins[winner]++;
    game.result = { type: r.kind, knocker, winner, points: r.points, detail: r, lead: lead || "" };
    finishHand();
  }

  function handDrawn() {
    game.result = { type: "draw" };
    finishHand();
  }

  function finishHand() {
    game.phase = "over";
    const res = game.result;
    if (res.type !== "draw") {
      if (game.scores.you >= 100 || game.scores.cpu >= 100) {
        const w = game.scores.you >= 100 ? "you" : "cpu";
        const t = G.gameTotals({ a: game.scores.you, b: game.scores.cpu }, { a: game.wins.you, b: game.wins.cpu }, w === "you" ? "a" : "b");
        game.over = true;
        game.final = { winner: w, you: t.totals.a, cpu: t.totals.b, shutout: t.shutout };
        stats.games++;
        if (w === "you") stats.won++;
        save("stats", stats);
      }
      game.dealer = other(game.dealer);  // the deal alternates
    }
    // On a drawn hand, the same dealer deals again.
    persist();
    render();
    showResult(true);
  }

  function resultText() {
    const res = game.result;
    if (res.type === "draw") {
      return { title: "No winner", say: "The deck is down to two cards and nobody knocked, so this hand doesn't count. Same dealer deals again." };
    }
    const d = res.detail;
    const you = res.knocker === "you" ? d.knocker : d.defender;
    const cpu = res.knocker === "cpu" ? d.knocker : d.defender;
    const laid = d.defender.laid;
    const laidText = laid.length ? ` after laying off the ${list(laid.map(name))}` : "";
    let title, say;
    if (res.knocker === "you") {
      if (res.type === "gin") {
        title = "Gin! You win the hand";
        say = `Gin! I had ${cpu.value} deadwood. You score ${res.points} points, including the 25-point gin bonus.`;
      } else if (res.type === "undercut") {
        title = "Undercut! I win the hand";
        say = `You knocked with ${you.value} deadwood, but I had only ${cpu.value}${laidText}. That's an undercut: I score ${res.points} points, including the 25-point bonus.`;
      } else {
        title = "You knocked and won the hand";
        say = `You knocked with ${you.value} deadwood. I had ${cpu.value}${laidText}. You score ${res.points} points.`;
      }
    } else {
      const lead = res.lead ? res.lead + " " : "";
      if (res.type === "gin") {
        title = "I went gin";
        say = `${lead}You had ${you.value} deadwood. I score ${res.points} points, including the 25-point gin bonus.`;
      } else if (res.type === "undercut") {
        title = "You undercut me! You win the hand";
        say = `${lead}I had ${cpu.value} deadwood, but you had only ${you.value}${laidText}. You score ${res.points} points, including the 25-point undercut bonus.`;
      } else {
        title = "I knocked and won the hand";
        say = `${lead}I had ${cpu.value} deadwood. You had ${you.value}${laidText}. I score ${res.points} points.`;
      }
    }
    say += ` The score is you ${game.scores.you}, me ${game.scores.cpu}.`;
    if (game.over) {
      const f = game.final;
      title = f.winner === "you" ? "You won the game!" : "I won the game";
      say += ` ${f.winner === "you" ? "You" : "I"} reached 100. With bonuses for winning the game and for each hand won` +
        `${f.shutout ? ", doubled for a shutout" : ""}, the final score is you ${f.you}, me ${f.cpu}.`;
    }
    return { title, say };
  }

  // ---------- Hints ----------
  function hint() {
    if (game.phase === "upcard" && game.upTurn === "you" || game.phase === "draw") {
      const c = top();
      if (game.phase === "draw" && game.mustDraw) return speak("Draw a card from the deck. That's the only choice right now.");
      const hctx = { level: "medium", stockLeft: game.deck.length, seen: game.seen, oppPicked: game.cpuPicked };
      if (G.shouldTake(game.hands.you, c, hctx)) {
        const why = G.takeReason(game.hands.you, c);
        speak(`Take the ${name(c)}: ${why || "it lowers your deadwood enough to think about knocking"}.`);
      } else {
        speak(game.phase === "upcard"
          ? `Pass. The ${name(c)} doesn't fit with your cards.`
          : `Draw from the deck. The ${name(c)} doesn't fit with your cards.`);
      }
      return;
    }
    if (game.phase === "discard") {
      const hctx = { level: "medium", stockLeft: game.deck.length, seen: game.seen, oppPicked: game.cpuPicked };
      const m = G.chooseDiscard(game.hands.you, hctx, game.justTaken);
      selected = m.discard;
      render();
      if (m.gin) return speak(`Throw away the ${name(m.discard)} and you have gin! I've chosen it for you. Tap Gin.`);
      if (m.knock) {
        return speak(`You can knock! Throw away the ${name(m.discard)} and your deadwood will be ${m.deadwood}. ` +
          "I've chosen it for you. Tap Knock, or keep playing for gin with Discard.");
      }
      const b = G.best(game.hands.you);
      const c = m.discard;
      const near = b.deadwood.some((x) => x !== c && (G.rank(x) === G.rank(c) ||
        (G.suit(x) === G.suit(c) && Math.abs(G.rank(x) - G.rank(c)) <= 2)));
      let why = "";
      if (b.deadwood.includes(c)) {
        why = `It's a loose card worth ${plural(G.value(c), "point")}` +
          (near ? ", and your other near-melds are more promising. " : ", and it isn't close to a meld. ");
      }
      speak(`Throw away the ${name(c)}. ${why}I've chosen it for you. Tap Discard if you agree.`);
      return;
    }
    if (game.phase === "cpu" || (game.phase === "upcard" && game.upTurn === "cpu")) return speak("It's my turn. One moment.");
    speak("The hand is over.");
  }

  function handSpeech() {
    const b = G.best(game.hands.you);
    const parts = [];
    if (b.melds.length) parts.push("You have " + list(b.melds.map(G.describeMeld)) + ".");
    else parts.push("You have no melds yet.");
    if (b.deadwood.length) parts.push(`Loose cards: ${list(b.deadwood.map(name))}.`);
    parts.push(`Your deadwood is ${b.value}.`);
    if (game.hands.you.length === 10 && b.value <= 10) parts.push("That's low enough to knock, once you've drawn.");
    return parts.join(" ");
  }

  function scoreSpeech() {
    return `The score is you ${game.scores.you}, me ${game.scores.cpu}. First to 100 wins. ` +
      `Hands won: you ${game.wins.you}, me ${game.wins.cpu}. There are ${plural(game.deck.length, "card")} left in the deck. ` +
      `I'm playing at ${settings.level} level.`;
  }

  function playedSpeech() {
    const parts = [];
    for (let s = 0; s < 4; s++) {
      const rs = game.discard.filter((c) => G.suit(c) === s).sort(G.byRank).map((c) => G.RANK_NAMES[G.rank(c)]);
      if (rs.length) parts.push(`${G.SUITS[s]}: ${list(rs)}.`);
    }
    let say = parts.length ? "Cards in the discard pile. " + parts.join(" ") : "The discard pile is empty.";
    say += game.cpuPicked.length
      ? ` I picked up the ${list(game.cpuPicked.map(name))}.`
      : " I haven't picked up anything from the pile.";
    return say;
  }

  const HELP = "Gin rummy. Make melds: three or four cards of the same number, or three or more " +
    "cards in a row of the same suit. Aces are low. Cards not in a meld are deadwood: aces count one, " +
    "picture cards ten, others their number. On your turn, draw from the deck or take the top card of " +
    "the discard pile, then throw one card away. When your deadwood is 10 or less after throwing away, " +
    "you can knock to end the hand; with no deadwood at all, that's gin, worth a 25-point bonus. " +
    "The other player can then lay loose cards onto the knocker's melds. If they end up with as little " +
    "deadwood as the knocker, that's an undercut and they win a 25-point bonus. First to 100 points wins. " +
    "Tap any card to hear it, tap Your hand to hear your melds, and tap Hint for a suggestion.";

  // ---------- Rendering ----------
  const $ = (id) => document.getElementById(id);

  function cardEl(c, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `card s${G.suit(c)}` + (cls ? " " + cls : "");
    const r = document.createElement("span");
    r.className = "rank";
    r.textContent = G.RANK_LABELS[G.rank(c)];
    const s = document.createElement("span");
    s.className = "suit";
    s.textContent = G.SUIT_SYMBOLS[G.suit(c)] + VS;
    b.append(r, s);
    b.setAttribute("aria-label", name(c));
    return b;
  }

  function groupsFor(hand) {
    if (settings.order === "rank") return [{ cls: "plain", cards: hand.slice().sort(G.byRank) }];
    if (settings.order === "suit") {
      return [0, 1, 2, 3].map((s) => ({ cls: "plain", cards: hand.filter((c) => G.suit(c) === s).sort(G.byRank) }))
        .filter((g) => g.cards.length);
    }
    const b = G.best(hand);
    const melds = b.melds.map((m) => ({ cls: "meld", cards: m.slice().sort(G.isSet(m) ? G.bySuit : G.byRank) }));
    return melds.concat(b.deadwood.length ? [{ cls: "loose", cards: b.deadwood.slice().sort(G.bySuit) }] : []);
  }

  function render() {
    renderTop();
    renderPiles();
    renderHand();
    renderActions();
    $("message").textContent = game.msg;
  }

  function renderTop() {
    $("score-text").textContent = `You ${game.scores.you} · Me ${game.scores.cpu}`;
  }

  function renderPiles() {
    const deck = $("pile-deck");
    const back = document.createElement("span");
    back.className = "card back";
    const lab = document.createElement("span");
    lab.className = "pile-label";
    lab.textContent = `Deck · ${game.deck.length}`;
    deck.replaceChildren(back, lab);
    deck.classList.toggle("active", game.phase === "draw");

    const pile = $("pile-discard");
    const lab2 = document.createElement("span");
    lab2.className = "pile-label";
    lab2.textContent = "Discard";
    if (game.discard.length) {
      const face = cardEl(top());
      face.tabIndex = -1;
      const span = document.createElement("span");
      span.className = face.className;
      span.append(...face.childNodes);
      pile.replaceChildren(span, lab2);
      pile.setAttribute("aria-label", `Discard pile: ${name(top())}`);
    } else {
      const e = document.createElement("span");
      e.className = "empty";
      e.textContent = "Empty";
      pile.replaceChildren(e, lab2);
      pile.setAttribute("aria-label", "Discard pile: empty");
    }
    pile.classList.toggle("active", (game.phase === "draw" && !game.mustDraw) || (game.phase === "upcard" && game.upTurn === "you"));
  }

  function renderHand() {
    const hand = game.hands.you;
    const b = G.best(hand);
    $("hand-label").textContent = `Your hand · Deadwood ${b.value}  🔊`;
    const els = groupsFor(hand).map((g) => {
      const div = document.createElement("div");
      div.className = "group " + g.cls;
      for (const c of g.cards) {
        const el = cardEl(c, (c === selected ? "selected" : "") + (c === game.drawn ? " new" : ""));
        el.addEventListener("click", () => tapCard(c));
        div.appendChild(el);
      }
      return div;
    });
    $("hand").replaceChildren(...els);
  }

  function actButton(label, cls, onTap, aria) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "act" + (cls ? " " + cls : "");
    b.textContent = label;
    if (aria) b.setAttribute("aria-label", aria);
    if (onTap) b.addEventListener("click", onTap);
    return b;
  }

  function renderActions() {
    const a = [];
    const p = game.phase;
    if (p === "upcard" && game.upTurn === "you") {
      a.push(actButton(`Take the ${short(top())}`, "primary", takeUpcard, `Take the ${name(top())}`));
      a.push(actButton("Pass", "", pass));
    } else if (p === "draw") {
      a.push(actButton("Draw from deck", "primary", drawFromDeck));
      if (!game.mustDraw && game.discard.length) {
        a.push(actButton(`Take the ${short(top())}`, "", takeFromDiscard, `Take the ${name(top())}`));
      }
    } else if (p === "discard") {
      if (selected === null) {
        a.push(actButton("Tap a card to throw away", "info", null));
      } else if (selected === game.justTaken) {
        a.push(actButton("You just took that card. Choose another.", "info", null));
      } else {
        const dw = G.best(game.hands.you.filter((x) => x !== selected)).value;
        a.push(actButton(`Discard ${short(selected)}`, "primary", () => discard(false), `Discard the ${name(selected)}`));
        if (dw === 0) a.push(actButton("Gin!", "go", () => discard(true), "Go gin"));
        else if (dw <= 10) a.push(actButton(`Knock (${dw})`, "go", () => discard(true), `Knock with ${dw} deadwood`));
      }
    } else if (p === "over") {
      a.push(actButton("See the result", "primary", () => showResult(false)));
    } else {
      a.push(actButton("My turn…", "info", null));
    }
    $("actions").replaceChildren(...a);
  }

  function setMessage(text) {
    game.msg = text;
    $("message").textContent = text;
  }

  // ---------- Panels ----------
  function openPanel(id) {
    closePanels();
    $(id).hidden = false;
    $(id).scrollTop = 0;
  }
  function closePanels() {
    for (const p of document.querySelectorAll(".panel")) p.hidden = true;
  }

  function sideEl(title, side, laidCards) {
    const wrap = document.createElement("div");
    wrap.className = "result-side";
    const h = document.createElement("h3");
    h.textContent = `${title}: deadwood ${side.value}`;
    const cards = document.createElement("div");
    cards.className = "result-cards";
    for (const m of side.melds) {
      const g = document.createElement("div");
      g.className = "group meld";
      for (const c of m.slice().sort(G.isSet(m) ? G.bySuit : G.byRank)) {
        g.appendChild(cardEl(c, laidCards && laidCards.includes(c) ? "laid" : ""));
      }
      cards.appendChild(g);
    }
    if (side.deadwood.length) {
      const g = document.createElement("div");
      g.className = "group loose";
      for (const c of side.deadwood) g.appendChild(cardEl(c));
      cards.appendChild(g);
    }
    for (const el of cards.querySelectorAll(".card")) {
      el.addEventListener("click", () => speak(el.getAttribute("aria-label")));
    }
    wrap.append(h, cards);
    return wrap;
  }

  function showResult(announce) {
    const res = game.result;
    const t = resultText();
    $("result-title").textContent = t.title;
    $("result-summary").textContent = t.say;
    const hands = $("result-hands");
    if (res.type === "draw") {
      hands.replaceChildren();
    } else {
      const d = res.detail;
      // Show the knocker's melds with the defender's laid-off cards added (dotted).
      const lo = G.layOff(d.knocker.melds, d.defender.laid);
      const knockSide = { melds: lo.melds, deadwood: d.knocker.deadwood, value: d.knocker.value };
      const defSide = { melds: d.defender.melds, deadwood: d.defender.deadwood, value: d.defender.value };
      const youSide = res.knocker === "you" ? knockSide : defSide;
      const cpuSide = res.knocker === "cpu" ? knockSide : defSide;
      hands.replaceChildren(
        sideEl(res.knocker === "you" ? "You knocked" : "You", youSide, res.knocker === "you" ? d.defender.laid : null),
        sideEl(res.knocker === "cpu" ? "I knocked" : "Me", cpuSide, res.knocker === "cpu" ? d.defender.laid : null));
      if (d.defender.laid.length) {
        const n = document.createElement("p");
        n.className = "note";
        n.textContent = `Dotted cards were laid off by ${res.knocker === "you" ? "me" : "you"}.`;
        hands.appendChild(n);
      }
    }
    const sc = $("result-score");
    const cells = [["", "You", "Me"], ["Points", game.scores.you, game.scores.cpu], ["Hands won", game.wins.you, game.wins.cpu]];
    if (game.over) cells.push(["Final, with bonuses", game.final.you, game.final.cpu]);
    sc.replaceChildren(...cells.flat().map((v, i) => {
      const s = document.createElement("span");
      s.textContent = String(v);
      if (i < 3 || i % 3 === 0) s.className = "head";
      return s;
    }));
    $("btn-next").textContent = game.over ? "New game" : "Next hand";
    openPanel("panel-result");
    if (announce) speak(t.say);
  }

  function showPlayed() {
    const rows = [];
    for (let s = 0; s < 4; s++) {
      const cards = game.discard.filter((c) => G.suit(c) === s).sort(G.byRank);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `played-row s${s}`;
      const sym = document.createElement("span");
      sym.className = "big-suit";
      sym.textContent = G.SUIT_SYMBOLS[s] + VS;
      const rs = document.createElement("span");
      rs.className = "ranks";
      rs.textContent = cards.length ? cards.map((c) => G.RANK_LABELS[G.rank(c)]).join("  ") : "—";
      b.append(sym, rs);
      b.addEventListener("click", () => speak(cards.length
        ? `${G.SUITS[s]} thrown away: ${list(cards.map((c) => G.RANK_NAMES[G.rank(c)]))}.`
        : `No ${G.SUITS[s]} thrown away yet.`));
      rows.push(b);
    }
    $("played-suits").replaceChildren(...rows);
    const picked = game.cpuPicked.map((c) => {
      const el = cardEl(c);
      el.addEventListener("click", () => speak(`I picked up the ${name(c)}.`));
      return el;
    });
    if (!picked.length) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = "Nothing yet.";
      picked.push(p);
    }
    $("played-picked").replaceChildren(...picked);
    openPanel("panel-played");
  }

  // ---------- Settings ----------
  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.size = settings.size;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = settings.theme === "light" ? "#ffffff" : "#000000";
    for (const group of document.querySelectorAll(".choices[data-setting]")) {
      const cur = String(settings[group.dataset.setting]);
      for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.value === cur));
    }
    $("menu-stats").textContent = stats.games ? `Games played: ${stats.games}. You've won ${stats.won}.` : "";
  }

  function fillVoiceSelect() {
    const sel = $("voice-select");
    const opts = [new Option("Automatic (best available)", "")];
    for (const v of voices) opts.push(new Option(`${v.name} (${v.lang})`, v.voiceURI));
    sel.replaceChildren(...opts);
    sel.value = voices.some((v) => v.voiceURI === settings.voice) ? settings.voice : "";
  }

  function onChoice(e) {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    const key = btn.parentElement.dataset.setting;
    let value = btn.dataset.value;
    if (value === "true" || value === "false") value = value === "true";
    else if (typeof DEFAULT_SETTINGS[key] === "number") value = Number(value);
    settings[key] = value;
    save("settings", settings);
    applySettings();
    render();
    if (key === "rate") speak("This is the new speaking speed.");
    else if (key === "level") speak(`I'll play at ${value} level.`);
    else speak(btn.textContent);
  }

  // ---------- Wiring ----------
  function init() {
    applySettings();
    if (!game || !game.hands || !game.phase) {
      newGame();
    } else {
      render();
      if (game.phase === "over") showResult(false);
      else if (game.phase === "cpu" || (game.phase === "upcard" && game.upTurn === "cpu")) scheduleCpu();
    }

    $("pile-deck").addEventListener("click", () => {
      if (game.phase === "draw") drawFromDeck();
      else speak(`The deck has ${plural(game.deck.length, "card")} left.`);
    });
    $("pile-discard").addEventListener("click", () => {
      if ((game.phase === "draw" && !game.mustDraw) || (game.phase === "upcard" && game.upTurn === "you")) takeFromDiscard();
      else speak(game.discard.length ? `The top of the discard pile is the ${name(top())}.` : "The discard pile is empty.");
    });
    $("message").addEventListener("click", () => speak(game.msg.replace(/[♠♥♦♣]︎?/g, (m) =>
      " of " + G.SUITS[G.SUIT_SYMBOLS.indexOf(m[0])])));
    $("hand-label").addEventListener("click", () => speak(handSpeech()));
    $("btn-score").addEventListener("click", () => speak(scoreSpeech()));
    $("btn-hint").addEventListener("click", hint);
    $("btn-played").addEventListener("click", showPlayed);
    $("btn-played-hear").addEventListener("click", () => speak(playedSpeech()));
    $("btn-menu").addEventListener("click", () => { applySettings(); openPanel("panel-menu"); });
    $("btn-help").addEventListener("click", () => speak(HELP));
    $("btn-new").addEventListener("click", () => {
      if (game.over || (game.handNo <= 1 && game.phase === "upcard")) { newGame(); }
      else openPanel("panel-confirm");
    });
    $("btn-confirm-yes").addEventListener("click", newGame);
    $("btn-next").addEventListener("click", () => {
      if (game.over) newGame();
      else startHand();
    });
    $("btn-result-hear").addEventListener("click", () => speak(resultText().say));
    for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", closePanels);
    for (const g of document.querySelectorAll(".choices[data-setting]")) g.addEventListener("click", onChoice);
    $("voice-select").addEventListener("change", (e) => {
      settings.voice = e.target.value;
      save("settings", settings);
      speak("Hello! This is how I sound.");
    });
    $("btn-test-voice").addEventListener("click", () => speak("Hello! This is how I sound. I drew from the deck and threw away the Queen of hearts."));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && game.phase !== "over") closePanels();
    });

    if (synth) {
      loadVoices();
      if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", loadVoices);
      else synth.onvoiceschanged = loadVoices;
    } else {
      fillVoiceSelect();
    }

    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  // Exposed for automated tests only.
  window.__gin = {
    get game() { return game; },
    get selected() { return selected; },
    setCpuDelay(ms) { cpuDelay = ms; },
  };

  init();
})();
