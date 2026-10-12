<img width="1299" height="424" alt="cd (1)" src="https://github.com/user-attachments/assets/b25fff4d-043d-4f38-9985-f832ae0d0f6e" />

## Recall.ai - API for desktop recording

If you’re looking for a hosted desktop recording API, consider checking out [Recall.ai](https://www.recall.ai/product/desktop-recording-sdk/?utm_source=github&utm_medium=sponsorship&utm_campaign=sohzm-cheating-daddy), an API that records Zoom, Google Meet, Microsoft Teams, in-person meetings, and more.

This project is sponsored by Recall.ai.

---

> [!NOTE]  
> Use latest MacOS and Windows version, older versions have limited support

> [!NOTE]  
> During testing it wont answer if you ask something, you need to simulate interviewer asking question, which it will answer

A real-time AI assistant that provides contextual help during video calls, interviews, presentations, and meetings using screen capture and audio analysis.

## Features

- **Live AI Assistance**: Real-time help powered by Google Gemini 2.0 Flash Live
- **Screen & Audio Capture**: Analyzes what you see and hear for contextual responses
- **Multiple Profiles**: Interview, Sales Call, Business Meeting, Presentation, Negotiation
- **Transparent Overlay**: Always-on-top window that can be positioned anywhere
- **Click-through Mode**: Make window transparent to clicks when needed
- **Cross-platform**: Works on macOS, Windows, and Linux (kinda, dont use, just for testing rn)

## Setup

1. **Get a Gemini API Key**: Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. **Install Dependencies**: `npm install`
3. **Run the App**: `npm start`

## Usage

1. Enter your Gemini API key in the main window
2. Choose your profile and language in settings
3. Click "Start Session" to begin
4. Position the window using keyboard shortcuts
5. The AI will provide real-time assistance based on your screen and what interview asks

### How answers are written (Use your API keys mode)

For a step-by-step guide to using the app in an interview, including a coding round, see [docs/how-to-use.md](docs/how-to-use.md).

Gemini Live (`gemini-3.8-live`) only listens and transcribes. Every question, spoken or typed, is answered by a text model, so answers are full written text rather than a transcript of Live's short spoken reply:

- With an **OpenRouter API key** on the main screen, the model picked under **Answer Model** writes the answers. A change applies from the next session.
    - **GPT-6 Astra** (`openai/gpt-6-astra`, low reasoning effort, the default). In blind tests it gave clearly better technical answers than Gemini Flash. Its first words show after about 1.4 seconds, and an answer costs about 2.5 cents.
    - **Claude Opus 5.5** (`anthropic/claude-opus-5.5`, medium reasoning effort). It thinks before it writes, so its first words show after about 5 seconds, and slow ones take up to 14 to 21 seconds. An answer costs about 1.5 cents.
    - **GPT-6.1 Sol** (`openai/gpt-6.1-sol`, low reasoning effort), the cheapest, for testing.
- Without that key, or when the OpenRouter request fails or shows no text in time (8 seconds, or 20 for Opus), `gemini-3.8-flash` answers instead.

Live's own reply stays hidden unless both fail. If the interviewer pauses mid-question, speech that arrives within 12 seconds is treated as the same question, but only while its answer is still empty or less than 5 seconds old. After that, new speech is a new question, so the answer you are reading never changes under you.

### Two answer screens

The overlay has a **Main** screen and a **Follow-ups** screen, with tabs in the top bar. Main answers stay on Main. When the interviewer asks a follow-up or counter-question, a short answer appears on Follow-ups and the overlay jumps there. `Cmd+Option+Left` goes back to Main, to the same answer and scroll position, and `Cmd+Option+Right` opens Follow-ups again. Remarks such as "okay" or "mm-hmm" get no answer.

### Coding mode

For a DSA coding round, put the problem on screen and press `Cmd+Option+1`. The app takes a screenshot and walks you through the problem the way `src/prompts/dsa-coding-skill.md` describes. Part 1 restates the problem, asks questions and gives the simple version. Part 2 gives the better approach. Then the code comes one step at a time.

- `Cmd+Option+2` Part 2, `Cmd+Option+3` start coding, `Cmd+Option+4` next step, `Cmd+Option+5` full code, `Cmd+Option+6` dry run, `Cmd+Option+9` exit.
- Typing `new problem` followed by the problem text also starts it, and typing `exit` leaves. Anything else you type goes to the model as an instruction.
- What the interviewer says is passed on automatically. "Can you do better?" and "go ahead and code it" move the main screen forward. Other questions get a short answer on Follow-ups. If one of them changes code you already typed, the changed step appears on Main, marked "Changed after ...", and your place stays where it was.
- Analyze Screen in coding mode sends the screenshot into the same conversation, for example to check your code or a failing test.
- **Type along.** While a step with code or a pad is on Main, a strip under the answers shows the line to type now, with the line before and after it. Say the line (the comments are the reasons), type it in the editor and press Enter, and the strip moves to the next line by itself. `Cmd+Option+Up/Down` (`Alt+Shift+Up/Down` on Windows) move it back or forward when it gets out of step, for example after you accept an autocomplete suggestion with Enter. Enter only counts while the strip is showing, and Enter in the app's own message box never counts. It uses the same macOS Accessibility permission as the Option-tap hide.

Answer length, voice and content come from **AI Context → Custom Instructions**. `docs/prompts/interview-prompt.txt` is a ready-made version in the voice of a mid-level engineer talking, with short sentences, contractions and plain words. Answer length fits the question: 10 to 20 seconds to name something, about 40 seconds for a definition, about a minute for why, how and experience questions, and about a minute and a half for a story. It includes practiced answers for seven likely questions. It brings up your background only when the question is about you, builds stories only from the listed facts, and has a coding mode. Paste it in, then start a new session; custom instructions are loaded at session start.

`docs/prompts/interview-prompt-deeper-draft.txt` is an alternative draft, not in use. It asks for more technical depth (how things work underneath, the real component names, the tradeoff). In a blind test with GPT-6 Astra it gave the stronger interview answer in 17 of 28 comparisons but sounded less natural, and its lengths and practiced answers predate the shorter targets.

Word counts are generation targets, not guarantees. Read an answer before you say it: the model can still add details that are not in your background.

## Keyboard Shortcuts

- **Window Movement**: `Option + Arrow Keys` on Mac, `Ctrl + Arrow Keys` on Windows - Move window
- **Click-through**: `Ctrl/Cmd + M` - Toggle mouse events
- **Show or hide**: `Cmd + \` on Mac, or tap `Option`/`Alt` on its own
- **Analyze Screen**: `Ctrl/Cmd + Enter`. While the app runs this works in every app, so don't use it to send messages elsewhere.
- **Main / Follow-ups screen**: `Cmd + Option + Left/Right` on Mac, `Alt + Shift + Left/Right` on Windows
- **Coding mode**: `Cmd + Option + 1-6, 9` on Mac, `Alt + Shift + 1-6, 9` on Windows (see Coding mode)
- **Type along**: `Cmd + Option + Up/Down` on Mac, `Alt + Shift + Up/Down` on Windows - line back/forward
- **Send Message**: `Enter` - Send text to AI

## Audio Capture

- **macOS**: [SystemAudioDump](https://github.com/Mohammed-Yasin-Mulla/Sound) for system audio
- **Windows**: Loopback audio capture
- **Linux**: Microphone input

## Requirements

- Electron-compatible OS (macOS, Windows, Linux)
- Gemini API key
- Screen recording permissions
- Microphone/audio permissions
