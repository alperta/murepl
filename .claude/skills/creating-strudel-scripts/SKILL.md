---
name: creating-strudel-scripts
description: Write a script the user loads into strudel.cc with one import line, hosted in his public scripts repo. Covers what the script must never say, how to namespace it, the transpiler and audio-graph traps, and the git and CDN routine. Use when the user wants a meter, a visual or any tool inside the Strudel editor, or when a script in `murepl` needs a change.
---

# Creating Strudel scripts

The user writes patterns on strudel.cc. He wants tools there without pasting 200 lines into the editor every time, so each tool lives as one ES module in `github.com/alperta/murepl`, and he loads it with one line:

```js
await import('https://cdn.jsdelivr.net/gh/alperta/murepl@main/lufs-meter.js')

stack(s("bd sd"), note("c2").s("sawtooth")).lufs()
```

The repo is public, because a CDN reads nothing private. So the repo must stay uninteresting to anyone who stumbles on it.

This file names the repo and the handle. It lives in `~/.claude`, which is no git repo, so it publishes nothing. Never copy it into a project.

## What the script never says

Write the file clean the first time. A commit that carries a name you later regret forces a history rewrite, which is what the user asked never to repeat.

- **Name no person, no channel, no project.** Drop the user's name, his channels, his repos and every identifier tying the script to him.
- **Name Strudel nowhere in the prose.** No `strudel`, no `strudel.cc`, no `superdough`, no `mini-notation` in a comment, a string or the README you never write. Say "the host", "the master output", "the editor".
- **Keep the identifiers the API forces.** `getSuperdoughAudioController()` and `Pattern.prototype.x` have no synonym, so they stay. The prose around them carries the silence.
- **Write no README.** A README describes the repo to a stranger and a search engine. The header comment inside the file says everything the user needs.
- **Give the file a plain functional name.** `lufs-meter.js` says what it does and names no platform.

## Namespace every top-level name

One repo holds every script, and 2 scripts loaded together share one page. So prefix each top-level declaration with the function it serves: `lufsKCoefs`, `lufsPanel`, `LUFS_OFFSET`, `globalThis.lufsMeter`, the DOM id `lufs-meter-panel`.

A module keeps its top level private, so the prefix looks useless. It stops 2 things:

- The user pastes the file into the editor one day. The transpiler registers every top-level `const` and `function` on `globalThis`, so a bare `OFFSET` collides with the next script.
- A second script declares the same helper. Both write `globalThis.state` and the last one wins.

Expose one global object per script, named after the function: `globalThis.lufsMeter` holds `reset()`, `stop()` and the live numbers. Register the pattern method under the same word: `Pattern.prototype.lufs`.

## The traps, measured on 2026-09-22

- **The transpiler rewrites every backtick and every double-quoted string into mini-notation.** `packages/transpiler/plugin-mini.mjs` turns each one into `m(value, offset)`, so `` `${13 * dpr}px ui-monospace` `` throws. A single-quoted string survives. A module loaded by `import()` never meets the transpiler, so a module may use backticks freely. A block pasted in the editor may not, unless it opens on `// mini-off` and closes on `// mini-on`. Forgetting `// mini-on` strips mini-notation off the user's own pattern.
- **`evalScope` assigns every Strudel export to `globalThis`.** `packages/core/evaluate.mjs` walks each loaded module and writes `globalThis[name] = value`. So a module reaches `Pattern`, `getAudioContext()`, `getDrawContext()` and `getSuperdoughAudioController()` by their bare names. Patch no prototype to find them.
- **Never patch `AudioNode.prototype.connect`.** A snippet doing that stopped strudel.cc from starting at all, and the cause never surfaced.
- **The oscilloscope's analyser measures one sound, in mono.** `getAnalyserById(id)` only receives a sound whose pattern sets the `analyze` control, and an `AnalyserNode` downmixes before it fills a time-domain array, which reads 3 to 6 dB under the stereo number. For the whole mix in stereo, tap `getSuperdoughAudioController().output.destinationGain` through a `ChannelSplitterNode` into one analyser per channel.
- **An `AnalyserNode` returns `fftSize` samples at most, and the spec caps `fftSize` at 32768.** That is 0.68 s at 48 kHz, so a 400 ms window fits and anything longer needs the script to keep its own history.
- **`raw.githubusercontent.com` serves `text/plain`, so Chrome refuses the module.** jsdelivr serves `application/javascript`. Use jsdelivr.
- **`safeEval` wraps the editor's code in `(async () => {...})()`.** So `await import(...)` works at the top of the pane, and the last expression still returns the pattern.

## The traps, measured on 2026-09-28 and 2026-09-29

- **A module runs once per page, so a reset drops the sounds it registered.** Loading a pattern with a reset calls `resetLoadedSounds()` in `website/src/repl/useReplContext.jsx`, and a second `await import()` returns the cached module without running it. A script that calls `registerSound` tells the user to import it with `'?' + Date.now()` appended, which runs it on every evaluate.
- **`white`, `pink` and `brown` loop one 2 s buffer, and every note starts it from sample 0.** `superdough/noise.mjs` caches the buffer per type, so two noise voices never decorrelate, and a noise drop replays the same grain each time. `crackle` is the exception: it builds a new buffer per note.
- **`rand` returns the same number to every call at the same time.** `irand`, `degradeBy` and `rand.range` in one pattern correlate. Shift each one with `.early(Math.sqrt(n))`, and use `useRNG('precise')`, because the default `legacy` generator also repeats from cycle to cycle.
- **Each orbit has one reverb, and it rebuilds whenever a note brings different settings.** The rebuild cuts the tail that was ringing, which clicks. Give each line with its own `room`, `rsize` or `rlp` its own `.orbit(n)`.
- **A `.gain()` chained after a `register`ed stack replaces the gains inside it.** Chain `.velocity()`, which multiplies instead.
- **The editor reads `.wt()` once per note, and the synth's amplitude envelope is linear.** Move the wavetable position with `.wtdepth()` and `.wtrate()`, which drive a triangle LFO. An exponential decay needs a sample or a custom `registerSound`.
- **`strudelMirror.evaluate()` waits for a first click before it starts audio.** A headless browser clicks the page once before it evaluates.

## The panel, and failing out loud

A script that draws nothing and says nothing wastes an hour. Follow these:

- **Draw into a DOM element, never `getDrawContext()`.** That canvas gets prepended to the body, so the editor paints over it. A `position:fixed` div at `z-index:2147483647` with `pointer-events:none` always shows.
- **Show a waiting state the moment the script loads.** `LUFS: waiting for audio` proves the module ran, before any sound plays.
- **Wrap the per-frame body in try/catch and print the error in the panel.** An exception inside a `requestAnimationFrame` callback kills the loop in silence. `panel.textContent = 'LUFS failed: ' + err.message` turns that into a sentence the user can read.
- **Hang the animation off the pattern.** `this.draw(fn, { id })` re-registers under the same id on every evaluation, so re-running the pattern never stacks 2 loops.

## Verify before you push

- **Run the real transpiler over the script.** `npm i @strudel/transpiler @strudel/mini @strudel/core`, then transpile the script followed by a pattern using double quotes. Check that the script's own strings came out as plain JavaScript and that the pattern still came out as `m('bd sd', 87)`. `@strudel/core` needs a stub for `@kabelsalat/web`'s `SalatRepl` export under Node.
- **Check the maths against a reference package.** When a script measures something, run its functions in Node with `vm.runInThisContext` over the shipped file, and compare against a published implementation. For loudness that is `@audio/loudness-lufs`, which implements BS.1770-4 in 90 lines.
- **Fetch the CDN URL and diff it against the local file.** That proves what the browser will actually load.

## The repo routine

The clone sits at `~/code/murepl`. One file per script, no README, no build step.

- **Commit the clean file once.** Never commit a draft carrying a name the user would want erased, because erasing it means rewriting history and force pushing a public repo.
- **Cut a tag once a script settles.** `@v2` is immutable on the CDN, so a later push never breaks the line the user already pasted.
- **Serve `@main` while a script moves.** jsdelivr caches a branch for up to 12 hours. `https://purge.jsdelivr.net/gh/alperta/murepl@main/<file>.js` clears it, and the browser needs a reload after that.
- **Hand over the import line, single-quoted.** Double quotes around the URL turn it into a pattern.
- **If something private reached the history, squash to one commit and force push.** `git reset --soft $(git rev-list --max-parents=0 HEAD)`, then `git commit --amend`, then `git push --force`. GitHub keeps the old commit reachable by its SHA, so say that out loud.
