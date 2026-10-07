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

Gemini Live (`gemini-3.8-live`) only listens and transcribes. Every question, spoken or typed, is answered by a text model, so answers are full written text rather than a transcript of Live's short spoken reply:

- With an **OpenRouter API key** on the main screen, GPT-6 Astra (`openai/gpt-6-astra`, low reasoning effort) writes the answers. In blind tests it gave clearly better technical answers than Gemini Flash and started a little sooner. Each answer costs about 3 cents; a 1.5-hour interview is roughly $3 of OpenRouter answers plus about $2 of Gemini Live listening.
- Without that key, or when the OpenRouter request fails or shows no text within 8 seconds, `gemini-3.8-flash` answers instead.

Live's own reply stays hidden unless both fail. If the interviewer pauses mid-question, speech that arrives within 12 seconds is treated as the same question and the answer card is rewritten.

Answer length, voice and content come from **AI Context → Custom Instructions**. `docs/prompts/interview-prompt.txt` is a ready-made version in the voice of a mid-level engineer talking, with short sentences, contractions and plain words. Answer length fits the question: 10 to 20 seconds to name something, about 40 seconds for a definition, about a minute for why, how and experience questions, and about a minute and a half for a story. It includes practiced answers for seven likely questions. It brings up your background only when the question is about you, builds stories only from the listed facts, and has a coding mode. Paste it in, then start a new session; custom instructions are loaded at session start.

`docs/prompts/interview-prompt-deeper-draft.txt` is an alternative draft, not in use. It asks for more technical depth (how things work underneath, the real component names, the tradeoff). In a blind test with GPT-6 Astra it gave the stronger interview answer in 17 of 28 comparisons but sounded less natural, and its lengths and practiced answers predate the shorter targets.

Word counts are generation targets, not guarantees. Read an answer before you say it: the model can still add details that are not in your background.

## Keyboard Shortcuts

- **Window Movement**: `Ctrl/Cmd + Arrow Keys` - Move window
- **Click-through**: `Ctrl/Cmd + M` - Toggle mouse events
- **Close/Back**: `Ctrl/Cmd + \` - Close window or go back
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
