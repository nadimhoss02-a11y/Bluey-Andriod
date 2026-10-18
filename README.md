<p align="center">
  <img src="preview-berry.png" width="140" alt="Bluey">
</p>

<h1 align="center">🫐 Bluey — your berry buddy</h1>

<p align="center">
  A blueberry with big googly eyes lives on your screen, points at things with its own arrow cursor,
  chats with you, can drive your PC — and pairs with your phone over Wi-Fi.<br>
  <b>Windows app (Electron)</b> · <b>Android app (Kotlin)</b> · inspired by
  <a href="https://github.com/rbrown101010/bluey-by-riley">bluey-by-riley</a>
</p>

---

## ✨ What it does

| | Windows | Android |
|---|---|---|
| 🫐 Blueberry character with googly-eye physics | ✅ lives on your desktop | ✅ lives on your phone |
| 👉 Own arrow cursor that points at things | ✅ at your mouse, screen center, or any open window | ✅ reports replies |
| 💬 Speech bubbles + voice | ✅ spoken with Windows voices | ✅ spoken with Android TTS |
| 🎙 Push-to-talk | ✅ `Alt+Space` | ✅ hold the mic button |
| 🗣 Wake word "Hey Bluey" | ✅ hands-free with an OpenAI key (or your own Google API key) | ✅ always-listening while the app is open |
| 👆 Tap the character to talk | ✅ double-click the berry | ✅ tap the berry (original Bluey style) |
| 🤖 AI voice chat | ✅ offline personality now · paste a **free Google Gemini key** (or an OpenAI key) to upgrade | ✅ sends text and audio to the PC when paired |
| 🖱 PC control (click / type / scroll / open apps) | ✅ via chat commands | ✅ from your phone |
| 📝 Meeting notes (5-min audio chunks) | ✅ saved to `Documents\Bluey Notes` | — |
| 📱 Phone companion over Wi-Fi | ✅ runs the server | ✅ discovers PC via mDNS + pairing code |
| 👀 Follow mode, sleep mode, size / glow / mood settings | ✅ | ✅ shake your phone for googly chaos |

Everything works **offline with no API key** — Bluey ships with an offline personality and a text
command parser, so PC control works out of the box. Add a free Google Gemini key (or an OpenAI key)
later and the same chat and push-to-talk flow becomes a real conversation that can understand *and*
control your PC.

---

## 💬 How to talk to Bluey (four ways)

**1. Type at her — double-click the berry.**
A little chat box opens near the taskbar. Type anything from the command table below —
`open notepad`, `point at chrome`, `tell me a joke` — and she answers in a speech bubble,
out loud, and actually does it. This is the full-power channel: the offline brain's command
parser understands everything here, no microphone and no internet needed.

**2. Push-to-talk — hold `Alt+Space`.**
Press once, talk (up to ~10 s), press again or wait. In offline mode she reacts playfully to
your voice's energy. With a Gemini or OpenAI key configured (Settings → Brain) the clip is
transcribed and becomes a real command/conversation.

**3. Wake word — just say "Hey Bluey".**
Turn it on once (Settings → Voice → *Voice activation* → **Wake word**, or the tray menu), and
she perks up whenever she hears her name — no keys to press:

```
"Hey Bluey"                 →  "Yes? I'm listening!"
"Hey Bluey, open notepad"   →  launches Notepad
"Hey Bluey, point at Spotify" → aims her arrow at the Spotify window
"Bluey, tell me a joke"     →  berry humor (she answers to just her name too)
```

How it works under the hood, and what to expect:
- **OpenAI brain** (recommended for hands-free): she listens for voice activity, records the
  utterance, transcribes it with Whisper, and checks it for the wake word — no Google involvement.
- **Offline brain** (default): Chromium's built-in speech recognition only works when it has a
  Google API key, and the Electron build ships without one. Paste your own key in
  Settings → Voice → *Google API key* (a Google Cloud key with the Speech API enabled) and restart
  Bluey. Without a key, Bluey tells you once, switches back to push-to-talk, and `Alt+Space`
  keeps working offline.
- **She never hears herself**: while her TTS voice is speaking, and during meeting recordings,
  the wake engine is paused. Nothing loops, nothing is captured mid-call.
- **Privacy**: the mic stream lives inside the app on your PC. Transcripts are matched against
  the wake phrase locally; utterances without her name are ignored and never acted on. The
  Windows taskbar mic badge appears whenever the mic is in use — that's her listening engine.
- The wake phrase is configurable (Settings → Wake phrase). She matches `hey/hi/ok/okay/yo/
  hello` + the keyword, or the bare keyword itself.

**4. From your phone — pair over Wi-Fi** (see below). Three ways to talk from the couch:

- **Tap the berry** — she listens once and answers (standalone brain, or forwards to the PC
  when paired) — just like the original Bluey app.
- **"Hey Bluey" wake word** — tap the *"Hey Bluey": tap to always-listen* chip at the top of
  the phone screen. She then listens continuously **while the app is open**, reacts to her
  name, and answers with Android's speech engine. Foreground-only by design (battery +
  privacy), and she holds her ears while she's speaking or while you hold the mic button.
- **Hold the mic button** — records WAV audio straight to the PC (Whisper path when paired).

Quick command buttons (point at my mouse, follow me, bigger, sleep…) also work from the phone.

Plus the tray menu for mouse-only operation: talk, wake word on/off, point, follow, meeting
notes, settings.

---

## 🚀 Build walkthrough

### Route A — GitHub Actions (no toolchains needed, recommended)

1. **Get the code onto GitHub.** Create a new empty repository on github.com, then push this
   folder's contents to it:
   ```bash
   unzip bluey-app.zip -d bluey && cd bluey
   git init && git add . && git commit -m "Bluey 1.1 - wake word edition"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   git push -u origin main
   ```
   (Or use GitHub's *"Import repository"* / drag-and-drop upload — the workflows only need the
   folder structure to be intact: `windows-app/`, `android-app/`, `.github/workflows/`.)
2. **Run the builders.** In your repo: **Actions** tab → if pushed to `main` they start
   automatically; otherwise select **build-windows** / **build-android** → *Run workflow*.
   - `build-windows` runs on a Windows VM: `npm ci` → `electron-builder` → uploads the artifact.
   - `build-android` runs on Ubuntu: JDK 17 + Gradle 8.7 → `assembleDebug` → uploads the APK.
3. **Download the artifacts.** When a run finishes (green check), open it and download from the
   *Artifacts* section:
   - `bluey-windows` → unzip to get **`Bluey Setup 1.1.0.exe`** (installer) and a portable
     `Bluey 1.1.0.exe` that runs without installing (about 156 MB).
   - `bluey-windows-installer` → just **`Bluey Setup 1.1.0.exe`** (about 78 MB). Use this one if the
     bigger download keeps failing on a slow connection. An installed copy also runs from a fixed folder,
     so the Windows Firewall prompt appears once; the portable exe unpacks to a new temp folder each launch,
     which can make Windows ask again.
   - `bluey-android` → **`app-debug.apk`**.
4. **Install.**
   - *Windows*: run the Setup exe. Windows SmartScreen may warn "unknown publisher" — click
     *More info* → *Run anyway* (the app is unsigned; signing requires a paid certificate).
     Bluey starts in the tray and the berry appears.
   - *Android*: copy the APK to your phone, tap it, allow *Install from unknown sources*.
     Then open Bluey, grant microphone permission, and (optionally) pair with the PC.

> Tip: artifacts on GitHub are zip-wrapped and expire after ~90 days by default. Re-run the
> workflow any time to regenerate them.

### Route B — build locally

**Windows app** (on Windows, needs [Node.js 18+](https://nodejs.org)):
```bat
cd windows-app
npm install
npm start          :: run Bluey straight from source - great for trying changes
npm run dist       :: installer + portable exe land in windows-app\dist\
```
You'll get `Bluey Setup 1.1.0.exe` and the portable exe in `windows-app/dist/`. While
 developing you can also run the render self-test: `npm run selftest`.

**Android app** (needs [Android Studio](https://developer.android.com/studio) *or* JDK 17 +
Gradle 8.7):
```bash
cd android-app
gradle assembleDebug        # APK at app/build/outputs/apk/debug/app-debug.apk
# or: open the android-app folder in Android Studio → Run ▶
```

Want faster feedback while hacking on the PC side? `npm start` runs from source with instant
restarts (Ctrl+C → `npm start` again), no packaging step involved.

---

## 📱 Pairing the phone with the PC

1. Run Bluey on Windows. Phone and PC must be on the **same Wi-Fi**.
2. On the PC: tray icon → **Settings** → *Phone companion* → note the **PC IP** and the **6-digit code**.
   Treat the code like a password: anyone who has it can control this PC from the same network.
   (Wrong codes are throttled: 5 misses lock that device out for 10 minutes.)
3. On the phone: **Pair with PC** → pick your PC from the discovered list (or type the IP) → enter the code.
   If Windows Firewall asks about Bluey, allow **Private networks only** — not Public.
4. Now **tap the berry and talk**, enable the **"Hey Bluey"** chip for hands-free, or **hold the mic button**:
   your voice goes to the PC, Bluey answers in a bubble on **both** screens (and out loud on the PC).
   Chat text and quick commands work from the phone too.

> Pairing protocol & discovery are documented in `windows-app/src/server.js` — service type `_bluey._tcp`,
> WebSocket on port `8787`, code-auth handshake.

---

## 🖥 Using Bluey on Windows

- **`Alt+Space`** — push-to-talk (press once, talk, press again or wait ~10 s)
- **"Hey Bluey …"** — wake word mode (Settings → Voice → Voice activation)
- **Double-click Bluey** — open a chat box
- **Drag the tray icon menu** — talk, wake word toggle, point, follow, meeting notes, settings
- **Right-click Bluey** *(hover him first)* — nothing, he's just happy you hovered. Mouse passes through everywhere else.

### Things you can type / say (works offline!)

| Say this | Bluey will |
|---|---|
| `open notepad` / `open spotify` / `open calc` | launch the app |
| `point at chrome` | point its arrow at that window |
| `point at my mouse` / `point at center` | point somewhere specific |
| `click` / `double click` / `right click` | click at the current cursor spot |
| `type hello world` | type into the focused window |
| `scroll down 5` | scroll |
| `what's on my screen` | list your open windows |
| `follow me` / `stay` | waddle after your cursor / park |
| `go to sleep` / `wake up` | nap mode with Zzz |
| `bigger` / `smaller` | resize him |
| `start meeting` / `stop meeting` | record + chunk audio to `Documents\Bluey Notes` |
| `tell me a joke` | berry humor |

Known apps: `notepad, calc, paint, cmd, terminal, explorer, chrome, edge, firefox, spotify, discord, steam, code, word, excel, powerpoint, outlook` — anything else is launched by name.

### Upgrading the brain (optional)

**Google Gemini (free).** Get a key at <https://aistudio.google.com/apikey> (a Google account is
enough, no card), then Settings → **Brain** → *Google Gemini* → paste it → Save. Typed chat, the
phone's text and voice, and push-to-talk now go to Gemini, which answers in Bluey's voice and can
use the same PC-control tools ("open notepad", "point at Chrome", "scroll down"…). Leave *Gemini
model* empty and Bluey picks one your key can use. If Google can't be reached, the key is wrong or the
daily free limit is used up, Bluey says so in a bubble and the offline command parser keeps working.

- Free-tier terms: Google may use what you send to improve its products, and there are daily limits.
  Only your typed or spoken messages are sent — never your screen.
- Gemini is **not** used for the always-listening wake word (that would upload everything said in the
  room, and the free limits would run out). Hands-free: use the phone app's *Hey Bluey* chip, or
  `Alt+Space`.

**OpenAI.** Settings → **Brain** → *OpenAI* → paste your API key. Then push-to-talk **and wake word**
become real conversations: your voice is transcribed (Whisper), Bluey thinks (GPT) with the same
PC-control tools, and speaks the reply.

Keys never leave your PC except to their own service — they are stored in
`%APPDATA%\Bluey\config.json` and sent only to `generativelanguage.googleapis.com` (Gemini) or
`api.openai.com` (OpenAI).

---

## 🏗 Project structure

```
bluey-app/
├── windows-app/               Electron desktop app
│   ├── src/main.js            windows, tray, hotkey, IPC, action executor
│   ├── src/brain.js           scripted personality + Gemini and OpenAI providers + tool defs
│   ├── src/control.js         mouse/keyboard/apps via PowerShell (zero native deps)
│   ├── src/server.js          phone pairing: HTTP ping + WebSocket + mDNS
│   ├── src/recorder.js        hidden-window audio: PTT clips, meeting chunks, wake-word engine
│   ├── src/overlay/           the character (SVG + googly-eye spring physics + cursor)
│   ├── src/settings/          settings UI
│   └── assets/                icon.ico / icon.png / tray.png
├── android-app/               Kotlin phone app
│   └── app/src/main/java/com/bluey/app/
│       ├── BlueyView.kt       canvas-drawn berry + pupil physics + shake wobble + bubbles
│       ├── MainActivity.kt    tap-to-talk, wake chip, push-to-talk, chat, TTS, shake, reconnect
│       ├── SpeechInput.kt     system speech recognizer: one-shot + continuous "Hey Bluey" loop
│       ├── Wake.kt            wake word matcher ("hey/hi/ok…" + keyword, or bare keyword)
│       ├── PairActivity.kt    NSD discovery (_bluey._tcp) + manual IP + code pairing
│       ├── PairClient.kt      WebSocket companion client
│       ├── WavRecorder.kt     16 kHz WAV capture with RMS metering
│       └── Brain.kt           the same offline personality, pocket edition
└── .github/workflows/         one-click .exe + .apk builders
```

## 🔧 Troubleshooting

- **No sound on PC?** Bluey uses the Windows voice named in Settings → Voice; pick another one there.
- **Wake word doesn't react?** Without an OpenAI key or your own Google API key (Settings) there is no speech engine for it — Bluey says so and falls back to `Alt+Space`. With a key: check the mic isn't muted/occupied by another app, then toggle the tray item *Wake word "Hey Bluey"* off and on.
- **Android wake word doesn't react?** It only listens while the Bluey app is open (battery + privacy). Check the "Hey Bluey" chip shows *ON*, mic permission is granted, and your phone has a speech app (Google app installed). Wake word uses your phone's on-device speech engine.
- **Android: tap the berry and nothing happens?** Tap directly on the berry, not around it — and the first time, allow the microphone permission.
- **Wake word triggers from TV/music?** It only acts when it clearly hears the keyword at the start of an utterance; everything else is ignored. If it's too eager, switch back to push-to-talk in Settings → Voice → *Voice activation*.
- **Phone can't find the PC** — mDNS is sometimes blocked on guest Wi-Fi. Type the PC IP manually.
- **Phone says "failed to connect … after 6000ms"** — Windows Firewall is blocking the PC. Windows marks hotspot Wi-Fi as *Public*, where incoming connections are blocked. Set the network to **Private** (Settings → Network & Internet → Wi-Fi → your network → Network profile type), restart Bluey and allow it on *Private networks*. Quick check: open `http://<PC IP>:8787/ping` in the phone's browser — it should show `{"app":"bluey"…}`.
- **Bluey answers with canned jokes even though a Gemini key is saved** — Settings → Brain shows why (wrong key, free limit used up, no internet). Make sure the *Google Gemini* option is ticked, not *Offline personality*.
- **`Alt+Space` does nothing** — another app grabbed it; Windows reserves it for window menus. Restart Bluey (it registers globally on launch), or use the tray menu.
- **PC control does nothing in a game** — some full-screen games block synthetic input; use windowed mode.
- **Pointing misses the window** — windows on other monitors aren't targeted in v1 (primary display only).

## 📄 License

MIT. Inspired by and credited to [bluey-by-riley](https://github.com/rbrown101010/bluey-by-riley)
(Unlicense) — this is an independent re-implementation for Windows + Android, not affiliated with Riley Brown or the Bluey TV show.
