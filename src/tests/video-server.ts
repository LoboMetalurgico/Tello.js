import { TelloClient } from '../main/TelloClient';
import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = 8080;

const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Tello Stream</title>
    <style>
      body { margin: 0; background: #000; display:flex; align-items:center; justify-content:center; height:100vh; }
      img { max-width:100vw; max-height:100vh; object-fit:contain; }
    </style>
  </head>
  <body>
    <img id="frame" />
    <script>
      const img = document.getElementById("frame");
      const ws = new WebSocket("ws://" + location.host);
      ws.onopen = () => console.log("WebSocket Connected");
      ws.onerror = (e) => console.error("WebSocket Err:", e);
      ws.onclose = () => console.warn("Connection closed!");
      ws.onmessage = (e) => { img.src = "data:image/jpeg;base64," + e.data; };
    </script>
  </body>
</html>
`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});

const wss = new WebSocketServer({ server });

server.listen(PORT, '0.0.0.0', () =>
  console.log(`Server running at http://localhost:${PORT}`)
);

(async () => {
  const tello = new TelloClient();

  try {
    console.log('Trying to connect with Tello...');
    await tello.connect();

    console.log('Connected!');

    await tello.startVideo();
    tello.startFfmpegDecoder();

    console.log('Stream Started. Check http://localhost:8080');

    tello.on('frame', (frame: Buffer) => {
      const base64 = frame.toString('base64');

      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(base64);
        }
      }
    });

    process.on('SIGINT', async () => {
      console.log('\nFinishing...');
      await tello.stopVideo();
      tello.disconnect();
      process.exit(0);
    });
  } catch (err) {
    console.error('An error occurred:', err);
  }
})();
