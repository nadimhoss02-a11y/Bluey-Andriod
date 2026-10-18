'use strict';
/**
 * PC control for Bluey on Windows.
 * Everything is done through PowerShell + user32.dll SendInput-style calls,
 * so there are ZERO native npm dependencies to compile. Works on stock Windows 10/11.
 *
 * On non-Windows platforms every call no-ops gracefully (so devs on mac/linux can run the UI).
 */
const { spawn } = require('child_process');
const os = require('os');

const IS_WINDOWS = os.platform() === 'win32';

function ps(script, timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!IS_WINDOWS) {
      resolve({ ok: false, reason: 'windows-only', stdout: '', stderr: 'not windows' });
      return;
    }
    let out = '', err = '', done = false;
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
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

/* ---------- mouse ---------- */

function moveMouse(x, y) {
  return ps(`
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);'
[W.U]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
'ok'`);
}

async function click(kind = 'left') {
  let flags;
  if (kind === 'right') flags = '0x0008, 0x0010';       // RIGHTDOWN, RIGHTUP
  else if (kind === 'middle') flags = '0x0020, 0x0040'; // MIDDLEDOWN, MIDDLEUP
  else flags = '0x0002, 0x0004';                        // LEFTDOWN, LEFTUP
  const r = await ps(`
Add-Type -Namespace W -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);'
[W.M]::mouse_event(${flags}, 0, 0, 0, [UIntPtr]::Zero)`);
  if (kind === 'double' && r.ok) {
    await new Promise(res => setTimeout(res, 60));
    await ps(`
Add-Type -Namespace W -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);'
[W.M]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [W.M]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)`);
  }
  return r;
}

/* ---------- keyboard ---------- */

function escapeSendKeys(text) {
  // escape SendKeys special chars: +^%~(){}[]
  return text.replace(/([+^%~(){}[\]])/g, '{$1}').replace(/'/g, "''");
}

function typeText(text) {
  if (!text) return { ok: true, reason: 'ok', stdout: 'ok', stderr: '' };
  const esc = escapeSendKeys(String(text));
  return ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${esc}')
'ok'`, 15000);
}

function pressKey(key) {
  const allowed = {
    enter: '{ENTER}', esc: '{ESC}', tab: '{TAB}', space: ' ',
    up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
    backspace: '{BACKSPACE}', delete: '{DELETE}', home: '{HOME}', end: '{END}'
  };
  const k = allowed[String(key || '').toLowerCase()] || null;
  if (!k) return { ok: false, reason: 'unknown key', stdout: '', stderr: 'unknown key' };
  return ps(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${k}')
'ok'`);
}

/* ---------- scroll ---------- */
/** clicks: positive = down, negative = up */
function scroll(clicks = 3) {
  const delta = -Math.round(clicks) * 120; // WHEEL_DELTA
  return ps(`
Add-Type -Namespace W -Name S -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);'
[W.S]::mouse_event(0x0800, 0, 0, ${delta}, [UIntPtr]::Zero)
'ok'`);
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

function openApp(nameRaw) {
  const name = String(nameRaw || '').trim().toLowerCase();
  const target = APP_MAP[name] || String(nameRaw || '').trim();
  return ps(`
Start-Process -FilePath '${target.replace(/'/g, "''")}' -ErrorAction Stop
'ok'`, 8000);
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
$out | ConvertTo-Json -Compress`, 8000);
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
  _: { ps, noopResult }
};
