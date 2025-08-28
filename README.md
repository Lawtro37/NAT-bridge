# NAT-bridge

A sweet and simple single command Node.js CLI tool for tunneling TCP and UDP traffic over a peer-to-peer (P2P) network using [Hyperswarm](https://github.com/hyperswarm/hyperswarm). NAT-bridge allows you to expose local services to remote clients, bypassing NAT/firewall restrictions (no need for port fowarding).

---

## Features

- Tunnel **TCP**, **UDP**, or **both** protocols.
- Peer-to-peer connectivity via Hyperswarm (no central server).
- Multiplexing for multiple simultaneous streams.
- One command simple CLI usage.
- Works behind NAT/firewall **without** port forwarding.

---

## Limitations
- Protocols that require complex NAT traversal (like STUN/TURN or Multicast) probably wont work correctly.
- ICMP (used by ping) is **not** supported (NAT-bridge is TCP/UDP only).
- Encrypted protocols (HTTPS, SSH) work transparently, encryption is handled by the tunneled service, **not** NAT-bridge.

## Installation

```bash
npm install
```

---

## Usage

```bash
nat-bridge <host|client> <bridge-id> [options]
```

### Options

| Option                        | Description                                 | Default   |
|-------------------------------|---------------------------------------------|-----------|
| `-e`, `--expose <port>`       | Port to expose on host                      | 8080      |
| `-l`, `--listen <port>`       | Port to listen on client                    | 5000      |
| `-p`, `--protocol <type>`     | Protocol to tunnel: `tcp`, `udp`, `both`    | tcp       |
| `-v`, `--verbose`             | Enable verbose logging                      |           |
| `-h`, `--help`                | Show help                                   |           |
|       `--json                 | Structured JSON logs (disables spinner)     |           |
|       `--secret <pass>`       | Enable mutual auth (HMAC challenge)         |           |
|       `--status <port>`       | Start status server (JSON)                  |           |
|       `--max-streams <n>`     | Limit concurrent streams                    | 256       |
|       `--kbps <n>`            | Simple throttle per stream (0=unlimited)    | unlimited |
|       `--tcp-retries <n>`     | TCP connect retry attempts                  | 5         |
|       `--tcp-retry-delay <ms>`| Delay between retries (in miliseconds)      | 500ms     |

---

### Examples

#### Web Server Access
```bash
# Host: Share your local web server (localhost:3000) 
nat-bridge host webserver --expose 3000 --protocol tcp --verbose

# Client: Access the remote web server on your local port 8080
nat-bridge client webserver --listen 8080 --protocol tcp
# Now visit http://localhost:8080 to access the remote server
```

#### Game Server with Authentication
```bash
# Host: Expose Minecraft server with security
nat-bridge host minecraft --expose 25565 --protocol both --secret "gamenight2024"

# Client: Connect to the game server
nat-bridge client minecraft --listen 25565 --protocol tcp --secret "gamenight2024"
# Connect your Minecraft client to localhost:25565
```

#### Database Tunneling
```bash
# Host: Expose PostgreSQL database with monitoring
nat-bridge host database --expose 5432 --protocol tcp --status 9999 --max-streams 5

# Client: Connect to database through tunnel
nat-bridge client database --listen 5432 --protocol tcp
# Connect your database client to localhost:5432
# Check connection status at http://localhost:9999/status
```

#### Home Media Server
```bash
# Host: Share Plex/Jellyfin server with bandwidth limiting
nat-bridge host mediaserver --expose 32400 --protocol tcp --kbps 5000

# Client: Access media server remotely
nat-bridge client mediaserver --listen 32400 --protocol tcp
```

#### Configuration File Example
```bash
# Create config.json:
{
  "mode": "host",
  "bridgeId": "myservice",
  "exposedPort": 8080,
  "protocol": "tcp",
  "secret": "mysecret123",
  "verbose": true,
  "maxStreams": 10
}

# Use the config file:
nat-bridge config ./config.json
```

---

## How It Works

- **Host mode**: Exposes a local service (TCP/UDP) to the P2P network.
- **Client mode**: Connects to the host via P2P and forwards traffic to/from a local port.
- Uses a shared `bridge-id` as the P2P topic for discovery.
- Multiplexing allows multiple simultaneous connections over a single P2P link.

---

## Requirements

- Node.js v14+
- [Hyperswarm](https://github.com/hyperswarm/hyperswarm)
- [multiplex](https://github.com/maxogden/multiplex) 
- [pump](https://github.com/mafintosh/pump)

Install dependencies with:

```bash
npm install hyperswarm multiplex pump
```

---

## Troubleshooting

- **No connection established:**  
  Ensure both the host and the client use the same `bridge-id` and protocol.
- **Port already in use:**  
  Change the `--listen` port to an available one.
- **No service running on host:**  
  Make sure the service you want to expose is running on the host machine and at the specified port.
- **Firewall issues:**  
  NAT-bridge works behind most NAT/firewalls, but some restrictive networks may block P2P connections.

---

## Security

- **No authentication or encryption is provided by default.**
- It is up to you or the protocol tunneled through NAT-bridge to encrypt data.
- Use on trusted networks or add your own security layer if needed (e.g., run a VPN or SSH tunnel over NAT-bridge).
- Anyone with the same `bridge-id` can connect; treat the `bridge-id` as a shared secret.

---

## Notes
- the warning `[WARN] Socket error: connection reset by peer` is common and often harmless.
- if you get the warning `[WARN] [CONFLICT] Another host attempted to connect. Ignoring.` you may want to change your bridge ID.

---

## More Info

- **Multiple clients:**  
  Multiple clients can connect to the same host using the same `bridge-id`.
- **Changing protocols:**  
  You can tunnel both TCP and UDP simultaneously by using `--protocol both`.
- **Custom topics:**  
  The `bridge-id` is used to generate a unique P2P topic. Use a random or hard-to-guess string for privacy.

---

## Contributing

Feel free to fork, file issues, and submit pull requests!
Any contributions that help make NAT-bridge more robust, secure, or user-friendly are welcome.

---

#### made by Lawtro

##### MIT Licence

##
