'use strict';
/**
 * Audio recording manager (hidden window based).
 *  - push-to-talk clips  : recorder collects a clip -> main gets buffer + stats
 *  - meeting notes       : 5-minute chunks -> Documents/Bluey Notes/<date> <id>/
 *
 * MediaRecorder is used inside the hidden renderer (Chromium handles mic access),
 * main process never touches native audio APIs.
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

class Recorder {
  constructor() {
    this.win = null;
    this.talkResolve = null;
    this.meeting = null; // { dir, chunkIndex, startedAt }
    this._ready = null;
  }

  _ensure() {
    if (this.win && !this.win.isDestroyed()) return Promise.resolve(this.win);
    this._ready = new Promise((resolve) => {
      this.win = new BrowserWindow({
        show: false,
        width: 10, height: 10,
        webPreferences: {
          preload: path.join(__dirname, 'recorder-preload.js'),
          backgroundThrottling: false
        }
      });
      this.win.loadFile(path.join(__dirname, 'recorder.html')).then(() => resolve(this.win));
    });
    return this._ready;
  }

  register() {
    ipcMain.on('rec-level', (e, rms) => {
      if (this.handlers && this.handlers.level) this.handlers.level(rms);
    });
    ipcMain.on('rec-clip', (e, payload) => {
      if (this.talkResolve) {
        this.talkResolve(payload);
        this.talkResolve = null;
      }
    });
    ipcMain.on('rec-chunk', (e, payload) => {
      this._saveChunk(payload.data).catch(err => console.error('[recorder] chunk save failed:', err.message));
    });
    ipcMain.on('rec-error', (e, msg) => {
      console.error('[recorder] renderer error:', msg);
      if (this.talkResolve) { this.talkResolve(null); this.talkResolve = null; }
    });
    ipcMain.on('rec-wake-heard', (e, text) => {
      if (this.handlers && this.handlers.wakeHeard) this.handlers.wakeHeard(String(text || ''));
    });
    ipcMain.on('rec-wake-clip', (e, payload) => {
      if (this.handlers && this.handlers.wakeClip) this.handlers.wakeClip(payload);
    });
    ipcMain.on('rec-wake-error', (e, kind) => {
      if (this.handlers && this.handlers.wakeError) this.handlers.wakeError(String(kind || ''));
    });
  }

  on(evt, fn) { this.handlers = this.handlers || {}; this.handlers[evt] = fn; }

  /* ---------- push-to-talk ---------- */

  async startTalk() {
    await this._ensure();
    this.win.webContents.send('rec-cmd', { op: 'talk-start' });
  }

  /** resolves { data: Uint8Array, durationMs, rms } or null */
  async stopTalk() {
    if (!this.win) return null;
    const p = new Promise((resolve) => { this.talkResolve = resolve; });
    this.win.webContents.send('rec-cmd', { op: 'talk-stop' });
    const result = await Promise.race([p, new Promise(r => setTimeout(() => r(null), 4000))]);
    return result;
  }

  cancelTalk() {
    if (this.win) this.win.webContents.send('rec-cmd', { op: 'talk-cancel' });
  }

  /* ---------- wake word (always listening) ---------- */

  async startWake(opts = {}) {
    await this._ensure();
    this.win.webContents.send('rec-cmd', { op: 'wake-start', openai: !!opts.openai });
  }

  stopWake() {
    if (this.win) this.win.webContents.send('rec-cmd', { op: 'wake-stop' });
  }

  pauseWake() {
    if (this.win) this.win.webContents.send('rec-cmd', { op: 'wake-pause' });
  }

  resumeWake() {
    if (this.win) this.win.webContents.send('rec-cmd', { op: 'wake-resume' });
  }

  /* ---------- meeting notes ---------- */

  _notesDir() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
    const id = Math.random().toString(36).slice(2, 6);
    return path.join(app.getPath('documents'), 'Bluey Notes', `${stamp} ${id}`);
  }

  async startMeeting() {
    if (this.meeting) return this.meeting.dir;
    await this._ensure();
    const dir = this._notesDir();
    fs.mkdirSync(dir, { recursive: true });
    this.meeting = { dir, chunkIndex: 0, startedAt: Date.now() };
    fs.writeFileSync(path.join(dir, 'notes.md'),
      `# Bluey Meeting Notes\n\n- Started: ${new Date().toLocaleString()}\n- Audio: ${Math.round(300 / 60)}-minute audio chunks (webm/opus)\n- Transcription: ${this.handlers && this.handlers.brainMode && this.handlers.brainMode() === 'openai' ? 'enabled' : 'requires an OpenAI key (Settings → Brain) — audio is saved and can be transcribed later'}\n\n## Timeline\n`, 'utf8');
    this.win.webContents.send('rec-cmd', { op: 'meeting-start', chunkSeconds: 300 });
    return dir;
  }

  async stopMeeting() {
    if (!this.meeting) return null;
    const { dir } = this.meeting;
    this.win.webContents.send('rec-cmd', { op: 'meeting-stop' });
    const endedAt = new Date().toLocaleString();
    const meta = this.meeting;
    setTimeout(() => {
      try {
        fs.appendFileSync(path.join(dir, 'notes.md'),
          `\n\n- Ended: ${endedAt}\n- Duration: ${Math.round((Date.now() - meta.startedAt) / 60000)} min\n`, 'utf8');
      } catch (_) {}
    }, 500);
    this.meeting = null;
    return dir;
  }

  get isMeeting() { return !!this.meeting; }

  async _saveChunk(u8) {
    if (!this.meeting || !u8) return;
    const idx = this.meeting.chunkIndex++;
    const file = path.join(this.meeting.dir, `chunk-${String(idx + 1).padStart(2, '0')}.webm`);
    fs.writeFileSync(file, Buffer.from(u8));
    if (this.meeting) {
      fs.appendFileSync(path.join(this.meeting.dir, 'notes.md'),
        `- chunk ${idx + 1} @ ${new Date().toLocaleTimeString()}\n`, 'utf8');
    }
    if (this.handlers && this.handlers.chunkSaved) this.handlers.chunkSaved(file, Buffer.from(u8));
  }

  openNotesFolder() {
    const base = path.join(app.getPath('documents'), 'Bluey Notes');
    if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
    shell.openPath(base);
  }

  destroy() {
    try { if (this.win) this.win.destroy(); } catch (_) {}
  }
}

module.exports = { Recorder };
