const PARAM_STORAGE_KEY = "mqtt-countdown-clock-params-v1";
const params = getLaunchParams();

const els = {
  status: document.querySelector("#clockStatus"),
  installButton: document.querySelector("#installButton"),
  title: document.querySelector("#clockTitle"),
  message: document.querySelector("#clockMessage"),
  cards: [...document.querySelectorAll("[data-digit]")]
};

const state = {
  client: null,
  totalSeconds: 600,
  remainingSeconds: 600,
  running: false,
  lastTickAt: 0,
  digits: "",
  warnings: [
    { seconds: 120, beeps: 2 },
    { seconds: 60, beeps: 3 }
  ],
  triggeredWarnings: new Set(),
  finishBeeps: 6,
  audioContext: null,
  installPrompt: null
};

function getLaunchParams() {
  const current = new URLSearchParams(window.location.search);
  const mqttValue = current.get("mqtt");
  const topicValue = current.get("topic");

  if (mqttValue || topicValue) {
    localStorage.setItem(PARAM_STORAGE_KEY, current.toString());
    return current;
  }

  return new URLSearchParams(localStorage.getItem(PARAM_STORAGE_KEY) || "");
}

function normalizeBroker(value) {
  const raw = (value || "").trim();
  if (!raw) return "wss://broker.emqx.io:8084/mqtt";
  if (/^wss?:\/\//i.test(raw)) return raw;
  if (/\/mqtt$/i.test(raw)) return `ws://${raw}`;
  if (raw.includes(":")) return `ws://${raw}`;
  return `ws://${raw}:9001`;
}

function clampSeconds(value, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(359999, number));
}

function formatTime(totalSeconds) {
  const safe = clampSeconds(totalSeconds, 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function updateTitle() {
  els.title.textContent = `倒數時間總計 ${formatTime(state.totalSeconds)}`;
}

function updateDigits() {
  const digits = formatTime(state.remainingSeconds).replaceAll(":", "");
  els.cards.forEach((card, index) => {
    const nextDigit = digits[index] || "0";
    const digit = card.querySelector(".flip-digit");
    if (digit.textContent !== nextDigit) {
      digit.textContent = nextDigit;
      card.classList.remove("changing");
      void card.offsetWidth;
      card.classList.add("changing");
    }
  });
  state.digits = digits;
}

function setStatus(online, text) {
  els.status.classList.toggle("online", online);
  els.status.textContent = text;
}

async function requestDisplayMode() {
  ensureAudio();

  if (state.installPrompt && !isStandaloneDisplay()) {
    await state.installPrompt.prompt();
    state.installPrompt = null;
    els.installButton.textContent = "全螢幕";
    return;
  }

  if (document.fullscreenElement) return;

  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await lockLandscapeOrientation();
  } catch {
    // Fullscreen needs a trusted tap and may be blocked by some browsers.
  }
}

async function lockLandscapeOrientation() {
  try {
    if (screen.orientation?.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch {
    // Orientation lock is optional across browsers.
  }
}

function setupPwaMode() {
  if (isStandaloneDisplay()) {
    document.documentElement.classList.add("is-standalone");
    els.installButton.textContent = "全螢幕";
    return;
  }

  if (isMobileViewport()) {
    els.installButton.textContent = "加入主畫面";
  }
}

function isStandaloneDisplay() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 820px)").matches ||
    /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("../service-worker.js").catch(() => {});
}

function ensureAudio() {
  if (!state.audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    state.audioContext = new AudioContext();
  }
  if (state.audioContext.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }
  return state.audioContext;
}

function playTone(startTime, duration = 0.13) {
  const context = ensureAudio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(930, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.42, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function beepSequence(count) {
  const context = ensureAudio();
  if (!context) return;
  const now = context.currentTime + 0.04;
  for (let index = 0; index < count; index += 1) {
    playTone(now + index * 0.24);
  }
}

function applyConfig(payload) {
  if (payload.totalSeconds !== undefined) {
    state.totalSeconds = Math.max(1, clampSeconds(payload.totalSeconds, state.totalSeconds));
    if (!state.running) state.remainingSeconds = state.totalSeconds;
  }
  if (Array.isArray(payload.warnings)) {
    state.warnings = payload.warnings
      .map((warning) => ({
        seconds: Math.max(1, clampSeconds(warning.seconds, 60)),
        beeps: Math.max(1, Math.min(10, Number.parseInt(warning.beeps, 10) || 1))
      }))
      .slice(0, 2);
  }
  if (payload.finishBeeps !== undefined) {
    state.finishBeeps = Math.max(1, Math.min(12, Number.parseInt(payload.finishBeeps, 10) || 6));
  }
  if (payload.message) {
    els.message.textContent = payload.message;
  }
  state.triggeredWarnings.clear();
  updateTitle();
  updateDigits();
}

function startCountdown(payload = {}) {
  if (payload.totalSeconds !== undefined) {
    state.totalSeconds = Math.max(1, clampSeconds(payload.totalSeconds, state.totalSeconds));
    state.remainingSeconds = state.totalSeconds;
  } else if (state.remainingSeconds <= 0) {
    state.remainingSeconds = state.totalSeconds;
  }
  if (payload.message) {
    els.message.textContent = payload.message;
  }
  state.running = true;
  state.lastTickAt = performance.now();
  state.triggeredWarnings.clear();
  updateTitle();
  updateDigits();
}

function stopCountdown() {
  state.running = false;
  els.message.textContent = "倒數已停止";
}

function resumeCountdown() {
  if (state.remainingSeconds <= 0) {
    els.message.textContent = "時間已到";
    updateDigits();
    return;
  }
  state.running = true;
  state.lastTickAt = performance.now();
  els.message.textContent = "倒數接續中";
  updateDigits();
}

function resetCountdown() {
  state.running = false;
  state.remainingSeconds = state.totalSeconds;
  state.triggeredWarnings.clear();
  els.message.textContent = "等待倒數命令";
  updateDigits();
}

function handleCommand(payload) {
  const command = typeof payload === "string" ? payload.trim().toLowerCase() : payload.type;
  if (command === "config") applyConfig(payload);
  if (command === "start") {
    if (payload.resume) {
      resumeCountdown();
    } else {
      startCountdown(payload);
    }
  }
  if (command === "stop") stopCountdown();
  if (command === "resume") resumeCountdown();
  if (command === "interrupt_stop") {
    if (payload.message) els.message.textContent = payload.message;
    beepSequence(Math.max(1, Math.min(20, Number.parseInt(payload.beeps, 10) || 10)));
  }
  if (command === "reset") resetCountdown();
  if (command === "message" && payload.message) els.message.textContent = payload.message;
}

function parseMessage(message) {
  const text = new TextDecoder().decode(message);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function checkWarnings() {
  state.warnings.forEach((warning, index) => {
    if (state.remainingSeconds === warning.seconds && !state.triggeredWarnings.has(index)) {
      state.triggeredWarnings.add(index);
      beepSequence(warning.beeps);
    }
  });
}

function tick() {
  if (!state.running) return;
  const now = performance.now();
  const elapsed = Math.floor((now - state.lastTickAt) / 1000);
  if (elapsed <= 0) return;
  state.lastTickAt += elapsed * 1000;
  state.remainingSeconds = Math.max(0, state.remainingSeconds - elapsed);
  checkWarnings();
  updateDigits();
  if (state.remainingSeconds <= 0) {
    state.running = false;
    els.message.textContent = "時間到";
    beepSequence(state.finishBeeps);
  }
}

function connect() {
  const brokerUrl = normalizeBroker(params.get("mqtt"));
  const topic = params.get("topic") || "jj/countdown";

  if (!window.mqtt) {
    setStatus(false, "MQTT CDN Failed");
    els.message.textContent = "mqtt.js 尚未載入";
    return;
  }

  state.client = mqtt.connect(brokerUrl, {
    clientId: `countdown_clock_${Math.random().toString(16).slice(2, 10)}`,
    username: params.get("user") || undefined,
    password: params.get("pass") || undefined,
    reconnectPeriod: 2500,
    connectTimeout: 8000,
    clean: true
  });

  state.client.on("connect", () => {
    setStatus(true, "Online");
    state.client.subscribe(topic, { qos: 0 });
    els.message.textContent = `已連線 ${topic}`;
  });

  state.client.on("message", (_topic, message) => {
    handleCommand(parseMessage(message));
  });

  state.client.on("reconnect", () => setStatus(false, "Reconnecting"));
  state.client.on("close", () => setStatus(false, "Offline"));
  state.client.on("error", () => setStatus(false, "Error"));
}

document.addEventListener("pointerdown", ensureAudio, { once: true });
document.addEventListener("keydown", ensureAudio, { once: true });
els.installButton.addEventListener("click", requestDisplayMode);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  if (!isStandaloneDisplay()) {
    els.installButton.textContent = "加入主畫面";
  }
});

window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  els.installButton.textContent = "全螢幕";
});

window.addEventListener("load", () => {
  setupPwaMode();
  registerServiceWorker();
});

setupPwaMode();
updateTitle();
updateDigits();
connect();
setInterval(tick, 250);
