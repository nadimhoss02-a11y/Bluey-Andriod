'use strict';
/**
 * PC control for Bluey on Windows.
 * Everything is done through PowerShell + user32.dll SendInput-style calls,
 * so there are ZERO native npm dependencies to compile. Works on stock Windows 10/11.
 *
 * On non-Windows platforms every call no-ops gracefully (so devs on mac/linux can run the UI).
 *
 * Safety notes:
 *  - Scripts are handed to PowerShell as -EncodedCommand (base64 UTF-16), and any user-supplied
 *    text (what to type, which app to open) is embedded as base64 too, so it is never parsed as
 *    PowerShell code - typographic quotes, backticks, $(...) etc. are all just data.
 *  - openApp only launches plain program names (or a known alias), never paths or URLs.
 */
const { spawn } = require('child_process');
const os = require('os');

const IS_WINDOWS = os.platform() === 'win32';

const MAX_TYPE_CHARS = 4000;

// PowerShell's cold start can take 6+ seconds on a busy PC with antivirus; a short timeout turned slow into "failed"
function ps(script, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!IS_WINDOWS) {
      resolve({ ok: false, reason: 'windows-only', stdout: '', stderr: 'not windows' });
      return;
    }
    let out = '', err = '', done = false;
    // (no progress records: they would otherwise show up on stderr as CLIXML noise)
    const encoded = Buffer.from("$ProgressPreference = 'SilentlyContinue'\n" + script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true });
    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill(); } catch (_) {} resolve({ ok: false, reason: 'timeout', stdout: out, stderr: err }); }
    }, timeoutMs);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('close', (code) => {
      if (!done) {
        done = true; clearTimeout(timer);
        resolve({ ok: code === 0, reason: code === 0 ? 'ok' : 'exit ' + code, stdout: out, stderr: err });
      }
    });
    child.on('error', (e) => {
      if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, reason: e.message, stdout: out, stderr: err }); }
    });
  });
}

/** like ps(), but any error inside the script makes the result ok:false (instead of being swallowed) */
function psStrict(script, timeoutMs) {
  return ps("$ErrorActionPreference = 'Stop'\n" + script, timeoutMs);
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

/* ---------- mouse ---------- */

const MOUSE_DLL = `Add-Type -Namespace W -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);'`;
const mouseEvent = (flag, data = '0') => `[W.M]::mouse_event(${flag}, 0, 0, ${data}, [UIntPtr]::Zero)`;

function moveMouse(x, y) {
  return psStrict(`
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);'
[W.U]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
'ok'`);
}

/** build the PowerShell for a click. All the button events go out in ONE script so a double-click
 *  stays inside Windows' double-click window (separate PowerShell launches are ~1s+ apart). */
function buildClickScript(kind = 'left') {
  const LEFT = ['0x0002', '0x0004'], RIGHT = ['0x0008', '0x0010'], MIDDLE = ['0x0020', '0x0040'];
  const pair = (p) => [mouseEvent(p[0]), mouseEvent(p[1])];
  let lines;
  if (kind === 'right') lines = pair(RIGHT);
  else if (kind === 'middle') lines = pair(MIDDLE);
  else if (kind === 'double') lines = [...pair(LEFT), 'Start-Sleep -Milliseconds 40', ...pair(LEFT)];
  else lines = pair(LEFT);
  return `${MOUSE_DLL}\n${lines.join('\n')}\n'ok'`;
}

function click(kind = 'left') {
  return psStrict(buildClickScript(kind));
}

/* ---------- keyboard ---------- */

/** PowerShell that types `text` into the focused window. The text travels as base64 and SendKeys'
 *  special characters (+ ^ % ~ ( ) { } [ ]) are escaped inside PowerShell. */
function buildTypeScript(text) {
  const t = String(text).replace(/\r\n/g, '\n').slice(0, MAX_TYPE_CHARS);
  return `
Add-Type -AssemblyName System.Windows.Forms
$t = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(t)}'))
$t = [regex]::Replace($t, '([+^%~(){}\\[\\]])', '{$1}')
[System.Windows.Forms.SendKeys]::SendWait($t)
'ok'`;
}

function typeText(text) {
  if (!text) return { ok: true, reason: 'ok', stdout: 'ok', stderr: '' };
  return psStrict(buildTypeScript(text), 20000);
}

const KEYS = {
  enter: '{ENTER}', esc: '{ESC}', tab: '{TAB}', space: ' ',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  backspace: '{BACKSPACE}', delete: '{DELETE}', home: '{HOME}', end: '{END}'
};

function pressKey(key) {
  const k = KEYS[String(key || '').toLowerCase()] || null;
  if (!k) return { ok: false, reason: 'unknown key', stdout: '', stderr: 'unknown key' };
  return psStrict(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${k}')
'ok'`);
}

/* ---------- scroll ---------- */

/** clicks: positive = down, negative = up */
function buildScrollScript(clicks = 3) {
  const delta = -Math.round(clicks) * 120; // WHEEL_DELTA; negative = wheel toward the user = scroll down
  // mouse_event's dwData is a uint: a negative delta has to be passed as its two's-complement bit pattern
  const data = `[uint32]([BitConverter]::ToUInt32([BitConverter]::GetBytes([int]${delta}), 0))`;
  return `${MOUSE_DLL}\n${mouseEvent('0x0800', data)}\n'ok'`;
}

function scroll(clicks = 3) {
  return psStrict(buildScrollScript(clicks));
}

/* ---------- apps ---------- */

const APP_MAP = {
  notepad: 'notepad', 'notepad++': 'notepad++',
  calc: 'calc', calculator: 'calc',
  paint: 'mspaint', mspaint: 'mspaint',
  cmd: 'cmd', terminal: 'wt', powershell: 'powershell',
  explorer: 'explorer', files: 'explorer', 'file explorer': 'explorer',
  chrome: 'chrome', edge: 'msedge', firefox: 'firefox',
  spotify: 'spotify', discord: 'discord', steam: 'steam',
  code: 'code', vscode: 'code', 'vs code': 'code',
  word: 'winword', excel: 'excel', powerpoint: 'powerpnt', outlook: 'outlook',
  settings: 'ms-settings:', calculatorapp: 'calc'
};

/** known alias, or a plain program name ("snippingtool", "obs64"); anything that looks like a
 *  path, URL, argument list or script is refused. */
function resolveAppTarget(nameRaw) {
  const raw = String(nameRaw || '').trim();
  const key = raw.toLowerCase().replace(/\.exe$/, '');
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(APP_MAP, key)) return APP_MAP[key];
  if (!/^[a-z0-9][a-z0-9 ._+-]{0,38}$/i.test(raw)) return null;
  return raw;
}

function openApp(nameRaw) {
  const target = resolveAppTarget(nameRaw);
  if (!target) return Promise.resolve({ ok: false, reason: 'blocked-name', stdout: '', stderr: 'not a plain program name' });
  return psStrict(`
$n = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(target)}'))
Start-Process -FilePath $n
'ok'`, 15000);
}

/* ---------- window discovery ---------- */

async function listWindows() {
  const r = await ps(`
Add-Type -Namespace W -Name R -MemberDefinition '
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
public struct RECT { public int L; public int T; public int Rt; public int B; }'
$win = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowHandle -ne 0 } |
  Select-Object -First 40
$out = @()
foreach ($p in $win) {
  $rect = New-Object W.R+RECT
  [W.R]::GetWindowRect($p.MainWindowHandle, [ref]$rect) | Out-Null
  $out += [PSCustomObject]@{
    title = $p.MainWindowTitle
    process = $p.ProcessName
    x = $rect.L; y = $rect.T; w = ($rect.Rt - $rect.L); h = ($rect.B - $rect.T)
  }
}
$out | ConvertTo-Json -Compress`, 15000);
  if (!r.ok || !r.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(r.stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return [];
  }
}

/** find a window whose title/process loosely matches, return its rect center */
async function findWindowTarget(query) {
  const wins = await listWindows();
  if (!wins.length) return null;
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  let best = wins.find(w => w.title.toLowerCase().includes(q) || w.process.toLowerCase().includes(q));
  if (!best) {
    best = wins.find(w => q.split(/\s+/).some(tok => tok.length > 2 && w.title.toLowerCase().includes(tok)));
  }
  if (!best) return null;
  return { window: best, x: best.x + best.w / 2, y: best.y + Math.min(best.h / 2, 200) };
}

function noopResult(reason) {
  return { ok: false, reason: reason || 'windows-only', stdout: '', stderr: '' };
}

module.exports = {
  IS_WINDOWS,
  moveMouse, click, typeText, pressKey, scroll, openApp,
  listWindows, findWindowTarget,
  _: { ps, psStrict, noopResult, buildTypeScript, buildClickScript, buildScrollScript, resolveAppTarget, APP_MAP }
};
