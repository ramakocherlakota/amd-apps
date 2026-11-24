/* Word Flower: make words from seven letters; every word must use the center one.
   Low-vision friendly: huge letters in fixed places, spoken feedback and hints.
   Everything runs in the browser; progress is kept in localStorage. */
(function () {
  "use strict";

  // ---------- Data ----------
  const DATA = window.FLOWER_DATA;
  const PUZZLES = DATA.puzzles.split(" ");        // "abeghlue" = 7 letters + center
  const COMMON = DATA.common.split(" ");
  const REAL = new Set(DATA.real.split(" "));

  // ---------- Storage ----------
  const KEY = "wordflower.v1.";
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
    theme: "yellow",
    size: "large",
    speakKeys: true,
    examples: true,
    autoSpeak: true,
    rate: 0.85,
    voice: "",
  };
  const settings = Object.assign({}, DEFAULT_SETTINGS, load("settings", {}));
  let game = load("game", null);
  let answers = [];       // all answer words for the current puzzle, sorted
  let answerSet = new Set();
  let maxScore = 0;
  let clueWord = null;

  // ---------- Rules ----------
  function isPangram(w) { return new Set(w).size === 7; }
  function points(w) { return (w.length === 4 ? 1 : w.length) + (isPangram(w) ? 7 : 0); }
  function score() { return game.found.concat(game.bonus).reduce((s, w) => s + points(w), 0); }

  const RANKS = [
    [0, "Just started"], [2, "Warming up"], [5, "Good start"], [10, "Moving up"],
    [18, "Nice"], [30, "Great"], [45, "Amazing"], [60, "Brilliant"],
    [80, "Word wizard"], [100, "Every word!"],
  ];
  function rank(s) {
    const pct = maxScore ? (100 * s) / maxScore : 0;
    let name = RANKS[0][1];
    for (const [min, label] of RANKS) if (pct >= min) name = label;
    return name;
  }

  function setupPuzzle() {
    const all = new Set(game.letters + game.center);
    answers = COMMON.filter((w) => w.includes(game.center) && [...w].every((l) => all.has(l)));
    answerSet = new Set(answers);
    maxScore = answers.reduce((s, w) => s + points(w), 0);
    game.found = game.found.filter((w) => answerSet.has(w));
    game.bonus = (game.bonus || []).filter((w) => REAL.has(w));
    clueWord = null;
  }

  function newPuzzle() {
    const index = ((load("puzzleIndex", -1) + 1) % PUZZLES.length);
    save("puzzleIndex", index);
    const p = PUZZLES[index];
    const center = p[7];
    // Outer letters start in A-B-C order, clockwise from the top.
    const letters = p.slice(0, 7).replace(center, "");
    game = { index, center, letters, found: [], bonus: [], current: "" };
    setupPuzzle();
    save("game", game);
    closePanels();
    setMessage("");
    render();
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
  function name(l) { return LETTER_SOUNDS[l] || l; }
  function letterSay(l) { return settings.examples ? `${name(l)}, as in ${EXAMPLES[l]}` : name(l); }
  function spell(word) { return "|" + word.split("").map(name).join(", ") + "|"; }
  function listSay(items) {
    if (items.length <= 1) return items.join("");
    return items.slice(0, -1).join("; ") + "; and " + items[items.length - 1];
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
    const wasBusy = synth.speaking || synth.pending;
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
      const text = parts[i++];
      const u = new SpeechSynthesisUtterance(text);
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "en-US"; }
      u.rate = rate;
      // Move on when this piece ends. Safari sometimes never reports the end, so
      // also move on after a generous estimate of how long the piece takes.
      let moved = false;
      const advance = () => {
        if (moved) return;
        moved = true;
        clearTimeout(watchdog);
        if (run === speechRun && i < parts.length) setTimeout(next, pause);
      };
      const watchdog = setTimeout(advance, 500 + (text.length * 75) / rate);
      u.onend = advance;
      u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") advance(); };
      currentUtterance = u;
      synth.speak(u);
    };
    // Safari can silently drop speech started right after cancelling speech that
    // was still going, so give it a moment in that case.
    if (wasBusy) setTimeout(next, 120);
    else next();
  }

  function lettersSpeech() {
    return `The middle letter is ${letterSay(game.center)}. Every word must use it. ` +
      `The other letters are ${listSay(game.letters.split("").map(letterSay))}.`;
  }

  // ---------- Playing ----------
  function addLetter(l) {
    if (game.current.length >= 19) return;
    game.current += l;
    save("game", game);
    setMessage("");
    renderWord();
    if (settings.speakKeys) speak(letterSay(l));
  }

  function deleteLetter() {
    if (!game.current) { if (settings.speakKeys) speak("Nothing to delete."); return; }
    const gone = game.current.slice(-1);
    game.current = game.current.slice(0, -1);
    save("game", game);
    renderWord();
    if (settings.speakKeys) speak(`Deleted ${name(gone)}`);
  }

  function shuffle() {
    const arr = game.letters.split("");
    const before = game.letters;
    for (let tries = 0; tries < 5 && arr.join("") === before; tries++) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    game.letters = arr.join("");
    save("game", game);
    renderFlower();
    speak("Letters shuffled. Going around from the top: " + game.letters.split("").map(name).join(", ") + ".");
  }

  function reject(text, spoken) {
    setMessage(text);
    speak(spoken);
    const w = document.getElementById("word");
    w.classList.remove("shake");
    void w.offsetWidth;
    w.classList.add("shake");
    game.current = "";
    save("game", game);
    renderWord();
  }

  function submit() {
    const w = game.current;
    if (!w) {
      speak("Tap letters to make a word, then tap Check.");
      return;
    }
    if (w.length < 4) return reject("Too short", `Too short: ${spell(w)}. Words need at least 4 letters.`);
    if (!w.includes(game.center)) {
      return reject(`Use the middle letter ${game.center.toUpperCase()}`,
        `Every word must use the middle letter, ${letterSay(game.center)}.`);
    }
    if (game.found.includes(w) || game.bonus.includes(w)) return reject("Already found", `You already found ${w}.`);
    const bonus = !answerSet.has(w) && REAL.has(w);
    if (!answerSet.has(w) && !bonus) return reject("Not in my word list", `I don't know that word: ${spell(w)}.`);

    const oldRank = rank(score());
    const list = bonus ? game.bonus : game.found;
    list.push(w);
    list.sort();
    game.current = "";
    if (clueWord === w) clueWord = null;
    save("game", game);
    const pts = points(w);
    const newRank = rank(score());
    setMessage(isPangram(w) ? `★ All 7 letters! +${pts}` : bonus ? `Bonus word! +${pts}` : `Yes! +${pts}`, true);
    render();

    let say = isPangram(w)
      ? `Fantastic! ${w} uses all seven letters! ${pts} points.`
      : `Yes! ${w}. ${pts} point${pts === 1 ? "" : "s"}.`;
    if (bonus) say += " That's a bonus word: a less common word that isn't on the main list.";
    if (newRank !== oldRank) say += ` You've reached ${newRank}!`;
    if (game.found.length === answers.length) say += " You found every word! Amazing!";
    if (settings.autoSpeak) speak(say);
    else speak(isPangram(w) ? "Fantastic!" : "Yes!");
  }

  function scoreSpeech() {
    const s = score();
    return `${rank(s)}. ${s} point${s === 1 ? "" : "s"}. You've found ${game.found.length} of ${answers.length} words.`;
  }

  // ---------- Hints ----------
  function remaining() { return answers.filter((w) => !game.found.includes(w)); }

  function leftByLetter() {
    const map = {};
    for (const w of answers) {
      const k = w[0];
      map[k] = map[k] || { total: 0, left: 0 };
      map[k].total++;
      if (!game.found.includes(w)) map[k].left++;
    }
    return map;
  }

  function hintsSummary() {
    const left = remaining();
    if (!left.length) return "You found every word in this puzzle!";
    const map = leftByLetter();
    const parts = [`${left.length} word${left.length === 1 ? "" : "s"} left to find.`];
    const byLetter = Object.keys(map).sort().filter((k) => map[k].left)
      .map((k) => `${map[k].left} starting with ${name(k)}`);
    parts.push(listSay(byLetter) + ".");
    const pangramsLeft = left.filter(isPangram).length;
    if (pangramsLeft) parts.push(`${pangramsLeft === 1 ? "There's still a word" : `There are still ${pangramsLeft} words`} that use${pangramsLeft === 1 ? "s" : ""} all seven letters.`);
    const longest = Math.max(...left.map((w) => w.length));
    parts.push(`The longest word left has ${longest} letters.`);
    return parts.join(" ");
  }

  function giveClue() {
    const left = remaining();
    if (!left.length) { showClue(null); speak("You found every word!"); return; }
    // Prefer shorter words first: they're friendlier clues.
    const pool = left.filter((w) => w !== clueWord).sort((a, b) => a.length - b.length);
    const shortest = pool.length ? pool.slice(0, Math.max(3, Math.ceil(pool.length / 3))) : left;
    clueWord = shortest[Math.floor(Math.random() * shortest.length)];
    showClue(clueWord);
    speak(clueSpeech(clueWord));
  }
  function clueSpeech(w) {
    return `Try a ${w.length}-letter word starting with ${spell(w.slice(0, 2))}.` +
      (isPangram(w) ? " It uses all seven letters!" : "");
  }
  function showClue(w) {
    const p = $("clue-text");
    p.hidden = false;
    p.textContent = w
      ? `${w.length} letters, starts with ${w.slice(0, 2).toUpperCase()}…${isPangram(w) ? " (uses all 7!)" : ""}`
      : "You found every word!";
    $("btn-reveal").hidden = !w;
    $("btn-reveal").textContent = "Tell me that word";
  }

  const HELP = "Make words from the seven letters. Every word must use the middle letter, " +
    "and words need at least four letters. Letters can be used more than once. " +
    "Tap letters to spell a word, then tap Check. " +
    "Four-letter words score one point. Longer words score one point per letter. " +
    "A word that uses all seven letters scores seven extra points. " +
    "Tap Hints for help, and My words to hear what you've found. " +
    "Tap the score at the top to hear how you're doing.";

  // How to play: shown on screen in large type as well as read aloud, so the
  // button visibly does something even when the iPad's sound is off.
  function showHelp() {
    let panel = document.getElementById("panel-help");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "panel-help";
      panel.className = "panel";
      panel.hidden = true;
      const body = document.createElement("div");
      body.className = "panel-body";
      const head = document.createElement("div");
      head.className = "panel-head";
      const h = document.createElement("h2");
      h.textContent = "How to play";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "big-btn close";
      close.textContent = "Close";
      close.addEventListener("click", () => openPanel("panel-menu"));
      head.append(h, close);
      const again = document.createElement("button");
      again.type = "button";
      again.className = "big-btn wide";
      again.textContent = "🔊 Read it to me";
      again.addEventListener("click", () => speak(HELP));
      const text = document.createElement("div");
      text.className = "help-text";
      for (const sentence of HELP.replace(/([.!?])\s+/g, "$1\n").split("\n")) {
        const p = document.createElement("p");
        p.textContent = sentence;
        text.appendChild(p);
      }
      body.append(head, again, text);
      panel.appendChild(body);
      document.body.appendChild(panel);
    }
    openPanel("panel-help");
    speak(HELP);
  }

  // ---------- Rendering ----------
  const $ = (id) => document.getElementById(id);

  function render() {
    renderScore();
    renderWord();
    renderFlower();
  }

  function renderScore() {
    const s = score();
    $("score-text").textContent = `${rank(s)} · ${s} point${s === 1 ? "" : "s"} · ${game.found.length} of ${answers.length} words`;
    $("bar-fill").style.width = (maxScore ? Math.min(100, (100 * s) / maxScore) : 0) + "%";
  }

  function renderWord() {
    const el = $("word");
    const w = game.current;
    if (!w) {
      const ph = document.createElement("span");
      ph.className = "placeholder";
      ph.textContent = "Tap letters to make a word";
      el.replaceChildren(ph);
      el.style.removeProperty("--word-size");
    } else {
      const cursor = document.createElement("span");
      cursor.className = "cursor";
      el.replaceChildren(document.createTextNode(w.toUpperCase()), cursor);
      // Shrink long words so they always fit on one line.
      const avail = el.clientWidth || window.innerWidth - 32;
      el.style.setProperty("--word-size", `min(var(--word-max), ${Math.floor(avail / (w.length * 0.78 + 0.3))}px)`);
    }
    el.setAttribute("aria-label", w ? `Your word: ${w}` : "No letters yet");
  }

  function renderFlower() {
    const fl = $("flower");
    const make = (l, cls, leftPct, topPct) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "petal" + (cls ? " " + cls : "");
      b.textContent = l.toUpperCase();
      b.style.left = leftPct + "%";
      b.style.top = topPct + "%";
      b.setAttribute("aria-label", cls ? `${l.toUpperCase()}, middle letter` : l.toUpperCase());
      b.addEventListener("click", () => addLetter(l));
      return b;
    };
    const d = 31;            // petal diameter, % of the flower
    const r = 34.5;          // distance from the middle, % of the flower
    const petals = game.letters.split("").map((l, i) => {
      const a = (-90 + 60 * i) * Math.PI / 180;
      return make(l, "", 50 + r * Math.cos(a) - d / 2, 50 + r * Math.sin(a) - d / 2);
    });
    petals.push(make(game.center, "center", 50 - d / 2, 50 - d / 2));
    fl.replaceChildren(...petals);
  }

  function setMessage(text, good) {
    const m = $("message");
    m.textContent = text;
    m.classList.toggle("good", !!good && !!text);
  }

  function wordButton(w, onTap) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = (isPangram(w) ? "★ " : "") + w;
    if (isPangram(w)) b.classList.add("pangram");
    b.addEventListener("click", onTap);
    return b;
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

  function showHints() {
    $("clue-text").hidden = true;
    $("btn-reveal").hidden = true;
    const left = remaining();
    $("left-summary").textContent = left.length
      ? `${left.length} word${left.length === 1 ? "" : "s"} left. Longest: ${Math.max(...left.map((w) => w.length))} letters.` +
        (left.some(isPangram) ? " A word using all 7 letters is still hidden." : "")
      : "You found every word!";
    const map = leftByLetter();
    $("left-table").replaceChildren(...Object.keys(map).sort().map((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "left-row" + (map[k].left ? "" : " done");
      const big = document.createElement("span");
      big.className = "big-letter";
      big.textContent = k;
      const txt = document.createElement("span");
      txt.textContent = map[k].left ? `${map[k].left} left` : "all found ✓";
      b.append(big, txt);
      b.addEventListener("click", () => speak(map[k].left
        ? `${map[k].left} word${map[k].left === 1 ? "" : "s"} left starting with ${letterSay(k)}.`
        : `You found all the words starting with ${letterSay(k)}.`));
      return b;
    }));
    openPanel("panel-hints");
    speak(hintsSummary());
  }

  function showWords() {
    const found = game.found;
    $("words-title").textContent = `My words (${found.length})`;
    const list = $("found-list");
    if (!found.length && !game.bonus.length) {
      const p = document.createElement("p");
      p.className = "empty-note";
      p.textContent = "No words yet.";
      list.replaceChildren(p);
    } else {
      list.replaceChildren(
        ...found.map((w) => wordButton(w, () => speak(`${w}. ${spell(w)}.`))),
        ...game.bonus.map((w) => {
          const b = wordButton(w, () => speak(`${w}, a bonus word. ${spell(w)}.`));
          b.textContent = w + " +";
          b.classList.add("bonus");
          return b;
        }));
    }
    $("missed-list").hidden = true;
    $("missed-title").hidden = true;
    $("btn-missed").dataset.armed = "";
    $("btn-missed").textContent = "Show the words I haven't found";
    $("btn-missed").hidden = found.length === answers.length;
    openPanel("panel-words");
  }

  function onMissed() {
    const btn = $("btn-missed");
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.textContent = "Are you sure? Tap again to show them";
      speak("This will show the words you haven't found yet. Tap again if you're sure.");
      return;
    }
    const left = remaining();
    $("missed-list").replaceChildren(...left.map((w) => wordButton(w, () => speak(`${w}. ${spell(w)}.`))));
    $("missed-list").hidden = false;
    $("missed-title").hidden = false;
    btn.hidden = true;
    speak(`Words you haven't found: ${left.join(", ")}.`);
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
    if (key === "size") renderWord();
    if (key === "rate") speak("This is the new speaking speed.");
    else if (key === "examples") speak(value ? "Letters will sound like this: B, as in ball." : "Letters will sound like this: B.");
    else speak(btn.textContent);
  }

  // ---------- Wiring ----------
  function init() {
    applySettings();
    if (!game || typeof game.center !== "string" || typeof game.letters !== "string" || game.letters.length !== 6) {
      newPuzzle();
    } else {
      game.found = game.found || [];
      game.bonus = game.bonus || [];
      game.current = game.current || "";
      setupPuzzle();
      render();
    }

    $("btn-delete").addEventListener("click", deleteLetter);
    $("btn-shuffle").addEventListener("click", shuffle);
    $("btn-check").addEventListener("click", submit);
    $("score").addEventListener("click", () => speak(scoreSpeech()));
    $("word").addEventListener("click", () => speak(game.current
      ? `Your word so far: ${spell(game.current)}.`
      : lettersSpeech()));

    $("btn-hints").addEventListener("click", showHints);
    $("btn-hear-letters").addEventListener("click", () => speak(lettersSpeech()));
    $("btn-clue").addEventListener("click", () => { giveClue(); $("btn-clue").textContent = "Give me another clue"; });
    $("btn-reveal").addEventListener("click", () => {
      if (!clueWord) return;
      $("clue-text").textContent = clueWord.toUpperCase();
      $("btn-reveal").hidden = true;
      speak(`The word is ${clueWord}. ${spell(clueWord)}. Type it in to get the points!`);
    });

    $("btn-words").addEventListener("click", showWords);
    $("btn-hear-words").addEventListener("click", () => speak(game.found.length
      ? `You've found ${game.found.length} word${game.found.length === 1 ? "" : "s"}: ${game.found.join(", ")}.` +
        (game.bonus.length ? ` And bonus words: ${game.bonus.join(", ")}.` : "")
      : game.bonus.length ? `Bonus words: ${game.bonus.join(", ")}.` : "You haven't found any words yet."));
    $("btn-missed").addEventListener("click", onMissed);

    $("btn-menu").addEventListener("click", () => { applySettings(); openPanel("panel-menu"); });
    $("btn-help").addEventListener("click", showHelp);
    $("btn-new").addEventListener("click", () => {
      if (!game.found.length) { newPuzzle(); speak("New puzzle. " + lettersSpeech()); }
      else openPanel("panel-confirm");
    });
    $("btn-confirm-yes").addEventListener("click", () => { newPuzzle(); speak("New puzzle. " + lettersSpeech()); });

    for (const b of document.querySelectorAll("[data-close]")) b.addEventListener("click", closePanels);
    for (const g of document.querySelectorAll(".choices[data-setting]")) g.addEventListener("click", onChoice);
    $("voice-select").addEventListener("change", (e) => {
      settings.voice = e.target.value;
      save("settings", settings);
      speak("Hello! This is how I sound.");
    });
    $("btn-test-voice").addEventListener("click", () => speak("Hello! This is how I sound. Here are the letters: " +
      Object.values(LETTER_SOUNDS).join(", ") + "."));

    // Physical keyboard support.
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { closePanels(); return; }
      if (anyPanelOpen()) return;
      const k = e.key.toLowerCase();
      if (/^[a-z]$/.test(k) && (game.letters + game.center).includes(k)) { addLetter(k); e.preventDefault(); }
      else if (e.key === "Backspace") { deleteLetter(); e.preventDefault(); }
      else if (e.key === "Enter") { submit(); e.preventDefault(); }
      else if (e.key === " ") { shuffle(); e.preventDefault(); }
    });
    window.addEventListener("resize", renderWord);

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
  window.__wordFlower = {
    get game() { return game; },
    get answers() { return answers; },
    points, rank: () => rank(score()), isBonus: (w) => REAL.has(w),
  };

  init();
})();
