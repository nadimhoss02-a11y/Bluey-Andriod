'use strict';
/* Bluey overlay renderer: googly-eye physics, bubbles, pointing cursor, follow mode. */

const $ = (id) => document.getElementById(id);
const bluey = $('bluey');
const body = $('body');
const bubble = $('bubble');
const bubbleText = $('bubble-text');
const waves = $('waves');
const pointer = $('pointer');
const pupilEls = [document.querySelector('#eyeL .pupil'), document.querySelector('#eyeR .pupil')];
const eyeCenters = [document.getElementById('eyeL'), document.getElementById('eyeR')];

const state = {
  mouseX: innerWidth / 2, mouseY: innerHeight / 2,
  lastMouseMove: Date.now(),
  size: 130, follow: false,
  sleeping: false,
  voice: true, volume: 0.9, voiceName: '',
  hover: false,
  bubbleTimer: null,
  blinkTimer: null,
  glance: { x: innerWidth / 2, y: innerHeight / 2 }
};

/* character position (bottom anchored) */
let charX = 120, charTargetX = 120;
let charY = 20, charTargetY = 20; // bottom offset

/* pupil physics (SVG user units) */
const pup = pupilEls.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));

/* ================= helpers ================= */

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function layout() {
  const s = state.size / 130;
  const w = Math.round(160 * s), h = Math.round(190 * s);
  bluey.style.width = w + 'px';
  bluey.style.height = h + 'px';
}

function place() {
  bluey.style.left = charX + 'px';
  bluey.style.bottom = charY + 'px';
}

/* ================= eyes ================= */

function pupilTargets() {
  // where should pupils look?
  const look = (Date.now() - state.lastMouseMove < 6000)
    ? { x: state.mouseX, y: state.mouseY }
    : state.glance;
  return eyeCenters.map((g) => {
    const r = g.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = look.x - cx, dy = look.y - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const maxR = 13; // svg units
    return { x: (dx / dist) * Math.min(1, dist / 160) * maxR, y: (dy / dist) * Math.min(1, dist / 160) * maxR };
  });
}

function tick() {
  // pupils spring physics -> googly
  const targets = pupilTargets();
  for (let i = 0; i < 2; i++) {
    const p = pup[i], t = targets[i];
    p.vx += (t.x - p.x) * 0.16;
    p.vy += (t.y - p.y) * 0.16;
    p.vx *= 0.78; p.vy *= 0.78;
    p.x += p.vx; p.y += p.vy;
    pupilEls[i].setAttribute('transform', `translate(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  }

  // follow mode / smooth wandering
  if (state.follow && !state.sleeping) {
    charTargetX = clamp(state.mouseX - 80, 4, innerWidth - 170);
  }
  charX += (charTargetX - charX) * 0.06;
  charY += (charTargetY - charY) * 0.08;
  place();

  requestAnimationFrame(tick);
}

/* blink */
function scheduleBlink() {
  state.blinkTimer = setTimeout(() => {
    if (!state.sleeping) {
      bluey.classList.add('blink');
      setTimeout(() => bluey.classList.remove('blink'), 130);
      if (Math.random() < 0.25) setTimeout(() => {
        bluey.classList.add('blink');
        setTimeout(() => bluey.classList.remove('blink'), 130);
      }, 220);
    }
    scheduleBlink();
  }, 2200 + Math.random() * 3400);
}

/* idle glances when mouse is quiet */
setInterval(() => {
  if (Date.now() - state.lastMouseMove > 6000) {
    state.glance = { x: Math.random() * innerWidth, y: Math.random() * innerHeight * 0.6 };
  }
}, 2600);

/* ================= input ================= */

addEventListener('mousemove', (e) => {
  state.mouseX = e.clientX; state.mouseY = e.clientY;
  state.lastMouseMove = Date.now();
  const r = bluey.getBoundingClientRect();
  const pad = 26;
  const inside = e.clientX > r.left - pad && e.clientX < r.right + pad &&
                 e.clientY > r.top - pad && e.clientY < r.bottom + pad;
  if (inside !== state.hover) {
    state.hover = inside;
    window.bluey.send('ov-hover', inside);
  }
});

bluey.addEventListener('dblclick', () => window.bluey.send('ov-dblclick', {}));

/* ================= speech bubble ================= */

function speak(text) {
  if (!state.voice || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.volume = state.volume;
    u.rate = 1.04; u.pitch = 1.35;
    const voices = speechSynthesis.getVoices();
    if (state.voiceName) {
      const v = voices.find(v => v.name === state.voiceName);
      if (v) u.voice = v;
    } else {
      const v = voices.find(v => /en[-_]/i.test(v.lang) && /(zira|aria|jenny|female|samantha)/i.test(v.name));
      if (v) u.voice = v; else {
        const en = voices.find(v => /^en/i.test(v.lang));
        if (en) u.voice = en;
      }
    }
    // tell main when she's talking so wake-word listening ducks out of the way
    u.onstart = () => window.bluey.send('ov-speech', { speaking: true });
    const done = () => window.bluey.send('ov-speech', { speaking: false });
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
  } catch (_) {}
}

let typing = null;
function showBubble(text, voice) {
  clearTimeout(state.bubbleTimer);
  if (typing) clearInterval(typing);
  bubble.classList.remove('hidden');
  bubbleText.textContent = '';
  let i = 0;
  typing = setInterval(() => {
    i += 2;
    bubbleText.textContent = text.slice(0, i);
    if (i >= text.length) { clearInterval(typing); typing = null; }
  }, 18);
  if (voice) speak(text);
  const hold = 2600 + Math.min(6000, text.length * 55);
  state.bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), hold);
}

/* ================= voice menu integration ================= */

if ('speechSynthesis' in window) {
  speechSynthesis.getVoices(); // kick
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

/* ================= pointing cursor ================= */

let pointAnim = null;
function pointAt(x, y) {
  if (pointAnim) cancelAnimationFrame(pointAnim);
  const start = { x: charX + 80, y: innerHeight - charY - 150 };
  const t0 = performance.now();
  const fly = 650;
  const ctrl = { x: (start.x + x) / 2, y: Math.min(start.y, y) - 140 };
  pointer.classList.remove('hidden');

  const bezier = (t, a, b, c) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

  function frame(now) {
    const t = clamp((now - t0) / fly, 0, 1);
    const px = bezier(t, start.x, ctrl.x, x);
    const py = bezier(t, start.y, ctrl.y, y);
    pointer.style.transform = `translate(${px - 6}px, ${py - 4}px)`;
    if (t < 1) { pointAnim = requestAnimationFrame(frame); return; }
    pointer.classList.add('wiggle');
    setTimeout(() => {
      pointer.classList.remove('wiggle');
      // return home
      const t1 = performance.now();
      function back(now2) {
        const u = clamp((now2 - t1) / 500, 0, 1);
        const bx = bezier(u, x, ctrl.x, start.x);
        const by = bezier(u, y, ctrl.y, start.y);
        pointer.style.transform = `translate(${bx - 6}px, ${by - 4}px)`;
        if (u < 1) { pointAnim = requestAnimationFrame(back); }
        else pointer.classList.add('hidden');
      }
      pointAnim = requestAnimationFrame(back);
    }, 1600);
  }
  pointAnim = requestAnimationFrame(frame);
}

/* ================= messages from main ================= */

window.bluey.on('ov-state', (s) => {
  if (!s) return;
  if (s.size) { state.size = s.size; layout(); }
  if (s.glow !== undefined) bluey.classList.toggle('noglow', !s.glow);
  if (s.mood) { bluey.className = bluey.className.replace(/mood-\w+/, 'mood-' + s.mood); }
  if (s.follow !== undefined) state.follow = s.follow;
  if (s.voice !== undefined) state.voice = s.voice;
  if (s.volume !== undefined) state.volume = s.volume;
  if (s.voiceName !== undefined) state.voiceName = s.voiceName;
});

window.bluey.on('ov-bubble', (m) => { if (m && m.text) showBubble(m.text, !!m.voice); });

window.bluey.on('ov-listening', (m) => {
  if (!m) return;
  waves.classList.toggle('hidden', !m.on);
});

window.bluey.on('ov-point', (m) => { if (m && typeof m.x === 'number') pointAt(m.x, m.y); });

window.bluey.on('ov-move', (m) => {
  if (!m) return;
  if (typeof m.x === 'number') charTargetX = clamp(m.x - 80, 4, innerWidth - 170);
  if (typeof m.y === 'number') charTargetY = clamp(innerHeight - m.y - 190, 0, innerHeight);
});

window.bluey.on('ov-sleep', () => { state.sleeping = true; bluey.classList.add('sleeping'); $('zzz').classList.remove('hidden'); });
window.bluey.on('ov-wake', () => { state.sleeping = false; bluey.classList.remove('sleeping'); $('zzz').classList.add('hidden'); });

/* ================= boot ================= */

window.bluey.send('ov-ready', {});
layout();
place();
scheduleBlink();
requestAnimationFrame(tick);
