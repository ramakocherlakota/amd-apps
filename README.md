# amd-apps

Games designed for people with low vision, especially **macular degeneration**
(loss of central vision). They run in a web browser, work best on an iPad, and need
no server or account.

| App | What it is |
|---|---|
| [Word Guess](word-guess/) | Guess a hidden 4- or 5-letter word. Giant letters, spoken clues. |
| [Word Flower](word-flower/) | Make as many words as you can from seven big letters. Spoken hints. |
| [Gin Rummy](gin/) | Standard gin rummy against the computer. Giant cards, spoken moves, hints. |

## Layout

Each app lives in its own folder and gets its own web address, under a shared home
page that links to all of them:

```
https://<your-github-username>.github.io/amd-apps/              ← home page (index.html)
https://<your-github-username>.github.io/amd-apps/word-guess/   ← Word Guess
https://<your-github-username>.github.io/amd-apps/<next-app>/   ← future apps
```

To add an app: create a new folder with its own `index.html`, and add a card for it
to the root `index.html` (copy the Word Guess `<a class="app">` line) and a row to the
table above. Each app keeps its own settings and can be added to the iPad Home Screen
separately.

## Word Guess

Guess the hidden word. After each guess, every letter shows whether it is in the
right spot, somewhere else in the word, or not in the word at all.

### Low-vision design

- **One big row at a time.** Instead of a grid of six small rows, you see only your
  current guess in giant letters. Past guesses are one tap away under **Guesses**.
- **A "Known" line** under the guess sums up everything learned so far, so you never
  have to scan old guesses: letters already placed, plus "Also in word" letters.
- **Shape, not just color:** right spot = green **square** with ✓; in the word but
  wrong spot = orange **circle** with ↔; not in the word = dim, dashed outline with ✕.
  Green vs. orange is used because macular degeneration often weakens blue/yellow
  discrimination first.
- **Everything can be spoken.** Each tapped letter is said aloud ("B, as in ball"),
  results are read after each guess, **Clues** reads a full summary ("The first
  letter is C. The word also has R, but not in the third or fifth spot…"), and
  tapping any letter tile on screen says what it is.
- **High contrast** themes (yellow on black by default, also white on black and black
  on white), two size settings, and the
  [Atkinson Hyperlegible](https://brailleinstitute.org/freefont) font, designed by
  the Braille Institute for low-vision readers.
- **Large keys** in QWERTY order (or A-B-C), the same place every time.
- **No timers, gentle mistakes.** Made-up words don't use up a guess; you can turn
  off the real-word check or the guess limit entirely.
- **Works offline** once loaded, and remembers the game in progress, settings and
  win streak on the device.

## Word Flower

Seven letters are arranged as a flower: one in the middle and six around it. Make
words of 4 or more letters; every word must use the middle letter, and letters can
be reused. Four-letter words score 1 point, longer words 1 point per letter, and a
word that uses all seven letters scores 7 extra. Each puzzle has 20 to 45 familiar
answer words; any other real word is accepted as a "bonus word".

Low-vision design (same themes, sizes, font and speech settings as Word Guess):

- **Seven giant round letter buttons in fixed places.** The middle letter is solid
  (inverted colors) with a ring, so it stands out without relying on color. The six
  outer letters start in A-B-C order clockwise from the top; **Shuffle** rearranges
  them and reads out the new order.
- **The word being built is shown huge** and shrinks only as much as needed to fit.
- **Spoken feedback** for every letter tapped, every word checked ("Yes! bold, 1
  point"), and gentle reasons when a word isn't accepted ("Every word must use the
  middle letter, B").
- **Tap the score** to hear your rank, points and how many words are found.
- **Hints**: hear the letters, get a clue ("a 6-letter word starting with BO"), have
  the clue's word told to you, and see how many words are left for each first
  letter.
- **My words** lists found words in large type, reads them aloud, and can show the
  words not yet found.
- Puzzles never use S, so there are no easy plurals. There are about 3,500 puzzles,
  played in order without repeats.

The word lists are built by `tools/build_flower.py` from SCOWL (common words, no
names) filtered by everyday frequency, with `tools/flower_blocklist.txt` removing
rude words.

## Gin Rummy

Standard gin rummy against the computer: 10-card hands, knock with 10 or less, 25-point
gin and undercut bonuses, first to 100, with game (100), per-hand (25) and shutout
(double) bonuses. The first face-up card goes to the non-dealer, then the dealer; if both
pass, the non-dealer draws. The deal alternates. A hand with two cards left in the deck
and no knock doesn't count.

Low-vision design (same themes, sizes, font and speech settings as the word games):

- **Big, simple cards**: just a huge number and suit, no small corner marks or
  picture-card art, never overlapping.
- **Four suit colors** (spades white/black, hearts red, diamonds orange, clubs green), so
  hearts and diamonds never look alike.
- **The hand arranges itself**: runs and sets in solid boxes, loose cards in a dashed box,
  with the deadwood total always shown. Or sort by suit or by number.
- **Spoken table talk**: every computer move is read out ("I took your 8 of hearts. I
  threw away the jack of clubs."), and every card you tap is named along with its role.
- **Two taps to discard** (choose a card, then Discard / Knock / Gin), so a mis-tap
  can't throw the wrong card. Knock and Gin buttons appear only when allowed.
- **Hint** suggests whether to take the discard and which card to throw away, says why,
  and selects the card for you.
- **Played** lists the discard pile by suit and the cards the computer picked up, and can
  read them aloud (optional memory help).
- **Layoffs and scoring are done automatically**, with a results screen showing both
  hands, laid-off cards and the running score.

### The computer opponent

`gin/engine.js` holds the rules and strategy. The computer only uses its own hand and
public information (the discard pile and what you've picked up), never your cards or the
deck order.

- **Easy**: makes its melds but plays loosely: sometimes keeps the wrong card or passes
  on a useful discard.
- **Medium**: finds its best melds, keeps pairs and near-runs whose missing cards are
  still live, takes a discard only when it completes or extends a meld (or gets it down
  to knocking range), and knocks as soon as it can.

`node gin/test/engine.test.js 2000` runs the rule tests and computer-vs-computer matches
(Medium wins about two hands in three against Easy). A stronger level that avoided
feeding the opponent was tried and played no better than Medium over thousands of hands,
so it was left out; a genuinely stronger player would need to look ahead.

### Setting it up on an iPad

These steps apply to every game; each one gets its own Home Screen icon.

1. Open the game's web address in **Safari**.
2. Tap the **Share** button (square with an up arrow), then **Add to Home Screen**.
3. Open it from the new icon. It runs full-screen like a regular app,
   works without internet, and its saved progress is protected from Safari's
   automatic cleanup of website data.

Voices: the games can only use the voices Safari offers to websites, which they list
under **Menu → Voice**. Downloaded "Enhanced" or "Premium" voices (**Settings →
Accessibility → Read & Speak → Voices → English**; called "Spoken Content" on older
iPadOS) are often *not* offered to web pages, so they may not appear; if one does, the
games pick it automatically. Restarting the iPad after downloading a voice sometimes
helps. Also check that the iPad isn't in silent mode if no speech is heard.

If she uses **VoiceOver**, the game's own speech will overlap with it; turn off
"Say each letter I tap" and "Read results aloud" in the Menu and let VoiceOver read
instead (all buttons and tiles have spoken labels).

### Hosting

The site is plain static files, published by GitHub Pages ("Deploy from a branch",
`main`, root folder) automatically on every push to `main`. It is at
https://ramakocherlakota.github.io/amd-apps/. The `.nojekyll` file tells GitHub to
serve the files as-is.

To try it locally: `python3 -m http.server` in the repo root, then open
http://localhost:8000/word-guess/.

### Word lists

`word-guess/words.js` is generated by `tools/build_words.py`. Answers are about
1,400 five-letter and 1,050 four-letter common, familiar words (no names, slang, rude
or grim words; see `tools/blocklist.txt`). Any real dictionary word is accepted as
a guess. To ban a word from being an answer, add it to the blocklist and rerun the
script.
