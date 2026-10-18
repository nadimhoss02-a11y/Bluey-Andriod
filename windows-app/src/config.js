'use strict';
/**
 * Tiny JSON config store (no external deps).
 * Lives at userData/config.json so it survives updates.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  // character
  size: 130,              // px body diameter (80 - 220)
  glow: true,
  mood: 'happy',          // happy | sleepy | excitable | grumpy
  follow: false,          // follow the mouse
  idleChatter: true,
  // voice
  voice: true,            // speak replies out loud
  voiceName: '',          // speechSynthesis voice name (overlay picks closest)
  volume: 0.9,            // 0..1
  // voice input
  voiceMode: 'ptt',       // 'ptt' (Alt+Space) | 'wake' ("Hey Bluey") | 'off'
  wakeWord: 'hey bluey',  // phrase; she also answers to just her name
  // brain
  brain: 'scripted',      // 'scripted' | 'openai'
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
  // pc control
  controlEnabled: true,
  // companion server
  serverEnabled: true,
  port: 8787,
  pairingCode: '',        // generated on first run
  // meetings
  chunkSeconds: 300
};

let cached = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function load() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cached = Object.assign({}, DEFAULTS, raw);
  } catch (e) {
    cached = Object.assign({}, DEFAULTS);
  }
  if (!cached.pairingCode) {
    cached.pairingCode = generateCode();
    persist();
  }
  return cached;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cached, null, 2), 'utf8');
  } catch (e) {
    console.error('[config] save failed:', e.message);
  }
}

function get(key, fallback) {
  const cfg = load();
  return key in cfg ? cfg[key] : fallback;
}

function set(key, value) {
  const cfg = load();
  cfg[key] = value;
  persist();
  return cfg;
}

function all() {
  return Object.assign({}, load());
}

module.exports = { get, set, all, DEFAULTS };
