'use strict';
/**
 * Tiny JSON config store (no external deps).
 * Lives at userData/config.json so it survives updates.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const CODE_LENGTH = 6;

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
  googleApiKey: '',       // optional: enables Chromium's speech engine for the free wake word (needs a restart)
  // brain
  brain: 'scripted',      // 'scripted' | 'openai' | 'gemini'
  openaiKey: '',
  openaiModel: 'gpt-4o-mini',
  geminiKey: '',          // free key from aistudio.google.com/apikey
  geminiModel: '',        // empty = pick automatically
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

/** random numeric pairing code from a cryptographic RNG (6 digits) */
function generateCode() {
  return String(crypto.randomInt(10 ** (CODE_LENGTH - 1), 10 ** CODE_LENGTH));
}

function load() {
  if (cached) return cached;
  try {
    // tolerate a UTF-8 BOM (Notepad / PowerShell add one) - JSON.parse would reject it and reset everything
    const raw = fs.readFileSync(file(), 'utf8').replace(/^﻿/, '');
    cached = Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch (e) {
    cached = Object.assign({}, DEFAULTS);
  }
  // first run, or a short code from an older version: (re)generate a strong one
  if (!/^\d+$/.test(String(cached.pairingCode || '')) || String(cached.pairingCode).length < CODE_LENGTH) {
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

module.exports = { get, set, all, DEFAULTS, CODE_LENGTH };
