# Fluent IF

A conversational front end for classic Z-machine interactive fiction (Zork and friends). It runs entirely in the browser — no server, no backend — and can be published as a static site on GitHub Pages.

You type however feels natural. An LLM translates that into the exact terse command the game's parser expects (`take lamp`, `north`, `put cloak on hook`, …) and hands *that* to the interpreter. **The game's own output is never rewritten, summarized, or filtered** — you always see exactly what the interpreter printed, plus a small "interpreted as: …" line so you can see what was actually sent.

## How it's built

- **Interpreter**: [ifvms.js](https://github.com/curiousdannii/ifvms.js), a Z-machine (Zork/Infocom-format) emulator in JavaScript, running fully client-side. `src/glk.js` is a small [Glk](<https://en.wikipedia.org/wiki/Glk_(software)>) I/O shim written for this project so ifvms has something to talk to; `src/interpreter.js` wraps it in a plain line-in/text-out API.
- **Command interpreter**: `src/llm.js` calls the Anthropic, OpenAI, or Gemini API directly from your browser, using an API key you supply yourself (see below). It asks the model to rewrite your input into a short parser command and nothing else.
- **No build-time game content**: the repo ships with a small original 3-room demo game (`public/stories/cloakroom.z5`, compiled from `tools/cloak-of-darkness/cloak.inf`) so the site works the moment it's deployed. Actual Infocom games like *Zork I* are still under copyright — load one by uploading a story file from a copy you legally own via the **Story…** menu. Nothing you upload leaves your browser.

## Local development

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

## Deploying to GitHub Pages

This repo includes `.github/workflows/deploy.yml`, which builds the site with Vite and publishes it via GitHub's official Pages actions on every push to `main`.

One manual step is required once per repo: in **Settings → Pages**, set **Source** to **GitHub Actions**. After that, merging to `main` will publish (or update) the site automatically; the URL shows up on the workflow run and in the Pages settings once the first deploy finishes.

## Using it

1. Open the deployed page (or `npm run dev`). It boots straight into the bundled demo game.
2. Click **Interpreter settings…**, pick a provider (Anthropic, OpenAI, or Gemini), and paste in your own API key. It's stored only in your browser's `localStorage` and is only ever sent to the provider you chose. (Anthropic and OpenAI reliably support calling their API directly from a browser; Gemini's CORS support is less consistently documented, so if it errors out, fall back to raw mode.)
3. Type naturally — "grab the lamp and head north", "what am I carrying?", "hang the cloak up before we go to the bar" — and the interpreter figures out the parser command.
4. Toggle **raw mode** at any time to bypass the LLM and type exact commands straight to the game (also the automatic fallback when no key is configured).
5. Toggle **show LLM details** to see, for every command, exactly what the model returned before cleanup, the final command sent to the game, which model answered, and how long it took — useful for judging how well the interpretation is working.
6. Use **Story…** to switch to your own `.z3`/`.z5`/`.z8`/`.zblorb` file.

### Getting a real Zork file

*Zork I/II/III* are still copyrighted (currently by Activision), so this project can't include them. If you own a legal copy — e.g. an official re-release, or a physical/DOS copy you still have — you can extract its story file and upload it via the Story menu. This tool is purely a command interpreter; it doesn't provide, host, or link to game content.

## Notes & limitations

- The command interpreter has no way to *guarantee* a sensible translation — it's an LLM guessing at intent. When it guesses wrong, the game's real parser response makes that obvious (nothing is hidden), and you can always fall back to raw mode.
- Save/restore uses the game's own `save`/`restore` commands, persisted to browser `localStorage` (there's no cloud save).
- Calling the Anthropic/OpenAI APIs directly from a static page means your key lives in your browser only — do not use a key you're not comfortable placing in client-side JavaScript on a device you don't fully trust (e.g. a shared/public computer).
