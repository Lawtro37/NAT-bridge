#!/usr/bin/env node
'use strict';

const net = require('net');
const dgram = require('dgram');
const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const multiplex = require('multiplex');
const https = require('https');
const http = require('http');
const pump = require('pump');
const { Transform } = require('stream');

const VERSION = '1.0.4';
const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/Lawtro37/nat-bridge/main/VERSION';

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
let SECRET = parseArgValue('secret', 's', '');          // optional shared secret
let STATUS_PORT = parseInt(parseArgValue('status', null, '0'), 10) || 0;
let MAX_STREAMS = parseInt(parseArgValue('max-streams', null, '256'), 10); // per process
let KBPS = parseInt(parseArgValue('kbps', null, '0'), 10); // 0 = unlimited
let HANDSHAKE_TIMEOUT_MS = 10000;
let TCP_CONNECT_RETRIES = parseInt(parseArgValue('tcp-retries', null, '5'), 10);
let TCP_RETRY_DELAY_MS = parseInt(parseArgValue('tcp-retry-delay', null, '500'), 10);

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
  -h, --help                    Show this help

Examples:
  node main.js host mybridge --expose 3000 --protocol both --secret abc
  node main.js client mybridge --listen 1234 --protocol udp --json --status 7777
`);
  process.exit(1);
}

// Validate / config mode
if (!['host', 'client', 'config'].includes(mode) || !bridgeId || !['tcp', 'udp', 'both'].includes(protocol)) {
  if (!(mode === 'config')) printHelpAndExit();
}

if (mode === 'config') {
  info(`Loading configuration from file "${bridgeId}"`);
  try {
    const config = require(bridgeId);
    if (['host', 'client'].includes(config.mode) && ['tcp', 'udp', 'both'].includes(config.protocol)) {
      mode = config.mode;
      bridgeId = config.bridgeId || Math.random().toString(36).substring(2, 15);
      listenPort = config.listenPort || listenPort || 5000;
      remotePort = config.exposedPort || remotePort || 8080;
      protocol = config.protocol;
      VERBOSE = config.verbose || VERBOSE;
      SECRET = config.secret || SECRET;
      STATUS_PORT = config.status || STATUS_PORT;
      MAX_STREAMS = config.maxStreams || MAX_STREAMS;
      KBPS = config.kbps || KBPS;
      TCP_CONNECT_RETRIES = config.tcpRetries || TCP_CONNECT_RETRIES;
      TCP_RETRY_DELAY_MS = config.tcpRetryDelayMs || TCP_RETRY_DELAY_MS;
    } else {
      error("Invalid configuration file. Please check the contents.");
      process.exit(1);
    }
  } catch (e) {
    error(`Failed to load configuration file "${bridgeId}": ${e.message}`);
    process.exit(1);
  }
}

if (mode === 'client' && protocol === 'both') {
  error("Client mode does not support 'both' protocol. Please use 'tcp' or 'udp'.");
  info("You can open a udp and tcp tunnel on the same port to achieve the same effect.");
  process.exit(1);
}

// Logging
function nowIso() { return new Date().toISOString(); }
function color(text, c) {
  if (JSON_MODE || !process.stdout.isTTY) return text;
  return `\x1b[${c}m${text}\x1b[0m`;
}
function jlog(level, msg, extra = {}) {
  if (!JSON_MODE) return false;
  const entry = { ts: nowIso(), level, msg, ...extra };
  console.log(JSON.stringify(entry));
  return true;
}
const info = (msg, extra) => jlog('info', msg, extra) || console.log(color('[INFO]', '36'), msg);
const warn = (msg, extra) => {
  const s = String(msg ?? '');
  if (!isExpectedDisconnect(s)) (jlog('warn', s, extra) || console.warn(color('[WARN]', '33'), s));
};
const error = (msg, extra) => jlog('error', String(msg ?? ''), extra) || console.error(color('[ERROR]', '31'), msg);
const success = (msg, extra) => jlog('success', msg, extra) || console.log(color('[SUCCESS]', '32'), msg);
const verboseLog = (msg, extra) => { if (VERBOSE) (jlog('verbose', msg, extra) || console.log(color('[VERBOSE]', '90'), msg)); };

// Spinner
let spinnerInterval = null;
let spinnerIndex = 0;
const spinnerChars = ['|', '/', '-', '\\'];
let currentSpinnerMessage = '';

function startSpinner(message) {
  if (JSON_MODE || !process.stdout.isTTY) return;
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
  if (!spinnerInterval || JSON_MODE || !process.stdout.isTTY) return;
  clearInterval(spinnerInterval);
  spinnerInterval = null;
  const clearLine = '\r' + ' '.repeat(process.stdout.columns || 80) + '\r';
  process.stdout.write(clearLine);
}

// ------------------------- Startup Banner -------------------------

const topicName = `NAT-bridge:${bridgeId}`;
const topic = crypto.createHash('sha256').update(topicName).digest();

console.log(color('[ NAT Bridge CLI ]', '34'));
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

if (mode === 'client') startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`);
else startSpinner(`waiting for P2P connections...`);

// ------------------------- Version Check -------------------------

https.get(VERSION_CHECK_URL, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const remoteVersion = data.trim().split("\n----------\n")[0].split("\n");
    if (remoteVersion.length === 0) {
      stopSpinner(); warn('Could not retrieve remote version information.');
      mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
      return;
    }
    if (remoteVersion && remoteVersion[0] !== VERSION) {
      stopSpinner();
      console.log(color('[UPDATE]', '33'), `A new version (${remoteVersion[0]}) is available! You are using ${VERSION}.`);
      console.log(color('[UPDATE]', '33'), 'Visit https://github.com/Lawtro37/nat-bridge/releases to download the latest version.');
      if (remoteVersion.length > 1) console.log(color('[UPDATE]', '33'), `Changelog: \n${remoteVersion.slice(1).join('\n')}`);
      mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
    }
  });
}).on('error', () => {
  stopSpinner(); warn('Could not check for updates.');
  mode === 'client' ? startSpinner(`locating host peers with the bridge ID "${bridgeId}"...`) : startSpinner(`waiting for P2P connections...`);
});

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
  stopSpinner();
  verboseLog('P2P connection established');
  metrics.p2pConnections++;
  metrics.lastPeer = `${socket.remoteHost || 'peer'}:${socket.remotePort || ''}`;

  socket.on('error', (err) => warn(`Socket error: ${err.message}`));
  socket.on('close', () => { verboseLog('P2P socket closed'); });

  verboseLog('Beginning handshake');

  addHandshakeTimeout(socket, mode.toUpperCase());

  if (mode === 'host') {
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
          if (clientProtocol === 'tcp') setupTCPHost(socket);
          else if (clientProtocol === 'udp') setupUDPHost(socket);
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
          stopReading(); rejectAndDestroy(socket, "Client-to-client conflict");
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
  setTimeout(() => rejectedPeers.delete(key), 10000);
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
  gracefulExit(1);
});

swarm.on('close', () => {
  warn("Disconnected. Attempting reconnect in 5 seconds...");
  connectedToHost = false;
  setTimeout(() => swarm.join(topic, { lookup: mode === 'client', announce: mode === 'host' }), 5000);
});

// ------------------------- Cleanup -------------------------

let exiting = false;

function gracefulExit(code = 0) {
  if (exiting) return;
  stopSpinner();
  info('Shutting down gracefully...');
  exiting = true;

  // 1. Stop TCP server
  if (tcpServer) {
    try { tcpServer.close(() => info('TCP server closed')); } catch {}
  }

  // 2. Stop UDP socket
  if (udpSocket) {
    try { udpSocket.close(() => info('UDP socket closed')); } catch {}
  }

  // 3. Close all active streams
  for (const stream of activeStreams) {
    try {
      if (!stream.destroyed) {
        stream.end();
        setTimeout(() => { if (!stream.destroyed) stream.destroy(); }, 1000);
      }
    } catch (err) { warn(`Error while closing stream: ${err.message}`); }
  }
  activeStreams.clear();

  // 4. Destroy swarm with a fallback timeout
  try {
    let swarmClosed = false;
    swarm.destroy(() => {
      swarmClosed = true;
      info('Swarm closed');
      process.exit(code);
    });

    // Force exit after 3s in case swarm.destroy hangs
    setTimeout(() => {
      if (!swarmClosed) {
        warn('Swarm close timeout reached, forcing exit...');
        process.exit(code);
      }
    }, 3000);

  } catch (e) {
    process.exit(code);
  }
}

process.on('SIGINT', () => gracefulExit(0));
process.on('SIGTERM', () => gracefulExit(0));
process.on('uncaughtException', (err) => {
  error(`Uncaught exception: ${err.message}`);
  if (VERBOSE) console.error(err.stack || err);
  gracefulExit(1);
});
process.on('exit', (code) => { if (!exiting) gracefulExit(code); });
