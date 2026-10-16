# WordLens

Endless 5-letter word guessing for Even Realities G2 glasses, built as an Even Hub plugin.
Six guesses per word, a streak and guess distribution that survive a full app restart, and the next word is dealt the moment a round ends.
Guesses can be spoken: hold, say a word or spell it, let go, and pick what was heard. Recognition runs offline on the phone.

![Win in three guesses](docs/screenshots/02-win.png)

## Quick start

```bash
npm install
npm run voice-model    # once: downloads the 41 MB speech model to public/vosk/ (not committed)
npm test               # 122 unit + play-through tests
npm run dev            # Vite on :5173
npm run simulate       # in a second terminal: evenhub-simulator against :5173
npm run qr             # QR code to sideload the dev server onto your phone
npm run pack           # production build → wordlens.ehpk
npx tsx scripts/listing-sim.ts    # store play screenshots from the simulator (keyboard text)
npx tsx scripts/listing-shots.ts  # store Help and Stats screenshots
```

Requires Even App ≥ 2.2.10 and SDK ≥ 0.0.15 (pinned in `package.json` / `app.json`).
Older SDKs drop long-press event types and misread a long press as two taps.
`app.json` asks for the `g2-microphone` permission, used only while a hold to talk lasts.

## Settings

Edit `DEFAULT_SETTINGS` in `src/config.ts`:

| Setting | Options | Default | What it does |
| --- | --- | --- | --- |
| `boardSide` | `'right'` / `'left'` | `'right'` | Side of the guess board. Right keeps it visible while the OS menu (which opens over the left) is showing. |
| `letterOrder` | `'frequency'` / `'alphabetical'` | `'frequency'` | Letter order in the picker. |
| `picker` | `'keyboard'` / `'vertical'` / `'horizontal'` | `'keyboard'` | Keyboard = QWERTY with ENTER and DEL, letters as firmware text over drawn key frames; a swipe moves the focus with a text update (~60 ms), no image send, and the keys show the letter marks. Vertical = the native list (firmware-drawn, 20-item limit, so letters span two pages). Horizontal = a drawn carousel with all 28 items on one wrapping strip. |
| `hold` | `'talk'` / `'delete'` | `'talk'` | What holding does on Play: push-to-talk, or delete a letter. Also in the menu (saved). Voice needs the keyboard or horizontal picker. |
| `keys` | `'full'` / `'controls'` | `'full'` | With push-to-talk on the keyboard picker: the QWERTY keyboard, or just ENTER, DEL and CLEAR as text with the alphabet and its marks underneath. Also in the menu (saved). |

For quick testing without editing code, URL parameters override the defaults (and, for `hold` and `keys`,
the choices saved from the menu):
`http://localhost:5173/?picker=horizontal&order=alphabetical&board=left&hold=delete&keys=controls`

`?fakemic=<url of a 16 kHz 16-bit mono WAV>` plays that file instead of the glasses mic, so voice works in the
simulator or a browser without speaking: `say -o crane.wav --data-format=LEI16@16000 crane`.

## How to play

With the keyboard (default): swipe to walk the keys (Q → P, A → L, ENTER, Z → M, DEL, then around again);
brackets mark the key you are on. Tap types it; tap ENTER to guess. Hold talks (see Voice below; set it to
delete a letter from the menu), tap-then-hold opens the menu, double-tap exits. The keys carry the same marks as the board. The two pickers below are still available.

| Gesture | Vertical picker | Horizontal picker | Help / Stats |
| --- | --- | --- | --- |
| Swipe up/down | Move through the list (edges do not wrap) | Move left/right along the carousel (wraps) | – |
| Tap | Type the highlighted item | Type the centred item | Back to Play |
| Hold | Delete one letter | Delete one letter | – |
| Double-tap | Exit prompt | Exit prompt | Exit prompt |
| Tap, then hold | Menu: Enter guess, Backspace, Help, Stats, Give up, Quit | Same | Back to game, Quit |

Items: `DEL` backspaces, `ENTER` submits. In the vertical picker, page A holds `DEL`, `ENTER`, 17 letters and
`MORE >>` (the 20-item limit); page B holds the other 9 letters and `<< BACK`. Scrolling past either
edge does not change pages.
Double letters (APPLE) need two separate taps. A fast double-tap is a double-tap, not two single taps.

Marks use shape, not brightness alone: solid fill = right spot, circle = wrong spot, strike = not in word.
Dim marks (absent letters, empty cells) stay visible.

**Stats** shows streak, best, played, wins and win rate, plus a bar chart of guesses per game
(1–6, and L for losses and give-ups). Wins are solid bars, L is an outline, and your latest game's bar is full brightness.

## Voice (hold to talk)

Hold anywhere on Play and say a word, or spell it with letters or the NATO alphabet (alpha, bravo…), then let
go. The card on the left shows what was heard, best first: swipe to the one you meant and tap. A word is
guessed at once; letters (shown as `+CR`) are added to the row; CANCEL drops it. A hold while the list is up
starts over. Holding to delete instead, and hiding the keyboard, are in the menu (tap, then hold).

How it works (`src/voice/`):

- The glasses mic is open only while the hold lasts (`audioControl`); frames are buffered and decoded on
  release by [vosk-browser](https://github.com/ccoreilly/vosk-browser) (Kaldi in WebAssembly, in a worker)
  with the small English model. Nothing leaves the phone.
- Every decode is restricted to a grammar: the 5,472 allowed guesses the model knows (`src/words/spoken.ts`),
  or the 26 letters and NATO words. Vosk returns one answer per decode, so runner-ups (near misses and
  homophones like THERE / THEIR) come from decoding the clip again without the earlier answers.
- The engine is a separate chunk loaded only when push-to-talk is on; the model is unpacked into IndexedDB
  on first use and warmed with one decode of silence.
- The phone page shows the model state; each release logs the clip's bytes per second (16 kHz 16-bit mono
  is 32,000 B/s).

The voice card, its spinner and the ENTER / DEL / CLEAR box are all firmware text, so every step is a
~60 ms text update and nothing else on screen redraws. Boxes are drawn with box-drawing glyphs, which, like
fullwidth letters and the ideographic space, are 20 px wide in the G2 font; a second copy of each frame
half a line lower closes the gaps in the walls (`src/textframe.ts`).

## Layout

Keyboard picker (default):

```
+---------------------------+---------------------------+
| STREAK n   BEST n         | board 6×5 | message strip |   two 288×144 images
| voice card (text, framed) |           |               |   card: hint, or listening / choices
+---------------------------+---------------------------+
| key frames + marks: two 288×144 images                |
| keyboard text (fullwidth, 20 px cells, 27 px lines)   |   text box on top, not the capture
| blank text container underneath: isEventCapture: 1    |
+-------------------------------------------------------+
```

With "Enter and Del only" the bottom band is text only: a framed ENTER / DEL / CLEAR row, and under it
A–Z with a mark line (● right spot, ○ wrong spot; a letter not in the word turns into ・). That page uses
all 8 non-image containers. Without voice (no host support, or hold set to delete outside push-to-talk),
the card's place holds the marks legend and gestures, which are also on the Help page.

Fullwidth characters are monospaced in the G2 font, so the text is a grid and the frames are drawn on it (see
`src/textkb.ts`). Letters in the right spot or not in the word are drawn by the image (dark on a fill, or dim
with a strike) and blanked in the text, since text has one brightness.

List and carousel pickers:

```
+---------------------------+---------------------------+
| STREAK n   BEST n         | board 6×5 | message strip |   two 288×144 images
| QWERTY status (display)   |           |               |
+---------------------------+---------------------------+
| vertical: native list, 576×144, isEventCapture: 1     |
| horizontal: 288×64 carousel image over a blank        |
|             text container that catches swipes        |
+-------------------------------------------------------+
```

## Code map

| File | Role |
| --- | --- |
| `src/config.ts` | Settings, list pages, carousel items, menu IDs, timings. |
| `src/game.ts` | Scoring (duplicate-letter rules), key marks, stats and distribution rules. Pure. |
| `src/deck.ts` | Seeded Fisher–Yates deck; only seed + index are persisted. |
| `src/words/` | Packed answer list (2,069), allowlist (8,679) and spoken list (5,472). Generated. |
| `src/storage.ts` | Typed, defensive `get/setLocalStorage` wrapper. |
| `src/input.ts` | Raw events → inputs. Handles missing `eventType` / index per envelope. |
| `src/imageQueue.ts` | The only caller of `updateImageRawData` and `textContainerUpgrade`. Serial, coalescing, rebuild-aware; text updates jump ahead of waiting images. |
| `src/textkb.ts` | The text keyboard: key grid, keyboard text with ［ ］ focus, key frames and marks. Pure. |
| `src/render/` | 4-bit framebuffer, 5×7 pixel font, board / keys / info / help / chart / carousel renderers, PNG encoder. |
| `src/pages.ts` | Container layouts and menus for Play (both pickers), Help, Stats. |
| `src/controller.ts` | State machine: rounds, pages, pickers, persistence, drawing. Host is injected. |
| `src/textframe.ts` | Boxes drawn in text: two-part frames of 20 px glyphs. Pure. |
| `src/controls.ts` | ENTER / DEL / CLEAR row and the A–Z status line for controls mode. Pure. |
| `src/voice/` | Push-to-talk: `session.ts` (mic and clip, races), `engine.ts` (vosk-browser, grammars, runner-ups), `candidates.ts` and `spell.ts` (what was heard → choices), `modal.ts` (card text, spinner, frame), `pcm.ts`, `fakemic.ts` (dev). |
| `src/main.ts` | SDK bridge wiring, mic and lazy voice engine, URL setting overrides, phone page that mirrors the glasses frames. |

Grey levels per mark are in `src/render/cells.ts` (`LEVELS`).
`npm run preview-frames` renders sample frames to `previews/` without any device.
`npm run wordlists` regenerates the word lists (see `LICENSES.md`); `npm run voice-model` downloads the speech
model and regenerates the spoken list.

## Verified in evenhub-simulator 0.9.5

Both pickers, both board sides, typing, submit and scoring, the `MORE >>` page swap, the contextual
menu (Enter, Give up, Stats, Help), the Stats page and chart, double-tap exit, persistence across a
WebView reload, and recovery when `createStartUpPageContainer` fails on reload.
Screenshots are in `docs/screenshots/`.

Observed on the wire: list taps arrive as `listEvent` with only `currentSelectItemIndex`; swipes on a
native list emit no events; swipes on a text container emit `SCROLL_BOTTOM` (down) / `SCROLL_TOP` (up)
as `textEvent`; taps on a text container arrive as `sysEvent`; double-tap arrives as `sysEvent` type 3.
