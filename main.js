#!/usr/bin/env node
'use strict';

// Patch for pkg virtual file system module resolution error
if (process.pkg) {
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'events-universal') {
      return originalRequire.call(this, 'events-universal/default.js');
    }
    return originalRequire.call(this, id);
  };
}

const net = require('net');
const dgram = require('dgram');
const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const multiplex = require('multiplex');
const https = require('https');
const http = require('http');
const pump = require('pump');
const { Transform } = require('stream');
const prompt = require('prompt-sync')();

const VERSION = '1.2.3';
const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/Lawtro37/NAT-bridge/refs/heads/main/VERSION';

// ------------------------- CLI / Helpers -------------------------

const args = process.argv.slice(2);
function parseArgFlag(name, short) {
  return args.includes(`--${name}`) || (short && args.includes(`-${short}`));
}
function parseArgValue(name, short, def = undefined) {
  const i = args.indexOf(`--${name}`);
  const j = short ? args.indexOf(`-${short}`) : -1;
  const idx = i >= 0 ? i : j;
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return def;
}

let mode = args[0];
let bridgeId = args[1];

// Defaults
let listenPort = parseInt(parseArgValue('listen', 'l', '5000'), 10);
let remotePort = parseInt(parseArgValue('expose', 'e', '8080'), 10);
let protocol = (parseArgValue('protocol', 'p', 'tcp') || '').toLowerCase();
let VERBOSE = parseArgFlag('verbose', 'v');
let EXPECTEDWARNINGS = parseArgFlag('warnings', 'w');
let JSON_MODE = parseArgFlag('json', null);
let NO_TUI = parseArgFlag('no-tui', null);
let NO_FANCY_LOGS = parseArgFlag('no-fancy-logs', null);
if (NO_FANCY_LOGS) NO_TUI = true;
let SECRET = parseArgValue('secret', 's', '');
let STATUS_PORT = parseInt(parseArgValue('status', null, '0'), 10) || 0;
let MAX_STREAMS = parseInt(parseArgValue('max-streams', null, '256'), 10);
let KBPS = parseInt(parseArgValue('kbps', null, '0'), 10);
let HANDSHAKE_TIMEOUT_MS = 10000;
let TCP_CONNECT_RETRIES = parseInt(parseArgValue('tcp-retries', null, '5'), 10);
let TCP_RETRY_DELAY_MS = parseInt(parseArgValue('tcp-retry-delay', null, '500'), 10);
let TUI_ENABLED = !NO_TUI && !JSON_MODE && process.stdout.isTTY;
let CLOSE_ACTIVE_STREAM_TIMEOUT_MS = 5000;
let SKIP_UPDATE_CHECK = parseArgFlag('skip-update-check', null);

function printHelpAndExit() {
  console.log(`
${color('NAT Bridge CLI - Hybrid TCP/UDP over P2P', '36')}
v${VERSION}

Usage:
  node main.js <host|client> <bridge-id> [options]
  node main.js config <config-file>

Options:
  -e, --expose <port>           Port to expose on host (default: 8080)
  -l, --listen <port>           Port to listen on client (default: 5000)
  -p, --protocol tcp|udp|both   Protocol to tunnel (default: tcp)
  -v, --verbose                 Enable verbose logging
  -w, --warnings                Show common disconnect warnings
      --json                    Structured JSON logs (disables spinner)
      --secret <pass>           Enable mutual auth (HMAC challenge)
      --status <port>           Start status server (JSON)
      --max-streams <n>         Limit concurrent streams (default: 256)
      --kbps <n>                Simple throttle per stream (0=unlimited)
      --tcp-retries <n>         TCP connect retry attempts (default: 5)
      --tcp-retry-delay <ms>    Delay between retries (default: 500)
      --no-tui                  Disable the terminal UI
      --no-fancy-logs           Disable colored and formatted logs (implies --no-tui)
      --skip-update-check       Don't check for updates on startup
  -h, --help                    Show this help

Examples:
  node main.js host mybridge --expose 3000 --protocol both --secret abc
  node main.js client mybridge --listen 1234 --protocol udp --json --status 7777
`);
  process.exit(1);
}

// Logging
const crashLogBuffer = [];
const crashLogLimit = 400;
let tuiLog = null;
let tuiPendingLogBuffer = [];
let tuiLogPaused = false;
let tuiLogBuffer = [];
let tuiScreen = null;

function formatTuiLog(level, msg) {
  const lvl = String(level || '').toLowerCase();
  const label = String(level || 'info').toUpperCase();
  const text = String(msg ?? '');
  const colorByLevel = {
    info: 'cyan-fg',
    warn: 'yellow-fg',
    error: 'red-fg',
    success: 'green-fg',
    verbose: 'gray-fg',
    update: 'yellow-fg',
    'critical update': 'red-fg'
  };
  const color = colorByLevel[lvl] || 'white-fg';
  return `{${color}}[${label}]{/${color}} ${text}`;
}

function emitTui(level, msg) {
  if (!TUI_ENABLED || !tuiScreen) return false;
  const line = formatTuiLog(level, msg);
  if (!tuiLog) {
    tuiPendingLogBuffer.push(line);
    if (tuiPendingLogBuffer.length > 2000) tuiPendingLogBuffer.shift();
    return true;
  }
  if (tuiLogPaused) {
    tuiLogBuffer.push(line);
    if (tuiLogBuffer.length > 2000) tuiLogBuffer.shift();
    return true;
  }
  tuiLog.log(line);
  return true;
}

function pushCrashLog(level, msg) {
  const line = `[${String(level).toUpperCase()}] ${String(msg ?? '')}`;
  crashLogBuffer.push(line);
  if (crashLogBuffer.length > crashLogLimit) crashLogBuffer.shift();
}

function nowIso() { return new Date().toISOString(); }
function color(text, c) {
  if (JSON_MODE || !process.stdout.isTTY || NO_FANCY_LOGS) return text;
  return `\x1b[${c}m${text}\x1b[0m`;
}
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
function jlog(level, msg, extra = {}) {
  if (!JSON_MODE) return false;
  const entry = { ts: nowIso(), level, msg, ...extra };
  console.log(JSON.stringify(entry));
  return true;
}
const info = (msg, extra) => jlog('info', msg, extra) || (pushCrashLog('info', msg), emitTui('info', msg) || console.log(color('[INFO]', '36'), msg));
const warn = (msg, extra) => {
  const s = String(msg ?? '');
  if (!isExpectedDisconnect(s)) (jlog('warn', s, extra) || (pushCrashLog('warn', s), emitTui('warn', s) || console.warn(color('[WARN]', '33'), s)));
};
const error = (msg, extra) => jlog('error', String(msg ?? ''), extra) || (pushCrashLog('error', msg), emitTui('error', msg) || console.error(color('[ERROR]', '31'), msg));
const success = (msg, extra) => jlog('success', msg, extra) || (pushCrashLog('success', msg), emitTui('success', msg) || console.log(color('[SUCCESS]', '32'), msg));
const verboseLog = (msg, extra) => { if (VERBOSE) (jlog('verbose', msg, extra) || (pushCrashLog('verbose', msg), emitTui('verbose', msg) || console.log(color('[VERBOSE]', '90'), msg))); };
const update = (msg, extra) => jlog('update', msg, extra) || (pushCrashLog('update', msg), emitTui('update', msg) || console.log(color('[UPDATE]', '33'), msg));
const criticalVersionWarning = (msg, extra) => jlog('critical update', msg, extra) || (pushCrashLog('critical update', msg), emitTui('critical update', msg) || console.error(color('[CRITICAL UPDATE]', '31'), msg));

// Validate / config mode
if (!['host', 'client', 'config'].includes(mode) || !bridgeId || !['tcp', 'udp', 'both'].includes(protocol)) {
  if (!(mode === 'config')) printHelpAndExit();
}

if (mode === 'config') {
  const configPath = bridgeId;
  try {
    info(`Loading configuration from file "${configPath}"`);
    const config = require(configPath);

    if (!config || typeof config !== 'object') {
      error(`Invalid configuration file "${configPath}". Expected an object.`);
      process.exit(1);
    }

    if (config.mode && !['host', 'client'].includes(config.mode)) {
      error(`Invalid configuration key "mode" in file "${configPath}". Expected "host" or "client".`);
      process.exit(1);
    }

    if (config.protocol && !['tcp', 'udp', 'both'].includes(config.protocol)) {
      error(`Invalid configuration key "protocol" in file "${configPath}". Expected "tcp", "udp", or "both".`);
      process.exit(1);
    }

    if (config.expectedWarnings && !Array.isArray(config.expectedWarnings)) {
      error(`Invalid configuration key "expectedWarnings" in file "${configPath}". Expected an array.`);
      process.exit(1);
    }

    if (config.bridgeId && typeof config.bridgeId !== 'string') {
      error(`Invalid configuration key "bridgeId" in file "${configPath}". Expected a string.`);
      process.exit(1);
    } 
    if (!Object.keys(config).includes('bridgeId') || !config.bridgeId) {
      config.bridgeId = prompt('please enter a bridge ID: ');
    } else if (config.bridgeId == "auto") {
      config.bridgeId = Math.random().toString(36).substring(2, 15);
    }

    for (const key of Object.keys(config)) {
      const val = config[key];
      if (val == undefined || val === null) {
        // prompt user to enter value for missing config key
        config[key] = prompt(`please enter a value for "${key}": `);
      }
    }

    if (['host', 'client'].includes(config.mode) && ['tcp', 'udp', 'both'].includes(config.protocol)) {
      mode = config.mode;
      bridgeId = config.bridgeId || Math.random().toString(36).substring(2, 15);
      listenPort = config.listenPort || listenPort || 5000;
      remotePort = config.exposedPort || remotePort || 8080;
      protocol = config.protocol;
      VERBOSE = config.verbose || VERBOSE;
      EXPECTEDWARNINGS = config.expectedWarnings || EXPECTEDWARNINGS;
      JSON_MODE = config.json || JSON_MODE;
      SECRET = config.secret || SECRET;
      STATUS_PORT = config.status || STATUS_PORT;
      MAX_STREAMS = config.maxStreams || MAX_STREAMS;
      KBPS = config.kbps || KBPS;
      TCP_CONNECT_RETRIES = config.tcpRetries || TCP_CONNECT_RETRIES;
      TCP_RETRY_DELAY_MS = config.tcpRetryDelayMs || TCP_RETRY_DELAY_MS;
      NO_TUI = config.noTui || NO_TUI;
      NO_FANCY_LOGS = config.noFancyLogs || NO_FANCY_LOGS;
    } else {
      error("Invalid configuration file. Please check the contents.");
      process.exit(1);
    }
  } catch (e) {
    error(`Failed to load configuration file "${configPath}": ${e.message}`);
    process.exit(1);
  }
}

if (mode === 'client' && protocol === 'both') {
  error("Client mode does not support 'both' protocol. Please use 'tcp' or 'udp'.");
  info("You can open a udp and tcp tunnel on the same port to achieve the same effect.");
  process.exit(1);
}

// ------------------------- TUI -------------------------

let tui = null;
let tuiHeader = null;
let tuiStatus = null;
let tuiMetrics = null;
let tuiFooter = null;
let tuiTick = null;
let tuiSpinnerMessage = '';
let tuiSpinnerIndex = 0;
let tuiStatusLine = '';
const tuiSpinnerChars = ['|', '/', '-', '\\'];
let lastRateTs = Date.now();
let lastRateUp = 0;
let lastRateDown = 0;
let rateUpBps = 0;
let rateDownBps = 0;

function initTui() {
  if (!TUI_ENABLED) return;
  let blessed;
  try {
    blessed = require('blessed');
  } catch (e) {
    TUI_ENABLED = false;
    warn('Failed to load blessed; falling back to plain console.');
    return;
  }

  tuiScreen = blessed.screen({ smartCSR: true, title: `NAT-bridge ${VERSION}` });
  tuiScreen.enableMouse();
  tuiHeader = blessed.box({ top: 0, left: 0, height: 1, width: '100%', style: { fg: 'white', bg: 'blue' }, tags: true });
  tuiStatus = blessed.box({ label: 'Status', border: 'line', style: { fg: 'white', bg: 'black', border: { fg: 'magenta' } }, tags: true });
  tuiMetrics = blessed.box({ label: 'Metrics', border: 'line', style: { fg: 'white', bg: 'black', border: { fg: 'cyan' } }, tags: true });
  tuiLog = blessed.log({ label: 'Logs', border: 'line', style: { fg: 'white', bg: 'black', border: { fg: 'green' } }, scrollback: 2000, tags: true, keys: true, mouse: true });
  tuiFooter = blessed.box({ bottom: 0, left: 0, height: 1, width: '100%', style: { fg: 'white', bg: 'gray' }, tags: true });

  tuiScreen.append(tuiHeader);
  tuiScreen.append(tuiStatus);
  tuiScreen.append(tuiMetrics);
  tuiScreen.append(tuiLog);
  tuiScreen.append(tuiFooter);

  tuiLog.on('click', () => tuiLog.focus());
  tuiLog.on('wheeldown', () => { tuiLog.scroll(1); tuiScreen.render(); });
  tuiLog.on('wheelup', () => { tuiLog.scroll(-1); tuiScreen.render(); });

  function relayout() {
    const rows = tuiScreen.rows || 24;
    const cols = tuiScreen.cols || 80;
    const headerH = 1;
    const footerH = 1;
    const bodyTop = headerH;
    const bodyH = Math.max(6, rows - headerH - footerH);
    const leftW = Math.max(20, Math.floor(cols * 0.20));
    const rightW = Math.max(24, cols - leftW);

    tuiHeader.top = 0;
    tuiHeader.left = 0;
    tuiHeader.width = cols;
    tuiHeader.height = headerH;

    tuiFooter.top = rows - footerH;
    tuiFooter.left = 0;
    tuiFooter.width = cols;
    tuiFooter.height = footerH;

    tuiStatus.top = bodyTop;
    tuiStatus.left = 0;
    tuiStatus.width = leftW;
    tuiStatus.height = bodyH;

    const metricsH = Math.max(5, Math.floor(bodyH * 0.35));
    tuiMetrics.top = bodyTop;
    tuiMetrics.left = leftW;
    tuiMetrics.width = rightW;
    tuiMetrics.height = metricsH;

    tuiLog.top = bodyTop + metricsH;
    tuiLog.left = leftW;
    tuiLog.width = rightW;
    tuiLog.height = Math.max(5, bodyH - metricsH);

    tuiScreen.render();
  }

  function updateHeader() {
    tuiHeader.setContent(` {bold}{white-fg}NAT-bridge{/white-fg}{/bold}  {yellow-fg}Mode:{/yellow-fg} ${mode}  {yellow-fg}Bridge:{/yellow-fg} ${bridgeId}  {yellow-fg}Protocol:{/yellow-fg} ${protocol}`);
  }

  function updateFooter() {
    const pauseLabel = tuiLogPaused ? 'resume' : 'pause';
    let spinner = '';
    if (tuiSpinnerMessage) {
      const ch = tuiSpinnerChars[tuiSpinnerIndex++ % tuiSpinnerChars.length];
      spinner = `{yellow-fg}${tuiSpinnerMessage} ${ch}{/yellow-fg}`;
    }
    const status = tuiStatusLine ? `{green-fg}${tuiStatusLine}{/green-fg}` : '';
    tuiFooter.setContent(` ${spinner} ${status} {white-fg}|{/white-fg} {cyan-fg}q{/cyan-fg}: quit | {cyan-fg}c{/cyan-fg}: clear logs | {cyan-fg}p{/cyan-fg}: ${pauseLabel} logs | {cyan-fg}arrows/pgup/pgdn{/cyan-fg} to scroll`);
  }

  function updatePanels() {
    const uptimeSec = Math.floor((Date.now() - metrics.startTs) / 1000);
    const now = Date.now();
    const dt = Math.max(1, now - lastRateTs);
    const upDelta = metrics.bytesUp - lastRateUp;
    const downDelta = metrics.bytesDown - lastRateDown;
    rateUpBps = Math.max(0, Math.floor((upDelta * 1000) / dt));
    rateDownBps = Math.max(0, Math.floor((downDelta * 1000) / dt));
    lastRateTs = now;
    lastRateUp = metrics.bytesUp;
    lastRateDown = metrics.bytesDown;
    const statusLines = [
      `{yellow-fg}Connected:{/yellow-fg} ${(connectedToHost || connectedToClient) ? '{green-fg}yes{/green-fg}' : '{red-fg}no{/red-fg}'}`,
      `{yellow-fg}P2P connections:{/yellow-fg} ${metrics.p2pConnections}`,
      protocol === "both" || protocol === "tcp" ? `{yellow-fg}TCP streams:{/yellow-fg} ${metrics.tcpStreams}` : null,
      protocol === "both" || protocol === "udp" ? `{yellow-fg}UDP streams:{/yellow-fg} ${metrics.udpStreams}` : null,
      `{yellow-fg}Active streams:{/yellow-fg} ${activeStreams.size}`,
      `{yellow-fg}Last peer:{/yellow-fg} ${metrics.lastPeer || 'n/a'}`,
      mode === "client" ? `{yellow-fg}Listen:{/yellow-fg} ${listenPort}` : `{yellow-fg}Expose:{/yellow-fg} ${remotePort}`,
      `{yellow-fg}Max streams:{/yellow-fg} ${MAX_STREAMS}`,
    ];
    const metricLines = [
      `{cyan-fg}Uptime:{/cyan-fg} ${uptimeSec}s`,
      `{cyan-fg}Bytes up:{/cyan-fg} ${formatBytes(metrics.bytesUp)}`,
      `{cyan-fg}Bytes down:{/cyan-fg} ${formatBytes(metrics.bytesDown)}`,
      `{cyan-fg}Up rate:{/cyan-fg} ${formatBytes(rateUpBps)}/s`,
      `{cyan-fg}Down rate:{/cyan-fg} ${formatBytes(rateDownBps)}/s`,
      `{cyan-fg}Stream budget:{/cyan-fg} ${metrics.tcpStreams + metrics.udpStreams + activeStreams.size}/${MAX_STREAMS}`,
      `{cyan-fg}Throttle:{/cyan-fg} ${KBPS > 0 ? KBPS + ' kbps' : 'off'}`,
    ];
    tuiStatus.setContent(statusLines.filter(Boolean).join('\n'));
    tuiMetrics.setContent(metricLines.join('\n'));
  }

  tuiScreen.key(['q', 'C-c'], () => gracefulExit(0));
  tuiScreen.key(['c'], () => {
    tuiLog.setContent('');
    tuiScreen.render();
  });
  tuiScreen.key(['p'], () => {
    tuiLogPaused = !tuiLogPaused;
    updateFooter();
    if (!tuiLogPaused && tuiLogBuffer.length) {
      while (tuiLogBuffer.length) tuiLog.log(tuiLogBuffer.shift());
    }
    tuiScreen.render();
  });

  // Keyboard scrolling for logs (arrows, vi keys, page up/down, home/end)
  tuiScreen.key(['up', 'k'], () => { try { tuiLog.scroll(-1); } catch {} tuiScreen.render(); });
  tuiScreen.key(['down', 'j'], () => { try { tuiLog.scroll(1); } catch {} tuiScreen.render(); });
  tuiScreen.key(['pageup'], () => { try { const h = tuiLog.height || 10; tuiLog.scroll(-Math.max(1, Math.floor(h / 2))); } catch {} tuiScreen.render(); });
  tuiScreen.key(['pagedown'], () => { try { const h = tuiLog.height || 10; tuiLog.scroll(Math.max(1, Math.floor(h / 2))); } catch {} tuiScreen.render(); });
  tuiScreen.key(['home'], () => { try { if (tuiLog.scrollTo) tuiLog.scrollTo(0); else if (tuiLog.setScrollPerc) tuiLog.setScrollPerc(0); else tuiLog.scroll(-999999); } catch {} tuiScreen.render(); });
  tuiScreen.key(['end'], () => { try { if (tuiLog.getScrollHeight && tuiLog.scrollTo) tuiLog.scrollTo(tuiLog.getScrollHeight()); else if (tuiLog.setScrollPerc) tuiLog.setScrollPerc(100); else tuiLog.scroll(999999); } catch {} tuiScreen.render(); });

  tuiScreen.on('resize', relayout);
  relayout();
  updateHeader();
  updateFooter();
  updatePanels();

  if (tuiPendingLogBuffer.length) {
    tuiPendingLogBuffer.forEach((line) => tuiLog.log(line));
    tuiPendingLogBuffer = [];
  }

  tuiTick = setInterval(() => {
    updateHeader();
    updatePanels();
    updateFooter();
    tuiScreen.render();
  }, 500);
}

// Spinner
let spinnerInterval = null;
let spinnerIndex = 0;
const spinnerChars = ['|', '/', '-', '\\'];
let currentSpinnerMessage = '';
let exitSpinnerInterval = null;
let exitSpinnerRow = null;
let exitSpinnerStartTs = 0;
let exitSpinnerTimeoutMs = 0;
let exitSpinnerKeyHandler = null;

function visibleLength(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '').length;
}

function startSpinner(message) {
  if (NO_FANCY_LOGS) { console.log(`[WAIT] ${message}`); return; }
  if (JSON_MODE || !process.stdout.isTTY) return;
  if (TUI_ENABLED) {
    tuiSpinnerMessage = message;
    tuiStatusLine = '';
    return;
  }
  stopSpinner();
  currentSpinnerMessage = message;
  spinnerIndex = 0;
  spinnerInterval = setInterval(() => {
    const char = spinnerChars[spinnerIndex++ % spinnerChars.length];
    const line = `${color('[WAIT]', '90')} ${currentSpinnerMessage} ${char}`;
    process.stdout.write('\r' + line + ' '.repeat(Math.max(0, (process.stdout.columns || 80) - line.length)));
  }, 100);
}
function stopSpinner() {
  if (JSON_MODE || !process.stdout.isTTY) return;
  if (TUI_ENABLED) {
    tuiSpinnerMessage = '';
    return;
  }
  if (!spinnerInterval) return;
  clearInterval(spinnerInterval);
  spinnerInterval = null;
  const clearLine = '\r' + ' '.repeat(process.stdout.columns || 80) + '\r';
  process.stdout.write(clearLine);
}

function startExitSpinner() {
  if (JSON_MODE || !process.stdout.isTTY) return;
  if (exitSpinnerInterval) return;
  stopSpinner();
  exitSpinnerStartTs = Date.now();
  exitSpinnerTimeoutMs = CLOSE_ACTIVE_STREAM_TIMEOUT_MS;
  enableExitKeypress();
  let idx = 0;
  exitSpinnerInterval = setInterval(() => {
    const ch = spinnerChars[idx++ % spinnerChars.length];
    const remainingMs = exitSpinnerTimeoutMs
      ? Math.max(0, exitSpinnerTimeoutMs - (Date.now() - exitSpinnerStartTs))
      : 0;
    const remainingSec = exitSpinnerTimeoutMs ? Math.ceil(remainingMs / 1000) : 0;
    const countdown = exitSpinnerTimeoutMs ? `${remainingSec}s` : '';
    const line1 = color('Closing NAT Bridge', "31");
    const line2 = color('Waiting for active streams to close...', "33");
    const line3 = color('press Ctrl+C, q, Esc, Enter to force exit', "33");
    const line4 = `${countdown} ${ch}`.trim();
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    exitSpinnerRow = exitSpinnerRow || Math.max(1, Math.floor(rows / 2) - 1);

    const lines = [line1, line2, line3, line4];
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      const pad = Math.max(0, Math.floor((cols - visibleLength(text)) / 2));
      const line = ' '.repeat(pad) + text;
      const col = 1;
      const row = exitSpinnerRow + i;
      process.stdout.write(`\x1b[${row};${col}H` + line.padEnd(cols));
    }
  }, 100);
}

function stopExitSpinner() {
  if (!exitSpinnerInterval) return;
  clearInterval(exitSpinnerInterval);
  exitSpinnerInterval = null;
  disableExitKeypress();
  try {
    const cols = process.stdout.columns || 80;
    if (exitSpinnerRow) {
      process.stdout.write(`\x1b[${exitSpinnerRow};1H` + ' '.repeat(cols));
      process.stdout.write(`\x1b[${exitSpinnerRow + 1};1H` + ' '.repeat(cols));
      process.stdout.write(`\x1b[${exitSpinnerRow + 2};1H` + ' '.repeat(cols));
      process.stdout.write(`\x1b[${exitSpinnerRow + 3};1H` + ' '.repeat(cols));
    }
    process.stdout.write('\r\n');
  } catch {}
  exitSpinnerRow = null;
}

function enableExitKeypress() {
  if (!process.stdin || exitSpinnerKeyHandler) return;
  try {
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();
  } catch {}
  exitSpinnerKeyHandler = (chunk) => {
    const key = chunk && chunk.toString ? chunk.toString('utf8') : '';
    // Keys: Ctrl+C, q, Esc, Enter
    if (key === '\u0003' || key.toLowerCase() === 'q' || key === '\u001b' || key === '\r') {
      stopExitSpinner();
      stopSpinner();
      console.error('Force exit requested.');
      process.exit(1);
    }
  };
  process.stdin.on('data', exitSpinnerKeyHandler);
}

function disableExitKeypress() {
  if (!process.stdin || !exitSpinnerKeyHandler) return;
  process.stdin.off('data', exitSpinnerKeyHandler);
  exitSpinnerKeyHandler = null;
  try {
    if (process.stdin.setRawMode) process.stdin.setRawMode(false);
  } catch {}
  try { process.stdin.pause(); } catch {}
}

// ------------------------- Startup Banner -------------------------

const topicName = `NAT-bridge:${bridgeId}`; // if any of yous change this older versions won't be able to connect to newer ones. so you better have a good reason change it.
const topic = crypto.createHash('sha256').update(topicName).digest();

if (!TUI_ENABLED) console.log(color('[ NAT Bridge CLI ]', '34'));
else emitTui('info', 'NAT Bridge CLI');
info(`Mode       : ${mode}`);
info(`Bridge ID  : ${bridgeId}`);
info(`Protocol   : ${protocol}`);
info(mode === 'host' ? `Exposing   : localhost:${remotePort}` : `Listening  : localhost:${listenPort}`);
if (VERBOSE) info(`Verbose    : Enabled`);
if (JSON_MODE) info(`JSON logs  : Enabled`);
if (SECRET) info(`Auth       : Shared secret enabled`);
if (STATUS_PORT) info(`Status     : http://127.0.0.1:${STATUS_PORT}`);

if (mode === 'host' && protocol !== 'udp') {
  const testConn = net.connect(remotePort, '127.0.0.1');
  testConn.once('error', () => {
    error(`No service running on localhost:${remotePort}`);
    process.exit(1);
  });
  testConn.once('connect', () => testConn.destroy());
}

let STOP_EXECUTION = false;

// ------------------------- Version Check -------------------------
// this is kinda spaghetti code hell but whatever, it works.

if (!SKIP_UPDATE_CHECK) {
  startSpinner(`checking for updates...`);
  https.get(VERSION_CHECK_URL, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const versionBlocks = data.trim().split("\n----------\n").map(block => block.trim()).filter(Boolean);

      if (!versionBlocks.length) {
        stopSpinner(); warn('Could not retrieve remote version information.');
        mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
        return;
      }

      function parseVersionArray(ver) {
        return String(ver).split("-")[0].split('.').map(x => parseInt(x, 10));
      }

      function compareVersionArrays(a, b) {
        const len = Math.max(a.length, b.length);
        for (let i = 0; i < len; i++) {
          const ai = Number.isFinite(a[i]) ? a[i] : 0;
          const bi = Number.isFinite(b[i]) ? b[i] : 0;
          if (ai > bi) return 1;
          if (ai < bi) return -1;
        }
        return 0;
      }

      function formatChangelogBlock(version, lines) {
        const cleaned = lines.map(line => line.trim()).filter(Boolean);
        if (!cleaned.length) return `${version}\n        (no release notes provided)`;
        return `${version}\n        ${cleaned.join('\n        ')}`;
      }

      const remoteVersion = versionBlocks[0].split("\n").map(line => line.trim()).filter(Boolean);
      const remoteVerNum = parseVersionArray(remoteVersion[0]);
      const localVerNum = parseVersionArray(VERSION);

      if (remoteVerNum.some(isNaN) || localVerNum.some(isNaN)) {
        stopSpinner(); warn('Received invalid version information from server.');
        mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
        return;
      }

      const cmp = compareVersionArrays(remoteVerNum, localVerNum);
      const newerBlocks = versionBlocks
        .map(block => block.split("\n").map(line => line.trim()).filter(Boolean))
        .filter(blockLines => blockLines.length > 0 && compareVersionArrays(parseVersionArray(blockLines[0]), localVerNum) > 0);

      const newerVersions = newerBlocks.map(blockLines => formatChangelogBlock(blockLines[0], blockLines.slice(1)));

      // check for versions with "[CRITICAL]" in the notes and warn about them regardless of semver if we're on an older version.
      const hasCritical = newerBlocks.some(blockLines => {
        const notes = (blockLines.slice(1) || []).map(l => String(l).trim()).filter(Boolean);
        return notes.some(line => line.includes('[CRITICAL]'));
      });

      if (hasCritical) {
        stopSpinner();
        criticalVersionWarning(`A critical (most likely security) update (${remoteVersion[0]}) is available! You are using ${VERSION}.`);
        criticalVersionWarning('Visit https://github.com/Lawtro37/nat-bridge/releases to download the latest version.');
        if (newerVersions.length > 0) criticalVersionWarning(`Changelog: \n        ${newerVersions.join('\n        ----------\n        ')}`);
        criticalVersionWarning('Execution will not continue. If you want to continue anyway, use --skip-update-check flag (not recommended).');
        if (TUI_ENABLED) {
          stopExecutionForCriticalUpdate();
          return;
        } else {
          gracefulExit(0, 'Critical update available');
        }
      }

      if (cmp > 0) {
        stopSpinner();
        update(`A new version (${remoteVersion[0]}) is available! You are using ${VERSION}.`);
        update('Visit https://github.com/Lawtro37/nat-bridge/releases to download the latest version.');
        if (newerVersions.length > 0) update(`Changelog:\n        ${newerVersions.join('\n        ----------\n        ')}`);
        mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
      } else if (cmp < 0) {
        stopSpinner();
        update(`You are running a newer version (${VERSION}) than the latest release (${remoteVersion[0]}). thank you for remembering to change the version in the code.`);
        if (newerVersions.length > 0) update(`Changelog for newer releases:\n        ${newerVersions.join('\n        ----------\n        ')}`);
        mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
      } else {
        stopSpinner();
        if (newerVersions.length > 0) update(`Changelog for newer releases:\n        ${newerVersions.join('\n        ----------\n        ')}`);
        mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
      }
    });
  }).on('error', () => {
    stopSpinner(); warn('Could not check for updates.');
    mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
  });
} else {
  update('Skipping update check (disabled by --skip-update-check)');
  warn('Make sure to check for updates regularly to receive important security fixes and new features: https://github.com/Lawtro37/nat-bridge/releases');
}

let blockedIPs
try {blockedIPs = require('./blocked-ips.json');} catch (e) { }
function isBlockedIP(ip) {
  if (blockedIPs && Array.isArray(blockedIPs)) {
    return blockedIPs.includes(ip);
  }
  return false;
}

// ------------------------- Metrics / Status -------------------------

const metrics = {
  startTs: Date.now(),
  p2pConnections: 0,
  tcpStreams: 0,
  udpStreams: 0,
  bytesUp: 0,
  bytesDown: 0,
  lastPeer: null,
};
function addUp(n) { metrics.bytesUp += n; }
function addDown(n) { metrics.bytesDown += n; }

if (STATUS_PORT) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/status') {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const body = JSON.stringify({
      uptimeSec: Math.floor((Date.now() - metrics.startTs) / 1000),
      mode, bridgeId, protocol, listenPort, remotePort,
      p2pConnections: metrics.p2pConnections,
      tcpStreams: metrics.tcpStreams,
      udpStreams: metrics.udpStreams,
      bytesUp: metrics.bytesUp,
      bytesDown: metrics.bytesDown,
      connectedToHost,
      VERBOSE,
      JSON_MODE,
      MAX_STREAMS,
      KBPS,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  server.listen(STATUS_PORT, '127.0.0.1', () => info(`Status server listening at /status on ${STATUS_PORT}`));
}

// ------------------------- P2P / Handshake -------------------------

const swarm = new Hyperswarm();
let tcpServer = null;
let udpSocket = null;
const activeStreams = new Set();
let connectedToHost = false;
let connectedToClient = false;

initTui();

function readLines(socket, onLine) {
  let buffer = '';
  const dataHandler = (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      onLine(line);
    }
  };
  socket.on('data', dataHandler);
  return () => socket.off('data', dataHandler);
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', String(secret)).update(String(data)).digest('hex');
}
function randomNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function addHandshakeTimeout(sock, label) {
  sock.setTimeout(HANDSHAKE_TIMEOUT_MS, () => {
    warn(`${label} handshake timeout`);
    sock.destroy();
  });
}

swarm.on('connection', (socket) => {
  if (STOP_EXECUTION) {
    try { socket.destroy(); } catch {}
    return;
  }
  stopSpinner();
  if (TUI_ENABLED) tuiStatusLine = 'Connected';
  verboseLog('P2P connection established');
  metrics.p2pConnections++;
  metrics.lastPeer = `${socket.remoteHost || 'peer'}:${socket.remotePort || ''}`;

  socket.on('error', (err) => warn(`Socket error: ${err.message}`));
  socket.on('close', () => { verboseLog('P2P socket closed'); });

  verboseLog("socket: \n" + JSON.stringify(socket, null, 2));

  verboseLog('Beginning handshake');

  addHandshakeTimeout(socket, mode.toUpperCase());

  if (mode === 'host') {
    verboseLog(`validatting IP address against blocklist`);
    if (isBlockedIP(socket.rawStream.remoteHost)) {
      warn(`Blocked connection from ${socket.rawStream.remoteHost} (on blocklist)`);
      return socket.destroy();
    } else {
      verboseLog(`IP address "${socket.rawStream.remoteHost}" passed blocklist check`);
    }

    socket.write("HELLO:host\n");
    let stage = 0;

    const stopReading = readLines(socket, async (line) => {
      if (stage === 0) {
        if (line === "HELLO:host") {
          warn(color("[CONFLICT]", 31) + " Another host attempted to connect. Ignoring. (You may want to change your bridge ID)");
          stopReading(); rejectAndDestroy(socket, "Host-to-host conflict", true);
        } else if (line === "HELLO:client") {
          if (SECRET) {
            verboseLog('Issuing challenge');
            const n1 = randomNonce();
            socket.write(`CHAL:${n1}\n`);
            stage = 0.5;
            socket.once('data', (buf) => {
              const resp = String(buf).trim();
              if (!resp.startsWith('AUTH:')) { error("Invalid auth response from client."); rejectAndDestroy(socket, "Auth failed"); return; }
              const h = resp.slice(5);
              if (h !== hmac(SECRET, n1)) { error("Client auth failed."); rejectAndDestroy(socket, "Auth failed"); return; }
              // Mutual: respond to client's challenge if any
			        verboseLog('Challenge successful!');
              socket.write(`OK\n`);
              stage = 1;
            });
          } else {
            stage = 1;
			      socket.write("OK\n");
          }
        } else {
          error("Invalid initial handshake message from client.");
          stopReading(); rejectAndDestroy(socket, "Invalid initial handshake");
        }
      } else if (stage === 1) {
		    verboseLog(`Starting protocol negotiation`);
        const msg = safeJSON(line);
        const clientProtocol = msg.protocol;
        if (!clientProtocol || (protocol !== 'both' && clientProtocol !== protocol)) {
          error(`Unsupported or missing protocol from client: ${line}`);
          stopReading(); rejectAndDestroy(socket, "Unsupported protocol from client");
          return;
        }
        // Mutual auth completion if client expects it
        if (SECRET && msg.clientChal) {
          socket.write(JSON.stringify({ protocol: clientProtocol, hostAuth: hmac(SECRET, msg.clientChal) }) + '\n');
        } else {
          socket.write(JSON.stringify({ protocol: clientProtocol }) + '\n');
        }
        stopReading();

        try {
          if (!checkStreamBudget('tcp/udp host')) { rejectAndDestroy(socket, "Max streams reached"); return; }
		      verboseLog(`Handshake successful! Protocol: ${clientProtocol}`);
          success("Connected to client!");
          if (TUI_ENABLED) tuiStatusLine = 'Connected';
          if (clientProtocol === 'tcp') setupTCPHost(socket);
          else if (clientProtocol === 'udp') setupUDPHost(socket);
          connectedToClient = true;
        } catch (e) {
          error(`Failed to setup host stream: ${e.message}`);
          socket.destroy();
        }
      }
    });

  } else if (mode === 'client' && !connectedToHost) {
    socket.write("HELLO:client\n");
    let stage = 0;
    let clientChal = SECRET ? randomNonce() : '';

    const stopReading = readLines(socket, (line) => {
      if (stage === 0) {
        if (line === "HELLO:client") {
          warn("Another client tried to connect to this client. Ignoring.");
          stopReading(); rejectAndDestroy(socket, "Client-to-client conflict", true);
        } else if (line === "HELLO:host") {
          stage = 0.5;
        } 
	  } else if (stage == 0.5) {
		if (line.startsWith('CHAL:')) {
		      verboseLog("Received host challenge");
          // Respond to host challenge
          const n = line.slice(5);
          if (!SECRET) { error("Host requested auth but no --secret provided."); rejectAndDestroy(socket, "Auth not configured"); return; }
          socket.write(`AUTH:${hmac(SECRET, n)}\n`);
        } else if (line === 'OK') {
          verboseLog("Host challenge successful!");
          // proceed to protocol negotiation
          stage = 1;
          socket.write(JSON.stringify({ protocol, clientChal }) + '\n');
        } else {
          // fallback: if host doesn't do challenge, go ahead
          stage = 1;
          socket.write(JSON.stringify({ protocol, clientChal }) + '\n');
        }
      } else if (stage === 1) {
		    verboseLog("Starting protocol negotiation");
        const reply = safeJSON(line);
        if (!reply.protocol || reply.protocol !== protocol) {
          error("Host does not support requested protocol.");
          stopReading(); rejectAndDestroy(socket, "Unsupported protocol from host");
        } else if (SECRET && clientChal && reply.hostAuth !== hmac(SECRET, clientChal)) {
          error("Host auth failed.");
          stopReading(); rejectAndDestroy(socket, "Auth failed");
        } else {
          stopReading();
          connectedToHost = true;
          try {
            if (!checkStreamBudget('tcp/udp client')) { rejectAndDestroy(socket, "Max streams reached"); connectedToHost = false; return; }
            verboseLog(`Handshake successful! Protocol: ${reply.protocol}`);
            success("Connected to host!");
            if (TUI_ENABLED) tuiStatusLine = 'Connected';
            if (protocol === 'tcp') setupTCPClient(socket);
            else if (protocol === 'udp') setupUDPClient(socket);
          } catch (e) {
            error(`Failed to setup client stream: ${e.message}`);
            socket.destroy();
            connectedToHost = false;
          }
        }
      }
    });
  }
});

// ------------------------- Rate Limiter -------------------------

function makeThrottleTransform(kbps) {
  if (!kbps || kbps <= 0) return new Transform({ transform(chunk, enc, cb) { addUp(chunk.length); cb(null, chunk); } });
  const bytesPerSec = kbps * 1024;
  let allowance = bytesPerSec;
  let last = Date.now();

  return new Transform({
    transform(chunk, enc, cb) {
      const now = Date.now();
      const elapsed = (now - last) / 1000;
      last = now;
      allowance = Math.min(bytesPerSec, allowance + elapsed * bytesPerSec);

      const trySend = () => {
        if (chunk.length <= allowance) {
          allowance -= chunk.length;
          addUp(chunk.length);
          cb(null, chunk);
        } else {
          const delay = Math.ceil(((chunk.length - allowance) / bytesPerSec) * 1000);
          setTimeout(trySend, Math.max(delay, 1));
        }
      };
      trySend();
    }
  });
}

// ------------------------- TCP Host / Client -------------------------

async function connectWithRetry(port, host, attempts, delayMs) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let socket = null;

    const tryOnce = () => {
      attempt++;
      socket = net.connect(port, host);
      socket.setNoDelay(true);
      socket.once('connect', () => resolve(socket));
      socket.once('error', (err) => {
        if (attempt >= attempts) {
          reject(err);
        } else {
          setTimeout(tryOnce, delayMs);
        }
      });
    };
    tryOnce();
  });
}

function setupTCPHost(p2pSocket) {
  const mux = multiplex();
  pump(p2pSocket, mux, p2pSocket, (err) => {
    if (err && !isExpectedDisconnect(err)) warn(`Pump error: ${err.message}`);
  });
  mux.on('error', (err) => warn(`Multiplex error: ${err.message}`));

  mux.on('stream', async (stream, id) => {
    if (!checkStreamBudget('tcp stream')) { stream.destroy(); return; }
    metrics.tcpStreams++;
    info(`New TCP stream ${id}`);

    let target;
    try {
      target = await connectWithRetry(remotePort, '127.0.0.1', TCP_CONNECT_RETRIES, TCP_RETRY_DELAY_MS);
    } catch (e) {
      error(`Local TCP service unavailable on port ${remotePort}: ${e.message}`);
      stream.end();
      metrics.tcpStreams--;
      return;
    }

    const throttle = makeThrottleTransform(KBPS);

    stream.on('data', (data) => { addDown(data.length); verboseLog(`[TCP ${id}] client → host (${data.length} bytes)`, { id, dir: 'c2h', len: data.length }); });
    target.on('data', (data) => { verboseLog(`[TCP ${id}] host → client (${data.length} bytes)`, { id, dir: 'h2c', len: data.length }); });

    stream.on('close', () => { verboseLog(`[TCP ${id}] stream closed by client`); target.end(); metrics.tcpStreams--; });
    target.on('close', () => { verboseLog(`[TCP ${id}] connection to local service closed`); stream.end(); });

    stream.on('error', (err) => warn(`TCP stream error: ${err.message}`));
    target.on('error', (err) => warn(`TCP target error: ${err.message}`));

    // Pipe with throttle host->client if enabled
    pump(stream, target, (err) => { if (err && !isExpectedDisconnect(err)) warn(`TCP c2h pump: ${err.message}`); });
    pump(target, throttle, stream, (err) => { if (err && !isExpectedDisconnect(err)) warn(`TCP h2c pump: ${err.message}`); });
  });
}

function setupTCPClient(p2pSocket) {
  const mux = multiplex();
  pump(p2pSocket, mux, p2pSocket, (err) => {
    if (err && !isExpectedDisconnect(err)) warn(`Pump error: ${err.message}`);
  });
  mux.on('error', (err) => warn(`Multiplex error: ${err.message}`));
  p2pSocket.on("close", () => { 
    verboseLog('Closing TCP client'); 
    connectedToHost = false; 
    startSpinner("locating host peers with the bridge ID \"" + bridgeId + "\"...");
    tcpServer.close(); 
  });

  tcpServer = net.createServer((local) => {
    if (!checkStreamBudget('tcp stream')) { local.destroy(); return; }
    const stream = mux.createStream();
    activeStreams.add(stream);

    stream.on('close', () => activeStreams.delete(stream));
    stream.on('error', (err) => warn(`TCP stream error: ${err.message}`));
    local.on('error', (err) => warn(`TCP local error: ${err.message}`));

    stream.on('close', () => local.end());
    local.on('close', () => stream.destroy());

    const throttle = makeThrottleTransform(KBPS);

    // local -> remote
    pump(local, throttle, stream, (err) => { if (err && !isExpectedDisconnect(err)) warn(`TCP local->remote pump: ${err.message}`); });
    // remote -> local
    stream.on('data', (data) => { addDown(data.length); });
    pump(stream, local, (err) => { if (err && !isExpectedDisconnect(err)) warn(`TCP remote->local pump: ${err.message}`); });

    verboseLog('TCP connection -> remote tunnel');
  });

  tcpServer.on('error', (err) => error(`TCP server error: ${err.message}`));
  tcpServer.listen(listenPort, () => info(`TCP tunnel listening on localhost:${listenPort}`));
}

// ------------------------- UDP Host / Client -------------------------

function setupUDPHost(p2pSocket) {
  const mux = multiplex();
  pump(p2pSocket, mux, p2pSocket, (err) => {
    if (err && !isExpectedDisconnect(err)) warn(`Pump error: ${err.message}`);
  });
  mux.on('error', (err) => warn(`Multiplex error: ${err.message}`));

  mux.on('stream', (stream, id) => {
    if (!checkStreamBudget('udp stream')) { stream.destroy(); return; }
    metrics.udpStreams++;
    info(`New UDP stream ${id}`);
    const udp = dgram.createSocket('udp4');

    udp.on('message', (msg) => {
      addUp(msg.length);
      verboseLog(`[UDP ${id}] local → tunnel (${msg.length} bytes)`);
      try { stream.write(msg); } catch {}
    });

    stream.on('data', (chunk) => {
      addDown(chunk.length);
      verboseLog(`[UDP ${id}] tunnel → local (${chunk.length} bytes)`);
      udp.send(chunk, remotePort, '127.0.0.1', (err) => {
        if (err) error(`Failed to send to local UDP service on port ${remotePort}: ${err.message}`);
      });
    });

    stream.on('close', () => {
      verboseLog(`[UDP ${id}] stream closed`);
      try { udp.close(); } catch {}
      metrics.udpStreams--;
    });

    stream.on('error', (err) => warn(`UDP stream error: ${err.message}`));
    udp.on('error', (err) => warn(`UDP socket error: ${err.message}`));
  });
}

function setupUDPClient(p2pSocket) {
  const mux = multiplex();
  pump(p2pSocket, mux, p2pSocket, (err) => {
    if (err && !isExpectedDisconnect(err)) warn(`Pump error: ${err.message}`);
  });
  mux.on('error', (err) => warn(`Multiplex error: ${err.message}`));
  p2pSocket.on("close", () => { 
    verboseLog('Closing UDP client'); 
    connectedToHost = false; 
    startSpinner("locating host peers with the bridge ID \"" + bridgeId + "\"...");
    udpSocket.close(); 
  });

  udpSocket = dgram.createSocket('udp4');
  const stream = mux.createStream();
  activeStreams.add(stream);
  stream.on('close', () => activeStreams.delete(stream));

  udpSocket.bind(listenPort, () => info(`UDP tunnel ready on localhost:${listenPort}`));

  udpSocket.on('message', (msg) => {
    addUp(msg.length);
    verboseLog(`[UDP CLIENT] localApp → tunnel (${msg.length} bytes)`);
    try { stream.write(msg); } catch {}
  });

  stream.on('data', (chunk) => {
    addDown(chunk.length);
    verboseLog(`[UDP CLIENT] tunnel → localApp (${chunk.length} bytes)`);
    udpSocket.send(chunk, listenPort, '127.0.0.1');
  });

  stream.on('close', () => {
    verboseLog(`[UDP CLIENT] stream closed`);
    try { udpSocket.close(); } catch {}
  });

  stream.on('error', (err) => warn(`UDP stream error: ${err.message}`));
  udpSocket.on('error', (err) => warn(`UDP socket error: ${err.message}`));
}

// ------------------------- Utils / Limits -------------------------

function safeJSON(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

function preview(buf) {
  const str = buf.toString('utf8').replace(/\s+/g, ' ').trim();
  return str.length > 60 ? str.slice(0, 57) + '...' : str;
}

function isExpectedDisconnect(err) {
  const msg = (typeof err === 'string' ? err : (err && err.message)) || '';
  return !EXPECTEDWARNINGS && (
    msg.includes('reset by peer') ||
    msg.includes('Channel destroyed') ||
    msg.includes('Readable stream closed before ending') ||
    msg.includes('ECONNRESET')
  );
}

let rejectedPeers = new Set();

function rejectAndDestroy(socket, reason, block = false) {
  const key = (socket.remoteAddress || 'peer') + ':' + (socket.remotePort || '');
  if (rejectedPeers.has(key)) return;
  if (block) rejectedPeers.add(key);
  warn("Rejected Peer: " + reason);
  try { socket.destroy(); } catch {}
  setTimeout(() => rejectedPeers.delete(key), 1000000);
}

function checkStreamBudget(reason) {
  const total = metrics.tcpStreams + metrics.udpStreams + activeStreams.size;
  if (total >= MAX_STREAMS) {
    warn(`Max streams (${MAX_STREAMS}) reached; rejecting ${reason}`);
    return false;
  }
  return true;
}

// ------------------------- Swarm lifecycle -------------------------

swarm.join(topic, { lookup: mode === 'client', announce: mode === 'host' });

swarm.on('error', (err) => {
  error(`Swarm error: ${err.message}`);
  gracefulExit(1, err.message);
});

function handleSwarmClose() {
  warn("Disconnected. Attempting reconnect in 5 seconds...");
  connectedToHost = false;
  if (exiting) return; // stay out of the swarm
  setTimeout(() => {
    if (!exiting) swarm.join(topic, { lookup: mode === 'client', announce: mode === 'host' });
  }, 5000);
}

swarm.on('close', handleSwarmClose);

// ------------------------- Cleanup -------------------------

let exiting = false;

function printCrashLog() {
  try {
    if (crashLogBuffer.length) {
      console.error('\n--- NAT-bridge crash log ---');
      crashLogBuffer.forEach(line => console.error(line));
      console.error('--- end crash log ---\n');
    }
  } catch (e) { console.error('Failed to print crash log:', e); }
}

function stopExecutionForCriticalUpdate() {
  STOP_EXECUTION = true;
  connectedToHost = false;
  stopSpinner();

  try { if (swarm && swarm.removeListener) swarm.removeListener('close', handleSwarmClose); } catch {}
  try { if (swarm && swarm.leave) swarm.leave(topic); } catch {}

  if (tcpServer) {
    try { tcpServer.close(() => info('TCP server closed')); } catch {}
    tcpServer = null;
  }

  if (udpSocket) {
    try { udpSocket.close(() => info('UDP socket closed')); } catch {}
    udpSocket = null;
  }

  for (const stream of activeStreams) {
    try {
      if (!stream.destroyed) {
        stream.end();
        setTimeout(() => { if (!stream.destroyed) stream.destroy(); }, 1000);
      }
    } catch (err) { warn(`Error while closing stream: ${err.message}`); }
  }
  activeStreams.clear();

  try {
    if (swarm) swarm.destroy(() => info('Swarm closed'));
  } catch {}

  if (TUI_ENABLED) {
    tuiStatusLine = '{red-fg}Critical update detected - execution stopped{/red-fg}';
    if (tuiFooter) {
      tuiFooter.setContent(' {red-fg}Critical update detected. Execution stopped. Press q to quit.{/red-fg}');
    }
    if (tuiScreen) {
      try { tuiScreen.render(); } catch {}
    }
  }
}

function gracefulExit(code = 0, error) {
  if (exiting) return;
  stopSpinner();
  info('Shutting down gracefully... (press Ctrl+C again to force exit)');
  exiting = true;

  if (tuiTick) {
    clearInterval(tuiTick);
    tuiTick = null;
  }
  if (tuiScreen) {
    try {
      if (tuiFooter) {
        tuiFooter.setContent(' {yellow-fg}Closing NAT-bridge...{/yellow-fg}');
      }
      tuiScreen.render();
    } catch {}
    try { tuiScreen.leave(); } catch {}
    try { tuiScreen.destroy(); } catch {}
    startExitSpinner();
  } else {
    startSpinner("Waiting for active streams to close...");
  }

  if (tcpServer) {
    try { tcpServer.close(() => info('TCP server closed')); } catch {}
  }

  if (udpSocket) {
    try { udpSocket.close(() => info('UDP socket closed')); } catch {}
  }

  for (const stream of activeStreams) {
    try {
      if (!stream.destroyed) {
        stream.end();
        setTimeout(() => { if (!stream.destroyed) stream.destroy(); }, 1000);
      }
    } catch (err) { warn(`Error while closing stream: ${err.message}`); }
  }
  activeStreams.clear();

  // idk why but the swarm just refuses to die so I alaways end up having to force kill it
  // so for now I give it a chance even though it will probably never close properly, and then nuke it after a timeout
  try {
    try { if (swarm && swarm.removeListener) swarm.removeListener('close', handleSwarmClose); } catch {}
    try { if (swarm && swarm.leave) swarm.leave(topic); } catch {}

    let swarmClosed = false;
    swarm.destroy(() => {
      swarmClosed = true;
      stopSpinner();
      info('Swarm closed');
      stopExitSpinner();
      if (code !== 0 && TUI_ENABLED) {
        printCrashLog();
        // set stderr
        console.error(error ? color(`Error: ${error}`, '31') : 'Exited with error');
      }
      process.exit(code);
    });

    // Force exit after timeout in case swarm.destroy hangs
    setTimeout(() => {
      if (!swarmClosed) {
        stopSpinner();
        stopExitSpinner();
        if (code !== 0 && TUI_ENABLED) {
          printCrashLog();
          // set stderr
          console.error((error ? color(`Error: ${error}`, '31') : 'Exited with error') + ' (swarm close timeout)');
        }
        warn('Swarm close timeout reached, forcing exit...');
        process.exit(code);
      }
    }, CLOSE_ACTIVE_STREAM_TIMEOUT_MS);

  } catch (e) {
    process.exit(code);
  }
}

process.on('SIGINT', () => { enableExitKeypress(); gracefulExit(0); });
process.on('SIGTERM', () => { enableExitKeypress(); gracefulExit(0); });
process.on('uncaughtException', (err) => {
  error(`Uncaught exception: ${err.message}`);
  if (VERBOSE) console.error(err.stack || err);
  enableExitKeypress();
  gracefulExit(1, err.message);
});
process.on('exit', (code) => { if (!exiting) enableExitKeypress(); gracefulExit(code); });
