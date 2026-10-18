'use strict';
/**
 * Companion server: lets the Android app pair with Bluey over Wi-Fi.
 *
 *  - HTTP  GET /ping  -> { app:'bluey', name, version, brain }
 *  - WS   ws://<pc>:<port>/ws
 *
 * Protocol (JSON text frames):
 *   phone -> pc:
 *     { type:'hello',  code:'123456', device:'phone' }         // must be the FIRST frame
 *     { type:'ptt',    wav:'<base64 wav>', durationMs:1234 }   // push-to-talk audio
 *     { type:'text',   message:'open notepad' }                // chat from phone
 *     { type:'cmd',    action:'point_mouse|follow_on|follow_off|sleep|wake|bigger|smaller' }
 *     { type:'volume', level:80 }                              // 0..100 speech volume
 *   pc -> phone:
 *     { type:'welcome', name:'Bluey on DESKTOP', brain:'scripted' }
 *     { type:'reply',   text:'...' }                           // answer to ptt/text
 *     { type:'bubble',  text:'...' }                           // idle chatter etc.
 *     { type:'status',  connected:true, meeting:false }
 *     { type:'error',   msg:'bad code' }
 *
 * Discovery: mDNS advertisement of service type _bluey._tcp (Android NSD finds it).
 *
 * Hardening (the phone can click, type and open apps on this PC, so the pairing code is a real secret):
 *  - a socket is only "the phone" after a correct hello; before that it receives nothing and
 *    cannot displace the paired phone
 *  - hello must arrive within a few seconds or the socket is dropped
 *  - wrong codes are throttled per address and globally (lockout), codes are compared in constant time
 *  - connections that carry an Origin header (i.e. from a web page in a browser) are refused
 *  - frames are size-limited
 */
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Bonjour } = require('bonjour-service');

const DEFAULT_LIMITS = {
  helloTimeoutMs: 5000,
  maxFailuresPerIp: 5,
  failureWindowMs: 10 * 60 * 1000,
  lockoutMs: 10 * 60 * 1000,
  maxFailuresGlobal: 60,
  globalWindowMs: 60 * 1000,
  maxPayload: 25 * 1024 * 1024
};

class CompanionServer {
  constructor({ port, code, pcName, version, limits }) {
    this.port = port;
    this.code = String(code);
    this.pcName = pcName;
    this.version = version || '0.0.0';
    this.limits = Object.assign({}, DEFAULT_LIMITS, limits || {});
    this.client = null;      // the single AUTHENTICATED phone
    this.bonjour = null;
    this.bonjourService = null;
    this.handlers = {};      // set by main.js
    this.httpServer = null;
    this.wss = null;
    this._fails = new Map(); // ip -> { count, first, blockedUntil }
    this._globalFails = [];  // timestamps of recent wrong codes (any address)
  }

  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, ...args) {
    const fn = this.handlers[evt];
    if (!fn) return;
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((e) => console.error('[server] handler', evt, 'failed:', e && e.message));
    } catch (e) {
      console.error('[server] handler', evt, 'failed:', e && e.message);
    }
  }

  /* ---------- brute-force protection ---------- */

  _ipOf(req) {
    return String((req && req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  }

  _isBlocked(ip, now = Date.now()) {
    const e = this._fails.get(ip);
    if (e && e.blockedUntil > now) return true;
    this._globalFails = this._globalFails.filter(t => now - t < this.limits.globalWindowMs);
    return this._globalFails.length >= this.limits.maxFailuresGlobal;
  }

  _noteFailure(ip, now = Date.now()) {
    let e = this._fails.get(ip);
    if (!e || now - e.first > this.limits.failureWindowMs) e = { count: 0, first: now, blockedUntil: 0 };
    e.count++;
    if (e.count >= this.limits.maxFailuresPerIp) e.blockedUntil = now + this.limits.lockoutMs;
    this._fails.set(ip, e);
    this._globalFails.push(now);
    if (this._fails.size > 500) { // keep memory bounded
      for (const [k, v] of this._fails) if (v.blockedUntil < now && now - v.first > this.limits.failureWindowMs) this._fails.delete(k);
    }
  }

  _codeOk(candidate) {
    const a = Buffer.from(String(candidate === undefined || candidate === null ? '' : candidate));
    const b = Buffer.from(this.code);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /* ---------- server ---------- */

  start() {
    if (this.httpServer) return; // already running
    this.httpServer = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/ping' || req.url === '/')) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          app: 'bluey', name: this.pcName, version: this.version,
          brain: this.handlers.brainMode ? this.handlers.brainMode() : 'scripted'
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: '/ws',
      maxPayload: this.limits.maxPayload,
      // the phone app is not a browser and sends no Origin; a web page trying to reach us always does
      verifyClient: (info) => !info.req.headers.origin
    });

    this.wss.on('connection', (ws, req) => {
      const ip = this._ipOf(req);
      if (this._isBlocked(ip)) {
        this._sendTo(ws, { type: 'error', msg: 'too many wrong codes - try again later' });
        try { ws.close(); } catch (_) {}
        return;
      }

      let authed = false;
      const helloTimer = setTimeout(() => { if (!authed) { try { ws.close(); } catch (_) {} } }, this.limits.helloTimeoutMs);

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
        if (!msg || typeof msg !== 'object') return;

        if (!authed) {
          if (msg.type === 'hello' && !this._isBlocked(ip) && this._codeOk(msg.code)) {
            authed = true;
            clearTimeout(helloTimer);
            this._fails.delete(ip);
            // only now does this socket become "the phone" - and only now is the old one replaced
            const old = this.client;
            this.client = ws;
            if (old && old !== ws && old.readyState === 1) {
              this._sendTo(old, { type: 'error', msg: 'another device connected' });
              try { old.close(); } catch (_) {}
            }
            this._sendTo(ws, { type: 'welcome', name: this.pcName, brain: this.handlers.brainMode ? this.handlers.brainMode() : 'scripted' });
            this.emit('phone-connected');
          } else {
            if (msg.type === 'hello') this._noteFailure(ip);
            this._sendTo(ws, { type: 'error', msg: this._isBlocked(ip) ? 'too many wrong codes - try again later' : 'wrong pairing code' });
            try { ws.close(); } catch (_) {}
          }
          return;
        }

        try {
          switch (msg.type) {
            case 'ptt':
              if (typeof msg.wav !== 'string') throw new Error('ptt needs a base64 wav');
              this.emit('ptt', Buffer.from(msg.wav, 'base64'), Number(msg.durationMs) || 0);
              break;
            case 'text':
              this.emit('text', String(msg.message || '').slice(0, 2000));
              break;
            case 'cmd':
              this.emit('cmd', String(msg.action || ''));
              break;
            case 'volume':
              this.emit('volume', Math.max(0, Math.min(100, Number(msg.level) || 0)));
              break;
            default: break;
          }
        } catch (e) {
          this._sendTo(ws, { type: 'error', msg: e.message });
        }
      });

      ws.on('close', () => {
        clearTimeout(helloTimer);
        if (this.client === ws) { this.client = null; this.emit('phone-disconnected'); }
      });
      ws.on('error', () => {});
    });

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        // mDNS announce so the phone can auto-discover
        try {
          this.bonjour = new Bonjour();
          const host = os.hostname().split('.')[0];
          this.bonjourService = this.bonjour.publish({
            name: `Bluey on ${host}`,
            type: 'bluey',
            port: this.port,
            txt: { v: '1', app: 'bluey' }
          });
        } catch (e) {
          console.error('[server] mdns failed:', e.message);
        }
        console.log('[server] companion server on port', this.port);
        resolve(this.port);
      });
    });
  }

  stop() {
    try { if (this.bonjourService) this.bonjourService.stop(); } catch (_) {}
    try { if (this.bonjour) this.bonjour.destroy(); } catch (_) {}
    try { if (this.wss) { for (const c of this.wss.clients) { try { c.terminate(); } catch (_) {} } this.wss.close(); } } catch (_) {}
    try { if (this.httpServer) this.httpServer.close(); } catch (_) {}
    this.bonjour = this.bonjourService = this.wss = this.httpServer = this.client = null;
  }

  _sendTo(ws, obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch (_) {}
    }
  }

  /** send to the authenticated phone (nobody else ever receives pushes) */
  send(obj) { this._sendTo(this.client, obj); }

  /** push a bubble/reply to the phone */
  notifyPhone(obj) { this.send(obj); }
}

module.exports = { CompanionServer, DEFAULT_LIMITS };
