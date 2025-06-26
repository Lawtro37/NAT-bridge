const net = require('net');
const dgram = require('dgram');
const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const multiplex = require('multiplex');
const https = require('https');
const VERSION = '1.0.1';
const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/Lawtro37/nat-bridge/main/VERSION';


https.get(VERSION_CHECK_URL, (res) => {
	let data = '';
	res.on('data', chunk => data += chunk);
	res.on('end', () => {
		const remoteVersion = data.trim()
		.split("\n----------\n")[0] // future-proofing if I want to add more stuff later
		.split("\n");
		if (remoteVersion.length === 0) {
			warn('Could not retrieve remote version information.');
			return;
		}
		if (remoteVersion && remoteVersion[0] !== VERSION) {
			console.log(color('[UPDATE]', '33'), `A new version (${remoteVersion[0]}) is available! You are using ${VERSION}.`);
			console.log(color('[UPDATE]', '33'), 'Visit https://github.com/Lawtro37/nat-bridge/releases to download the latest version.');
			if (remoteVersion.length > 1) {
				console.log(color('[UPDATE]', '33'), `Changelog: \n ${remoteVersion.slice(1).join('\n')}`);
			}
		}
	});
}).on('error', () => {
	warn('Could not check for updates.');
});

// Helpers
const args = process.argv.slice(2);
const color = (text, c) => process.stdout.isTTY ? `\x1b[${c}m${text}\x1b[0m` : text;
const info = (msg) => console.log(color('[INFO]', '36'), msg);
const warn = (msg) => console.warn(color('[WARN]', '33'), msg);
const error = (msg) => console.error(color('[ERROR]', '31'), msg);
const verboseLog = (...msg) => VERBOSE && console.log(color('[VERBOSE]', '90'), ...msg);

// Defaults
let listenPort = 5000;
let remotePort = 8080;
let protocol = 'tcp';
let VERBOSE = false;

// Arg parsing
let mode = args[0];
let bridgeId = args[1];

for (let i = 2; i < args.length; i++) {
	if (args[i] === '--listen' || (args[i] === '-l' && args[i + 1])) listenPort = parseInt(args[++i]);
	else if (args[i] === '--expose' || (args[i] === '-e' && args[i + 1])) remotePort = parseInt(args[++i]);
	else if (args[i] === '--protocol' || (args[i] === '-p' && args[i + 1])) protocol = args[++i].toLowerCase();
	else if (args[i] === '--verbose' || (args[i] === '-v')) VERBOSE = true;
	else if (args[i] === '--help' || (args[i] === '-h')) return printHelpAndExit();
}

if (!['host', 'client', 'config'].includes(mode) || !bridgeId || !['tcp', 'udp', 'both'].includes(protocol)) {
	return printHelpAndExit();
}

if (mode === 'config') { // Load configuration from file
    info(`Loading configuration from file "${bridgeId}"`);
    // load from config file
    const config = require(bridgeId);
    if (['host', 'client'].includes(config.mode) && ['tcp', 'udp', 'both'].includes(config.protocol)) {
        mode = config.mode;
        bridgeId = config.bridgeId || Math.random().toString(36).substring(2, 15);
        listenPort = config.listenPort || listenPort || 5000;
        remotePort = config.exposedPort || remotePort || 8080;
        protocol = config.protocol;
        VERBOSE = config.verbose || VERBOSE;
        if (mode === 'client' && protocol === 'both') {
            error("Client mode does not support 'both' protocol. Please use 'tcp' or 'udp'.");
            info("You can open a udp and tcp tunnel on the same port to achieve the same effect.");
            process.exit(1);
        }
    } else {
        error("Invalid configuration file. Please check the contents.");
        process.exit(1);
    }
}

if (mode === 'client' && protocol === 'both') {
    error("Client mode does not support 'both' protocol. Please use 'tcp' or 'udp'.");
    info("You can open a udp and tcp tunnel on the same port to achieve the same effect.");
    process.exit(1);
}

function printHelpAndExit() {
	console.log(`
${color('NAT Bridge CLI - Hybrid TCP/UDP over P2P', '36')}
v1.0.0

Usage:
  node main.js <host|client> <bridge-id> [options]
  node main.js config <config-file>

Options:
  -e, --expose <port>       Port to expose on host (default: 8080)
  -l, --listen <port>       Port to listen on client (default: 5000)
  -p, --protocol tcp|udp|both   Protocol to tunnel (default: tcp)
  -v, --verbose             Enable verbose logging
  -h, --help                Show this help

Examples:
  node main.js host mybridge --expose 3000 --protocol both
  node main.js client mybridge --listen 1234 --protocol udp
`);
	process.exit(1);
}

// Setup
const topicName = `NAT-bridge:${bridgeId}`;
const topic = crypto.createHash('sha256').update(topicName).digest();

console.log(color('[ NAT Bridge CLI ]', '34'));
info(`Mode       : ${mode}`);
info(`Bridge ID  : ${bridgeId}`);
info(`Protocol   : ${protocol}`);
info(mode === 'host' ? `Exposing   : localhost:${remotePort}` : `Listening  : localhost:${listenPort}`);
if (VERBOSE) info(`Verbose    : Enabled`);

if (mode === 'host' && protocol !== 'udp') {
	const testConn = net.connect(remotePort, '127.0.0.1');
	testConn.once('error', () => {
		error(`No service running on localhost:${remotePort}`);
		process.exit(1);
	});
	testConn.once('connect', () => testConn.destroy());
}

// P2P Setup
const swarm = new Hyperswarm();

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

swarm.on('connection', (socket) => {
	info('P2P connection established');

	socket.on('error', (err) => warn(`Socket error: ${err.message}`));
	socket.on('close', () => verboseLog('P2P socket closed'));

	if (mode === 'host') {
		socket.write("HELLO:host\n");
		let stage = 0;

		const stopReading = readLines(socket, (line) => {
			if (stage === 0) {
				if (line === "HELLO:host") {
					warn("[CONFLICT] Another host attempted to connect. Ignoring. (You may want to change your bridge ID)");
					stopReading(); socket.destroy();
				} else if (line === "HELLO:client") {
					stage = 1;
				} else {
					error("Invalid initial handshake message from client.");
					stopReading(); socket.destroy();
				}
			} else if (stage === 1) {
				const { protocol: clientProtocol } = safeJSON(line);
				if (!clientProtocol || (protocol !== 'both' && clientProtocol !== protocol)) {
					error(`Unsupported or missing protocol from client: ${line}`);
					stopReading(); socket.destroy();
					return;
				}

				socket.write(JSON.stringify({ protocol: clientProtocol }) + '\n');
				stopReading();

				try {
					if (clientProtocol === 'tcp') setupTCPHost(socket);
					else if (clientProtocol === 'udp') setupUDPHost(socket);
				} catch (e) {
					error(`Failed to setup host stream: ${e.message}`);
					socket.destroy();
				}
			}
		});

	} else if (mode === 'client') {
		socket.write("HELLO:client\n");
		let stage = 0;

		const stopReading = readLines(socket, (line) => {
			if (stage === 0) {
				if (line === "HELLO:client") {
					warn("Another client tried to connect to this client. Ignoring.");
					stopReading(); socket.destroy();
				} else if (line === "HELLO:host") {
					stage = 1;
					socket.write(JSON.stringify({ protocol }) + '\n');
				} else {
					error("Invalid handshake from host.");
					stopReading(); socket.destroy();
				}
			} else if (stage === 1) {
				const reply = safeJSON(line);
				if (!reply.protocol || reply.protocol !== protocol) {
					error("Host does not support requested protocol.");
					stopReading(); socket.destroy();
				} else {
					stopReading();
					try {
						if (protocol === 'tcp') setupTCPClient(socket);
						else if (protocol === 'udp') setupUDPClient(socket);
					} catch (e) {
						error(`Failed to setup client stream: ${e.message}`);
						socket.destroy();
					}
				}
			}
		});
	}
});

// TCP Host
function setupTCPHost(socket) {
	const mux = multiplex();
	socket.pipe(mux).pipe(socket);

	mux.on('error', (err) => warn(`Multiplex error: ${err.message}`));

	mux.on('stream', (stream, id) => {
		info(`New TCP stream ${id}`);
		const target = net.connect(remotePort, '127.0.0.1');

		stream.on('data', (data) => verboseLog(`[TCP ${id}] client → host (${data.length} bytes)`, preview(data)));
		target.on('data', (data) => verboseLog(`[TCP ${id}] host → client (${data.length} bytes)`, preview(data)));

		stream.on('close', () => verboseLog(`[TCP ${id}] stream closed by client`));
		target.on('close', () => verboseLog(`[TCP ${id}] connection to local service closed`));

		stream.on('error', (err) => warn(`TCP stream error: ${err.message}`));
		target.on('error', (err) => warn(`TCP target error: ${err.message}`));

		stream.pipe(target).pipe(stream);
	});
}

// TCP Client
function setupTCPClient(socket) {
	const mux = multiplex();
	socket.pipe(mux).pipe(socket);

	mux.on('error', (err) => warn(`Multiplex error: ${err.message}`));

	const server = net.createServer((local) => {
		const stream = mux.createStream();

		stream.on('error', (err) => warn(`TCP stream error: ${err.message}`));
		local.on('error', (err) => warn(`TCP local error: ${err.message}`));

		stream.on('close', () => local.end());
		local.on('close', () => stream.destroy());

		local.pipe(stream).pipe(local);
		verboseLog('TCP connection -> remote tunnel');
	});

	server.on('error', (err) => error(`TCP server error: ${err.message}`));

	server.listen(listenPort, () => info(`TCP tunnel listening on localhost:${listenPort}`));
}

// UDP Host
function setupUDPHost(socket) {
	const mux = multiplex();
	socket.pipe(mux).pipe(socket);

	mux.on('error', (err) => warn(`Multiplex error: ${err.message}`));

	mux.on('stream', (stream, id) => {
		info(`New UDP stream ${id}`);
		const udp = dgram.createSocket('udp4');

		udp.on('message', (msg) => {
			verboseLog(`[UDP ${id}] local → tunnel (${msg.length} bytes)`, preview(msg));
			try { stream.write(msg); } catch {}
		});

		stream.on('data', (chunk) => {
			verboseLog(`[UDP ${id}] tunnel → local (${chunk.length} bytes)`, preview(chunk));
			udp.send(chunk, remotePort, '127.0.0.1');
		});

		stream.on('close', () => {
			verboseLog(`[UDP ${id}] stream closed`);
			udp.close();
		});

		stream.on('error', (err) => warn(`UDP stream error: ${err.message}`));
		udp.on('error', (err) => warn(`UDP socket error: ${err.message}`));
	});
}

// UDP Client
function setupUDPClient(socket) {
	const mux = multiplex();
	socket.pipe(mux).pipe(socket);

	mux.on('error', (err) => warn(`Multiplex error: ${err.message}`));

	const udp = dgram.createSocket('udp4');
	const stream = mux.createStream();

	udp.bind(listenPort, () => info(`UDP tunnel ready on localhost:${listenPort}`));

	udp.on('message', (msg) => {
		verboseLog(`[UDP CLIENT] localApp → tunnel (${msg.length} bytes)`, preview(msg));
		try { stream.write(msg); } catch {}
	});

	stream.on('data', (chunk) => {
		verboseLog(`[UDP CLIENT] tunnel → localApp (${chunk.length} bytes)`, preview(chunk));
		udp.send(chunk, listenPort, '127.0.0.1');
	});

	stream.on('close', () => {
		verboseLog(`[UDP CLIENT] stream closed`);
		udp.close();
	});

	stream.on('error', (err) => warn(`UDP stream error: ${err.message}`));
	udp.on('error', (err) => warn(`UDP socket error: ${err.message}`));
}

// Utilities
function safeJSON(str) {
	try {
		return JSON.parse(str);
	} catch {
		return {};
	}
}

function preview(buf) {
	const str = buf.toString('utf8').replace(/\s+/g, ' ').trim();
	return str.length > 60 ? str.slice(0, 57) + '...' : str;
}

swarm.join(topic, { lookup: mode === 'client', announce: mode === 'host' });
swarm.on('error', (err) => {
	error(`Swarm error: ${err.message}`);
	process.exit(1);
});

swarm.on('close', () => {
  warn("Disconected. Attempting reconnect in 5 seconds...");
  setTimeout(() => swarm.join(topic, { lookup: mode === 'client', announce: mode === 'host' }), 5000);
});

// close all sockets gracefully
process.on('SIGINT', () => {
	info('Shutting down gracefully...');
	swarm.destroy(() => {
		info('Swarm closed');
		process.exit(0);
	});
});

process.on('SIGTERM', () => {
	info('Received SIGTERM, shutting down gracefully...');
	swarm.destroy(() => {
		info('Swarm closed');
		process.exit(0);
	});
});

process.on('exit', (code) => {
	info(`Exiting with code ${code}`);
	swarm.destroy(() => {
		info('Swarm destroyed');
	});
});

process.on('uncaughtException', (err) => {
	error(`Uncaught exception: ${err.message}`);
	if (VERBOSE) console.error(err.stack || err);
	process.exit(1);
});
