'use strict';
/**
 * Bluey's brain.
 *
 * Two providers behind one interface:
 *   1. ScriptedBrain (default)  - offline personality with a text command parser
 *                                 so PC control works TODAY, no API key needed.
 *   2. OpenAIBrain              - fully implemented; activates the moment you paste
 *                                 an OpenAI key in Settings -> Brain.
 *
 * respond(input, ctx) -> { text, action, say }
 *   input: { text?: string, audio?: {rms:number, durationMs:number} }
 *   action: { type, ... } executed by main.js  (see ACTIONS below)
 */

const CONTROL_VERBS = require('./control');

/* ============================================================
 * Shared helpers
 * ============================================================ */

function pick(arr, notLast) {
  if (arr.length === 1) return arr[0];
  let v = arr[Math.floor(Math.random() * arr.length)];
  if (notLast !== undefined && v === notLast) v = arr[(arr.indexOf(v) + 1) % arr.length];
  return v;
}

const ACTIONS = {
  NONE: 'none',
  POINT: 'point',      // { target:'mouse'|'center'|'window'|'spot', query?, x?, y? }
  CLICK: 'click',      // { kind:'left'|'double'|'right' }
  TYPE: 'type',        // { text }
  SCROLL: 'scroll',    // { clicks }
  OPEN: 'open',        // { app }
  FOLLOW: 'follow',    // { on:boolean }
  SLEEP: 'sleep',
  WAKE: 'wake',
  WINDOWS: 'windows',  // list windows then comment
  SIZE: 'size',        // { delta:number }
  MEETING: 'meeting'   // { start:boolean }
};

/* ============================================================
 * Wake word helper
 * ============================================================ */

/**
 * Try to strip a wake phrase ("hey bluey", "ok bluey", or just "bluey")
 * from a transcript. The keyword is the last word of the configured phrase.
 * Returns { matched, rest, bare }:
 *   matched - the wake word was said at all
 *   rest    - whatever came after it (the actual command)
 *   bare    - ONLY the wake word was said ("hey bluey" and nothing else)
 */
function stripWakeWord(text, phrase = 'hey bluey') {
  const t = String(text || '').trim().toLowerCase().replace(/^["']+|["'.!?,,]+$/g, '');
  if (!t) return { matched: false, rest: '', bare: false };
  const words = String(phrase || '').toLowerCase().split(/\s+/).filter(Boolean);
  const kw = (words[words.length - 1] || 'bluey').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:hey|hi|ok|okay|yo|hello|alright|so)\\s+${kw}\\b[,!]*\\s*(.*)$` +
                        `|^(?:hey|hi|ok|okay|yo|hello|so)?\\s*${kw}\\b[,!]*\\s*(.*)$`, 'i');
  const m = t.match(re);
  if (!m) return { matched: false, rest: '', bare: false };
  const rest = (m[1] !== undefined ? m[1] : (m[2] || '')).trim();
  return { matched: true, rest, bare: rest.length === 0 };
}

/* ============================================================
 * ScriptedBrain - the offline personality
 * ============================================================ */

const LINES = {
  greet: [
    "Hey hey! Bluey's in the house. Well... on the house. On your screen. You get it.",
    "Hi! I was just sitting here being round. What are we doing?",
    "Hello! I've been holding very still so you'd think I'm a desktop icon. Did it work?"
  ],
  who: [
    "I'm Bluey! A blueberry of considerable talent. I point at things, I chat, and I can poke your PC until it does stuff.",
    "Bluey. Professional berry. I live under your cursor and above your taskbar.",
    "Just a small round fruit with big eyes and bigger opinions."
  ],
  how: [
    "Berry good! Ripe, even.",
    "I'd say I'm doing grape... wrong fruit? Great! Doing great.",
    "Living the dream. The dream is being a circle."
  ],
  joke: [
    "Why did the blueberry get promoted? It was outstanding in its jam.",
    "I told my computer I needed a break — now it won't stop sending me KitKat ads.",
    "What's a berry's favorite type of music? Anything with a good jam.",
    "Why don't berries ever use the phone? They prefer tojam.",
    "A SQL query walks into a bar, approaches two tables and asks: 'mind if I join you?'",
    "I'd tell you a UDP joke but you might not get it.",
    "Why did the developer go broke? He used up all his cache."
  ],
  thanks: [
    "Anytime! Berry service, at your service.",
    "You're welcome! This is going on my resume.",
    "That's what friends who are fruit are for."
  ],
  bye: [
    "See ya! I'll be here. Being round.",
    "Bye! I'll guard the taskbar with my life. It's a small life. But guard it I will.",
    "Later! *wiggles eyes mysteriously*"
  ],
  love: [
    "Aw. You're my favorite human. Don't tell the other humans.",
    "I love you too! Platonically. I'm a fruit."
  ],
  praise: [
    "I know, right?!",
    "Careful, my ego is already bigger than my stem.",
    "Stop it, I'm blushing. Do berries blush? I'm doing whatever this is."
  ],
  insult: [
    "Wow. Tossed salad energy. I'll pretend I didn't hear that.",
    "Cool cool cool. I'm adding you to my jam list.",
    "That's fine. I'll just cry blueberry juice quietly."
  ],
  heardLoud: [
    "WHOA, okay, I heard you loud and clear! Big energy!",
    "You sound excited! I'm excited! Everyone's excited!",
    "Wow, projecting today, huh? I respect it."
  ],
  heardShort: [
    "That was... brief. Blink twice if you're testing me.",
    "I caught, hmm, roughly one syllable. A personal best for my ears.",
    "Tiny message. Big mystery."
  ],
  heardGeneric: [
    "Interesting! I'm running on brain-lite right now, so pretend I said something wise.",
    "Hmmmm. Yes. I agree with... whatever that was.",
    "I heard you! My brain is currently a canned-response shaped hole, but I HEARD you.",
    "Fascinating. Add an OpenAI key in my settings and I'll have actual opinions about it.",
    "Noted! Filed under 'things my berry brain vaguely understood'."
  ],
  noWindows: [
    "I looked everywhere. Either you have no windows open or your PC is shy.",
    "Hmm, can't see any window titles from here. Are we incognito?"
  ],
  sleep: [
    "Nap mode engaged. Wake me if anything delicious happens.",
    "Zzz... *(dreams of fruit salad, but like, a respectful one)*",
    "Going dark. It's called beauty sleep. I'm going to need a LOT."
  ],
  wake: [
    "I'M UP, I'M UP. What did I miss?",
    "Whoa. How long was I out? Did anything point at anything?",
    "Reporting for duty! Eyes fully googly."
  ],
  attend: [
    "Yes? I'm listening!",
    "You rang? *eyes wobble excitedly*",
    "Here! What are we doing?",
    "Awake and round. Go ahead.",
    "That's me! What's up?"
  ],
  followOn: [
    "Follow mode! I'm your shadow now. A round, blue shadow.",
    "Okay I'm following you. Casual. Not weird. Totally normal berry behavior."
  ],
  followOff: [
    "Staying put! I'll just... exist here.",
    "Parked. Like a tiny blue car."
  ],
  clicked: [
    "*click* Consider it done.",
    "Boop. Clicked it.",
    "Tapped that button like a berry tapping a drum."
  ],
  typed: [
    "Typed it! My little berry fingers are exhausted.",
    "Done. Did I spell it right? Don't check. Definitely don't check.",
    "Typing accomplished. I expect a fruit basket."
  ],
  scrolled: [
    "*fwip fwip* Scrolled.",
    "Wheeeee — okay I stopped. Scrolled!",
    "Scrolling achieved. I saw things. Some of them were interesting."
  ],
  moved: [
    "Repositioning! I'm basically a tactical berry.",
    "Moving! Watch me navigate this enormous desktop like an ocean Current.",
    "On my way. Waddle waddle."
  ],
  opened: [
    "Opened it! I expect it to behave.",
    "Launching! *imaginary startup sound*",
    "There it goes. If it explodes, that's on you."
  ],
  unknownApp: [
    "I searched my berry memory and found nothing. Try 'notepad', 'calc', 'chrome', 'edge', 'spotify', 'explorer'...",
    "Never heard of that one! Give me something I know: notepad, calc, paint, cmd, chrome, edge, spotify, discord, code..."
  ],
  noKey: [
    "I'd have a smarter answer, but I'm in offline brain mode! Paste an OpenAI key in Settings → Brain and watch me level up.",
    "My canned response generator is proud of this answer. (Settings → Brain, if you want the smart version of me.)"
  ],
  meeting: [
    "Recording! I'll keep quiet and judgmental.",
    "Meeting notes started. I'll be SO quiet. Quietly opinionated."
  ],
  pointMouse: [
    "Pointing at your pointer! Pointer-ception.",
    "Look, it's your cursor! It's doing a great job."
  ],
  pointCenter: [
    "*point* The center of your screen. The heart of it all.",
    "Pointing at dead center. Very dramatic."
  ],
  idle: [
    "Still there? Blink if yes. Wait, that's my trick.",
    "Just vibing down here. The taskbar is nice this time of year.",
    "I've counted your icons. There are... some. Great icons.",
    "If anyone asks, I've been working VERY hard all day.",
    "Fun fact: I'm 94% water, 6% googly eyes.",
    "You've been typing for a while. I'm pretending to understand all of it.",
    "My eyes are following your cursor. This is not creepy. It's friendship.",
    "Leisurely day on the screen. I pointed at three things and called it cardio."
  ]
};

class ScriptedBrain {
  constructor() {
    this._lastIdle = 0;
    this._talkCount = 0;
  }

  /** main text/voice entry point */
  async respond(input, ctx) {
    if (input.text && input.text.trim()) {
      return this.handleText(input.text.trim());
    }
    if (input.audio) {
      return this.handleAudio(input.audio);
    }
    return { text: pick(LINES.heardGeneric), action: { type: ACTIONS.NONE }, say: true };
  }

  handleAudio(audio) {
    this._talkCount++;
    const { rms = 0, durationMs = 0 } = audio;
    if (durationMs < 700) return { text: pick(LINES.heardShort), action: { type: ACTIONS.NONE }, say: true };
    if (rms > 0.18) return { text: pick(LINES.heardLoud), action: { type: ACTIONS.NONE }, say: true };
    // every 3rd utterance, nudge toward the OpenAI upgrade
    if (this._talkCount % 3 === 0) return { text: pick(LINES.noKey), action: { type: ACTIONS.NONE }, say: true };
    return { text: pick(LINES.heardGeneric), action: { type: ACTIONS.NONE }, say: true };
  }

  idleLine() {
    this._lastIdle = Date.now();
    return pick(LINES.idle);
  }

  /** The command parser: PC control works with plain text, no AI required */
  async handleText(raw) {
    const text = raw.trim();
    const low = text.toLowerCase().replace(/[!.?]+$/g, '');

    const say = (t, action) => ({ text: t, action: action || { type: ACTIONS.NONE }, say: true });

    // --- greetings & smalltalk ---
    if (/^(hi|hey|hello|yo|sup|hiya|heyo)\b/.test(low)) return say(pick(LINES.greet));
    if (/(who are you|what are you|your name)/.test(low)) return say(pick(LINES.who));
    if (/(how are you|how's it going|hows it going|how you doing)/.test(low)) return say(pick(LINES.how));
    if (/(tell me a joke|another joke|make me laugh|say a joke)/.test(low)) return say(pick(LINES.joke));
    if (/(thank|thanks|thx)/.test(low)) return say(pick(LINES.thanks));
    if (/(bye|goodbye|see you|good night|goodnight)/.test(low)) return say(pick(LINES.bye));
    if (/(i love you|love you)/.test(low)) return say(pick(LINES.love));
    if (/(you('re| are) (great|awesome|amazing|cute|the best)|good (berry|job|boy))/.test(low)) return say(pick(LINES.praise));
    if (/(you('re| are) (dumb|stupid|useless|bad)|stupid berry|hate you)/.test(low)) return say(pick(LINES.insult));

    // --- sleep / wake ---
    if (/(go to sleep|nap|go to bed|shut eye|sleep now)/.test(low)) return say(pick(LINES.sleep), { type: ACTIONS.SLEEP });
    if (/(wake up|are you asleep|wakey)/.test(low)) return say(pick(LINES.wake), { type: ACTIONS.WAKE });

    // --- follow ---
    if (/(follow me|follow my (mouse|cursor)|come with me)/.test(low)) return say(pick(LINES.followOn), { type: ACTIONS.FOLLOW, on: true });
    if (/(stay|stop following|stay put|sit still)/.test(low)) return say(pick(LINES.followOff), { type: ACTIONS.FOLLOW, on: false });

    // --- meetings (before "open" so "start meeting" isn't eaten) ---
    if (/(start|begin) (a |the )?(meeting|recording)/.test(low)) return say(pick(LINES.meeting), { type: ACTIONS.MEETING, start: true });
    if (/(stop|end) (a |the )?(meeting|recording)/.test(low)) return say("Notes saved! Check Documents → Bluey Notes.", { type: ACTIONS.MEETING, start: false });

    // --- movement ---
    if (/(come here|come over|move left)/.test(low)) return say(pick(LINES.moved), { type: ACTIONS.POINT, target: 'mouse', moveSelf: true });
    if (/(go to|move to|walk to) (the )?(left|right|middle|center|corner|top)/.test(low)) {
      const spot = low.match(/(left|right|middle|center|corner|top)/)[1];
      return say(pick(LINES.moved), { type: ACTIONS.POINT, target: 'self', spot });
    }

    // --- pointing ---
    if (/^point at (my )?mouse/.test(low) || /point at (my )?cursor/.test(low)) {
      return say(pick(LINES.pointMouse), { type: ACTIONS.POINT, target: 'mouse' });
    }
    if (/point at (the )?(middle|center|screen)/.test(low)) {
      return say(pick(LINES.pointCenter), { type: ACTIONS.POINT, target: 'center' });
    }
    const pointWindow = low.match(/point at (?:the )?(?:window )?(.+)/);
    if (pointWindow && !/(^|\b)(mouse|cursor|middle|center|screen|myself)($|\b)|\bme\b/.test(pointWindow[1])) {
      return say(`Hunting for "${pointWindow[1]}"...`, { type: ACTIONS.POINT, target: 'window', query: pointWindow[1] });
    }
    if (/\bpoint\b/.test(low)) return say(pick(LINES.pointCenter), { type: ACTIONS.POINT, target: 'mouse' });

    // --- clicks ---
    if (/double.?click/.test(low)) return say(pick(LINES.clicked), { type: ACTIONS.CLICK, kind: 'double' });
    if (/right.?click/.test(low)) return say(pick(LINES.clicked), { type: ACTIONS.CLICK, kind: 'right' });
    if (/\bclick\b|\bpress it\b|boop (it|that)/.test(low)) return say(pick(LINES.clicked), { type: ACTIONS.CLICK, kind: 'left' });

    // --- typing ---
    const typeMatch = text.match(/^(?:type|write|enter)\s+"?([\s\S]+)"?$/i);
    if (typeMatch) return say(pick(LINES.typed), { type: ACTIONS.TYPE, text: typeMatch[1] });

    // --- scroll ---
    const scrollMatch = low.match(/scroll (up|down)(?: (\d+))?/);
    if (scrollMatch) {
      const dir = scrollMatch[1] === 'down' ? 1 : -1;
      const amount = Math.min(10, parseInt(scrollMatch[2] || '3', 10)) * dir;
      return say(pick(LINES.scrolled), { type: ACTIONS.SCROLL, clicks: amount });
    }

    // --- open apps ---
    const openMatch = low.match(/^(?:open|launch|start|run)\s+(?:the\s+)?(?:app\s+)?(.+)$/);
    if (openMatch && !/meeting|recording/.test(low)) {
      const app = openMatch[1].replace(/\bfor me\b|\bplease\b/g, '').trim();
      return say(pick(LINES.opened), { type: ACTIONS.OPEN, app });
    }

    // --- what's on screen ---
    if (/(what('| i)?s on my screen|what do you see|read my screen|list (my )?windows|what windows)/.test(low)) {
      return say("Scanning your kingdom...", { type: ACTIONS.WINDOWS });
    }

    // --- size ---
    if (/(get )?bigger|grow/.test(low)) return say("BIGGER BERRY!", { type: ACTIONS.SIZE, delta: 30 });
    if (/(get )?smaller|shrink/.test(low)) return say("Smol mode.", { type: ACTIONS.SIZE, delta: -30 });

    // fallback
    if (/\?\s*$/.test(text)) {
      return say("Great question. My offline berry brain votes: " + pick(["yes, probably", "absolutely not", "have you tried turning it off and on again", "42"]) + ". " + pick(LINES.noKey));
    }
    return say(pick(LINES.heardGeneric));
  }
}

/* ============================================================
 * OpenAIBrain - activates when a key is pasted (Settings → Brain)
 * ============================================================ */

const SYSTEM_PROMPT = `You are Bluey, a small cheeky blueberry with big googly eyes who lives on the user's screen.
You are playful, brief (1-2 sentences unless asked for more), a little dramatic, and genuinely helpful.
You can control the user's PC using the provided tools. When the user asks you to do something on the computer, use tools.
When you point at something, briefly say what you're pointing at.
Never use emoji. You are a berry, not a marketing department.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'point_at',
      description: 'Point Bluey\'s arrow cursor at something on screen. Use before clicking on things.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['mouse', 'center', 'window', 'spot'] },
          query: { type: 'string', description: 'window title or process name fragment when target=window' },
          x: { type: 'number' }, y: { type: 'number', description: 'screen coords when target=spot' }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click the mouse at its current position. Point first if a specific target is needed.',
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['left', 'double', 'right'] } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into the currently focused window.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the mouse wheel. Positive = down, negative = up.',
      parameters: { type: 'object', properties: { clicks: { type: 'number' } }, required: ['clicks'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: 'Open an application by name, e.g. notepad, calc, chrome, spotify.',
      parameters: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_windows',
      description: 'List titles of open windows so you can see what is on screen.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_follow',
      description: 'Make Bluey follow the user\'s mouse, or stop following.',
      parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] }
    }
  }
];

class OpenAIBrain {
  constructor(key, model = 'gpt-4o-mini') {
    this.key = key;
    this.model = model;
    this.history = []; // rolling window
  }

  setKey(key, model) { this.key = key; if (model) this.model = model; }

  async transcribe(buffer, filename = 'clip.wav') {
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);
    form.append('model', 'whisper-1');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}` },
      body: form
    });
    if (!res.ok) throw new Error('STT failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const json = await res.json();
    return json.text || '';
  }

  async speak(text) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: 'shimmer', input: text, response_format: 'wav' })
    });
    if (!res.ok) throw new Error('TTS failed: ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  }

  async respond(input, ctx) {
    let text = input.text || '';
    if (!text && input.audio && input.audio.buffer) {
      text = await this.transcribe(input.audio.buffer);
    }
    if (!text) return { text: "I didn't catch that — say it again?", action: { type: ACTIONS.NONE }, say: true };

    this.history.push({ role: 'user', content: text });
    if (this.history.length > 16) this.history = this.history.slice(-16);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: `Current state: mood=${ctx.mood}, follow=${ctx.follow}, brain=openai. Screen size ${ctx.screenW}x${ctx.screenH}.` },
      ...this.history
    ];

    let replyText = '';
    let action = { type: ACTIONS.NONE };

    for (let hop = 0; hop < 3; hop++) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, tools: TOOLS })
      });
      if (!res.ok) throw new Error('Chat failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
      const json = await res.json();
      const msg = json.choices && json.choices[0] && json.choices[0].message;
      if (!msg) break;
      if (msg.tool_calls && msg.tool_calls.length) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          let result = 'ok';
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            const executed = await ctx.execTool(tc.function.name, args);
            result = JSON.stringify(executed || { ok: true });
          } catch (e) { result = 'error: ' + e.message; }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        continue; // let the model speak after tooling
      }
      replyText = msg.content || '';
      this.history.push({ role: 'assistant', content: replyText });
      break;
    }

    if (!replyText) replyText = 'Done!';
    return { text: replyText, action, say: true };
  }
}

/* ============================================================
 * Router
 * ============================================================ */

class BrainRouter {
  constructor() {
    this.scripted = new ScriptedBrain();
    this.openai = null;
    this.mode = 'scripted';
    this.lastError = null;
  }

  configure(cfg) {
    if (cfg.brain === 'openai' && cfg.openaiKey) {
      this.mode = 'openai';
      if (!this.openai) this.openai = new OpenAIBrain(cfg.openaiKey, cfg.openaiModel);
      else this.openai.setKey(cfg.openaiKey, cfg.openaiModel);
    } else {
      this.mode = 'scripted';
    }
  }

  async respond(input, ctx) {
    try {
      if (this.mode === 'openai' && this.openai) {
        return await this.openai.respond(input, ctx);
      }
      return await this.scripted.respond(input, ctx);
    } catch (e) {
      this.lastError = e.message;
      console.error('[brain] error:', e.message);
      // graceful fallback to scripted
      const fb = await this.scripted.respond(input, ctx);
      fb.text = fb.text; // keep it light; error surfaced in settings
      return fb;
    }
  }

  idleLine() { return this.scripted.idleLine(); }

  /** playful answer when someone says just the wake word */
  attendLine() { return pick(LINES.attend); }

  /** map a tool name to a main-process action (used by ctx.execTool) */
  static toolToAction(name, args) {
    switch (name) {
      case 'point_at': return { type: ACTIONS.POINT, target: args.target || 'center', query: args.query, x: args.x, y: args.y };
      case 'click': return { type: ACTIONS.CLICK, kind: args.kind || 'left', immediate: true };
      case 'type_text': return { type: ACTIONS.TYPE, text: args.text || '', immediate: true };
      case 'scroll': return { type: ACTIONS.SCROLL, clicks: args.clicks || 3, immediate: true };
      case 'open_app': return { type: ACTIONS.OPEN, app: args.app || '', immediate: true };
      case 'list_windows': return { type: ACTIONS.WINDOWS, silent: true };
      case 'set_follow': return { type: ACTIONS.FOLLOW, on: !!args.on, immediate: true };
      default: return { type: ACTIONS.NONE };
    }
  }
}

module.exports = { BrainRouter, ScriptedBrain, OpenAIBrain, ACTIONS, LINES, CONTROL_VERBS, stripWakeWord };
