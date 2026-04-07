const el = {
  loadFromFile: document.getElementById("loadFromFile"),
  configRow: document.getElementById("configRow"),
  configFile: document.getElementById("configFile"),
  browseBtn: document.getElementById("browseBtn"),
  section: document.getElementById("interactiveSection"),
  mode: document.getElementById("mode"),
  bridgeId: document.getElementById("bridgeId"),
  protocol: document.getElementById("protocol"),
  port: document.getElementById("port"),
  verbose: document.getElementById("verbose"),
  warnings: document.getElementById("warnings"),
  openCmd: document.getElementById("openCmd"),
  advancedSelect: document.getElementById("advancedSelect"),
  advancedFieldset: document.getElementById("advancedFieldset"),
  secret: document.getElementById("secret"),
  status: document.getElementById("status"),
  maxStreams: document.getElementById("maxStreams"),
  kbps: document.getElementById("kbps"),
  tcpRetries: document.getElementById("tcpRetries"),
  tcpRetryDelay: document.getElementById("tcpRetryDelay"),
  runBtn: document.getElementById("runBtn"),
  clearBtn: document.getElementById("clearBtn"),
  statusLabel: document.getElementById("statusLabel"),
  output: document.getElementById("output"),
};

let running = false;
let advancedOpen = false;
let ansiColor = null;
let lines = [""];

const ansiMap = {
  30: "#000000",
  31: "#cd3131",
  32: "#0dbc79",
  33: "#e5e510",
  34: "#2472c8",
  35: "#bc3fbc",
  36: "#11a8cd",
  37: "#e5e5e5",
  90: "#666666",
  91: "#f14c4c",
  92: "#23d18b",
  93: "#f5f543",
  94: "#3b8eea",
  95: "#d670d6",
  96: "#29b8db",
  97: "#e5e5e5",
};

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function writeChar(ch) {
  const safe = escapeHtml(ch);
  if (ansiColor) {
    lines[lines.length - 1] += `<span style="color:${ansiColor}">${safe}</span>`;
  } else {
    lines[lines.length - 1] += safe;
  }
}

function renderBuffer() {
  el.output.innerHTML = lines.join("<br>");
  el.output.scrollTop = el.output.scrollHeight;
}

function processAnsiText(text) {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\u001b" && text[i + 1] === "[") {
      const mIdx = text.indexOf("m", i);
      if (mIdx === -1) break;
      const codes = text.slice(i + 2, mIdx).split(";").map(Number);
      for (const code of codes) {
        if (code === 0) ansiColor = null;
        if (ansiMap[code]) ansiColor = ansiMap[code];
      }
      i = mIdx + 1;
      continue;
    }
    if (ch === "\r") {
      lines[lines.length - 1] = "";
      i += 1;
      continue;
    }
    if (ch === "\b") {
      const current = lines[lines.length - 1];
      lines[lines.length - 1] = current.slice(0, -1);
      i += 1;
      continue;
    }
    if (ch === "\n") {
      lines.push("");
      i += 1;
      continue;
    }
    writeChar(ch);
    i += 1;
  }
}

function refreshVisibility() {
  const fromFile = el.loadFromFile.checked;
  el.section.classList.toggle("hidden", fromFile);
  el.configRow.classList.toggle("hidden", !fromFile);
}

function refreshProtocol() {
  const mode = el.mode.value;
  if (mode === "client") {
    if (el.protocol.value === "both") el.protocol.value = "tcp";
    if (el.port.value === "8080" || el.port.value === "") el.port.value = "5000";
  } else {
    if (el.port.value === "5000" || el.port.value === "") el.port.value = "8080";
  }
}

function refreshAdvanced() {
  el.advancedFieldset.classList.toggle("hidden", !advancedOpen);
}

function setStatus(status, isRunning) {
  running = !!isRunning;
  el.statusLabel.textContent = `Status: ${status}`;
  el.runBtn.textContent = running ? "Stop" : "Start";
}

function appendLog(stream, text) {
  processAnsiText(text);
  renderBuffer();
}

function getPayload() {
  return {
    loadFromFile: el.loadFromFile.checked,
    configFile: el.configFile.value.trim(),
    mode: el.mode.value,
    bridgeId: el.bridgeId.value.trim(),
    protocol: el.protocol.value,
    port: el.port.value.trim(),
    verbose: el.verbose.checked,
    warnings: el.warnings.checked,
    openCommandPrompt: el.openCmd.checked,
    secret: el.secret.value.trim(),
    status: el.status.value.trim(),
    maxStreams: el.maxStreams.value.trim(),
    kbps: el.kbps.value.trim(),
    tcpRetries: el.tcpRetries.value.trim(),
    tcpRetryDelay: el.tcpRetryDelay.value.trim(),
  };
}

el.loadFromFile.addEventListener("change", refreshVisibility);
el.mode.addEventListener("change", refreshProtocol);

el.advancedSelect.addEventListener("change", () => {
  advancedOpen = el.advancedSelect.value === "show";
  refreshAdvanced();
});

el.browseBtn.addEventListener("click", async () => {
  const picked = await window.launcherApi.browseConfig();
  if (picked) el.configFile.value = picked;
});

el.runBtn.addEventListener("click", async () => {
  const result = await window.launcherApi.toggle(getPayload());
  if (!result.ok) {
    setStatus("error", false);
    return;
  }
  if (result.running) {
    setStatus("running", true);
  }
});

el.clearBtn.addEventListener("click", () => {
  lines = [""];
  ansiColor = null;
  renderBuffer();
});

window.launcherApi.onLog((p) => appendLog(p.stream, p.text));
window.launcherApi.onStatus((p) => setStatus(p.status, p.running));

refreshVisibility();
refreshProtocol();
el.advancedSelect.value = "hide";
refreshAdvanced();
setStatus("idle", false);
appendLog("stdout", "[info] Launcher ready.\n");
