'use strict';
/**
 * Companion server: lets the Android app pair with Bluey over Wi-Fi.
 *
 *  - HTTP  GET /ping  -> { app:'bluey', name, version, brain }
 *  - WS   ws://<pc>:<port>/ws
 *
 * Protocol (JSON text frames):
 *   phone -> pc:
 *     { type:'hello',  code:'1234', device:'phone' }
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
 */
const http = require('http');
const os = require('os');
const { WebSocketServer } = require('ws');
const { Bonjour } = require('bonjour-service');

class CompanionServer {
  constructor({ port, code, pcName }) {
    this.port = port;
    this.code = code;
    this.pcName = pcName;
    this.client = null;      // single active phone
    this.bonjour = null;
    this.bonjourService = null;
    this.handlers = {};      // set by main.js
    this.httpServer = null;
    this.wss = null;
  }

  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, ...args) { if (this.handlers[evt]) this.handlers[evt](...args); }

  start() {
    if (this.httpServer) return; // already running
    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/ping' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          app: 'bluey', name: this.pcName, version: '1.0.0',
          brain: this.handlers.brainMode ? this.handlers.brainMode() : 'scripted'
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });

    this.wss.on('connection', (ws) => {
      let authed = false;
      // only one phone at a time - kick the old one
      if (this.client && this.client.readyState === 1) {
        try { this.client.send(JSON.stringify({ type: 'error', msg: 'another device connected' })); this.client.close(); } catch (_) {}
      }
      this.client = ws;

      ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

        if (!authed) {
          if (msg.type === 'hello' && String(msg.code) === String(this.code)) {
            authed = true;
            this.send({ type: 'welcome', name: this.pcName, brain: this.handlers.brainMode ? this.handlers.brainMode() : 'scripted' });
            this.emit('phone-connected');
          } else {
            this.send({ type: 'error', msg: 'wrong pairing code' });
            try { ws.close(); } catch (_) {}
          }
          return;
        }

        try {
          switch (msg.type) {
            case 'ptt':
              this.emit('ptt', Buffer.from(msg.wav, 'base64'), msg.durationMs || 0);
              break;
            case 'text':
              this.emit('text', String(msg.message || ''));
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
          this.send({ type: 'error', msg: e.message });
        }
      });

      ws.on('close', () => {
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
    try { if (this.wss) this.wss.close(); } catch (_) {}
    try { if (this.httpServer) this.httpServer.close(); } catch (_) {}
    this.bonjour = this.bonjourService = this.wss = this.httpServer = this.client = null;
  }

  send(obj) {
    if (this.client && this.client.readyState === 1) {
      try { this.client.send(JSON.stringify(obj)); } catch (_) {}
    }
  }

  /** push a bubble/reply to the phone */
  notifyPhone(obj) { this.send(obj); }
}

module.exports = { CompanionServer };
