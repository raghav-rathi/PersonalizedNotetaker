# How to use the app in an interview

This guide is for macOS. Windows keys are listed too, but they haven't been tried on a Windows PC yet.

## One-time setup

1. Install Node 22.12 or newer, then run `npm ci` in this folder.
2. Start the app with `npm start`.
3. Give the app that starts it (your terminal or editor) two macOS permissions in System Settings, Privacy & Security:
    - **Screen & System Audio Recording**, so the app can hear the call and read your screen.
    - **Accessibility**, so tapping Option hides the overlay.
4. On the start screen, choose **Use your API keys** and fill in:
    - **Gemini API key** (required). Gemini listens to the call and writes down what the interviewer says.
    - **OpenRouter API key**. With it, the model you pick under **Answer Model** writes the answers.
    - **Answer Model**. GPT-6 Astra is the default. See "Which answer model" below.
5. Open **AI Customization** in the sidebar and paste `docs/prompts/interview-prompt.txt` into **Custom Instructions**. It holds your background and the way answers should sound.
6. Pick the round under **Mode** on the start screen, or under **Profile** in **AI Customization** (it's the same choice): **Job Interview** for normal questions, **Coding Round (DSA)**, **LLD Interview** or **HLD / System Design** for those rounds, or **DevOps / SRE Round** for an on-call incident drill. The round decides which prompt writes the answers and runs the `Cmd+Option+1` to `Cmd+Option+6` steps. It applies when the next session starts.
7. In **Settings**, set **Audio Mode** to **Speaker Only (Interviewer)**.

## Starting a session

Join the call first, then press **Start Session** (or `Cmd+Enter` on the start screen). The window turns into a small overlay at the top of the screen. The top bar shows:

- the mode (Interview, DevOps, or Coding during a coding round)
- two tabs, **Main** and **Follow-ups**
- what the app is doing (Listening, Answering, Coding mode, DevOps mode) and the time

**Make it fit your screen.** Drag the top bar to move the overlay. Drag its left, right or bottom edge, or a bottom corner, to resize it. The app remembers the size and place separately for normal answers and for coding mode, also after a restart. When it's narrower than about 760 px, a coding card shows the explanation above the code instead of beside it. Below 600 px the top bar hides the status and the clock.

**Typing.** The message box is hidden so the answers get the whole height. Click the overlay and start typing: the box appears with what you typed. Enter sends, Escape closes it. Pasting with `Cmd+V` opens it too.

**Analyze Screen** is the round ⚡ button at the bottom right. It's always there.

The app asks the system to keep the overlay out of screen sharing and screenshots. Its dropdown lists and error messages stay inside the overlay too. What can still show: on Windows, the tray icon and its right-click menu, and anything the app opens for you, such as the text editor from **Edit round prompt** or a link in your browser. Check on a test call with your meeting app before you rely on it.

## Tech meetings

Pick **Tech Meeting** in AI Customization. Two fields replace Custom Instructions there:

- **Your name in meetings** (Bharat). Questions put to that name get answers. Close spellings from the transcription count too.
- **Meeting context.** Paste what the meeting is about: tickets, changes, test results, log markers, Splunk queries. Answers use only these facts, keep the limits you wrote ("not seen in UAT", "needs PROD validation"), and say "I'd need to confirm that" when something isn't there.

During the meeting, the overlay has a **Context** tab next to Main and Follow-ups. Edit the context there; it saves as you type, and the next answer uses it.

What it answers:

- questions to you
- questions about your tickets or work
- moments when the team is stuck on a technical problem

Status updates, people talking to each other and "can you see my screen?" get no reply. Each answer starts with a sentence you can say as is. Queries and commands show in the code column.

In meetings, your screen is attached only when the answer has to point at something on it ("why is compacted false on this line?"). A shared screen alone isn't enough. Claude Haiku 5.5 suits meetings: in testing it answered in 1–2 s, and each ignored line cost almost nothing.

## Screen context

For every question, spoken or typed, in every profile, the app checks whether the answer needs what's on your screen right now. A small decision model, Jev, reads the words of the question (never the screen) and decides in about half a second, for a tiny fraction of a cent.

- **Needs the screen** ("why a hashmap on line seven?", "see the error in the terminal?"): the app takes a screenshot at that moment and answers with it. The answer shows up about half a second later than usual.
- **Something is being shared** ("I'm sharing a doc, open it"): nothing is shown. The next question in the following 2 minutes gets a screenshot taken when that question ends, so it sees the opened doc.
- **Doesn't need it:** answered as usual. Nothing is sent.

The same Jev call also decides whether the answer model thinks. Small talk, behavioral questions and follow-ups get a quick answer (Claude Haiku in about 1 s). A new problem, a request for code, a dry run, a changed constraint or "that's wrong" gets a thinking answer, at the level you pick under **Thinking** on the start screen (see "Which answer model" below). Coding hotkeys always think.

Answers that were sent your screen are marked **📷**. Turn it off, or change how often it attaches the screen, in **Settings → Screen Context**. It needs the OpenRouter key. Without the key, or with it switched off, Jev isn't asked: every spoken or typed answer is quick, and only questions with words like "look at this" use the screen.

## Normal questions

You don't need to press anything. When the interviewer finishes a question, the answer starts appearing on **Main** within a few seconds.

- **Follow-up questions** ("why?", "what if...", "how is that different from...") get a short answer on the **Follow-ups** screen, and the overlay jumps there by itself. Press `Cmd+Option+Left` to go back to Main. You land on the same answer, scrolled to where you were.
- **"Okay", "mm-hmm", "sounds good"** get no answer.
- **If the interviewer pauses mid-question**, the app waits and answers the whole question in one card. Once an answer has been on screen for 5 seconds, it never changes under you.
- **To ask something yourself**, click the overlay, type, and press Enter.
- **Analyze Screen** (the ⚡ button, or `Cmd+Enter`) reads your screen and answers what's on it.

Read every answer before you say it. The model can still add a detail that isn't in your background.

## A coding round, step by step

1. **Put the problem on screen**, in front of other windows. The app reads it from a screenshot.
2. **Press `Cmd+Option+1`.** Coding mode starts, the overlay gets wider, and **Part 1** appears on **Main**. Each card has two columns: on the left, what you say (it starts with "I can relate this to ..." when a well-known approach fits) and the walkthrough on the example; on the right, the Java code. Each side scrolls on its own.
3. **Say Part 1 from the left side and type the code from the right side.**
4. **When the interviewer answers your questions**, the app hears it. You don't need to do anything.
5. **When they ask "can you do better?"**, Part 2 (the better approach) appears by itself. You can also press `Cmd+Option+2`.
6. **When they say "go ahead and code it"**, the first code step appears. You can also press `Cmd+Option+3`.
7. **Type the code from the right column**, saying each line's comment as you type it.
8. **Press `Cmd+Option+4` for the next step.** Repeat until the code is done.
9. **When they ask a question about your code** ("why a heap?", "what if the array is empty?"), a short answer appears on Follow-ups and the overlay jumps there. Its first sentence is the direct answer you can say as is, then the simple explanation. If the answer changes code you already typed, the fixed step shows up on Main as "Changed after ...". Your place on Main stays where it was.
10. **To walk through an example**, press `Cmd+Option+6` (dry run), or just let the interviewer ask for it. **For the whole function**, press `Cmd+Option+5`.
11. **When the round is over**, press `Cmd+Option+9` or type `exit`. Normal answers come back.

You can also type in coding mode:

- `new problem` followed by the problem text starts coding mode without a screenshot.
- `exit` leaves coding mode.
- Anything else goes to the model as an instruction, for example `use Java` or `dry run with nums = [4,4,5], k = 1`.

**Analyze Screen in coding mode** sends a screenshot into the same conversation, so it can check your code or a failing test.

## LLD and HLD rounds

Pick **LLD Interview** or **HLD / System Design** as the profile before you start the session. The same keys run the round:

| Key            | LLD                                   | HLD                                         |
| -------------- | ------------------------------------- | ------------------------------------------- |
| `Cmd+Option+1` | Use cases                             | Requirements and rough scale numbers        |
| `Cmd+Option+2` | Objects, how they connect, one flow   | Box diagram, API, data and one request      |
| `Cmd+Option+4` | Code, one class or method per step    | Go deeper on one part (storage, cache, ...) |
| `Cmd+Option+5` | All the classes                       | Design summary                              |
| `Cmd+Option+6` | Walk one use case through the objects | Follow one request from start to finish     |

## A DevOps / on-call round

Pick **DevOps / SRE Round** under **Mode** on the start screen. The overlay stays wide the whole session, so a query, a command or a status message sits in the right column. Every answer comes from the DevOps prompt, written like a calm senior on-call engineer: the decision first, every number against its baseline, a deploy treated as a suspect until its change can explain the error, and "fixed" only when your own metrics say so.

1. **When the alert is on screen, press `Cmd+Option+7`** (new incident). The app takes a screenshot and reads what the interviewer just said, then gives your first move: how bad it is, where, and what you'd check first.
2. **For each new piece of evidence** (the runbook, a deploy diff, logs, a response, a status page, metrics), the interviewer usually says "here's the ..." and the app attaches a screenshot by itself. If an answer didn't get the screen (no 📷), press `Cmd+Enter`.
3. **For log lines or a long JSON response**, select them, copy them with `Cmd+C`, then press `Cmd+Option+0`. The copied text goes in exactly, where a screenshot can cut lines off. Up to 20,000 characters go along; longer text loses its middle.
4. **Questions about evidence you already read** ("what about the 429s?", "could it be one tenant?") get a short answer on Follow-ups. If the answer changes the plan, Main shows the updated case board, marked "Changed after ...".
5. **Main answers end with a small case board**: facts, ruled out, leading, next check. It's for you to glance at, not to read out.
6. **The whole incident stays in one conversation** until the next `Cmd+Option+7`: what was heard, what you typed, every screenshot and every pasted text. Each answer is sent the first screenshot and the three newest; earlier answers already say what the others showed.
7. **A coding question in the same interview**: put it on screen and press `Cmd+Option+1`. The DSA round runs as usual. `Cmd+Option+9` goes back to the incident, with everything it had.
8. **Small talk and behavioral questions** use **Custom Instructions** in AI Customization (with DevOps picked) as your background: your years on call, your stack, an outage you handled. Answers don't invent experience beyond it.

You can also type `new incident` followed by the alert text to start one without a screenshot.

## Changing a round's prompt

In **AI Customization**, with a round profile picked (Coding, LLD, HLD or DevOps), press **Edit round prompt**. The prompt file opens in your editor. Save it, and the next reply follows it. No rebuild or restart is needed. The file lives in the app's settings folder, so it survives updates. To go back to the built-in prompt, delete that file.

## Which answer model

You pick it on the start screen under **Answer Model**. The choice applies from the next session.

Under it, **Thinking** sets how hard the model thinks on a thinking answer: **Low** (the default), **Medium** or **High**. Higher can give a deeper answer but starts later: GPT-6 Astra took about 11 s to start a new DSA problem at Medium, against about 2 to 3 s at Low. High hasn't been timed. Quick answers stay quick at every level. If the model shows nothing for 30 s at Medium or 60 s at High, Gemini Flash answers instead. The choice applies from the next session.

| Model                 | First words appear              | Cost per answer    | Notes                                                              |
| --------------------- | ------------------------------- | ------------------ | ------------------------------------------------------------------ |
| GPT-6 Astra (default) | about 1.4 s                     | about 2.5 cents    | Fastest start. Best for reading answers aloud.                     |
| Claude Opus 5.5       | about 5 s, sometimes up to 20 s | about 1.5 cents    | Thinks first, so you wait longer. Writes longer follow-up answers. |
| Claude Sonnet 5.5     | about 2 s, sometimes up to 10 s | about 1 to 3 cents | Thinks before some follow-ups.                                     |
| GPT-6.1 Sol           | fast                            | about 1 cent       |                                                                    |
| DeepSeek V4.1 Flash   | about 4 s, slow to finish       | a tenth of a cent  | Very cheap. A long answer can take 15 to 60 s to finish.           |
| Claude Haiku 5.5      | about 2 s, sometimes up to 12 s | a tenth of a cent  | Cheapest good one. Use it for practice and testing.                |

If the chosen model fails or stays silent too long, Gemini Flash answers instead. A 1.5-hour interview with Astra costs about $3 in answers plus about $2 for Gemini listening.

## Keys

| What                                   | Mac                                 | Windows                             |
| -------------------------------------- | ----------------------------------- | ----------------------------------- |
| Main screen                            | `Cmd+Option+Left`                   | `Alt+Shift+Left`                    |
| Follow-ups screen                      | `Cmd+Option+Right`                  | `Alt+Shift+Right`                   |
| New coding problem (reads your screen) | `Cmd+Option+1`                      | `Alt+Shift+1`                       |
| Part 2                                 | `Cmd+Option+2`                      | `Alt+Shift+2`                       |
| Start coding                           | `Cmd+Option+3`                      | `Alt+Shift+3`                       |
| Next step                              | `Cmd+Option+4`                      | `Alt+Shift+4`                       |
| Full code                              | `Cmd+Option+5`                      | `Alt+Shift+5`                       |
| Dry run                                | `Cmd+Option+6`                      | `Alt+Shift+6`                       |
| Leave coding mode                      | `Cmd+Option+9`                      | `Alt+Shift+9`                       |
| New incident (reads your screen)       | `Cmd+Option+7`                      | `Alt+Shift+7`                       |
| Send copied text (DevOps or coding)    | `Cmd+Option+0`                      | `Alt+Shift+0`                       |
| Previous / next answer                 | `Cmd+[` / `Cmd+]`                   | `Ctrl+[` / `Ctrl+]`                 |
| Scroll the answers                     | `Cmd+Shift+Up` / `Cmd+Shift+Down`   | `Ctrl+Shift+Up` / `Ctrl+Shift+Down` |
| Analyze Screen                         | `Cmd+Enter`                         | `Ctrl+Enter`                        |
| Hide or show the overlay               | tap `Option` on its own, or `Cmd+\` | tap `Alt` on its own, or `Ctrl+\`   |
| Let clicks pass through the overlay    | `Cmd+M`                             | `Ctrl+M`                            |
| Move the overlay                       | `Option+arrow keys`                 | `Ctrl+arrow keys`                   |

You can change any of these in Settings.

## Watch out for

- **While the app runs, these keys work in every app.** `Cmd+Enter` takes a screenshot and sends it to the model, so don't use it to send a chat message. `Cmd+[` and `Cmd+]` won't indent code in your editor either.
- **Never press `Cmd+Shift+E` while the app runs.** It is Emergency Erase: it deletes the app's settings, keys and history, and quits. VS Code uses the same keys for its Explorer.
- **Check the problem is on screen** before `Cmd+Option+1`. If the model says it can't find a problem, put it in front and press `Cmd+Option+1` again, or type `new problem` with the text.
- **`Cmd+Option+0` sends whatever is on the clipboard.** Copy the evidence right before you press it; a password or token you copied earlier would go to the model.
- **A free Gemini key allows only 20 Gemini Flash answers a day** (Google's limit on 2026-10-19). Without a working OpenRouter key, Gemini Flash writes every answer, so a long interview can run out; the status bar then says "Gemini quota used up". Use an OpenRouter key, or a Gemini key with billing, for a real interview.
- **Before an interview, try a practice round** with GPT-6.1 Sol to get used to the keys.
