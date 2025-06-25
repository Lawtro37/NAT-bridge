# NAT-bridge

A sweet and simple Node.js CLI tool for tunneling TCP and UDP traffic over a peer-to-peer (P2P) network using [Hyperswarm](https://github.com/hyperswarm/hyperswarm). NAT-bridge allows you to expose local services to remote clients, bypassing NAT/firewall restrictions (no need for port fowarding).

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
node main.js <host|client> <bridge-id> [options]
```

### Options

| Option                      | Description                                 | Default   |
|-----------------------------|---------------------------------------------|-----------|
| `-e`, `--expose <port>`     | Port to expose on host                      | 8080      |
| `-l`, `--listen <port>`     | Port to listen on client                    | 5000      |
| `-p`, `--protocol <type>`   | Protocol to tunnel: `tcp`, `udp`, `both`    | tcp       |
| `-v`, `--verbose`           | Enable verbose logging                      |           |
| `-h`, `--help`              | Show help                                   |           |

---

### Examples

#### Expose a local TCP+UDP service on port 3000

```bash
node main.js host mybridge --expose 3000 --protocol both
```

#### Connect as a client and listen on port 1234 for UDP

```bash
node main.js client mybridge --listen 1234 --protocol udp
```

#### Expose a TCP-only service on port 8081

```bash
node main.js host mybridge2 --expose 8081 --protocol tcp
```

#### Connect as a client and listen on port 9000 for both TCP

```bash
node main.js client mybridge2 --listen 9000 --protocol tcp
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

Install dependencies with:

```bash
npm install hyperswarm multiplex
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

## Advanced

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
