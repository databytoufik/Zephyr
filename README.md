# Zephyr

Write by voice, hands-free. Zephyr turns everything you say into your manuscript, and anything that starts with
**“Zephyr please”** into a command: format, read back, edit with Claude, get feedback, undo, switch documents.
It runs in the phone’s browser, with no account and no server. Your writing stays on your device.

## Using it

1. Open the site in **Safari on iPhone** or **Chrome on Android**, and add it to your Home Screen
   (Share › Add to Home Screen). Installed, it opens full-screen, works offline, and the phone keeps its data.
2. Tap **Start listening** and talk. Say “period”, “comma”, “new paragraph” for punctuation.
3. Give commands with “Zephyr please …”: *read last paragraph*, *bold that*, *heading two, chapter one*,
   *scratch that*, *edit change cold to bitter*, *feedback*, *end session*. The **Commands** tab lists them all.
4. Optional, in **Settings**:
   - **Claude**: paste an API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) and tap
     *Test key*. This turns on edit, feedback, explain and automatic punctuation.
   - **Appearance**: eight colour themes (Midnight Amber, Royal Purple, Fairy Queen, Deep Navy, Ocean Teal, Forest,
     Ember, High Contrast), each in light and dark, plus three text sizes.
   - **Google Drive backup**: follow the steps in Settings. They use [`apps-script/Code.gs`](apps-script/Code.gs).
   - **Your data**: export everything to a file, or import a file from another device.

If Zephyr ever mistakes your words for a command, or you speak while it is reading, say **“Zephyr please add that”**
and the words go into the manuscript.

## How it is built

A static site with no build step and no dependencies. GitHub Pages serves the files as they are.

```
index.html              page markup
css/styles.css          layout and components
css/themes.css          colour themes (generated, see below)
js/app.js               start-up
js/ui.js                rendering, settings, themes, export/import
js/commands.js          “Zephyr please” routing and the command table
js/speech.js            speech recognition, text-to-speech, echo filtering
js/doc.js               documents, sessions, autosave, undo, formatting
js/dictation.js         spoken punctuation, capitals, line breaks (pure)
js/markup.js            the manuscript’s formatting marks: parse, render, export (pure)
js/wake.js              spotting the wake phrase (pure)
js/ai.js, js/claude.js  Claude requests (streaming) and prompts
js/edits.js             applying Claude’s edits (pure)
js/backup.js            Google Drive backup client
js/palettes.js          colour palettes, the source for css/themes.css
sw.js                   offline support
apps-script/Code.gs     the Google Drive side of backup
```

The manuscript is plain text with light marks: `% ` title, `# `…`#### ` headings, `- ` bullets, `1. ` numbered items,
`**bold**`, `*italic*`, `++underline++`. Marks only count when they pair up around words, so `C++` or `5 * 3` stay
as written. A leading `\` keeps a line that looks like a mark as ordinary text.

### Develop

```sh
npm run serve                 # http://localhost:8080
npm test                      # unit tests (Node 20+)
node tools/build-themes.mjs   # after editing js/palettes.js; also checks colour contrast
node tests/browser.cjs http://localhost:8080/   # end-to-end checks (needs Playwright + Chromium)
```

When you change a file the app loads, bump `VERSION` in `sw.js` so installed copies pick up the update.

### Privacy and security

- Documents, settings and the API key live in this browser’s storage (IndexedDB) on this device.
- The key is sent only to `api.anthropic.com`; backups go only to your own Apps Script URL. A Content Security
  Policy blocks every other destination.
- Browser storage is shared by every page on the same GitHub Pages domain (`<user>.github.io`), so only host other
  projects there that you trust, and set a spending limit on your Claude key.

## License

AGPL-3.0. Forked from [artemisiamathieu/Zephyr](https://github.com/artemisiamathieu/Zephyr).
