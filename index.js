// Entry point for Railway deployment
// Merges Express server and Relay (WebSocket) in one app

const express = require('express');
const WebSocket = require('ws');
const { twiml: { VoiceResponse } } = require('twilio');
const connectToSpeechmatics = require('./speechmatics');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

console.log('🧪 PORT set to:', PORT);

// Health check endpoint for Railway
app.get('/', (req, res) => {
  res.send('✅ Twilio Relay is running.');
});

// Create standard HTTP server (Railway handles TLS externally)
const server = require('http').createServer(app);

const wss = new WebSocket.Server({
  noServer: true,
  handleProtocols: (protocols) => {
    return protocols.includes('audio') ? 'audio' : false;
  }
});


server.on('upgrade', (req, socket, head) => {
  const protocols = req.headers['sec-websocket-protocol'];
  const protocolList = protocols?.split(',').map(p => p.trim()) || [];

  if (protocolList.includes('audio')) {
    // Accept connection and confirm audio protocol
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Protocol: audio\r\n' +
      '\r\n'
    );

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.protocol = 'audio';
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (twilioSocket) => {
  console.log('🔗 Twilio stream connected');

  const smSocket = connectToSpeechmatics(
    (data) => {
      const transcript = data.results.map(r => r.alternatives[0].content).join(' ');
      console.log('📝 Transcript:', transcript);
    },
    (err) => console.error('Speechmatics error', err)
  );

  twilioSocket.on('message', (msg) => {
    try {
      const frame = JSON.parse(msg);
      if (frame.event === 'media') {
        const audio = Buffer.from(frame.media.payload, 'base64');
        smSocket.send(audio);
      }
    } catch (e) {
      console.warn('Invalid WS message', e);
    }
  });

  twilioSocket.on('close', () => {
    console.log('❌ Twilio WebSocket closed');
    smSocket.close();
  });
});

app.use(express.urlencoded({ extended: false }));

app.post('/voice', (req, res) => {
  console.log('📞 Incoming call from:', req.body?.From || 'Unknown');

  const response = new VoiceResponse();

  response.start().stream({
    url: process.env.WS_STREAM_URL,
    track: 'inbound_track',
    statusCallback: process.env.STATUS_CALLBACK_URL
  });

  response.pause({ length: 1 });
  response.redirect(process.env.ELEVENLABS_WEBHOOK);

  console.log(response.toString());
  res.type('text/xml');
  res.send(response.toString());
});

app.post('/stream-status', (req, res) => {
  console.log('📡 Stream status callback:', req.body);
  res.sendStatus(200);
});

server.listen(PORT, () => {
  console.log(`🚀 App running on port ${PORT}`);
});

console.log('ENV:');
console.log('  WS_STREAM_URL:', process.env.WS_STREAM_URL);
console.log('  STATUS_CALLBACK_URL:', process.env.STATUS_CALLBACK_URL);
console.log('  ELEVENLABS_WEBHOOK:', process.env.ELEVENLABS_WEBHOOK);
