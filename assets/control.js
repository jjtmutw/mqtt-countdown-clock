const STORAGE_KEY = "mqtt-countdown-control-v1";

const els = {
  status: document.querySelector("#connectionStatus"),
  brokerSummary: document.querySelector("#brokerSummary"),
  broker: document.querySelector("#brokerInput"),
  username: document.querySelector("#usernameInput"),
  password: document.querySelector("#passwordInput"),
  topic: document.querySelector("#topicInput"),
  connectionLog: document.querySelector("#connectionLog"),
  commandLog: document.querySelector("#commandLog"),
  totalMinutes: document.querySelector("#totalMinutesInput"),
  totalSeconds: document.querySelector("#totalSecondsInput"),
  warningOneSeconds: document.querySelector("#warningOneSecondsInput"),
  warningOneBeeps: document.querySelector("#warningOneBeepsInput"),
  warningTwoSeconds: document.querySelector("#warningTwoSecondsInput"),
  warningTwoBeeps: document.querySelector("#warningTwoBeepsInput"),
  message: document.querySelector("#messageInput"),
  qrImage: document.querySelector("#qrImage"),
  displayUrlBox: document.querySelector("#displayUrlBox")
};

const state = {
  client: null,
  connected: false
};

function normalizeBroker(value) {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (/^wss?:\/\//i.test(raw)) return raw;
  if (/\/mqtt$/i.test(raw)) return `ws://${raw}`;
  if (raw.includes(":")) return `ws://${raw}`;
  return `ws://${raw}:9001`;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    Object.entries({
      broker: "broker",
      username: "username",
      password: "password",
      topic: "topic",
      totalMinutes: "totalMinutes",
      totalSeconds: "totalSeconds",
      warningOneSeconds: "warningOneSeconds",
      warningOneBeeps: "warningOneBeeps",
      warningTwoSeconds: "warningTwoSeconds",
      warningTwoBeeps: "warningTwoBeeps",
      message: "message"
    }).forEach(([key, id]) => {
      if (saved[key] !== undefined && els[id]) els[id].value = saved[key];
    });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveSettings() {
  const saved = {
    broker: els.broker.value,
    username: els.username.value,
    password: els.password.value,
    topic: els.topic.value,
    totalMinutes: els.totalMinutes.value,
    totalSeconds: els.totalSeconds.value,
    warningOneSeconds: els.warningOneSeconds.value,
    warningOneBeeps: els.warningOneBeeps.value,
    warningTwoSeconds: els.warningTwoSeconds.value,
    warningTwoBeeps: els.warningTwoBeeps.value,
    message: els.message.value
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

function setConnected(connected, detail = "") {
  state.connected = connected;
  els.status.classList.toggle("online", connected);
  els.status.textContent = connected ? "Online" : "Offline";
  els.brokerSummary.textContent = detail || (connected ? "MQTT 已連線" : "尚未連線");
}

function appendLog(target, text) {
  const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  target.textContent = `[${time}] ${text}`;
}

function getTotalSeconds() {
  const minutes = Math.max(0, Number.parseInt(els.totalMinutes.value, 10) || 0);
  const seconds = Math.min(59, Math.max(0, Number.parseInt(els.totalSeconds.value, 10) || 0));
  return minutes * 60 + seconds;
}

function getConfigPayload() {
  return {
    type: "config",
    totalSeconds: Math.max(1, getTotalSeconds()),
    warnings: [
      {
        seconds: Math.max(1, Number.parseInt(els.warningOneSeconds.value, 10) || 120),
        beeps: Math.max(1, Number.parseInt(els.warningOneBeeps.value, 10) || 2)
      },
      {
        seconds: Math.max(1, Number.parseInt(els.warningTwoSeconds.value, 10) || 60),
        beeps: Math.max(1, Number.parseInt(els.warningTwoBeeps.value, 10) || 3)
      }
    ],
    finishBeeps: 6,
    message: els.message.value.trim() || "請注意倒數時間"
  };
}

function publish(payload) {
  saveSettings();
  const topic = els.topic.value.trim() || "jj/countdown";
  const body = JSON.stringify({
    ...payload,
    sentAt: new Date().toISOString()
  });

  if (!state.client || !state.connected) {
    appendLog(els.commandLog, `尚未連線，未送出：${body}`);
    return;
  }

  const retainedTypes = new Set(["config", "message"]);
  state.client.publish(topic, body, { qos: 0, retain: retainedTypes.has(payload.type) }, (error) => {
    appendLog(els.commandLog, error ? `傳送失敗：${error.message}` : `已傳送到 ${topic}：${body}`);
  });
}

function connect() {
  saveSettings();
  const brokerUrl = normalizeBroker(els.broker.value);
  const topic = els.topic.value.trim() || "jj/countdown";

  if (!brokerUrl) {
    appendLog(els.connectionLog, "請輸入 MQTT 伺服器位址。");
    return;
  }

  if (!window.mqtt) {
    appendLog(els.connectionLog, "mqtt.js 尚未載入，請確認網路可讀取 CDN。");
    return;
  }

  if (state.client) {
    state.client.end(true);
  }

  appendLog(els.connectionLog, `連線中：${brokerUrl}`);
  setConnected(false, "連線中");

  state.client = mqtt.connect(brokerUrl, {
    clientId: `countdown_control_${Math.random().toString(16).slice(2, 10)}`,
    username: els.username.value.trim() || undefined,
    password: els.password.value || undefined,
    reconnectPeriod: 2500,
    connectTimeout: 8000,
    clean: true
  });

  state.client.on("connect", () => {
    setConnected(true, `${brokerUrl} / ${topic}`);
    appendLog(els.connectionLog, `已連線，控制 topic：${topic}`);
    updateQr();
  });

  state.client.on("reconnect", () => {
    setConnected(false, "重新連線中");
    appendLog(els.connectionLog, "MQTT 正在重新連線。");
  });

  state.client.on("error", (error) => {
    setConnected(false, "連線錯誤");
    appendLog(els.connectionLog, `錯誤：${error.message}`);
  });

  state.client.on("close", () => {
    setConnected(false, "連線已關閉");
  });
}

function getDisplayUrl() {
  const url = new URL("./clock/mqtt.html", window.location.href);
  const brokerRaw = els.broker.value.trim();
  url.searchParams.set("mqtt", brokerRaw || "wss://broker.emqx.io:8084/mqtt");
  url.searchParams.set("topic", els.topic.value.trim() || "jj/countdown");
  if (els.username.value.trim()) url.searchParams.set("user", els.username.value.trim());
  if (els.password.value) url.searchParams.set("pass", els.password.value);
  return url.href;
}

function updateQr() {
  saveSettings();
  const displayUrl = getDisplayUrl();
  els.displayUrlBox.textContent = displayUrl;
  els.qrImage.src = `https://quickchart.io/qr?size=300&text=${encodeURIComponent(displayUrl)}`;
}

document.querySelector("#connectButton").addEventListener("click", connect);
document.querySelector("#sendConfigButton").addEventListener("click", () => publish(getConfigPayload()));
document.querySelector("#startButton").addEventListener("click", () => {
  publish({ type: "start", totalSeconds: Math.max(1, getTotalSeconds()), message: els.message.value.trim() });
});
document.querySelector("#stopButton").addEventListener("click", () => publish({ type: "stop" }));
document.querySelector("#resetButton").addEventListener("click", () => publish({ type: "reset" }));
document.querySelector("#sendMessageButton").addEventListener("click", () => {
  publish({ type: "message", message: els.message.value.trim() || "請注意倒數時間" });
});
document.querySelector("#refreshQrButton").addEventListener("click", updateQr);

[
  els.broker,
  els.username,
  els.password,
  els.topic,
  els.totalMinutes,
  els.totalSeconds,
  els.warningOneSeconds,
  els.warningOneBeeps,
  els.warningTwoSeconds,
  els.warningTwoBeeps,
  els.message
].forEach((input) => input.addEventListener("input", updateQr));

loadSettings();
updateQr();
