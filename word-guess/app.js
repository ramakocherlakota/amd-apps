/* Word Guess: a low-vision-friendly word-guessing game.
   Everything runs in the browser; progress is kept in localStorage. */
(function () {
  "use strict";

  // ---------- Word lists ----------
  const LISTS = {};
  for (const [len, lists] of Object.entries(window.WORD_LISTS)) {
    const answers = lists.answers.split(" ");
    const allowed = new Set(lists.allowed.split(" "));
    for (const w of answers) allowed.add(w);
    LISTS[len] = { answers, allowed };
  }

  // ---------- Storage (never fatal: private mode or cleared data just means a fresh start) ----------
  const KEY = "wordguess.v1.";
  function load(name, fallback) {
    try {
      const raw = localStorage.getItem(KEY + name);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(name, value) {
    try {
      localStorage.setItem(KEY + name, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  }

  const DEFAULT_SETTINGS = {
    length: 5,
    maxGuesses: 6,
    theme: "yellow",
    size: "large",
    layout: "qwerty",
    speakKeys: true,
    examples: true,
    autoSpeak: true,
    rate: 0.85,
    voice: "",
    strict: true,
  };
  const settings = Object.assign({}, DEFAULT_SETTINGS, load("settings", {}));
  const stats = Object.assign({ played: 0, won: 0, streak: 0, best: 0 }, load("stats", {}));
  let recent = load("recent", []);
  let game = load("game", null);

  // ---------- Scoring ----------
  // Returns "correct" | "present" | "absent" per letter, handling repeated letters
  // the standard way: each answer letter can only be matched once.
  function score(guess, answer) {
    const n = answer.length;
    const result = new Array(n).fill("absent");
    const left = {};
    for (let i = 0; i < n; i++) {
      if (guess[i] === answer[i]) result[i] = "correct";
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < n; i++) {
      if (result[i] === "correct") continue;
      if (left[guess[i]] > 0) {
        result[i] = "present";
        left[guess[i]]--;
      }
    }
    return result;
  }

  // Everything the player has learned so far, merged across all guesses.
  function knowledge() {
    const n = game.answer.length;
    const known = new Array(n).fill(null);
    const minCount = {};
    const notAt = {};
    const absentSeen = [];
    for (const g of game.guesses) {
      const res = score(g, game.answer);
      const counts = {};
      for (let i = 0; i < n; i++) {
        const l = g[i];
        if (res[i] === "correct") known[i] = l;
        if (res[i] !== "correct") (notAt[l] = notAt[l] || new Set()).add(i);
        if (res[i] !== "absent") counts[l] = (counts[l] || 0) + 1;
        else absentSeen.push(l);
      }
      for (const l in counts) minCount[l] = Math.max(minCount[l] || 0, counts[l]);
    }
    const absent = new Set(absentSeen.filter((l) => !minCount[l]));
    const extras = [];
    for (const l of Object.keys(minCount).sort()) {
      const placed = known.filter((k) => k === l).length;
      for (let c = placed; c < minCount[l]; c++) extras.push(l);
    }
    return { known, minCount, notAt, absent, extras };
  }

  function keyStatus(k, letter) {
    if (k.known.includes(letter)) return "correct";
    if (k.minCount[letter]) return "present";
    if (k.absent.has(letter)) return "absent";
    return "";
  }

  // ---------- Speech ----------
  const synth = window.speechSynthesis;
  const EXAMPLES = {
    a: "apple", b: "ball", c: "cat", d: "dog", e: "egg", f: "fish", g: "goat",
    h: "hat", i: "ice", j: "jam", k: "kite", l: "lamp", m: "moon", n: "nest",
    o: "orange", p: "pig", q: "queen", r: "rose", s: "sun", t: "tea",
    u: "umbrella", v: "violin", w: "window", x: "x-ray", y: "yellow", z: "zebra",
  };
  // Letters are spoken as words ("tee", not "T"): iPad voices read a lone capital
  // letter as "capital T".
  const LETTER_SOUNDS = {
    a: "eigh", b: "bee", c: "see", d: "dee", e: "e", f: "eff", g: "gee", h: "aitch",
    i: "eye", j: "jay", k: "kay", l: "el", m: "em", n: "en", o: "oh", p: "pee",
    q: "cue", r: "ar", s: "ess", t: "tee", u: "you", v: "vee", w: "double-you",
    x: "ex", y: "why", z: "zee",
  };
  const letterName = (l) => LETTER_SOUNDS[l] || l;
  function letterSay(l) {
    const name = letterName(l);
    return settings.examples ? `${name}, as in ${EXAMPLES[l]}` : name;
  }
  function spell(word) {
    return "|" + word.split("").map(letterName).join(", ") + "|";
  }
  const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  function spots(set) {
    const list = [...set].sort().map((i) => ORDINALS[i]);
    if (list.length === 1) return list[0];
    return list.slice(0, -1).join(", ") + " or " + list[list.length - 1];
  }

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
  /* Speak text with short pauses: it's split into pieces at the end of each sentence
     and wherever a "|" appears, and the pieces are spoken one at a time with a
     moment of silence between them (longer at slower speaking speeds). Speaking
     again cancels whatever is still queued. */
  let speechRun = 0;
  let currentUtterance = null;   // kept so the browser doesn't drop it before it ends
  function speak(text) {
    if (!synth || !text) return;
    synth.cancel();
    const run = ++speechRun;
    const parts = String(text).replace(/([.!?])\s+/g, "$1|").split("|")
      .map((s) => s.trim()).filter((s) => /[a-z0-9]/i.test(s));
    const rate = Number(settings.rate) || 0.85;
    const pause = Math.round(320 / rate);
    const v = pickVoice();
    let i = 0;
    const next = () => {
      if (run !== speechRun || i >= parts.length) return;
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "en-US"; }
      u.rate = rate;
      u.onend = () => { if (run === speechRun && i < parts.length) setTimeout(next, pause); };
      currentUtterance = u;
      synth.speak(u);
    };
    next();
  }

  // ---------- Game lifecycle ----------
  function newGame() {
    const len = String(settings.length);
    const pool = LISTS[len].answers;
    const recentSet = new Set(recent);
    let choices = pool.filter((w) => !recentSet.has(w));
    if (choices.length === 0) { recent = []; choices = pool; }
    const answer = choices[Math.floor(Math.random() * choices.length)];
    recent.push(answer);
    if (recent.length > 400) recent = recent.slice(-400);
    save("recent", recent);
    game = {
      answer,
      maxGuesses: Number(settings.maxGuesses),
      guesses: [],
      current: "",
      showingResult: false,
      over: false,
      won: false,
    };
    save("game", game);
    closePanels();
    setStatus(turnText());
    render();
  }

  function guessesLeft() {
    return game.maxGuesses ? game.maxGuesses - game.guesses.length : Infinity;
  }
  function turnText() {
    const n = game.guesses.length + 1;
    return game.maxGuesses ? `Guess ${n} of ${game.maxGuesses}` : `Guess ${n}`;
  }

  function addLetter(l) {
    if (game.over) return;
    if (game.showingResult) { game.showingResult = false; game.current = ""; }
    const n = game.answer.length;
    if (game.current.length >= n) {
      speak(`That's ${n} letters. Tap Check, or Delete to change a letter.`);
      setStatus("Tap Check, or Delete");
      render();
      return;
    }
    game.current += l;
    save("game", game);
    setStatus(turnText());
    render();
    if (settings.speakKeys) speak(letterSay(l));
  }

  function deleteLetter() {
    if (game.over) return;
    if (game.showingResult) { game.showingResult = false; game.current = ""; render(); return; }
    if (!game.current) { if (settings.speakKeys) speak("Nothing to delete."); return; }
    const gone = game.current.slice(-1);
    game.current = game.current.slice(0, -1);
    save("game", game);
    setStatus(turnText());
    render();
    if (settings.speakKeys) speak(`Deleted ${letterName(gone)}`);
  }

  function submit() {
    if (game.over) { showEnd(); return; }
    const n = game.answer.length;
    const word = game.showingResult ? "" : game.current;
    if (word.length < n) {
      const need = n - word.length;
      setStatus(`${need} more letter${need > 1 ? "s" : ""}`);
      speak(word.length === 0
        ? `Tap ${n} letters to make a word, then tap Check.`
        : `You need ${need} more letter${need > 1 ? "s" : ""}.`);
      shake();
      return;
    }
    if (settings.strict && !LISTS[String(n)].allowed.has(word)) {
      setStatus(`“${word.toUpperCase()}” isn't in my word list`);
      speak(`I don't know that word: ${spell(word)}. Try a different word. It doesn't use up a guess.`);
      shake();
      return;
    }

    game.guesses.push(word);
    game.current = word;
    game.showingResult = true;
    const res = score(word, game.answer);
    const won = word === game.answer;
    if (won || guessesLeft() <= 0) {
      game.over = true;
      game.won = won;
      stats.played++;
      if (won) { stats.won++; stats.streak++; stats.best = Math.max(stats.best, stats.streak); }
      else stats.streak = 0;
      save("stats", stats);
    }
    save("game", game);
    render();

    if (game.over) {
      showEnd();
      speak(endSpeech());
      return;
    }
    setStatus(turnText() + " — tap a letter to start");
    if (settings.autoSpeak) speak(resultSpeech(word, res));
  }

  function resultSpeech(word, res) {
    const right = [], wrongSpot = [], none = [];
    for (let i = 0; i < word.length; i++) {
      if (res[i] === "correct") right.push(i);
      else if (res[i] === "present") wrongSpot.push(word[i]);
      else none.push(word[i]);
    }
    const parts = [`You guessed ${word}.`];
    if (right.length) {
      parts.push("Right spot: | " + right.map((i) => `${letterSay(word[i])}, ${ORDINALS[i]} letter`).join(" | ") + ".");
    }
    if (wrongSpot.length) parts.push("In the word, but in a different spot: | " + wrongSpot.map(letterSay).join(" | ") + ".");
    if (none.length) parts.push("Not in the word: " + [...new Set(none)].map(letterName).join(", ") + ".");
    if (!right.length && !wrongSpot.length) parts.push("None of those letters are in the word. That's still useful!");
    if (game.maxGuesses) {
      const left = guessesLeft();
      parts.push(`${left} guess${left === 1 ? "" : "es"} left.`);
    }
    return parts.join(" ");
  }

  function endSpeech() {
    const a = game.answer;
    if (game.won) {
      const g = game.guesses.length;
      return `You got it! The word was ${a}. ${spell(a)}. You found it in ${g} guess${g === 1 ? "" : "es"}.`;
    }
    return `Out of guesses. The word was ${a}. ${spell(a)}. Good try!`;
  }

  function clueSpeech() {
    if (game.over) return endSpeech();
    if (!game.guesses.length) {
      return `No clues yet. The word has ${game.answer.length} letters. Tap letters to make any word, then tap Check, and I'll tell you which letters are in it.`;
    }
    const k = knowledge();
    const parts = [];
    k.known.forEach((l, i) => { if (l) parts.push(`The ${ORDINALS[i]} letter is ${letterSay(l)}.`); });
    for (const l of [...new Set(k.extras)]) {
      const not = k.notAt[l];
      parts.push(`The word also has ${letterSay(l)}` +
        (not && not.size ? `, but not in the ${spots(not)} spot.` : "."));
    }
    if (!parts.length) parts.push("No letters found yet.");
    if (k.absent.size) {
      parts.push("Not in the word: " + [...k.absent].sort().map(letterName).join(", ") + ".");
    }
    if (game.maxGuesses) {
      const left = guessesLeft();
      parts.push(`You have ${left} guess${left === 1 ? "" : "es"} left.`);
    }
    if (game.current && !game.showingResult) parts.push(`Your guess so far: ${spell(game.current)}.`);
    return parts.join(" ");
  }

  const HELP = "Guess the hidden word. Tap letters to make a word, then tap Check. " +
    "Letters in the right spot turn into green squares. " +
    "Letters that are in the word, but in a different spot, turn into orange circles. " +
    "Letters that are not in the word go dim. " +
    "Under your guess is a line showing what you know so far. " +
    "Tap Clues at any time to hear everything you've learned. " +
    "Tap any letter on the screen to hear it.";

  // ---------- Rendering ----------
  const $ = (id) => document.getElementById(id);
  const MARKS = { correct: "✓", present: "↔", absent: "✕" };
  const LABELS = { correct: "right spot", present: "in the word, wrong spot", absent: "not in the word" };

  function makeTile(letter, state, opts) {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "tile" + (state ? " " + state : "");
    if (letter) t.appendChild(document.createTextNode(letter.toUpperCase()));
    if (opts && opts.mark && MARKS[state]) {
      const m = document.createElement("span");
      m.className = "mark";
      m.setAttribute("aria-hidden", "true");
      m.textContent = MARKS[state];
      t.appendChild(m);
    }
    if (opts && opts.label) t.setAttribute("aria-label", opts.label);
    if (opts && opts.say) t.addEventListener("click", () => speak(opts.say));
    return t;
  }

  function renderResultRow(container, word, mark) {
    const res = score(word, game.answer);
    container.replaceChildren(...word.split("").map((l, i) => {
      const say = `${letterSay(l)}: ${LABELS[res[i]]}.`;
      return makeTile(l, res[i], { mark, label: `${l.toUpperCase()}, ${LABELS[res[i]]}`, say });
    }));
  }

  function render() {
    document.documentElement.style.setProperty("--n", game.answer.length);
    const n = game.answer.length;
    const row = $("row");

    if (game.showingResult) {
      renderResultRow(row, game.current, true);
    } else {
      const tiles = [];
      for (let i = 0; i < n; i++) {
        const l = game.current[i];
        const state = l ? "filled" : (i === game.current.length ? "cursor" : "");
        tiles.push(makeTile(l, state, {
          label: l ? l.toUpperCase() : `Empty spot ${i + 1}`,
          say: l ? letterSay(l) : `Empty. ${game.current ? "Your guess so far: " + spell(game.current) : "Tap a letter below."}`,
        }));
      }
      row.replaceChildren(...tiles);
    }

    // What you know so far.
    const k = knowledge();
    const knownRow = $("known-row");
    const label = document.createElement("span");
    label.className = "known-label";
    label.textContent = "Known:";
    knownRow.replaceChildren(label, ...k.known.map((l, i) => l
      ? makeTile(l, "correct", { label: `${ORDINALS[i]} letter is ${l.toUpperCase()}`, say: `The ${ORDINALS[i]} letter is ${letterSay(l)}.` })
      : makeTile("?", "blank", { label: `${ORDINALS[i]} letter unknown`, say: `The ${ORDINALS[i]} letter is not known yet.` })));

    const extra = $("known-extra");
    if (k.extras.length) {
      const lab = document.createElement("span");
      lab.className = "known-label";
      lab.textContent = "Also in word:";
      extra.replaceChildren(lab, ...k.extras.map((l) => {
        const not = k.notAt[l];
        const say = `The word has ${letterSay(l)}` + (not && not.size ? `, but not in the ${spots(not)} spot.` : ".");
        return makeTile(l, "present", { label: `${l.toUpperCase()} is in the word`, say });
      }));
      extra.hidden = false;
    } else {
      extra.replaceChildren();
      extra.hidden = true;
    }

    renderKeyboard(k);
  }

  const LAYOUTS = {
    abc: ["abcdefg", "hijklmn", "opqrstu", "vwxyz"],
    qwerty: ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
  };

  function renderKeyboard(k) {
    const kb = $("keyboard");
    const rows = LAYOUTS[settings.layout] || LAYOUTS.qwerty;
    const make = (label, cls, onTap, aria) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "key" + (cls ? " " + cls : "");
      b.textContent = label;
      if (aria) b.setAttribute("aria-label", aria);
      b.addEventListener("click", onTap);
      return b;
    };
    const rowEls = rows.map((letters, r) => {
      const div = document.createElement("div");
      div.className = "kb-row";
      for (const l of letters) {
        const st = keyStatus(k, l);
        div.appendChild(make(l.toUpperCase(), st, () => addLetter(l),
          st ? `${l.toUpperCase()}, ${LABELS[st]}` : l.toUpperCase()));
      }
      return div;
    });
    // Delete and Check get their own row when the screen is tall (iPad held upright),
    // and share the last letter row when it's wide, to save height.
    const tall = window.innerHeight > window.innerWidth;
    const actions = tall ? document.createElement("div") : rowEls[rowEls.length - 1];
    if (tall) { actions.className = "kb-row actions"; rowEls.push(actions); }
    actions.appendChild(make("⌫ Delete", "wide", deleteLetter, "Delete"));
    actions.appendChild(make("Check ✓", "wide enter", submit, "Check my guess"));
    kb.replaceChildren(...rowEls);
  }

  function setStatus(text) { $("status").textContent = text; }

  function shake() {
    const row = $("row");
    row.classList.remove("shake");
    void row.offsetWidth;
    row.classList.add("shake");
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
  function anyPanelOpen() {
    return [...document.querySelectorAll(".panel")].some((p) => !p.hidden);
  }

  function statsText() {
    if (!stats.played) return "";
    return `Played ${stats.played} · Won ${stats.won} · Streak ${stats.streak} · Best streak ${stats.best}`;
  }

  function showEnd() {
    $("end-title").textContent = game.won ? "You got it!" : "The word was:";
    const row = $("end-word");
    if (game.won) renderResultRow(row, game.answer, false);
    else row.replaceChildren(...game.answer.split("").map((l) => makeTile(l, "filled", { say: letterSay(l) })));
    $("end-stats").textContent = statsText();
    openPanel("panel-end");
  }

  function showHistory() {
    const list = $("history-list");
    if (!game.guesses.length) {
      const p = document.createElement("p");
      p.className = "history-empty";
      p.textContent = "No guesses yet.";
      list.replaceChildren(p);
      speak("No guesses yet.");
    } else {
      list.replaceChildren(...game.guesses.map((g) => {
        const r = document.createElement("div");
        r.className = "row";
        renderResultRow(r, g, true);
        return r;
      }));
      speak("Your guesses: " + game.guesses.join(", ") + ". Tap a letter to hear about it.");
    }
    openPanel("panel-history");
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
      for (const b of group.querySelectorAll("button")) {
        b.setAttribute("aria-pressed", String(b.dataset.value === cur));
      }
    }
    $("menu-stats").textContent = statsText();
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
    if (key === "layout" || key === "size") render();
    if (key === "rate") speak("This is the new speaking speed.");
    else if (key === "examples") speak(value ? "Letters will sound like this: B, as in ball." : "Letters will sound like this: B.");
    else speak(btn.textContent);
  }

  // ---------- Wiring ----------
  function init() {
    applySettings();
    if (!game || !LISTS[String(game.answer && game.answer.length)]) {
      newGame();
    } else {
      setStatus(game.over ? "" : turnText());
      render();
      if (game.over) showEnd();
    }

    $("btn-clues").addEventListener("click", () => speak(clueSpeech()));
    $("btn-history").addEventListener("click", showHistory);
    $("btn-menu").addEventListener("click", () => { applySettings(); openPanel("panel-menu"); });
    $("btn-help").addEventListener("click", () => speak(HELP));
    $("btn-new").addEventListener("click", () => {
      if (game.over || game.guesses.length === 0) { newGame(); speak("New word. " + turnText()); }
      else openPanel("panel-confirm");
    });
    $("btn-confirm-yes").addEventListener("click", () => {
      stats.played++;
      stats.streak = 0;
      save("stats", stats);
      const old = game.answer;
      newGame();
      speak(`The last word was ${old}. Here's a new word.`);
    });
    $("btn-end-new").addEventListener("click", () => { newGame(); speak("New word. " + turnText()); });
    $("btn-end-menu").addEventListener("click", () => { applySettings(); openPanel("panel-menu"); });
    $("btn-end-hear").addEventListener("click", () => speak(endSpeech()));
    for (const b of document.querySelectorAll("[data-close]")) {
      b.addEventListener("click", () => { closePanels(); if (game.over) showEnd(); });
    }
    for (const g of document.querySelectorAll(".choices[data-setting]")) g.addEventListener("click", onChoice);
    $("voice-select").addEventListener("change", (e) => {
      settings.voice = e.target.value;
      save("settings", settings);
      speak("Hello! This is how I sound.");
    });
    $("btn-test-voice").addEventListener("click", () => speak("Hello! This is how I sound. Here are the letters: " +
      Object.values(LETTER_SOUNDS).join(", ") + "."));

    let wasTall = window.innerHeight > window.innerWidth;
    window.addEventListener("resize", () => {
      const tall = window.innerHeight > window.innerWidth;
      if (tall !== wasTall) { wasTall = tall; render(); }
    });

    // Physical keyboard support.
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { closePanels(); if (game.over) showEnd(); return; }
      if (anyPanelOpen()) return;
      if (/^[a-z]$/i.test(e.key)) { addLetter(e.key.toLowerCase()); e.preventDefault(); }
      else if (e.key === "Backspace") { deleteLetter(); e.preventDefault(); }
      else if (e.key === "Enter") { submit(); e.preventDefault(); }
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
  window.__wordGuess = { score, get game() { return game; }, newGame, knowledge };

  init();
})();
