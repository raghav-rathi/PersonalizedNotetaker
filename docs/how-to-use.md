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
5. For normal interviews, open **AI Customization** and paste `docs/prompts/interview-prompt.txt` into **Custom Instructions**. DevOps and the Experience / Resume Round have their own built-in prompts and don't send Custom Instructions at all.
6. Pick **Mode** on the start screen, or the same **Profile** in AI Customization. Choose **Job Interview**, **Experience / Resume Round**, **Coding Round (DSA)**, **LLD Interview**, **HLD / System Design** or **DevOps / SRE Round**. The choice applies from the next session. DevOps and the Experience / Resume Round require **Use your API keys**.
7. In **Settings**, set **Audio Mode** to **Speaker Only (Interviewer)**.

## Starting a session

Join the call first, then press **Start Session** (or `Cmd+Enter` on the start screen). The window turns into a small overlay at the top of the screen. The top bar shows:

- the mode (Interview, or Coding during a coding round)
- two tabs, **Main** and **Follow-ups**
- what the app is doing (Listening, Answering, Coding mode) and the time

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

Outside a DevOps incident, the app checks whether each spoken or typed question needs what's on your screen right now. A small decision model, Jev, reads the words of the question, never the screen, and decides in about half a second, for a tiny fraction of a cent. DevOps uses manual captures instead, as described below.

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

## Experience / resume round

Use this when the interview is about your own work: your jobs, your projects, and technical questions about the things in them.

1. Open **AI Customization** and set **Profile** to **Experience / Resume Round**.
2. Paste your background into **My background**: your resume, then every project. For each project, say what it was for, your part, the stack, the real numbers, what went wrong and why you made each choice. Add anything else they can ask about, such as your notice period or why you're looking.
3. On the start screen, pick the same **Mode** and start a **Use your API keys** session. The app won't start this mode with an empty background.
4. Answer questions as they come. A new question goes to **Main**. A short follow-up goes to **Follow-ups**.

How it differs from Job Interview:

- Facts about you come only from **My background**. Custom Instructions aren't sent.
- The whole interview is one conversation, so the model sees everything it already told you to say.
- When the interviewer asks for a fact that isn't in your background, the answer starts with **FILL IN**, which names what's missing. The text to say has a gap in square brackets, like `There were [team size] of us`. Say the real thing there. You can also type the fact into the overlay, for example `my team was 6 people`, and later answers use it.
- A technical question about your stack gets a normal spoken answer. It ties in your project in one sentence when your background has a matching fact.
- The screen is read only when you press **Analyze Screen**, for example when the interviewer pastes a question into the chat.
- The coding shortcuts still start the DSA round if you press them. Nothing in this mode needs them.

The more specific your background is, the better the answers. "Improved performance" gives the model nothing to say. "Cut the slowest query from 14 seconds to 900 ms by adding an index" does.

**Edit round prompt** in AI Customization opens the rules this mode follows, `experience-skill.md`. Edits apply from the next answer. Settings are per machine, so paste your background again on each computer.

Read every answer before you say it. The model follows these rules most of the time, not every time. In testing it still added a small detail now and then that wasn't in the background.

## DevOps incident round

Choose **DevOps / SRE Round** under **Mode**, then start a **Use your API keys** session. The Authd OCI skill is already adapted into `src/prompts/devops-skill.md`; don't paste the whole downloaded file into Custom Instructions.

1. The interviewer asks the opening question. The app can answer the spoken question, or you can capture it if it is on screen.
2. When the interviewer shows a log or another evidence card, press **Cmd+Enter** on Mac, **Ctrl+Enter** on Windows, or click **Analyze Screen**. If you changed the Analyze Screen key in Settings, use your saved key.
3. Read the answer on **Main**. It explains what the evidence supports and ends with **ASK NEXT**, one evidence request to say to the interviewer.
4. The interviewer supplies the next log, diff or metrics. Capture it the same way. The new answer keeps the earlier captures and replies in context.
5. Spoken or typed follow-up questions get short answers on **Follow-ups**. Click **Main** to return to the evidence answer without changing it.

No new-incident command or clipboard shortcut is needed. One session holds one incident; end it and start another to clear the case. DevOps does not automatically capture a screen while the interviewer is still pasting. Captures use the selected Thinking effort; spoken and typed questions use the model's quick setting.

The prompt tells the model to use only revealed evidence, not later facts from the preparation case. Answers are written to be read out loud: short sentences, contractions, values said in words ("we got a 400 back", not "status=400"), and no backticks or log syntax. Custom Instructions aren't sent, so answers stay on the incident. Read each answer before saying it, especially if the interview differs from the prepared case.

Python DSA mode remains available through its existing controls. Starting a coding problem keeps it separate from the incident, and exiting coding mode returns to the same incident history.

**Edit round prompt** in AI Customization opens the DevOps prompt. If you have a `devops-skill.md` copy from the older `devops-mode` branch in your settings folder, it takes priority. Remove that old copy to use this built-in capture-based version.

## A coding round, step by step

1. **Put the problem on screen**, in front of other windows. The app reads it from a screenshot.
2. **Press `Cmd+Option+1`.** Coding mode starts, the overlay gets wider, and **Part 1** appears on **Main**. Each card has two columns: on the left, what you say (it starts with "I can relate this to ..." when a well-known approach fits) and the walkthrough on the example; on the right, the Python code. Each side scrolls on its own.
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

## Changing a round's prompt

In **AI Customization**, with a round profile picked, press **Edit round prompt**. The prompt file opens in your editor. Save it, and the next reply follows it. No rebuild or restart is needed. The file lives in the app's settings folder, so it survives updates. To go back to the built-in prompt, delete that file. A copy made before 2026-10-19 still asks for Java code; delete it to get the built-in Python version.

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
- **Before an interview, try a practice round** with GPT-6.1 Sol to get used to the keys.
