# How to use the app in an interview

This guide is for macOS. Windows keys are listed too, but they haven't been tried on a Windows PC yet.

## One-time setup

1. Install Node 22.12 or newer, then run `npm ci` in this folder.
2. Start the app with `npm start`.
3. Give the app that starts it (your terminal or editor) two macOS permissions in System Settings, Privacy & Security:
    - **Screen & System Audio Recording**, so the app can hear the call and read your screen.
    - **Accessibility**, so tapping Option hides the overlay and type-along can see your Enter key.
4. On the start screen, choose **Use your API keys** and fill in:
    - **Gemini API key** (required). Gemini listens to the call and writes down what the interviewer says.
    - **OpenRouter API key**. With it, the model you pick under **Answer Model** writes the answers.
    - **Answer Model**. GPT-6 Astra is the default. See "Which answer model" below.
5. Open **AI Customization** in the sidebar and paste `docs/prompts/interview-prompt.txt` into **Custom Instructions**. It makes the app answer like an SDE-2 candidate, in the steps below, with no personal background.
6. In **Settings**, set **Audio Mode** to **Speaker Only (Interviewer)**.

## Starting a session

Join the call first, then press **Start Session** (or `Cmd+Enter` on the start screen). The window turns into a small overlay at the top of the screen. The top bar shows:

- the mode (Interview, or Coding during a coding round)
- two tabs, **Main** and **Follow-ups**
- what the app is doing (Listening, Answering, Coding mode) and the time

The app asks the system to keep the overlay out of screen sharing and screenshots. Check that on a test call with your meeting app before you rely on it.

## Normal questions

You don't need to press anything. When the interviewer finishes a question, the answer starts appearing on **Main** within a few seconds.

- **A coding question** is answered in steps. First the problem in your own words. Then clarifying questions, but only ones whose answer changes the solution; if there are some, the answer stops there. When the interviewer answers them (even with just "yes"), the next answer gives the brute force and why it works, then the optimized approach with a walk through the example, its cost and pseudocode, and asks whether to start coding. If there are no good questions, all of that comes in the first answer.
- **"Can you do better?"**, **"go ahead and code it"** and **"walk me through an example"** continue on Main.
- **Follow-up questions** ("why a hash map?", "what if...", "how is that different from...") get their own answer on the **Follow-ups** screen, and the overlay jumps there by itself. Press `Cmd+Option+Left` to go back to Main. You land on the same answer, scrolled to where you were.
- **"Okay", "mm-hmm", "sounds good"** get no answer, unless the last answer asked the interviewer something.
- **If the interviewer pauses mid-question**, the app waits and answers the whole question in one card. Once an answer has been on screen for 5 seconds, it never changes under you.
- **To ask something yourself**, type it in the box at the bottom and press Enter.
- **Analyze Screen** (`Cmd+Enter`) sends a screenshot of your main display and answers what's on it the same way. Later questions can see that screenshot too.

The app remembers the whole session, like a ChatGPT chat, so later answers build on earlier ones. Read every answer before you say it: the model can still get a detail wrong.

## A coding round, step by step

1. **Put the problem on screen**, in front of other windows. The app reads it from a screenshot.
2. **Press `Cmd+Option+1`.** Coding mode starts and **Part 1** appears. Part 1 restates the problem in your words, walks the example, asks a few questions, and gives a simple version with its cost.
3. **Say Part 1 and type the pad.** The strip under the answer shows one line to type at a time (see "Type-along").
4. **When the interviewer answers your questions**, the app hears it. You don't need to do anything.
5. **When they ask "can you do better?"**, Part 2 (the better approach) appears by itself. You can also press `Cmd+Option+2`.
6. **When they say "go ahead and code it"**, the first code step appears. You can also press `Cmd+Option+3`.
7. **Type the code with type-along**, saying each line's comment as you type it.
8. **Press `Cmd+Option+4` for the next step.** Repeat until the code is done.
9. **When they ask a question about your code** ("why a heap?", "what if the array is empty?"), a short answer appears on Follow-ups. If the answer changes code you already typed, the fixed step shows up on Main as "Changed after ...". Your place on Main stays where it was.
10. **To walk through an example**, press `Cmd+Option+6` (dry run), or just let the interviewer ask for it. **For the whole function**, press `Cmd+Option+5`.
11. **When the round is over**, press `Cmd+Option+9` or type `exit`. Normal answers come back.

You can also type in coding mode:

- `new problem` followed by the problem text starts coding mode without a screenshot.
- `exit` leaves coding mode.
- Anything else goes to the model as an instruction, for example `use Java` or `dry run with nums = [4,4,5], k = 1`.

**Analyze Screen in coding mode** sends a screenshot into the same conversation, so it can check your code or a failing test.

## Type-along

During a coding step, the strip under the answer shows:

- the line you just typed (faded)
- **the line to type now** (large, with a bar on the left)
- the next line

Type the line in your editor and press Enter. The strip moves on by itself. When every line is typed, it says so, and the next step starts again at line 1.

If the strip gets out of step with your editor, `Cmd+Option+Up` moves it back a line and `Cmd+Option+Down` skips a line. This happens when you press Enter to accept an autocomplete suggestion, because the app can't tell that Enter from a new line.

Enter only counts while the strip is showing on Main during coding mode. Enter in the overlay's own message box doesn't count.

## Which answer model

You pick it on the start screen under **Answer Model**. The choice applies from the next session.

| Model                 | First words appear              | Cost per answer | Notes                                                              |
| --------------------- | ------------------------------- | --------------- | ------------------------------------------------------------------ |
| GPT-6 Astra (default) | about 1.4 s                     | about 2.5 cents | Fastest start. Best for reading answers aloud.                     |
| Claude Opus 5.5       | about 5 s, sometimes up to 20 s | about 1.5 cents | Thinks first, so you wait longer. Writes longer follow-up answers. |
| GPT-6.1 Sol           | fast                            | cheapest        | For practice and testing.                                          |

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
| Type-along: line back / skip line      | `Cmd+Option+Up` / `Cmd+Option+Down` | `Alt+Shift+Up` / `Alt+Shift+Down`   |
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
