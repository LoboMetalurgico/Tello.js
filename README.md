# **tello.js**

### A modern, fully-typed and reliable DJI Tello SDK client for Node.js

`tello.js` is a TypeScript library that provides a clean, event-driven and safe interface for controlling DJI Tello drones via UDP.

It includes:

* Full command support (takeoff, land, movement, rotations…)
* Automatic command queue with retry, timeouts and priority handling
* Real-time telemetry (`state`) with typed parsing
* Real-time video streaming (FFmpeg MJPEG decoder)
* Frame-by-frame capture for AI / computer vision
* Safe emergency mode
* TypeScript-first design

---

## ✨ Features

* ✔ **TypeScript typings** for all commands and telemetry
* ✔ **Reliable command queue** with retry on timeout
* ✔ **Automatic parsing** of drone telemetry (battery, height, speed, TOF, etc.)
* ✔ **Video stream decoding** using FFmpeg (MJPEG pipe)
* ✔ **Frame capture** for AI models (OpenCV, TensorFlow, Gemini Vision…)
* ✔ **Event-based architecture** (`state`, `frame`, `response`, `emergency`)
* ✔ **No native dependencies** (FFmpeg included via `ffmpeg-static`)

---

## 📦 Installation

```sh
npm install tello.js
```

or

```sh
yarn add tello.js
```

---

## ⚡ Quick Start

```ts
import { TelloClient } from "tello.js";

async function main() {
  const tello = new TelloClient();

  await tello.connect();
  console.log("Connected!");

  await tello.takeoff();
  await tello.up(30);
  await tello.cw(180);
  await tello.land();

  tello.disconnect();
}

main();
```

---

## 🎥 Video Streaming (MJPEG via FFmpeg)

```ts
const tello = new TelloClient();

await tello.connect();
await tello.startVideo();

tello.startFfmpegDecoder();

tello.on("frame", (jpeg) => {
  // Send to AI model, save, stream on WebSocket, etc.
});
```

### Example: save one frame to disk

```ts
import fs from "fs";

const frame = await tello.captureFrame();
fs.writeFileSync("frame.jpg", frame);
```

---

## 🚁 Movement API

All movement commands automatically validate range and queue safely.

```ts
await tello.takeoff();
await tello.up(50);
await tello.forward(100);
await tello.right(50);
await tello.cw(90);
await tello.land();
```

### Supported commands:

| Command      | Range     |
| ------------ | --------- |
| `up(x)`      | 20–500 cm |
| `down(x)`    | 20–500 cm |
| `left(x)`    | 20–500 cm |
| `right(x)`   | 20–500 cm |
| `forward(x)` | 20–500 cm |
| `back(x)`    | 20–500 cm |
| `cw(deg)`    | 1–3600°   |
| `ccw(deg)`   | 1–3600°   |

---

## 🔄 Command Queue + Retry System

The library guarantees:

* Only **one command is sent at a time**
* Commands are **retried automatically** if Tello doesn't respond
* Timeouts are configurable
* Emergency mode interrupts the queue safely

Example:

```ts
await tello.takeoff(); // retried automatically on timeout
```

---

## 📡 Telemetry (state)

The Tello sends telemetry at **10 Hz** (~every 100 ms).

Example structure:

```ts
{
  pitch: 0,
  roll: 0,
  yaw: 0,
  bat: 86,
  tof: 78,
  height: 12,
  templ: 64,
  temph: 67,
  agx: 20,
  agy: 12,
  agz: -38
}
```

---

## 🆘 Emergency Mode

Emergency interrupts the queue and sends the drone into immediate motor-stop mode.

```ts
await tello.emergency();
```

⚠ **Use only in real danger**, as this cuts the motors instantly.

---

## ⚠ Limitations (From the DJI Tello SDK)

* Only **one client** may control the drone at a time
* Commands must respect the minimum ranges
* Video is always **960×720 H.264**, converted to MJPEG
* Wi-Fi can introduce latency or packet loss

---

## 🛠 Requirements

* Node.js **18+**
* FFmpeg (included via `ffmpeg-static`)
* DJI Tello (or Tello EDU)

---

## 📄 License

Licensed under **Apache 2.0**.

---

## 🤝 Contributing

Pull requests are welcome!
If you find a bug, please open an issue with:

* Logs or telemetry
* Steps to reproduce
* Drone model + firmware version
* Node version
