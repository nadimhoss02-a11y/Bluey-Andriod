'use strict';
/**
 * Bluey for Windows - main process.
 * Owns: overlay window (character), tray, global hotkey, chat + settings windows,
 * the brain, PC-control actions, the companion server and the meeting recorder.
 */
const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  ipcMain, screen, shell, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { BrainRouter, ACTIONS, stripWakeWord } = require('./brain');
const control = require('./control');
const { CompanionServer } = require('./server');
const { Recorder } = require('./recorder');

const SELFTEST = process.argv.includes('--selftest');

let overlay = null;      // fullscreen transparent character window
let settingsWin = null;
let chatWin = null;
let tray = null;
let brain = null;
let server = null;
let recorder = null;
let state = {
  listening: false,
  sleeping: false,
  speaking: false,
  lastTalk: 0,
  wakeCooldownUntil: 0,
  wakeErrShownAt: 0,
  autoStopTimer: null,
  meetMenu: null
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showOverlay(true); });
  app.whenReady().then(onReady);
}

app.setAppUserModelId('com.bluey.buddy');
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (server) server.stop();
  if (recorder) recorder.destroy();
});
app.on('window-all-closed', () => { /* keep running in tray */ });

/* ============================================================
 * Startup
 * ============================================================ */

function onReady() {
  brain = new BrainRouter();
  brain.configure(config.all());

  recorder = new Recorder();
  recorder.register();
  recorder.on('level', (rms) => sendOverlay('ov-listening', { on: state.listening, level: rms }));
  recorder.on('chunkSaved', (file, buf) => { maybeTranscribeChunk(file, buf); });
  recorder.on('brainMode', () => brain.mode);
  recorder.on('wakeHeard', (text) => handleWakeUtterance(text));
  recorder.on('wakeClip', (clip) => handleWakeClip(clip));
  recorder.on('wakeError', (kind) => handleWakeError(kind));

  createOverlay();
  createTray();
  registerHotkey();

  if (config.get('serverEnabled')) startServer();
  applyVoiceMode();

  // idle chatter
  setInterval(() => {
    if (!config.get('idleChatter')) return;
    if (state.listening || state.sleeping) return;
    if (recorder.isMeeting) return;
    const quietFor = Date.now() - state.lastTalk;
    if (quietFor < 4 * 60 * 1000) return;
    if (Math.random() < 0.5) {
      sayToOverlay(brain.idleLine(), { voice: false });
    }
  }, 90 * 1000);

  if (SELFTEST) setTimeout(runSelftest, 2500);
}

/* ============================================================
 * Overlay window (the character)
 * ============================================================ */

function createOverlay() {
  const wa = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: false,
    fullscreenable: false, minimizable: false, maximizable: false,
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js') }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'overlay', 'index.html'));
  if (SELFTEST) overlay.show();
}

function showOverlay(show) {
  if (!overlay) return;
  if (show) overlay.showInactive();
  else overlay.hide();
}

function sendOverlay(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

/* ============================================================
 * Tray
 * ============================================================ */

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Bluey - your berry buddy');
  tray.setContextMenu(buildMenu());
}

function buildMenu() {
  const meeting = recorder && recorder.isMeeting;
  return Menu.buildFromTemplate([
    { label: 'Talk to Bluey (Alt+Space)', click: () => toggleListening() },
    { label: 'Wake word "Hey Bluey": ' + (config.get('voiceMode') === 'wake' ? 'ON' : 'off'),
      click: toggleWakeMode },
    { label: 'Point at my mouse', click: () => executeAction({ type: ACTIONS.POINT, target: 'mouse' }) },
    { label: config.get('follow') ? 'Stop following' : 'Follow my mouse',
      click: () => executeAction({ type: ACTIONS.FOLLOW, on: !config.get('follow') }) },
    { type: 'separator' },
    { label: meeting ? 'Stop meeting notes' : 'Start meeting notes',
      click: () => executeAction({ type: ACTIONS.MEETING, start: !meeting }) },
    { label: 'Open notes folder', click: () => recorder.openNotesFolder() },
    { type: 'separator' },
    { label: 'Settings', click: () => openSettings() },
    { label: 'Hide Bluey', click: () => showOverlay(false) },
    { label: 'Show Bluey', click: () => showOverlay(true) },
    { type: 'separator' },
    { label: 'Quit Bluey', click: () => { globalShortcut.unregisterAll(); app.quit(); } }
  ]);
}

/* ============================================================
 * Push-to-talk hotkey (Alt+Space) - works in every voice mode
 * ============================================================ */

function registerHotkey() {
  try {
    globalShortcut.register('Alt+Space', () => toggleListening());
  } catch (e) {
    console.error('[hotkey] Alt+Space unavailable:', e.message);
  }
}

async function toggleListening() {
  if (state.listening) {
    clearTimeout(state.autoStopTimer);
    state.listening = false;
    sendOverlay('ov-listening', { on: false });
    recorder.resumeWake();
    await finishListening();
    return;
  }
  state.listening = true;
  state.lastTalk = Date.now();
  recorder.pauseWake();   // don't wake-spot while we're holding a conversation
  sendOverlay('ov-listening', { on: true });
  try { await recorder.startTalk(); } catch (e) { console.error(e); }
  state.autoStopTimer = setTimeout(() => {
    if (!state.listening) return;
    state.listening = false;
    sendOverlay('ov-listening', { on: false });
    recorder.resumeWake();
    finishListening();
  }, 10000);
}

async function finishListening() {
  const clip = await recorder.stopTalk();
  if (!clip || !clip.data || clip.data.length === 0) {
    sayToOverlay("My ears aren't working — check the microphone permission for Bluey in Windows settings.", { voice: true });
    return;
  }
  const input = { audio: { rms: clip.rms, durationMs: clip.durationMs } };
  if (brain.mode === 'openai') input.audio.buffer = Buffer.from(clip.data);
  const reply = await brain.respond(input, brainCtx());
  sayToOverlay(reply.text, { voice: true });
  if (reply.action) executeAction(reply.action);
}

/* ============================================================
 * Wake word mode ("Hey Bluey")
 *
 * scripted brain -> Chromium speech recognition spots the phrase
 * openai brain   -> voice-activity capture + Whisper transcription
 * She ducks out of listening while she herself is speaking.
 * ============================================================ */

function applyVoiceMode() {
  if (!recorder || !brain) return;
  if (config.get('voiceMode') === 'wake' && !recorder.isMeeting) {
    recorder.startWake({ openai: brain.mode === 'openai' });
  } else {
    recorder.stopWake();
  }
}

function toggleWakeMode() {
  const next = config.get('voiceMode') === 'wake' ? 'ptt' : 'wake';
  config.set('voiceMode', next);
  applyVoiceMode();
  refreshTray();
  if (next === 'wake') {
    sayToOverlay(`Always listening! Say "${config.get('wakeWord')}" and I'm yours.`, { voice: true });
  }
}

/** a transcript arrived from the speech spotter or Whisper */
async function handleWakeUtterance(text) {
  if (!text || Date.now() < state.wakeCooldownUntil) return;
  const hit = stripWakeWord(text, config.get('wakeWord'));
  if (!hit.matched) return;   // someone else's conversation - stay quiet
  state.wakeCooldownUntil = Date.now() + 2000;
  state.lastTalk = Date.now();
  flashListening();
  if (state.sleeping) executeAction({ type: ACTIONS.WAKE });
  if (hit.bare) {
    sayToOverlay(brain.attendLine(), { voice: true });
    return;
  }
  try {
    const reply = await brain.respond({ text: hit.rest }, brainCtx());
    sayToOverlay(reply.text, { voice: true });
    if (reply.action) executeAction(reply.action);
  } catch (e) {
    console.error('[wake] command failed:', e.message);
  }
}

/** an audio clip arrived from the voice-activity spotter (OpenAI brain) */
async function handleWakeClip(clip) {
  if (!clip || !clip.data || brain.mode !== 'openai' || !brain.openai) return;
  if (Date.now() < state.wakeCooldownUntil) return;
  try {
    const text = await brain.openai.transcribe(Buffer.from(clip.data), 'wake-clip.webm');
    await handleWakeUtterance(text);
  } catch (e) {
    console.error('[wake] transcribe failed:', e.message);
  }
}

/** one-time-ish complaints from the wake engine */
function handleWakeError(kind) {
  const now = Date.now();
  if (kind === 'permission') {
    sayToOverlay("I can't reach the microphone — check Windows microphone permission for Bluey, then re-enable wake word.", { voice: true });
    config.set('voiceMode', 'ptt');
    refreshTray();
    return;
  }
  if (now - state.wakeErrShownAt < 5 * 60 * 1000) return;
  if (kind === 'network' && brain.mode !== 'openai') {
    state.wakeErrShownAt = now;
    sayToOverlay('Wake word needs internet for the free speech engine. Alt+Space still works offline.', { voice: false });
  } else if (kind === 'no-speech-api' && brain.mode !== 'openai') {
    state.wakeErrShownAt = now;
    sayToOverlay('No speech engine found for wake word - use Alt+Space, or add an OpenAI key for always-listening.', { voice: false });
  }
}

/** brief ears-perk so you can see she heard her name */
function flashListening() {
  sendOverlay('ov-listening', { on: true });
  setTimeout(() => { if (!state.listening) sendOverlay('ov-listening', { on: false }); }, 1500);
}

/* ============================================================
 * Brain context + actions
 * ============================================================ */

function brainCtx() {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    mood: config.get('mood'),
    follow: config.get('follow'),
    screenW: wa.width, screenH: wa.height,
    execTool: async (name, args) => {
      const action = BrainRouter.toolToAction(name, args);
      return await executeAction(action, { silent: true });
    }
  };
}

function controlAllowed(silent) {
  if (config.get('controlEnabled')) return true;
  if (!silent) sayToOverlay('PC control is switched off — flip it on in Settings → PC control.', { voice: true });
  return false;
}

async function executeAction(action, opts = {}) {
  const silent = opts.silent || action.silent;
  try {
    switch (action.type) {
      case ACTIONS.POINT: {
        const wa = screen.getPrimaryDisplay().workArea;
        let x, y, label = '';
        if (action.target === 'mouse') {
          const p = screen.getCursorScreenPoint();
          x = p.x; y = p.y; label = 'your mouse';
        } else if (action.target === 'center') {
          x = wa.x + wa.width / 2; y = wa.y + wa.height / 2; label = 'screen center';
        } else if (action.target === 'window' && action.query) {
          const found = await control.findWindowTarget(action.query);
          if (found) { x = found.x; y = found.y; label = found.window.title; }
          else {
            if (!silent) sayToOverlay(`I couldn't find a window called "${action.query}". Want me to list what I can see?`, { voice: true });
            return { ok: false, reason: 'window-not-found' };
          }
        } else if (action.target === 'spot') {
          x = action.x; y = action.y;
        } else if (action.target === 'self' && action.spot) {
          // Bluey moves itself
          const spots = {
            left: { x: wa.x + 140, y: wa.y + wa.height - 120 },
            right: { x: wa.x + wa.width - 140, y: wa.y + wa.height - 120 },
            middle: { x: wa.x + wa.width / 2, y: wa.y + wa.height - 120 },
            center: { x: wa.x + wa.width / 2, y: wa.y + wa.height - 120 },
            corner: { x: wa.x + 140, y: wa.y + 80 },
            top: { x: wa.x + wa.width / 2, y: wa.y + 80 }
          };
          sendOverlay('ov-move', spots[action.spot] || spots.left);
          return { ok: true };
        }
        if (x === undefined) { x = screen.getCursorScreenPoint().x; y = screen.getCursorScreenPoint().y; }
        sendOverlay('ov-point', { x: x - wa.x, y: y - wa.y, label });
        if (action.moveSelf) {
          sendOverlay('ov-move', { x: Math.max(90, Math.min(wa.width - 90, x - wa.x)), y: wa.height - 110 });
        }
        return { ok: true, target: label };
      }
      case ACTIONS.CLICK: {
        if (!controlAllowed(silent)) return { ok: false, reason: 'disabled' };
        const r = await control.click(action.kind || 'left');
        return { ok: r.ok };
      }
      case ACTIONS.TYPE: {
        if (!controlAllowed(silent)) return { ok: false, reason: 'disabled' };
        const r = await control.typeText(action.text || '');
        return { ok: r.ok };
      }
      case ACTIONS.SCROLL: {
        if (!controlAllowed(silent)) return { ok: false, reason: 'disabled' };
        const r = await control.scroll(action.clicks || 3);
        return { ok: r.ok };
      }
      case ACTIONS.OPEN: {
        if (!controlAllowed(silent)) return { ok: false, reason: 'disabled' };
        const r = await control.openApp(action.app || '');
        if (!r.ok && !silent) sayToOverlay(`I couldn't launch "${action.app}".`, { voice: true });
        return { ok: r.ok };
      }
      case ACTIONS.FOLLOW: {
        config.set('follow', !!action.on);
        sendOverlay('ov-state', overlayState());
        refreshTray();
        return { ok: true };
      }
      case ACTIONS.SLEEP: {
        state.sleeping = true;
        sendOverlay('ov-sleep', {});
        return { ok: true };
      }
      case ACTIONS.WAKE: {
        state.sleeping = false;
        sendOverlay('ov-wake', {});
        return { ok: true };
      }
      case ACTIONS.WINDOWS: {
        const wins = await control.listWindows();
        if (!wins.length) {
          if (!silent) sayToOverlay('I looked everywhere - no open windows found. Either you are very tidy or very incognito.', { voice: true });
          return { ok: true, windows: [] };
        }
        const names = wins.slice(0, 6).map(w => w.title.length > 34 ? w.title.slice(0, 34) + '…' : w.title);
        const line = `I can see ${wins.length} window${wins.length === 1 ? '' : 's'}: ${names.join('; ')}${wins.length > 6 ? '… and more' : ''}`;
        if (!silent) sayToOverlay(line, { voice: true });
        return { ok: true, windows: wins.map(w => ({ title: w.title, process: w.process })) };
      }
      case ACTIONS.SIZE: {
        const next = Math.max(80, Math.min(220, config.get('size') + (action.delta || 20)));
        config.set('size', next);
        sendOverlay('ov-state', overlayState());
        return { ok: true };
      }
      case ACTIONS.MEETING: {
        if (action.start) {
          recorder.stopWake();   // meetings are private - no wake spotting mid-call
          const dir = await recorder.startMeeting();
          if (!silent) sendOverlay('ov-bubble', { text: 'Recording your meeting. Red dot energy.' });
          refreshTray();
          return { ok: true, dir };
        } else {
          const dir = await recorder.stopMeeting();
          applyVoiceMode();      // resume wake word if it was enabled
          if (!silent) sayToOverlay('Meeting saved to Documents → Bluey Notes.', { voice: true });
          refreshTray();
          return { ok: true, dir };
        }
      }
      default:
        return { ok: true };
    }
  } catch (e) {
    console.error('[action]', e);
    return { ok: false, reason: e.message };
  }
}

/* ============================================================
 * Overlay chat-out
 * ============================================================ */

function sayToOverlay(text, { voice = true } = {}) {
  state.lastTalk = Date.now();
  sendOverlay('ov-bubble', { text, voice, volume: config.get('volume'), voiceName: config.get('voiceName') });
  if (server) server.notifyPhone({ type: 'bubble', text });
}

/* ============================================================
 * Companion server (phone)
 * ============================================================ */

function startServer() {
  const os = require('os');
  server = new CompanionServer({
    port: config.get('port'),
    code: config.get('pairingCode'),
    pcName: `Bluey on ${os.hostname().split('.')[0]}`
  });
  server.on('ptt', async (buf, durMs) => {
    state.lastTalk = Date.now();
    const input = { audio: { rms: 0.1, durationMs: durMs } };
    if (brain.mode === 'openai') input.audio.buffer = buf;
    const reply = await brain.respond(input, brainCtx());
    sayToOverlay(reply.text, { voice: true });
    if (reply.action) executeAction(reply.action);
    server.notifyPhone({ type: 'reply', text: reply.text });
  });
  server.on('text', async (message) => {
    state.lastTalk = Date.now();
    const reply = await brain.respond({ text: message }, brainCtx());
    sayToOverlay(reply.text, { voice: true });
    if (reply.action) executeAction(reply.action);
    server.notifyPhone({ type: 'reply', text: reply.text });
  });
  server.on('cmd', (action) => {
    const map = {
      point_mouse: { type: ACTIONS.POINT, target: 'mouse' },
      follow_on: { type: ACTIONS.FOLLOW, on: true },
      follow_off: { type: ACTIONS.FOLLOW, on: false },
      sleep: { type: ACTIONS.SLEEP },
      wake: { type: ACTIONS.WAKE },
      bigger: { type: ACTIONS.SIZE, delta: 30 },
      smaller: { type: ACTIONS.SIZE, delta: -30 }
    };
    if (map[action]) executeAction(map[action]);
  });
  server.on('volume', (level) => {
    config.set('volume', level / 100);
    sendOverlay('ov-state', overlayState());
  });
  server.on('phone-connected', () => sendOverlay('ov-bubble', { text: 'Ooh, a new friend connected!', voice: false }));
  server.on('brainMode', () => brain.mode);
  server.start();
}

function stopServer() { if (server) { server.stop(); server = null; } }

/* ============================================================
 * Meeting transcription (only when an OpenAI key is configured)
 * ============================================================ */

async function maybeTranscribeChunk(file, buf) {
  if (brain.mode !== 'openai' || !brain.openai) return;
  try {
    const text = await brain.openai.transcribe(buf, path.basename(file));
    const md = file.replace(/chunk-\d+\.webm$/, 'transcript.md');
    fs.appendFileSync(md, `\n### ${path.basename(file)}\n\n${text}\n`, 'utf8');
  } catch (e) {
    console.error('[transcribe]', e.message);
  }
}

/* ============================================================
 * Settings window
 * ============================================================ */

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 460, height: 760, resizable: false,
    title: 'Bluey Settings',
    backgroundColor: '#101423',
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js') }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
}

/* ============================================================
 * Chat window (type at Bluey)
 * ============================================================ */

function openChat() {
  if (chatWin && !chatWin.isDestroyed()) { chatWin.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  chatWin = new BrowserWindow({
    width: 360, height: 130, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    x: wa.x + wa.width - 390, y: wa.y + wa.height - 170,
    webPreferences: { preload: path.join(__dirname, 'chat-preload.js') }
  });
  chatWin.setAlwaysOnTop(true, 'screen-saver');
  chatWin.loadFile(path.join(__dirname, 'overlay', 'chat.html'));
}

async function handleChatText(text) {
  state.lastTalk = Date.now();
  const reply = await brain.respond({ text }, brainCtx());
  sayToOverlay(reply.text, { voice: true });
  if (reply.action) executeAction(reply.action);
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('chat-reply', { text: reply.text });
  if (chatWin && !chatWin.isDestroyed()) setTimeout(() => { try { chatWin.close(); } catch (_) {} }, 400);
}

/* ============================================================
 * IPC
 * ============================================================ */

function overlayState() {
  return {
    size: config.get('size'),
    glow: config.get('glow'),
    mood: config.get('mood'),
    follow: config.get('follow'),
    voice: config.get('voice'),
    volume: config.get('volume'),
    voiceName: config.get('voiceName'),
    sleeping: state.sleeping
  };
}

function registerOverlayIPC() {
  ipcMain.on('ov-ready', () => {
    const wa = screen.getPrimaryDisplay().workArea;
    sendOverlay('ov-state', Object.assign({ waX: wa.x, waY: wa.y, waW: wa.width, waH: wa.height }, overlayState()));
  });
  ipcMain.on('ov-hover', (e, hovering) => {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.setIgnoreMouseEvents(!hovering, { forward: true });
  });
  ipcMain.on('ov-dblclick', () => openChat());
  ipcMain.on('ov-speech', (e, p) => {
    state.speaking = !!(p && p.speaking);
    // while she talks, the wake engine goes quiet so she can't hear herself
    if (config.get('voiceMode') === 'wake') {
      if (state.speaking) recorder.pauseWake(); else recorder.resumeWake();
    }
  });
}

function registerChatIPC() {
  ipcMain.on('chat-send', (e, text) => { handleChatText(String(text || '')); });
  ipcMain.on('chat-close', () => { try { chatWin.close(); } catch (_) {} });
}

function registerSettingsIPC() {
  ipcMain.handle('set-get', () => {
    const wa = screen.getPrimaryDisplay().workArea;
    return Object.assign({}, config.all(), {
      isWindows: control.IS_WINDOWS,
      notesDir: path.join(app.getPath('documents'), 'Bluey Notes'),
      pcIP: lanIP(),
      phoneConnected: !!(server && server.client),
      brainError: brain ? brain.lastError : null,
      brainMode: brain ? brain.mode : 'scripted'
    });
  });
  ipcMain.on('set-save', (e, patch) => {
    const prevPort = config.get('port');
    const prevEnabled = config.get('serverEnabled');
    for (const [k, v] of Object.entries(patch || {})) config.set(k, v);
    // live-apply
    sendOverlay('ov-state', overlayState());
    brain.configure(config.all());
    if (patch.port !== prevPort || patch.serverEnabled !== prevEnabled) {
      stopServer();
      if (config.get('serverEnabled')) startServer();
    }
    // voice mode / brain changes re-arm the wake engine
    if (['voiceMode', 'wakeWord', 'brain', 'openaiKey', 'openaiModel'].some(k => patch && k in patch)) {
      applyVoiceMode();
    }
    refreshTray();
  });
  ipcMain.on('set-open-notes', () => recorder.openNotesFolder());
}

function lanIP() {
  const os = require('os');
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name] || []) {
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return '127.0.0.1';
}

function refreshTray() { if (tray) tray.setContextMenu(buildMenu()); }

/* ============================================================
 * Selftest (dev/CI): render windows, screenshot, exit
 * ============================================================ */

async function runSelftest() {
  const outDir = app.getPath('userData');
  try {
    openSettings();
    await new Promise(r => setTimeout(r, 1200));
    const shot = await settingsWin.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'selftest-settings.png'), shot.toPNG());
    sendOverlay('ov-bubble', { text: 'Selftest! I am alive and googly.', voice: false });
    sendOverlay('ov-point', { x: screen.getPrimaryDisplay().workArea.width / 2, y: 200, label: 'selftest' });
    await new Promise(r => setTimeout(r, 1500));
    const shot2 = await overlay.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'selftest-overlay.png'), shot2.toPNG());
    console.log('SELFTEST_OK ' + outDir);
  } catch (e) {
    console.error('SELFTEST_FAIL', e);
  }
  setTimeout(() => app.exit(0), 400);
}

/* ============================================================
 * Wire it all up
 * ============================================================ */

app.whenReady().then(() => {
  registerOverlayIPC();
  registerChatIPC();
  registerSettingsIPC();
});
