# AGENTS.md

Handover notes for the next coding agent. Read the whole file before you change anything.

Last updated: 2026-10-06, on the owner's Mac (macOS arm64). Next step: the owner runs this repo on a Windows PC, and an agent on that PC diagnoses the Windows failure live.

## 1. Status

- The app works on macOS. A "Use your API keys" (BYOK) session captures system audio, Gemini Live (`gemini-3.8-live`) transcribes it, and the answer model picked on the start screen (GPT-6 Astra by default, through OpenRouter, with `gemini-3.8-flash` as the fallback) writes every answer (section 3.2).
- The app does not work on Windows. Nobody has observed the exact Windows symptom yet. It could fail at install, at launch, at session start, or later by never answering.
- No Windows code fix has been applied yet. This was deliberate. Confirm which failure happens on the real machine, then apply the matching fix from section 6.
- Your job on Windows: follow the runbook in section 5, identify the failing stage, apply the matching fix, verify it, commit it, and add an entry to the status log in section 11.

## 2. What this repo is

- An Electron desktop app in plain JavaScript. The main process uses CommonJS. The UI uses Lit web components (ES modules) plus one classic renderer script. There is no React, TypeScript or build step for app code.
- Electron 44.3.0 and Electron Forge 7.11.2 (`npm start`, `npm run package`, `npm run make`).
- It shows an always-on-top overlay, captures system audio (optionally the microphone) and screenshots, sends them to an AI model and shows the answers. Profiles: job interview, LLD interview, sales, meeting, presentation, negotiation, exam.
- License: GPL-3.0, inherited from upstream. The repository has been private since 2026-10-09; it was public before, so anything committed earlier may exist in other people's copies.

Provenance:

| Repo                                                  | Role                           | Head                                    |
| ----------------------------------------------------- | ------------------------------ | --------------------------------------- |
| https://github.com/sohzm/cheating-daddy               | Original upstream              | `3cccc36`, v0.8.0, 2026-07-23           |
| https://github.com/RohitRathiii/cheatingdaddymodified | Fork this repo was copied from | `8c49d85`                               |
| https://github.com/raghav-rathi/PersonalizedNotetaker | This repo                      | `8c49d85` plus the commits in section 7 |

Rohit's fork is upstream v0.7.0 (merge-base `5dfdc12`, 2026-02-09) plus 15 commits. It has none of upstream's 7 newer commits (section 4.7). To compare, add the other repos as remotes:

```powershell
git remote add rohit https://github.com/RohitRathiii/cheatingdaddymodified.git
git remote add upstream https://github.com/sohzm/cheating-daddy.git
git fetch rohit
git fetch upstream
```

## 3. How the app works

### 3.1 Key files

| File                                                                       | Role                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.js`                                                             | Main entry. Squirrel guard, Chromium switches per platform, tray, renderer crash recovery, storage and general IPC handlers.                                                                                                |
| `src/utils/window.js`                                                      | Creates the BrowserWindow, the screen-capture request handler (line 149), content protection, Windows z-order and taskbar handling, global shortcuts.                                                                       |
| `src/utils/overlayVisibility.js`                                           | Per-platform window helpers: opaque window on Windows, Alt as the Windows hide key.                                                                                                                                         |
| `src/utils/optionTapMonitor.js`                                            | Global Alt/Option tap detection through the native module `uiohook-napi`.                                                                                                                                                   |
| `src/utils/gemini.js`                                                      | About 2,500 lines. Gemini Live session, text answers and the two answer screens (`streamLanedAnswer`), coding mode (`handleCodingCommand`), audio routing, macOS SystemAudioDump, turn handling, every session IPC handler. |
| `src/utils/geminiLiveSessionConfig.js`, `src/utils/geminiLiveTransport.js` | Live setup message and the raw WebSocket transport.                                                                                                                                                                         |
| `src/utils/liveAudioGapFiller.js`, `src/utils/liveTurnWatchdog.js`         | Keep Gemini 3.8 Live turns closing (see cause B4).                                                                                                                                                                          |
| `src/utils/questionMerge.js`                                               | Joins a spoken question that Live split at a pause, so it gets one answer card, but only while that answer is not being read yet.                                                                                           |
| `src/utils/answerModel.js`                                                 | The answer models on the start screen (`ANSWER_MODELS`), the OpenRouter request and stream, and the fallback to Gemini Flash.                                                                                               |
| `src/utils/answerLanes.js`                                                 | The `LANE:` line that puts each answer on the main screen or the follow-up screen, the "okay"/"mm-hmm" filter, and the merge rule.                                                                                          |
| `src/utils/codingSession.js`, `src/prompts/*-skill.md`                     | Coding mode: one conversation per problem, the hotkey commands, and the round prompt picked by profile (`dsa-coding-skill.md`, `lld-skill.md`, `hld-skill.md`). A copy in the settings folder wins over the built-in file.  |
| `src/utils/renderer.js`                                                    | Renderer glue loaded by `index.html`. Storage wrappers, provider start, audio capture (`startCapture`, line 691), screenshots, the `window.cheatingDaddy` API.                                                              |
| `src/audio-worklet.js`                                                     | AudioWorklet that turns captured audio into 40 ms 16-bit frames.                                                                                                                                                            |
| `src/components/**`                                                        | Lit UI. `CheatingDaddyApp.js` is the root and starts meetings. `MainView.js` is the start screen.                                                                                                                           |
| `src/storage.js`                                                           | JSON files in the per-OS config folder.                                                                                                                                                                                     |
| `src/utils/localai.js`, `src/utils/cloud.js`                               | Local mode (Ollama and Whisper) and Cloud mode (cheatingdaddy.com).                                                                                                                                                         |
| `forge.config.js`, `package.json`                                          | Packaging, makers, native-module rebuild settings, dependencies.                                                                                                                                                            |

The window uses `nodeIntegration: true` and `contextIsolation: false`. Renderer `require()` paths resolve from `src/index.html`, so they are written as `./utils/x`.

### 3.2 AI modes

- `cloud`: the cheatingdaddy.com invite-code service. The code falls back to this mode when no `providerMode` is saved (cause B1).
- `byok` ("Use your API keys"): Gemini Live `gemini-3.8-live` over `wss://generativelanguage.googleapis.com/...` listens and transcribes. Every answer, spoken or typed, comes from a text model (`streamLanedAnswer` in `gemini.js`) using the full system prompt, which includes the custom instructions. With `openrouterKey` saved, the model picked under **Answer Model** on the start screen answers through OpenRouter (`answerModel.js`): GPT-6 Astra (`openai/gpt-6-astra`, low effort, the default), Claude Opus 5.5 (`anthropic/claude-opus-5.5`, medium effort), Claude Sonnet 5.5, GPT-6.1 Sol, DeepSeek V4.1 Flash or Claude Haiku 5.5 (the cheapest, for testing), all at low effort except Opus. Otherwise `gemini-3.8-flash` answers. If the OpenRouter request fails or shows no text within the model's limit (`firstTextMs` in `answerModel.js`: 8 s to 20 s), Gemini Flash answers instead. Live's own spoken reply is hidden unless both fail. Each answer starts with a `LANE:` line that puts it on the main screen or the follow-up screen, or drops it (`answerLanes.js`, section 7, change 11). Speech that continues a question within 12 s re-answers it in the same card only while that answer is empty or under 5 s old (`questionMerge.js`). Coding mode runs the round prompt for the selected profile (`coding` or any non-round profile: `dsa-coding-skill.md`; `lld`: `lld-skill.md`; `hld`: `hld-skill.md`) as one conversation per problem (`codingSession.js`). Screen analysis outside coding mode uses `gemini-3.8-flash`. An optional Groq key is only used when there is no Live session.

    Why: every Live model can only answer by speaking, so the overlay used to show a short transcript of speech. In a 2026-10-07 comparison with the same prompt, Live models gave 114 to 367 words, `gemini-3.8-flash` gave 365 to 412 words with more depth, and `gemini-3.1-pro-preview` took 13 to 18 s to start. `gemini-3.8-live-extended-thinking` refuses this app's setup unless `thinkingConfig` is set and the `search_meeting` tool is `NON_BLOCKING`.

- `local`: Ollama plus Whisper through `@huggingface/transformers`.

### 3.3 Audio: macOS and Windows use different code

This is the most important fact for the Windows problem. The working Mac setup never runs the Windows audio path.

```text
macOS (works):
  SystemAudioDump binary (24 kHz stereo) -> main: startMacOSAudioCapture (gemini.js:1445)
      -> enqueueLivePcm -> Gemini Live
  plus liveGapFiller.start() (gemini.js:1480), which adds a low noise floor when frames stop

Windows (never run on Windows):
  renderer: getLoopbackStream() -> navigator.mediaDevices.getDisplayMedia (renderer.js:633)
      -> main: setDisplayMediaRequestHandler -> { video: sources[0], audio: 'loopback' } (window.js:149)
      -> AudioContext + AudioWorklet (renderer.js:650, src/audio-worklet.js)
      -> IPC 'send-audio-frame' -> validateAudioFrame -> routeAudioFrame (gemini.js:1755)
      -> enqueueLivePcm -> Gemini Live
  no gap filler
```

### 3.4 Where data lives on Windows

- Settings: `%APPDATA%\cheating-daddy-config\` (`config.json`, `credentials.json`, `preferences.json`, `keybinds.json`, `limits.json`, `history\`). `credentials.json` holds API keys in plain text (`apiKey` for Gemini, `openrouterKey`, `groqApiKey`). Never commit or upload it.
- Performance diagnostics: `app.getPath('logs')\diagnostics\performance.jsonl`, normally `%APPDATA%\cheating-daddy\logs\diagnostics\` in a dev run. A line is written every 15 s and includes `global.getMeetingDiagnostics()` (`gemini.js:246`): provider mode, audio queue, `audioGapsFilled`, `liveUnansweredTurns`, `liveStalledTurns`.
- Settings are per machine. On a new Windows PC, enter the Gemini and OpenRouter keys and paste the custom prompt again.

## 4. Windows investigation (2026-10-06)

### 4.1 How it was investigated

The Mac session could not run Windows. Seven agents worked in parallel on the code, the git history, the upstream diff, all 367 upstream issues and 116 pull requests, and Mac-side reproductions: npm installs that simulate Windows, and an Electron 44 harness that forced the Windows capture path. Their raw JSON reports are in `docs/windows-investigation/`. This file is the reviewed summary. Where a raw report disagrees with this file, trust this file. For example, some reports call the `git+ssh` lockfile entry a risk, but a reproduction showed it is not.

### 4.2 Key facts

- None of the fork's Windows work has run on Windows. `docs/windows-performance-report.md` says "Windows visibility and two-hour readiness remain unverified". `tests/windows-smoke.spec.js` skips itself outside Windows. The Windows commits were written and checked on a Mac.
- Most upstream "does not work on Windows" issues were not Windows bugs. #168 (41 comments), #176, #318, #452 and #339 came from Google retiring Gemini models. This repo already avoids that by using `gemini-3.8-live` and `gemini-3.8-flash`.

### 4.3 Stage A: the app does not open (running from source)

A1. `npm start` compiles `uiohook-napi` from C++ source. Likely blocker, introduced by the fork.

- `forge.config.js:30` has `rebuildConfig: {}`, so `electron-forge start` runs `@electron/rebuild` 3.7.2 on native modules before it opens a window.
- `@electron/rebuild` only accepts prebuilt binaries named `electron.napi.node` or `node.napi.node` (`node_modules/@electron/rebuild/lib/module-type/prebuildify.js:49-50`). `uiohook-napi` ships `prebuilds/win32-x64/uiohook-napi.node`, so the lookup fails and it compiles libuiohook with node-gyp.
- That needs Visual Studio 2019 or 2022 with the "Desktop development with C++" workload, plus Python. The bundled `@electron/node-gyp` 10.2.0-electron.1 only recognises VS 2017, 2019 and 2022 (`lib/find-visualstudio.js`), so a machine with only VS 2026 fails too.
- A rebuild error aborts `npm start` at "Preparing native dependencies" (`node_modules/@electron-forge/core/dist/api/start.js`). No window appears.
- Proof that the compile happens: on the Mac, Xcode built `node_modules/uiohook-napi/build/Release/uiohook_napi.node` for Electron 44.3.0, and every `npm start` printed "Preparing native dependencies: 1 / 1".
- `uiohook-napi` was added in commit `17e6740`. Upstream has no native modules, so upstream does not hit this.
- Fix: F1.

A2. Node older than 22.12 cannot download Electron 44. Likely blocker, introduced by the fork.

- Electron 44.3.0 requires Node 22.12 or newer. It downloads its binary lazily on the first `require('electron')`, using ESM-only packages.
- On Node 20.18.1, `npm ci` succeeds with only `EBADENGINE` warnings. The first `npm start` then fails with `ERR_REQUIRE_ESM` and "Electron failed to install correctly". This was reproduced.
- Commit `309fadf` moved Electron from 30 to 44.3.0. Upstream is still on Electron `^30.0.5`.
- Fix: F2.

A3. Windows 11 Smart App Control can block Electron's unzip step. Possible.

- `@electron-internal/extract-zip` loads an unsigned native `.node` file. With Smart App Control on, Windows can refuse to load it (electron/electron#52481), so `node_modules\electron\dist` never appears.
- Workaround: unzip `electron-v44.3.0-win32-x64.zip` from `%LOCALAPPDATA%\electron\Cache` into `node_modules\electron\dist` and write `electron.exe` into `node_modules\electron\path.txt`.

### 4.4 Stage B: the app opens but never answers

B1. A fresh Windows profile starts in Cloud mode. Likely if nobody switched modes.

- `providerMode` is missing from `DEFAULT_PREFERENCES` (`src/storage.js:20-35`). `CheatingDaddyApp.js:748`, `MainView.js:541` and `renderer.js:697` fall back to `'cloud'`.
- Cloud mode needs a cheatingdaddy.com invite code and never uses the Gemini key. The Mac already has `"providerMode": "byok"` saved.
- Upstream changed the default to `byok` in `cdedc66`. This repo does not have that change.
- Workaround: click "Use your API keys" on the start screen. Fix: F3.

B2. Start can hang forever in the screen-capture handler. Possible, depends on the machine.

- `window.js:149-156` calls `desktopCapturer.getSources({ types: ['screen'] }).then(sources => callback({ video: sources[0], audio: 'loopback' }))` with no `.catch` and no check for an empty list.
- If `getSources` rejects or returns nothing (two graphics cards, Remote Desktop, driver problems), `getDisplayMedia` never settles. `startCapture` never returns, the session stays in "starting", and every later Start says a meeting is already starting until the app restarts.
- The hang was reproduced on Electron 44 on the Mac with the handler forced on. The Mac never reaches this code in normal use.
- `{ useSystemPicker: true }` only does anything on macOS 15+ and is ignored on Windows.
- Upstream has fixes in PRs #431, #298 and #279. None are merged. Fix: F4.

B3. Windows loopback records only the default playback device. Possible.

- Chromium's Windows `loopback` capture uses the default console render endpoint. If Zoom, Teams or a Bluetooth headset in hands-free mode plays through another device, Gemini hears silence and no error appears.
- This matches upstream #161 (no audio on three Windows PCs).
- Workaround: set the meeting app's speaker to the Windows default output device. Code idea: warn when several seconds of frames are all zero.

B4. Turn ending only works on Mac. Possible, unverified.

- `src/utils/liveAudioGapFiller.js:1-3` says Gemini 3.8 Live only closes a turn while trailing audio keeps arriving, ignores `audioStreamEnd`, and that digital zeros are avoided on purpose.
- Commit `9043400` removed the old `audioStreamEnd` signal, which ran on all platforms, and added the gap filler. The filler only starts in the Mac path (`gemini.js:1480`).
- On Windows the AudioWorklet keeps sending a frame every 40 ms, and silence arrives as exact zeros (confirmed in the harness). If Gemini does not close a turn on zeros, Windows transcribes the question but never answers.
- Since 2026-10-07, answers are triggered by Live's input transcription, not by Live finishing its own reply, which lowers this risk. Input transcription still waits for Live to detect the end of speech, so the risk is not gone.
- Fix: F5. Apply it only after confirming the symptom (runbook 5.6).

B5. Audio failures are hidden.

- If loopback capture fails, `startCapture` still returns success and only sets the status "Audio unavailable — text and Analyze Screen still work" (`renderer.js:734-737`). The meeting looks active but can never answer.
- Fix: F6.

### 4.5 Smaller Windows issues

- Local mode can crash on Windows. Whisper uses `device: 'auto'` (`src/utils/localai.js:184`), which tries DirectML (upstream #239, #421, #373; PRs #298, #315, #434). Fix: F7.
- A single tap of Alt hides the overlay (`overlayVisibility.js:23-25`). The hidden window is not on the taskbar, so it can look like the app vanished. `Ctrl+\` and the tray "Show" item bring it back.
- The default Windows shortcuts take Ctrl+Arrows, Ctrl+M, Ctrl+Enter, Ctrl+[, Ctrl+], Ctrl+Shift+Up/Down and Ctrl+Shift+E in every app (`window.js:249-264`). `globalShortcut.register` return values are ignored, so a shortcut that another app already owns fails silently.
- The 1 fps desktop video track from `getDisplayMedia` stays alive for the whole meeting, although nothing uses it (`renderer.js:635`). Stopping the video tracks after the stream opens keeps audio working (tested on Electron 44).
- In "Both Speaker and Microphone" mode the worklet averages the two sources, which halves each level (`src/audio-worklet.js:15-16`).
- The main-process WebSockets ignore the Windows system proxy. On a corporate network that requires a proxy, the Live socket cannot open.
- IPC handlers are registered after the tray and diagnostics start (`src/index.js:113-118`). If either throws, the window loads but every IPC call fails.
- All platforms: `gemma-3-27b-it` is retired (upstream `998a056` renamed it to `gemma-4-26b-a4b-it`). It is still used at `gemini.js:871,892` and `src/storage.js:40,315,335`, only in the non-Live Gemma fallback. Fix: F8.

### 4.6 Checked and fine (do not re-investigate)

- `npm ci` works without GitHub SSH keys and without git. npm fetches the `git+ssh` `@electron/node-gyp` lockfile entry over HTTPS.
- npm 11's "install scripts not yet covered by allowScripts" message is only a warning. The scripts still run.
- Windows prebuilt binaries exist for `uiohook-napi` (win32-x64 and win32-arm64), `onnxruntime-node` and sharp (`@img/sharp-win32-x64`).
- Window creation on Windows (opaque window, `show: true`, skipTaskbar, screen-saver level), the tray `.ico`, the settings path and history file names are fine.
- `pkill` and SystemAudioDump only run on macOS.
- The four earlier Windows fixes (`1a26363`, `79d63b2`, `133406a`, `309fadf`) are intact on master. The renderer `require()` paths resolve.
- The Windows audio IPC contract matches. In the forced harness the main process accepted 144 of 144 frames at 16 kHz.
- All 66 unit tests pass on macOS (`npm test`).

### 4.7 Upstream comparison

| Upstream commit              | What it does                                                                                         | Matters here                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `cdedc66` cleanup            | Default provider `byok`, converts `cloud` to `byok`, window size changes                             | Yes, cause B1                                                    |
| `998a056` (#385)             | `gemma-3-27b-it` to `gemma-4-26b-a4b-it`, Live model to `gemini-3.1-flash-live-preview`              | Only the Gemma name is stale here (F8). This repo uses 3.8 Live. |
| `c85ff3e` uwu                | BYOK models configurable in `config.json`, transport event logger                                    | No                                                               |
| `800df4d` yay                | Native llama.cpp/whisper.cpp runtime replaces Ollama and transformers.js; removes those dependencies | Local mode only (F7)                                             |
| `23c8a84` cleanup            | UI cleanup                                                                                           | No                                                               |
| `452cf2d`                    | Version 0.8.0                                                                                        | No                                                               |
| `3cccc36` fix: refine window | Window behaviour tweak                                                                               | No net change on Windows                                         |

The fork's own big changes: Electron 30 to 44.3.0 (A2), `uiohook-napi` (A1), the opaque Windows window, Alt hide, the tray, the AudioWorklet audio path, Gemini 3.8 Live, code cards and the Mac-only gap filler (B4). This repo has every merged upstream PR except #385.

Upstream Windows issue patterns:

| Pattern                                         | Issues                       | Known fix                                     | Here                               |
| ----------------------------------------------- | ---------------------------- | --------------------------------------------- | ---------------------------------- |
| No system audio                                 | #161, #117, #126, #207, #462 | PR #186 (not merged), use the default speaker | Partly                             |
| Screen capture fails, Start or screenshots hang | #198, #172, #177, #366       | PRs #298, #431, #279 (not merged)             | No (F4)                            |
| Setup.exe install fails                         | #206, #383, #422, #165       | None documented                               | Source runs have A1 and A2 instead |
| Local AI crash                                  | #239, #421, #373             | PRs #434, #315 (not merged)                   | No (F7)                            |
| Taskbar and stealth                             | #204, #223, #217             | skipTaskbar                                   | Taskbar fixed                      |

## 5. Windows runbook: diagnose live

Run everything in PowerShell from the repo folder. Keep the terminal output, because main-process logs only appear there.

### 5.1 Check prerequisites

```powershell
node -v          # must be v22.12.0 or newer (cause A2). Node 24 LTS is recommended.
npm -v
git --version
python --version # only needed if native modules get compiled (cause A1)
# Visual Studio C++ tools: 16.x = VS 2019, 17.x = VS 2022, 18.x = VS 2026 (not supported by the bundled node-gyp)
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion
# Smart App Control: 0 = off, 1 = on, 2 = evaluation (cause A3). A missing value means it is not present.
Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy -Name VerifiedAndReputablePolicyState
```

### 5.2 Install and start

```powershell
git clone https://github.com/raghav-rathi/PersonalizedNotetaker.git
cd PersonalizedNotetaker
npm ci
npm start 2>&1 | Tee-Object -FilePath start.log
```

| What you see                                                              | Cause                  | Next                                                                                      |
| ------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| Stops at "Preparing native dependencies" with gyp or Visual Studio errors | A1                     | Apply F1, run `npm start` again                                                           |
| "Electron failed to install correctly" or `ERR_REQUIRE_ESM`               | A2 (or A3 on new Node) | Install Node 22.12 or newer, delete `node_modules\electron`, run `npm ci` again, apply F2 |
| The Electron zip downloads but never extracts                             | A3                     | Manual unzip (4.3, A3)                                                                    |
| A window opens                                                            | Stage A is fine        | Go to 5.3                                                                                 |

Quick A1 check without changing code: `npx electron .` starts the app without Forge's rebuild step. If that opens the app and `npm start` does not, A1 is confirmed.

### 5.3 First run in the app

1. On the start screen, check the title. "Cheating Daddy Cloud" means cause B1. Click "Use your API keys".
2. Paste the Gemini API key.
3. Open AI Context, then Custom Instructions, and paste `docs/prompts/interview-prompt.txt`.
4. Leave Settings, Audio Mode on "Speaker Only (Interviewer)".
5. Press the Start button or Ctrl+Enter.

### 5.4 After pressing Start

| What you see                                                                   | Cause                        | Next                                                    |
| ------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------- |
| Stays on the start screen, and pressing Start again says a meeting is starting | B2                           | Apply F4                                                |
| Status "Audio unavailable — text and Analyze Screen still work"                | Loopback failed (B2, B3, B5) | Read the warning in the status bar, open DevTools (5.5) |
| "Listening", but nothing happens when audio plays                              | B3 or B4                     | Go to 5.6                                               |
| Answers appear                                                                 | Audio path works             | Test Analyze Screen, typed questions, hide and show     |

### 5.5 Renderer logs (DevTools)

The app has no DevTools shortcut. For a debug run, temporarily add this line after `mainWindow.loadFile(...)` in `src/utils/window.js`. Do not commit it.

```js
mainWindow.webContents.openDevTools({ mode: 'detach' });
```

Another option: start with `npx electron . --remote-debugging-port=9222` and open `edge://inspect` in Edge.

### 5.6 Audio device (B3) or turn ending (B4)?

1. In Windows Settings, System, Sound, note the default output device. Set Zoom, Teams or the browser to play through it. Avoid Bluetooth hands-free.
2. Play a recorded interview question, for example a YouTube video, through those speakers.
3. To see what reaches Gemini, temporarily add logs. Do not commit them.
    - In `ingestLiveInputTranscription` (`gemini.js:123`): `console.log('[live input]', incoming);`
    - In `routeAudioFrame` (`gemini.js:1755`): count frames whose samples are all zero, and log the count every 100 frames.
4. Read the result:
    - Every frame is zero while audio plays: B3. Fix the device routing.
    - Input transcription appears, but no answer and no "Saved conversation turn" line: B4. Apply F5.
    - No transcription and no non-zero frames: capture failed (B2 or B5). Check the DevTools console.

On the Mac, every turn logs "Gemini Live answer stalled without turnComplete; finishing the turn". That is normal with `gemini-3.8-live`. The watchdog closes the turn 3 s after the last answer text.

## 6. Fixes (apply after confirming the cause)

F1 (A1). Stop Forge from compiling `uiohook-napi`. In `forge.config.js`:

```js
    // uiohook-napi ships N-API prebuilds (prebuilds/win32-x64/uiohook-napi.node) that load in Electron 44.
    // @electron/rebuild 3.7.2 does not recognise that file name and would compile it, which needs MSVC and Python.
    rebuildConfig: { ignoreModules: ['uiohook-napi'] },
```

Upstream PR #474 uses `rebuildConfig: { onlyModules: [] }` and was tested in a packaged Windows x64 app. Either works. If a failed compile left a `node_modules\uiohook-napi\build` folder, delete it, because node-gyp-build prefers `build\Release` over the prebuilds. Verify: `npm start` no longer compiles anything, the log has no "uiohook-napi unavailable; Option tap hide is disabled" warning, and a single Alt tap hides the window.

F2 (A2). Enforce Node 22.12 or newer. Add `"engines": { "node": ">=22.12.0" }` to `package.json` and a `.npmrc` containing `engine-strict=true`, and mention it in the README. npm then fails early with a clear message, not later at `npm start`.

F3 (B1). Default to BYOK, as upstream `cdedc66` does. Add `providerMode: 'byok',` to `DEFAULT_PREFERENCES` in `src/storage.js`. `getPreferences()` merges the defaults (`src/storage.js:254-257`). Also change the three `|| 'cloud'` fallbacks (`CheatingDaddyApp.js:748`, `MainView.js:541`, `renderer.js:697`) to `|| 'byok'`.

F4 (B2). Make the capture handler always answer. In `src/utils/window.js`:

```js
session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
        desktopCapturer
            .getSources({ types: ['screen'] })
            .then(sources => {
                if (!sources.length) throw new Error('No screen source available');
                callback({ video: sources[0], audio: 'loopback' });
            })
            .catch(error => {
                console.error('Display media request failed:', error);
                try {
                    callback({});
                } catch {}
            });
    },
    { useSystemPicker: process.platform === 'darwin' }
);
```

`callback({})` makes the renderer's `getDisplayMedia` reject with `AbortError`, and the next request works. It can also throw in the main process, which is why it is wrapped. Also add a timeout to `getLoopbackStream` (`renderer.js:633`), so a hung request turns into "Audio unavailable":

```js
async function getLoopbackStream(sampleRate, timeoutMs = 8000) {
    const request = navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { sampleRate, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            request.then(stopStream).catch(() => {});
            reject(new Error('System audio capture timed out'));
        }, timeoutMs);
    });
    try {
        return await Promise.race([request, timeout]);
    } finally {
        clearTimeout(timer);
    }
}
```

F5 (B4, only if confirmed). Make turn ending work on every platform.

1. Start the filler when a BYOK Live session starts. In the `initialize-gemini` handler (`gemini.js:1797`), after `geminiSessionRef.current = session;`, add `liveGapFiller.start();`. `close-session` already stops it through `stopMacOSAudioCapture()`, which has no platform check.
2. In `routeAudioFrame` (`gemini.js:1755`), do not forward frames that are exact digital silence. The filler then sees a gap and sends its noise floor.

```js
function isDigitalSilence(pcm) {
    for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
        if (pcm.readInt16LE(offset) !== 0) return false;
    }
    return true;
}
// In routeAudioFrame, before enqueueLivePcm:
//     if (isDigitalSilence(pcmBuffer)) return { success: true, provider: 'gemini', skipped: 'silence' };
```

Verify: play a question through the default speakers, an answer arrives, and `audioGapsFilled` rises in the diagnostics file.

F6 (B5). Make audio failures visible. When `startCapture` ends with no `system` input in `speaker_only` mode, show a persistent error card with the warning text (the DOMException name and message), not only the status line. Log it too.

F7. Local mode on Windows: `device: process.platform === 'win32' ? 'cpu' : 'auto'` in `src/utils/localai.js:184`.

F8. Replace `gemma-3-27b-it` with `gemma-4-26b-a4b-it` in `src/utils/gemini.js` (lines 871 and 892) and `src/storage.js` (lines 40, 315 and 335).

Optional: stop the unused video track right after `getLoopbackStream` resolves: `mediaStream.getVideoTracks().forEach(track => track.stop())`.

After any fix, run `npm test`, then repeat the matching runbook step on Windows.

## 7. Changes in this handover, and why

Commits on top of Rohit's `8c49d85`:

1. `e310efb feat: let custom instructions set interview answer length` (`README.md`, `src/utils/prompts.js`, `src/utils/geminiLiveSessionConfig.js`). These edits were already uncommitted in the Mac working copy before the Windows investigation. They were committed unchanged.
    - What: the Job Interview profile no longer forces answers of 1 to 3 sentences and follows the length in Custom Instructions. The code-card instruction no longer tells Gemini to keep the spoken answer to "two or three short sentences". The README explains how to ask for long answers.
    - Why: the owner wants long spoken answers, about 6 to 7 minutes for behavioral questions.
2. `6cab7a2 docs: add long-answer ASD-STE100 interview prompt` (`docs/prompts/interview-prompt-ste100.txt`, 1,207 words). Replaced on 2026-10-07 by change 5.
    - What: the owner's custom instructions. They ask for long answers (13 to 14 paragraphs for behavioral questions), ASD-STE100 Simplified Technical English, a six-part story structure and truth rules, and they map the owner's resume stories to common behavioral questions.
    - Why: answers were too short. The previous 67,792-word custom prompt told the model to use 180 to 350 words, and its appendix said 60 to 120 seconds. It was also too large for the live model to follow.
    - Results on the Mac: with earlier, longer versions of this prompt, direct Gemini Live tests gave behavioral answers of 377, 716, 889, 685 and 511 words. They did not reliably reach 900 words, and some included details that are not in the owner's record. In a real session with this final version, technical questions got answers of 90 to 150 words, because its length rules only cover behavioral questions. The STE rules are only partly followed.
    - The app stores it in `preferences.json` (`customPrompt`). Paste it into AI Context, Custom Instructions on each new machine.
3. `134f5ff docs: add raw Windows investigation reports` (`docs/windows-investigation/*.json`).
4. `docs: rewrite AGENTS.md as Windows handover` (this file). The previous AGENTS.md said there were no automated tests and presented React, shadcn and TypeScript rules as current. Both were out of date. Its long-term plans are kept in section 10.
5. 2026-10-07 `feat: answer every question with gemini-3.8-flash` and `docs: replace interview prompt with a long, natural-voice version`.
    - What: in BYOK mode every question goes to `gemini-3.8-flash` (section 3.2). The old code-only card, the typed-question queue (`boundedTurnQueue.js`), the "no answer for a typed turn" timer and the `needsCodeAnswer` heuristic were removed, because every question now gets a text answer. Typed questions go straight to the text model. `docs/prompts/interview-prompt.txt` (3,434 words) replaces the STE prompt.
    - Why: the owner wants two to three minutes of natural, human-sounding speech for every question. Live's spoken answers were 114 to 367 words and sounded scripted.
    - Prompt rules: 400 to 450 words for every real question (never under 370), contractions and plain speech, no bullet lists, banned resume and AI phrases, stories told only from listed facts with "Not in my facts" notes per story, a present-tense "how I usually work" pattern for missing details, no invented disagreement or mistake stories, placeholders for "why are you leaving" and strengths and weaknesses, and the owner's coding mode (SAY / CODE / LINE COACH / COMPLEXITY).
    - Tests on the Mac: a 13-question prompt battery gave 367 to 537 words for every real question, with no bullet lists or dashes. In the real app, spoken and typed questions got 391 to 534-word answers, and the first text showed 2.4 to 4 s after the question ended. A question spoken in two parts with a 2.5 s pause was merged into one 399-word answer in one card. "Can you hear me?" got one short sentence. Remaining issue: the model still sometimes adds details that are not in the owner's facts, so answers must be read before they are spoken.

6. 2026-10-07 `fix: make interview answers sound like spoken English`.
    - What: rewrote `docs/prompts/interview-prompt.txt` (4,627 words) and the Job Interview profile text in `src/utils/prompts.js`. The profile text now only says to write what the user says out loud and to follow the custom instructions. The old profile text asked for complete, technically grounded answers covering mechanism, data flow, tradeoffs and validation, and to use the candidate's experience. That pushed answers toward essays and resume mentions.
    - Why: the owner said answers still sounded machine-generated, not like a mid-level engineer speaking, and that the resume should come up only when necessary.
    - Prompt rules: five rules at the top (short sentences, contractions, plain words, resume only when the question is about me, 430 to 480 words). A "how I talk" section with plain-word replacements, a bad and a good answer to the same Terraform question, a DaemonSet example, and voice examples for experience, "why are you leaving" and coding answers. A section on when to bring up my background. No lists of three, no essay transitions, and no lessons or habits that aren't in the facts.
    - Tests on the Mac, same 12 questions, old prompt versus new: average sentence length 22.3 to 13.8 words, sentences over 20 words 57% to 14%, Flesch-Kincaid grade 12.2 to 6.6, resume mentioned in 5 of 6 general questions to 0 of 6, average length 401 to 422 words. A blind comparison by a separate model preferred the new answers in 20 of 20 pairs. In the real app, the spoken Terraform question got a 448-word answer with no resume mention, and "Have you worked with HPC or GPUs?" got a 350-word answer built on the listed facts.
    - Remaining issues: "why are you leaving" answers run shorter (323 to 349 words) because the reasons aren't filled in yet. The model still sometimes adds a small detail that isn't in the facts, or a technical claim that's slightly off.

7. 2026-10-07 `docs: fit interview answer length to the question`.
    - What: `docs/prompts/interview-prompt.txt` (about 8,500 words) now sets the answer length by question type instead of two to three minutes for everything. It adds practiced answers for seven likely questions (Terraform vs Python, HPC and GPU experience, why Kubernetes alone falls short for training, gang scheduling, DaemonSet, an on-call story, tell me about yourself), more "Not in my facts" lines, banned endings and openers, and corrections for technical details that came out wrong in testing.
    - Why: the owner said a 400-word answer to "what does a DaemonSet do?" sounds generated. A first version with short answers (about 20 words to name something, 65 for a definition, 140 for a why question) was then too short, so the lengths were set in between.
    - Length policy (about 150 words per minute): naming something 40 to 80 words, definition 100 to 160, why, how and experience 200 to 260, follow-up 60 to 130, story 300 to 380, tell me about yourself 230 to 300, small talk one sentence.
    - How it was tuned: agents wrote 30 realistic, messy test questions (16 for tuning, 14 held back for the final check), a simulated interviewer and a web research agent proposed lengths, and three review rounds by simulated interviewers (a staff SRE, a manager who looks for read answers, an interview coach) scored every answer and proposed prompt changes.
    - Results with the final prompt, two samples each: median words were 62 to name something, 166 for definitions, 190 for why questions, 146 for experience questions, 92 for follow-ups and 220 for stories. Answers about general topics never mentioned the owner's background (0 of 44). In the last review round, 9% of tuning answers and 14% of held-back answers were flagged for an invented detail, down from 25% in the first round. In the real app, the five likely questions and two quick questions spoken back to back with simulated reading time gave seven separate cards, with first text 3.7 to 5.5 s after the question ended. The 12 s question-merge window did not join any of them.
    - Remaining issues: experience questions with few listed facts get 80 to 160 words, some definitions reach about 190 words, longer answers still contain a list of three about 40% of the time, and follow-ups about the owner's own work sometimes add a reason or setting that isn't in his facts.

8. 2026-10-07 `feat: answer with GPT-6 Astra through OpenRouter`.
    - What: when an OpenRouter key is saved (new field on the main screen, stored as `openrouterKey`), `sendTextAnswer` streams the answer from `openai/gpt-6-astra` at low reasoning effort through OpenRouter's chat completions API (`src/utils/answerModel.js`). Gemini Live still listens. If OpenRouter fails or shows no text within 8 s, `gemini-3.8-flash` answers instead; if both fail, Live's spoken answer is shown as before. A request whose answer was replaced by a newer question is cancelled, so it stops being billed. The main screen's unused OpenAI key field was replaced by the OpenRouter field.
    - Why: the owner said the answers themselves were not good enough. Thinking longer did not help Gemini: on 12 interview questions, a blind grader scored `gemini-3.8-flash` at LOW and MEDIUM, `gemini-3.7-flash` and `gemini-3.1-pro-preview` about the same, and the slower ones took 19 to 66 s to start.
    - Model choice: the same 12 questions with the real prompt, graded blind by three judges from different companies (Claude Opus 5.5, GPT-6.1 Sol, Gemini 3.8 Flash). Each candidate was compared with the current model in both orders. GPT-6 Astra was preferred in 83% of comparisons (every judge, including Gemini's), GPT-6.1 Sol in 72% and Claude Sonnet 5.5 in 62%, while GPT-6 Luna lost every comparison. Through OpenRouter, Astra's first text took 1.7 s (median) and 2.6 s (p90), against 3.1 s and 5.7 s for Gemini Flash that day.
    - Cost: each Astra answer cost $0.025 to $0.041 in the real app. A 1.5-hour interview is about $3 of answers plus about $2 of Gemini Live listening (measured at 2 to 4 cents per interviewer turn, because Live re-bills the 12,600-token prompt every turn and speaks a hidden 30 s reply).
    - Tests: 10 new unit tests in `answerModel.test.js` (stream parsing across chunk boundaries, cost reporting, a failure mid-stream, a rejected key, screenshot attachment, the fallback cases, the first-text timeout and cancellation). In the real app, five spoken interview questions, one more spoken question and one typed question were all answered by Astra, one card each, with first text 2.7 to 6.0 s after the question ended. With an invalid OpenRouter key, Gemini answered both test questions and the log recorded the 401.

9. 2026-10-07 `docs: shorten interview answers by about a fifth`.
    - What: the length targets in `docs/prompts/interview-prompt.txt` went down about 25% (naming something 30 to 60 words, definition 80 to 120, why/how and experience 150 to 200, scenario 170 to 230, story 200 to 280, tell me about yourself 160 to 220), and the practiced answers were trimmed to match.
    - Why: the owner asked for slightly shorter answers.
    - Tests: the same 14 interview questions answered by GPT-6 Astra before and after. Total length went from 3,048 to 2,417 words (21% shorter), and 13 of 14 answers landed inside their new range.

10. 2026-10-07 `docs: add the deeper-answer prompt draft`.
    - What: `docs/prompts/interview-prompt-deeper-draft.txt`, a prompt written from scratch around what interviewers reward (answer first, the mechanism underneath with real component names, one concrete scenario, the tradeoff), combined with the current voice rules, background facts and practiced answers. It is not installed.
    - Results: 14 questions answered by GPT-6 Astra with the current prompt and with this draft, compared blind in both orders by Claude Opus 5.5. The draft gave the stronger interview answer in 17 of 28 comparisons, but sounded more like a real person in only 6 of 28. Its length targets and practiced answers predate change 9, so they need shortening before use.

11. 2026-10-09 `feat: add a follow-up screen, a DSA coding mode and an answer model switch`.
    - Two answer screens (`answerLanes.js`, `CheatingDaddyApp.js`, `AssistantView.js`). Every text answer starts with `LANE: MAIN`, `LANE: SIDE` or `LANE: NONE`, which the app strips. Main answers and coding steps go to the main screen. Follow-up questions get short answers on a second screen, and the overlay jumps there; Cmd+Option+Left and Cmd+Option+Right (Alt+Shift+Left/Right on Windows) switch screens. Each screen keeps its focused card and scroll position. A NONE reply is cancelled as soon as its first line arrives, and "okay", "mm-hmm" and similar never reach a model (`isBackchannel`). A new main answer cancels the main and follow-up answers still streaming; a follow-up cancels only an older follow-up.
    - Question merge: speech joins the previous question only while its answer is empty or under 5 s old (`isReplaceableAnswer`), so the card being read is never rewritten. A merged question picks its screen again.
    - Coding mode (`codingSession.js`; `src/prompts/dsa-coding-skill.md` is the app's version of the owner's DSA skill, and his original file stays unchanged outside the repo). Cmd+Option+1 takes a screenshot and starts Part 1. Cmd+Option+2 to 6 are Part 2, start coding, next step, full code and dry run, and Cmd+Option+9 or typing `exit` leaves. Typing `new problem` with pasted text also starts it. Interviewer speech goes in as `they said:`, hotkeys and typing as `command:`, and Analyze Screen as `screen:` with the screenshot. Each problem is one conversation, sent in full every turn so the prompt cache keeps hitting. A follow-up that changes printed code adds an `UPDATE:` part, shown on the main screen as a "Changed after ..." card without moving the user's place. Live's spoken fallback is off in coding mode.
    - Answer model switch on the start screen (`ANSWER_MODELS` in `answerModel.js`, saved as `answerModel` in `preferences.json`, read when a session starts). Each model goes to its maker's servers first (`provider.order`), and the system prompt is a cache breakpoint; for Opus the newest coding turn is one too, because Anthropic only caches up to a marked block.
    - Display: SAY, SPEAK and WRITE labels are hidden, and LISTEN, ACTION, CODE, LINE COACH and COMPLEXITY become small labels (`formatAnswerForDisplay`). Cards are labelled with the question that produced them.
    - Why: the owner reads answers aloud while he types in the interview editor, so an interruption must not replace the answer he is reading. He used to run the coding skill by hand in ChatGPT.
    - Tests: 91 unit tests. In the real app with GPT-6.1 Sol, a main question went to the main screen, a follow-up jumped to the follow-up screen, Cmd+Option+Left returned to the same card, "Okay, makes sense" produced nothing, and a new topic went back to the main screen. The coding round has not been completed in the real app: the test screenshot showed another window, so the model asked for the problem. In a direct comparison with the app's prompts (16 interview answers and 7 coding steps per model), Astra showed its first text after a median 1.4 s (p90 2.8 s) at 2.4 cents per answer, and Opus at medium effort after a median 5.2 s (p90 13.8 s, slowest 20.7 s) at 1.5 cents. Opus put 2 of 23 replies on the wrong screen and wrote longer follow-up answers.
    - Known risks: while the app runs, Cmd+Enter in any app triggers Analyze Screen, and a test capture sent a LinkedIn page that way. Cmd+Shift+E (Emergency Erase) is also VS Code's Show Explorer. The Windows keys are untested.

12. 2026-10-09 `feat: add type-along for coding steps`.
    - What: in coding mode, the focused card on the main screen is split into the lines inside its fenced blocks, code and pads (`typeAlong.js`). A strip under the answers shows the current line large, with the line before and after it. Each plain Enter pressed in any app moves it one line on: `optionTapMonitor.js` passes Enter from the existing `uiohook-napi` key hook, but only while the overlay reports the strip as showing (`type-along-active` IPC). Cmd+Option+Up/Down (Alt+Shift+Up/Down) step back and forward. Each card keeps its own line, so a follow-up question or going back to an older card doesn't lose the place. A new answer now also stays pinned to the top of the view while it streams in. Before, it was revealed once while still too short to scroll there, so it stayed at the bottom.
    - Why: the owner reads code off the overlay while typing it in the interview editor. One line at a time, with its reason, keeps his eyes in one place, lets him explain each line as he types it, like someone coding for real, and needs no key press beyond Enter.
    - Tests: 94 unit tests. In the real app with GPT-6 Astra and TextEdit standing in for the editor (the problem shown in TextEdit, Cmd+Option+1 for a new problem, then Part 2, start coding and next step, with each line typed by System Events): every Enter moved the strip one line; Cmd+Option+Down and Up moved it as expected. A spoken counter-question switched to the follow-up screen and hid the strip, and Cmd+Option+Left brought it back on the same line. Typing all 10 lines of hop 1 showed "all 10 lines typed", and the next step started again at line 1. No Enter reached the app before coding mode or after exit. Every new card started at the top of the view. Five Astra answers cost $0.16.
    - Limits: an Enter that doesn't add a line (accepting an autocomplete suggestion, for example) also moves the strip, and Cmd+Option+Up puts it back. Without the macOS Accessibility permission or `uiohook-napi`, only the Cmd+Option+Up/Down keys move it.
    - Removed on 2026-10-16 by change 13: the strip took space the owner wanted for the answer.

13. 2026-10-16 `feat: add LLD and HLD rounds, split code cards and more answer models`.
    - Round profiles. AI Customization lists **Coding Round (DSA)**, **LLD Interview** and **HLD / System Design**. The profile picks the prompt that runs the Cmd+Option+1 to 6 steps (`loadCodingSkill(profile)` in `codingSession.js`). Other profiles keep the DSA prompt. New `src/prompts/lld-skill.md` (use cases, objects and one flow, code one class per hop) and `src/prompts/hld-skill.md` (requirements and scale, box diagram and one request, deep dives). Coding mode still starts only from the hotkey.
    - Editable prompts. **Edit round prompt** in AI Customization copies the built-in prompt into the settings folder on first use (`ensureUserSkillFile`) and opens it (`open-round-prompt` IPC). The file is read on every turn, so edits apply from the next reply, also in the packaged app. The owner's Mac has `dsa-coding-skill.md` there as a symlink to the repo file, so repo edits apply live.
    - Split cards. A card with code shows the explanation and `trace` walkthroughs on the left and every other fenced block on the right, each column scrolling on its own (`splitCodeColumn` in `answerFormatting.js`, `_setCardBody` in `AssistantView.js`). Same on both screens. The overlay widens from 850 to 1100 px while coding mode is on (`coding-layout` IPC in `window.js`).
    - Prompt shape (all three round prompts). A main step starts with "I can relate this to <approach>, because ..." only when a well-known approach (DSA), pattern (LLD) or architecture (HLD) fits. Part 1 and Part 2 give complete Java, not pseudocode pads. Walkthroughs go in a `trace` block. A follow-up starts with one sentence that can be said as is, then the simple explanation; the "They asked" header is gone. The TEACH lesson cards on the follow-up screen are gone (`splitMainLesson` removed), because the left column now explains the step. Normal-mode follow-ups get the same first-sentence rule (`LANE_INSTRUCTION`).
    - Type-along removed: the strip, the Enter forwarding in `optionTapMonitor.js`, the `type-along-*` IPC and the Cmd+Option+Up/Down keys. A stored keybind for them is ignored.
    - Answer models. Added Claude Sonnet 5.5, DeepSeek V4.1 Flash (DeepSeek V4 Pro can't read screenshots) and Claude Haiku 5.5 (the "cheapest, for testing" label moved from Sol to Haiku). Prices on 2026-10-16 per million tokens in/out: Haiku $0.10/$0.50, DeepSeek Flash $0.04/$0.68, Sonnet $2/$10, Astra $10/$50. The Gemini fallback is unchanged.
    - Tests: 95 unit tests. Direct calls with the real prompts: Haiku on DSA Part 1 started in 1.6 s and cost $0.0012; Sonnet and Haiku follow-ups took 6 to 10 s to start; DeepSeek Flash started in 4 s but took 17 to 68 s to finish; Haiku gave correct LLD and HLD Part 1 shapes. In the real app (Playwright, Coding profile, Haiku): a typed BST problem asking for the optimal answer gave Part 2 with "I can relate this to BST in-order traversal", the explanation and trace on the left and Java on the right; start coding gave a split hop; a typed follow-up opened with a direct answer; the window went 850 to 1100 to 850; first text 2.8 to 11.9 s (the screenshot turn was slowest).
    - Not tested: the LLD and HLD rounds in the real app, spoken questions in a round, and Windows.

14. 2026-10-16 `feat: let the overlay take less screen`.
    - Resizing. The live overlay has invisible handles on its left, right and bottom edges and both bottom corners (`CheatingDaddyApp.js`, `_startResize`). They send screen-coordinate deltas over `overlay-resize-*` IPC, and `window.js` applies `resizeBounds` (`windowBounds.js`) clamped to the work area, at least 320×240. The window stays `resizable: false`, because Electron doesn't promise edge resizing for the transparent macOS panel. The size and place are saved per mode in `preferences.json` as `overlayBounds: {live, coding}` after a resize or a move (`moved` event, debounced), and `view-changed` / `coding-layout` restore them. With nothing saved, live is 850×400 at the top centre and coding is 1100 wide.
    - Layout. Below 760 px a split card stacks, explanation above code; below 600 px the live bar drops the status and the clock. Code in the code column is 0.75em and doesn't wrap.
    - Typing. The message box is hidden in every profile until a printable key or Cmd/Ctrl+V reaches the overlay; that key lands in the box (`_openInputOnType` in `AssistantView.js`). Enter sends and closes it, Escape or leaving it empty closes it. Analyze Screen is a 40 px round button that always floats at the bottom right; its waveform animation already handles a circle.
    - Why: the owner needs to see the problem and the editor while the overlay is up.
    - Tests: 97 unit tests (`resizeBounds`). In the real app (Playwright, Coding profile, Haiku): the right-edge drag took live from 850 to 700 and coding from 1100 to 680, a bottom-left drag moved x by 60 and added 80 px of height, exit and re-entry restored each mode's own bounds, a restart restored the live bounds, typing "h" "i" opened the box holding "hi" and Escape closed it, a typed "new problem ..." plus Enter started coding mode, the 680 px card stacked, and clicking the round button produced an answer. The handles weren't tried with a real mouse.

Not in git (Mac only): the owner's `preferences.json` and API keys, backups of older prompts (`preferences.backup-before-ste-prompt.json`, `preferences.backup-before-humanistic-prompt.json`), and the downloaded Electron binary.

No app code was changed to fix Windows. Change 5 changes how answers are written on every platform, not a Windows fix. The exact Windows symptom is unknown, and none of these fixes can be tested on a Mac. The plan is to confirm the cause on the Windows PC first, then apply only the fixes it needs.

## 8. Commands, tests and conventions

- Install: `npm ci`. Run: `npm start`. Package: `npm run package`. Installer: `npm run make` (the Squirrel Setup.exe must be built on Windows).
- Unit tests: `npm test` (`node --test src/**/*.test.js`). 97 tests, all passing on macOS on 2026-10-16. Node 22+ expands the glob itself, so it also works from cmd and PowerShell.
- Electron smoke tests: `npm run test:electron` and `npm run test:windows` (Playwright `_electron`; they launch the app from source and check that the window renders and can hide and restore; the Windows one is skipped elsewhere). Neither has run on Windows yet.
- Type check: `npm run typecheck` (`tsc -p jsconfig.performance.json`).
- Format only the files you change: `npx prettier --write <files>`. Settings are in `.prettierrc`: 4-space indent, print width 150, semicolons, single quotes. `src/assets` and `node_modules` are ignored.
- Commit messages: short, with `feat:`, `fix:`, `docs:`, `perf:` or `chore:`.
- Never commit `%APPDATA%\cheating-daddy-config`, `credentials.json`, API keys, `node_modules`, `out/` or temporary debug edits such as DevTools lines and extra logs. The repository is private now, but it was public until 2026-10-09.
- Upstream changes: cherry-pick from sohzm/cheating-daddy, inspect the diff, keep messages short, then run the app.

macOS notes:

- System audio needs Screen & System Audio Recording permission for the app that launches it, for example the terminal or editor. Without it, `src/assets/SystemAudioDump` exits with code 1 and the app keeps showing "Listening".
- If `npm start` reports that Electron is missing, run `node node_modules/electron/install.js` with Node 22.12 or newer.
- Packaged app (`/Applications/Personalized Notetaker.app`): build with Node 24 (`PATH=/usr/local/bin:$PATH npm run package`). On Node 26.7 the package step exits 0 without an app while unzipping Electron. The `postPackage` hook in `forge.config.js` signs the bundle ad-hoc as `com.personalized.notetaker`, because `osxSign` with identity `-` silently skipped signing. Each rebuild changes the signature, so old permission switches stay "on" but no longer apply: quit the app, run `tccutil reset All com.personalized.notetaker`, install the new build, and grant Accessibility and Screen & System Audio Recording again.
- A terminal run borrows the terminal's permissions; the packaged app has its own. The Option hook now starts as soon as Accessibility is granted, and `Cmd+\` always toggles the overlay.
- The packaged app writes its main-process log to `~/Library/Logs/Personalized Notetaker/main.log` (reset at each launch). `[answer]` lines give first-text and done times.

## 9. Security and privacy notes

- The renderer runs with `nodeIntegration: true` and `contextIsolation: false`. AI answers are rendered as unsanitised HTML (`AssistantView.js`, marked with `sanitize: false`). Text on screen or in audio could inject HTML that runs with Node access. Do not widen this. Fixing it is planned work.
- `credentials.json` stores API keys in plain text.
- The Live session is told to answer everything it hears (`LIVE_ALWAYS_RESPOND_INSTRUCTION` in `geminiLiveSessionConfig.js`), so side conversations also get answers.

## 10. Long-term plans (not started)

These come from the previous AGENTS.md and still apply to future work:

- Local transcription with whisper.cpp (resample to 16 kHz first), dual-stream microphone and system audio capture, tinydiarize speaker labels (`[SPEAKER_TURN]`), voice activity detection, and local note storage linked to meetings.
- Privacy by design: process locally where possible, let users delete their data, document what is stored, and store only what is needed.
- A UI rebuild with shadcn/ui and React 19, TypeScript strict mode for new files, and Jest with React Testing Library. None of this exists yet. The current code is plain JavaScript with Lit.
- Validate and sanitise every IPC parameter, and keep heavy audio work off the UI thread.

## 11. Status log

Add an entry after each session: date, machine, what you ran, what you saw, what you changed.

- 2026-10-06, Mac (macOS arm64): investigation done, no Windows run yet. The app works on the Mac with BYOK `gemini-3.8-live`. Next: run section 5 on the Windows PC, starting with 5.1 and 5.2.
- 2026-10-07, Mac: answers now come from `gemini-3.8-flash` with the new interview prompt (section 7, change 5). Tested end to end on the Mac with spoken and typed questions. Not yet run on Windows.
- 2026-10-07, Mac: plain-voice prompt and profile text (section 7, change 6). Tested with a 12-question battery and in the real app. Not yet run on Windows.
- 2026-10-07, Mac: answer length now depends on the question (section 7, change 7). Tested with 30 interview questions, three simulated interviewer reviews and the real app. Not yet run on Windows.
- 2026-10-07, Mac: answers come from GPT-6 Astra through OpenRouter with a Gemini fallback (section 7, change 8). Tested end to end on the Mac, including the fallback. Not yet run on Windows; the OpenRouter key must be entered there.
- 2026-10-09, Mac: two answer screens, coding mode and the answer model switch (section 7, change 11). Normal questions tested in the real app. Not yet run on Windows.
- 2026-10-09, Mac: type-along for coding steps (section 7, change 12). A full coding round ran in the real app with GPT-6 Astra: new problem from a screenshot, Part 1, Part 2, two code steps, a spoken counter-question and exit. Not yet run on Windows.
- 2026-10-13, Mac: "slow in the app, fast in the terminal". The packaged app was never properly signed and had no Accessibility at launch, so the Option hook never started and a hidden overlay could not come back. Fixed the signing (postPackage hook), the hook retry, the `Cmd+\` fallback and the packaged log file. In the rebuilt app, GPT-6 Astra answers showed first text after 1.7 to 2.7 s, the same as terminal runs. No App Nap throttling was seen in a 30 s probe.
- 2026-10-16, Mac: LLD and HLD round profiles, editable round prompts, split code cards, Java instead of pseudocode, type-along removed, and Sonnet 5.5, DeepSeek V4.1 Flash and Haiku 5.5 added (section 7, change 13). A typed DSA round ran in the real app with Haiku. LLD and HLD were only checked with direct model calls. Not yet run on Windows.
- 2026-10-16, Mac: the overlay resizes from its edges and remembers size per mode, the message box opens when you type, Analyze Screen is a round button, and code is smaller (section 7, change 14). Checked in the real app with Playwright. Not yet run on Windows.
