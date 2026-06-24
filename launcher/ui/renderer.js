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
  noTui: document.getElementById("noTui"),
  advancedOptions: document.getElementById("advancedOptions"),
  secret: document.getElementById("secret"),
  status: document.getElementById("status"),
  maxStreams: document.getElementById("maxStreams"),
  kbps: document.getElementById("kbps"),
  tcpRetries: document.getElementById("tcpRetries"),
  tcpRetryDelay: document.getElementById("tcpRetryDelay"),
  runBtn: document.getElementById("runBtn"),
  statusLabel: document.getElementById("statusLabel"),
  skipUpdateCheck: document.getElementById("skipUpdateCheck"),
  noFancyLogs: document.getElementById("noFancyLogs"),
  messageLabel: document.getElementById("messageLabel"),
};

let running = false;
let advancedOpen = false;

function refreshVisibility() {
  const fromFile = el.loadFromFile.checked;

  el.section.classList.toggle("hidden", fromFile);
  el.configRow.classList.toggle("hidden", !fromFile);
}

function refreshProtocol() {
  const mode = el.mode.value;

  if (mode === "client") {
    if (el.protocol.value === "both") {
      el.protocol.value = "tcp";
    }
    if (el.port.value === "8080" || el.port.value === "") {
      el.port.value = "5000";
    }
  } else {
    if (el.port.value === "5000" || el.port.value === "") {
      el.port.value = "8080";
    }
  }
}

function setStatus(status, isRunning, message) {
  el.statusLabel.textContent = `Status: ${status}`;
  el.runBtn.textContent = isRunning ? "Stop" : "Start";
  el.messageLabel.textContent = message || "";
  el.messageLabel.style.color = status === "error" ? "#ff0000" : "";
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
    noTui: el.noTui.checked,
    secret: el.secret.value.trim(),
    status: el.status.value.trim(),
    maxStreams: el.maxStreams.value.trim(),
    kbps: el.kbps.value.trim(),
    tcpRetries: el.tcpRetries.value.trim(),
    tcpRetryDelay: el.tcpRetryDelay.value.trim(),
    skipUpdateCheck: el.skipUpdateCheck.checked,
    noFancyLogs: el.noFancyLogs.checked,
  };
}

el.loadFromFile.addEventListener("change", refreshVisibility);

el.mode.addEventListener("change", refreshProtocol);

const resizeObserver = new ResizeObserver((entries) => {
  for (let entry of entries) {
    sendIpc("heightChange", document.getElementById("mainWindow").offsetHeight-5);
  }
});
resizeObserver.observe(document.getElementById("mainWindow"));

el.browseBtn.addEventListener("click", () => {
  sendIpc("openFileDialog", null);
});

el.runBtn.addEventListener("click", () => {
  sendIpc("launcherToggle", getPayload());
});

window.addEventListener("launcher:status", (event) => {
  const p = event.detail;
  setStatus(p.status, p.running, p.message);
});

refreshVisibility();
refreshProtocol();

el.advancedOptions.open = false;

setStatus("idle", false);

function sendIpc(type, payload) {
  window.ipc.postMessage(JSON.stringify({ type, payload }));
}
