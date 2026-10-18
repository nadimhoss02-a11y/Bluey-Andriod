# 🫐 Bluey — Quick Start Guide

A blueberry with googly eyes lives on your screen, points at things, talks with you,
and can control your PC. This guide walks you through **building it**, **running it**,
and **talking to it** — step by step.

---

## Part 1 — Build the apps

You need two builds: **Bluey.exe** (Windows) and **app-debug.apk** (Android).
Pick ONE route below.

### Route A: Build with GitHub Actions (no tools needed — recommended)

1. Go to [github.com/new](https://github.com/new) and create a new empty repository
   (Public or Private both work).
2. Upload this project into it:
   - **Easy way:** on the repo page click *uploading an existing file*, then drag the
     contents of the `bluey-app` folder into the browser and click *Commit changes*.
   - **Command line way:**
     ```bash
     cd bluey-app
     git init && git add . && git commit -m "Bluey 1.1 — wake word edition"
     git branch -M main
     git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
     git push -u origin main
     ```
3. In your repo, open the **Actions** tab.
   - Both builders (`build-windows`, `build-android`) start automatically on push to `main`.
   - If they don't, click each workflow → **Run workflow** → **Run workflow**.
4. Wait for a green check mark (about 3–6 minutes each).
5. Click the finished run, scroll to the **Artifacts** section, and download:
   - `bluey-windows` → unzip it → you get **`Bluey Setup 1.1.0.exe`** (installer)
     and a portable `Bluey 1.1.0.exe`.
   - `bluey-android` → unzip it → you get **`app-debug.apk`**.
6. Install:
   - **Windows:** double-click `Bluey Setup 1.1.0.exe`. If SmartScreen says
     "Windows protected your PC", click **More info → Run anyway** (the app is
     unsigned). Bluey starts minimized to the tray and the berry appears on screen.
   - **Android:** copy `app-debug.apk` to your phone (USB, email, Drive…), tap it,
     allow **Install from unknown sources**, open Bluey, and grant the
     **Microphone** permission.

### Route B: Build locally

**Windows app** — on a Windows PC with [Node.js 18+](https://nodejs.org) installed:

1. Open **Command Prompt** in this folder.
2. Run:
   ```bat
   cd windows-app
   npm install
   npm start
   ```
   Bluey now runs straight from source (great for testing — no packaging).
3. When you're happy and want the real installer, run:
   ```bat
   npm run dist
   ```
   The `.exe` files appear in `windows-app\dist\`.

**Android app** — with [Android Studio](https://developer.android.com/studio)
(or JDK 17 + Gradle 8.7):

1. Open the `android-app` folder in Android Studio (**File → Open**).
2. Press **Run ▶** with your phone connected (USB debugging on), **or** build the APK:
   ```bash
   cd android-app
   gradle assembleDebug
   ```
3. The APK lands at `app/build/outputs/apk/debug/app-debug.apk`.

---

## Part 2 — Talk to Bluey (four ways)

### Way 1: Type at her (works 100% offline)

1. **Double-click the berry** on your screen.
2. A small chat box opens near the taskbar.
3. Type a command and press Enter. Examples:
   - `open notepad` / `open spotify` / `open calc`
   - `point at chrome` — her arrow flies to that window
   - `type hello world` — types into whatever window is focused
   - `scroll down 5`
   - `what's on my screen` — she lists your open windows
   - `follow me` / `stay` — she waddles after your cursor / parks
   - `start meeting` / `stop meeting` — records meeting audio to `Documents\Bluey Notes`
   - `tell me a joke`
4. She replies in a speech bubble, out loud, and actually does the thing.

### Way 2: Push-to-talk (Alt+Space)

1. Press **Alt+Space** once.
2. Talk (up to ~10 seconds). She shows a listening glow.
3. Press Alt+Space again or just wait — she answers.
   - **Without an API key:** she reacts playfully to your voice (offline personality).
   - **With an OpenAI key (Settings → Brain):** she truly transcribes and understands you.

### Way 3: Wake word — "Hey Bluey" (hands-free, new in v1.1)

1. One-time setup — either:
   - Right-click the **tray icon** → click **Wake word "Hey Bluey": off** to switch it on, or
   - **Settings → Voice → Voice activation → Wake word** → Save.
2. Now just talk to your screen:
   - `"Hey Bluey"` → *"Yes? I'm listening!"*
   - `"Hey Bluey, open notepad"` → launches Notepad
   - `"Hey Bluey, point at Spotify"` → aims her arrow at Spotify
   - `"Bluey, tell me a joke"` → she answers to just her name too
3. Notes:
   - Hands-free needs an **OpenAI key** (Settings → Brain) **or your own Google API key**
     (Settings → Voice). Without either, Bluey says so and keeps push-to-talk (`Alt+Space`).
   - She goes deaf while she is speaking and during meeting recordings.
   - Anything said without her name is ignored.
   - The wake phrase is customizable in Settings → **Wake phrase**.

### Way 4: From your phone

1. On Windows: tray icon → **Settings** → note the **PC IP address** and **6-digit code**
   (keep the code private; if Windows Firewall asks, allow **Private networks only**).
2. On Android: open Bluey → **Pair with PC** → pick your PC from the list
   (or type the IP) → enter the code. Same Wi-Fi required.
3. Talk to her three ways:
   - **Tap the berry** — she listens once and answers (original Bluey style).
   - **"Hey Bluey" chip** (top of screen) — tap it to switch on always-listening.
     While the app is open she hears her name and answers hands-free.
     Works standalone (offline brain) or forwards your words to the PC when paired.
   - **Hold the mic button** — records audio straight to the PC (Whisper when paired).
4. Chat text and quick command buttons work from the phone too.

---

## Part 3 — Optional upgrades

- **Smarter brain:** Settings → **Brain** → select **OpenAI** → paste your API key →
  Save. Push-to-talk and wake word become real conversations powered by Whisper + GPT
  with full PC control. The key stays on your PC.
- **Character tuning:** Settings → size, glow, mood (happy / excitable / sleepy / grumpy),
  idle chatter, voice selection and volume.

## Troubleshooting quick hits

| Problem | Fix |
|---|---|
| Wake word doesn't react | It needs an OpenAI key or your own Google API key (see Way 3); then toggle the tray wake item off/on and make sure no other app holds the mic |
| Alt+Space does nothing | Another app owns the hotkey — restart Bluey, or use the tray menu |
| Phone can't find PC | Type the PC IP manually instead of discovery |
| SmartScreen blocks the exe | More info → Run anyway (unsigned app) |
| Bluey is silent | Pick a different Windows voice in Settings → Voice |
