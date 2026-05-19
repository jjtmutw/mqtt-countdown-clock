# MQTT Countdown Clock

純 HTML 的 MQTT 倒數計時專案，分成手機控制端與平板顯示端。

## Files

- `index.html`：手機控制端，設定 MQTT、倒數時間、提醒秒數、蜂鳴次數、信息內容，並產生平板顯示端 QRCode。
- `clock/mqtt.html`：平板顯示端，自動連線 MQTT 並以翻頁時鐘顯示倒數。
- `assets/styles.css`：共用深色控制器與翻頁時鐘樣式。
- `assets/control.js`：手機端 MQTT publish 與 QRCode。
- `assets/clock.js`：平板端 MQTT subscribe、倒數計時與蜂鳴提醒。

## Display URL

平板顯示端可用 GET 參數設定 MQTT 與 topic：

```text
https://xx.xx.xx.xx/clock/mqtt.html?mqtt=xx.xx.xx.xx&topic=jj/countdown
```

瀏覽器 MQTT 必須使用 WebSocket。如果 `mqtt` 只填 IP，顯示端會自動轉為：

```text
ws://xx.xx.xx.xx:9001
```

也可以直接填完整 WebSocket URL：

```text
clock/mqtt.html?mqtt=wss://broker.emqx.io:8084/mqtt&topic=jj/countdown
```

## MQTT Commands

手機控制端會送出 JSON 到指定 topic：

```json
{
  "type": "config",
  "totalSeconds": 600,
  "warnings": [
    { "seconds": 120, "beeps": 2 },
    { "seconds": 60, "beeps": 3 }
  ],
  "finishBeeps": 6,
  "message": "請注意倒數時間"
}
```

其他命令：

```json
{ "type": "start", "totalSeconds": 600 }
{ "type": "stop" }
{ "type": "reset" }
{ "type": "message", "message": "傳送的信息" }
```

蜂鳴聲受瀏覽器自動播放限制影響，平板第一次開啟後建議點一下畫面以啟用聲音。
