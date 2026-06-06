<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Unlicense License][license-shield]][license-url]

<!-- LOGO -->
<br />
<div align="center">
  <a href="https://raw.githubusercontent.com/Lawtro37/NAT-bridge/refs/heads/dev/icons/NAT-bridge-icon-8.png">
    <img src="https://raw.githubusercontent.com/Lawtro37/NAT-bridge/refs/heads/dev/icons/NAT-bridge-icon-8.png" alt="Logo" width="250" height="250">
  </a>

  <h3 align="center">NAT-Bridge</h3>

  <p align="center">
    Network through P2P with no port fowarding
    <br />
    <a href="https://github.com/Lawtro37/NAT-bridge/releases/tag/v1.2.1"><strong>Latest Release »</strong></a>
    <br />
    <br />
    <a href="https://github.com/Lawtro37/NAT-bridge/issues/new?labels=bug&template=bug-report---.md">Report Bug</a>
    &middot;
    <a href="https://github.com/Lawtro37/NAT-bridge/issues/new?labels=enhancement&template=feature-request---.md">Request Feature</a>
  </p>
</div>



<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-">About</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#instructions-to-run">Instructions to Run</a></li>
        <li><a href="#building-to-executable">Building to Executable</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
  </ol>
</details>



<!-- ABOUT -->
## About

A sweet and simple single command Node.js CLI tool for tunneling TCP and UDP traffic over a peer-to-peer (P2P) network using Hyperswarm. NAT-bridge allows you to expose local services to remote clients, bypassing NAT/firewall restrictions (no need for port fowarding).

Use Cases:
* You want to play minecraft with your friend but dont want to pay for a dedicated server or port foward.
* You Are working on a website and want testers to quickly be able to acsess it.
* You only want to expose a port to specific computers for networking.

NAT-bridge can be used for many things not descussed here.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Built With


* [![Node][Node.js]][Node-url]
* [![Hyperswarm](https://img.shields.io/badge/Hyperswarm-yellow?style=for-the-badge)](https://github.com/hyperswarm)

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- GETTING STARTED -->
## Getting Started

Hyperswarm is made with node.js and can be run as such. However, if you prefer, It can also be downloaded as a windows executable [here](https://github.com/Lawtro37/NAT-bridge/releases/) in which case it should just run out of the box.

### Prerequisites
For this you will need the following:
* node
  ```bash
  winget install OpenJS.NodeJS
  ```
* npm
  ```bash
  npm install npm@latest -g
  ```

### Instructions to Run
Follow these steps to run NAT-bridge

1. Clone the repo
   ```bash
   git clone https://github.com/Lawtro37/NAT-bridge.git
   ```
2. Install NPM packages
   ```bash
   npm install
   ```
3. Run this command
   ```bash
   node main.js
   ```
4. If you prefer you can run the launcher GUI via this command
   ```bash
   npm run launcher
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Building to Executable
Follow these steps if you wish to build NAT-Bidge to an executable

#### Standalone EXE
```bash
npm run build
```

#### Launcher EXE
```bash
npm run build:launcher
```
Note that the launcher must be in the same or child directory as a `nat-bridge.exe` executable

There are currently no built in scripts for building to an executable for any operating system other than windows, though it can be done manualy through `pkg`.

<!-- USAGE EXAMPLES -->
## Usage
To connect a device to another they must have the same bridge id. The "host" machine exposes a specified port with `-e` or `--expose`. Any "client" machines can connect to the host over peer to peer if they have the same bridge id. The "client can specify a port on their machine with `-l` or `--listen` that the tunnel will listen on.

Note that anyone with the same bridge id can connect to your device if you machine is operating as a "host", unless you specify a secret with `--secret`.
Two hosts on the same bridge id can cause a variety of issues and may allow malicous hosts to trick "clients" inteded for your machine into to conneting to theirs.

No encryption is provided by NAT-bridge, that is the responsibility of the protocal running over the bridge.

```bash
node main.js <host|client> <bridge-id> [options]
```
or with a configuration
```bash
node main.js config <config-file>
```
### Options

| Option                        | Description                                 | Default   |
|-------------------------------|---------------------------------------------|-----------|
| `-e`, `--expose <port>`       | Port to expose on host                      | 8080      |
| `-l`, `--listen <port>`       | Port to listen on client                    | 5000      |
| `-p`, `--protocol <type>`     | Protocol to tunnel: `tcp`, `udp`, `both`    | tcp       |
| `-w`, `--warnings`            | Show common disconnect warnings             |           |
| `-v`, `--verbose`             | Enable verbose logging                      |           |
| `-h`, `--help`                | Show help                                   |           |
|       `--json`                | Structured JSON logs (disables spinner)     |           |
|       `--secret <pass>`       | Enable mutual auth (HMAC challenge)         |           |
|       `--status <port>`       | Start status server (JSON)                  |           |
|       `--max-streams <n>`     | Limit concurrent streams                    | 256       |
|       `--kbps <n>`            | Simple throttle per stream (0=unlimited)    | unlimited |
|       `--tcp-retries <n>`     | TCP connect retry attempts                  | 5         |
|       `--tcp-retry-delay <ms>`| Delay between retries (in miliseconds)      | 500ms     |
|       `--no-tui`              | Disable the terminal UI                     |           |
|       `--no-fancy-logs `      | Disable colored and formatted logs          |           |
|       `--skip-update-check`   | Don't check for updates on startup          |           |

#### Examples

##### Web Server Access
```bash
# Host: Share your local web server (localhost:3000) 
nat-bridge host webserver --expose 3000 --protocol tcp --verbose

# Client: Access the remote web server on your local port 8080
nat-bridge client webserver --listen 8080 --protocol tcp
# Now visit http://localhost:8080 to access the remote server
```

##### Game Server with Authentication
```bash
# Host: Expose Minecraft server with security
nat-bridge host minecraft --expose 25565 --protocol both --secret "gamenight2024"

# Client: Connect to the game server
nat-bridge client minecraft --listen 25565 --protocol tcp --secret "gamenight2024"
# Connect your Minecraft client to localhost:25565
```

##### Database Tunneling
```bash
# Host: Expose PostgreSQL database with monitoring
nat-bridge host database --expose 5432 --protocol tcp --status 9999 --max-streams 5

# Client: Connect to database through tunnel
nat-bridge client database --listen 5432 --protocol tcp
# Connect your database client to localhost:5432
# Check connection status at http://localhost:9999/status
```

##### Home Media Server
```bash
# Host: Share Plex/Jellyfin server with bandwidth limiting
nat-bridge host mediaserver --expose 32400 --protocol tcp --kbps 5000

# Client: Access media server remotely
nat-bridge client mediaserver --listen 32400 --protocol tcp
```

##### Configuration File Example
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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] Add a GUI Launcher
- [x] Add a terminal UI
- [ ] Refactor so everything isnt in one file
- [ ] Add more visuals to the TUI
    - [ ] Upload and download visual graph
- [ ] Fix that bug where streams refuse to die when exiting for some reason
- [ ] Rework the handshake protocal
    - [ ] Rework the handshake protocal
    - [ ] Add Legacy Support

See the [open issues](https://github.com/Lawtro37/NAT-bridge/issues) for a full list of proposed features (and known issues).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Feel free to fork, file issues, and submit pull requests! Any contributions that help make NAT-bridge more robust, secure, or user-friendly are welcome.

### Top contributors:

<a href="https://github.com/Lawtro37/NAT-bridge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Lawtro37/NAT-bridge" alt="contrib.rocks image" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the **GPL-3.0** License. See the `LICENSE` file for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

##### Made by Lawtro

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[contributors-shield]: https://img.shields.io/github/contributors/Lawtro37/NAT-bridge.svg?style=for-the-badge
[contributors-url]: https://github.com/Lawtro37/NAT-bridge/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Lawtro37/NAT-bridge.svg?style=for-the-badge
[forks-url]: https://github.com/Lawtro37/NAT-bridge/network/members
[stars-shield]: https://img.shields.io/github/stars/Lawtro37/NAT-bridge.svg?style=for-the-badge
[stars-url]: https://github.com/Lawtro37/NAT-bridge/stargazers
[issues-shield]: https://img.shields.io/github/issues/Lawtro37/NAT-bridge.svg?style=for-the-badge
[issues-url]: https://github.com/Lawtro37/NAT-bridge/issues
[license-shield]: https://img.shields.io/github/license/Lawtro37/NAT-bridge.svg?style=for-the-badge
[license-url]: https://github.com/Lawtro37/NAT-bridge/blob/master/LICENSE.txt
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[Node.js]: https://img.shields.io/badge/node.js-339933?style=for-the-badge&logo=Node.js&logoColor=white
[Node-url]: https://nodejs.org/
