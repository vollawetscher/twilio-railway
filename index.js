// Entry point for Railway deployment
// Merges Express server and Relay (HTTPS WebSocket) in one app

const fs = require('fs');
const https = require('https');
const express = require('express');
const WebSocket = require('ws');
const { twiml: { VoiceResponse } } = require('twilio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint for Railway
app.get('/', (req, res) => {
  res.send('✅ Twilio Relay is running.');
});

// SSL keys (Railway uses internal certs in production, use self-signed locally if needed)
const server = require('https').createServer(app);

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const protocols = req.headers['sec-websocket-protocol'];
  const protocolList = protocols?.split(',').map(p => p.trim()) || [];

  if (protocolList.includes('audio')) {
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

  twilioSocket.on('message', (data) => {
    console.log('📥 WS message:', data.toString());
  });

  twilioSocket.on('close', () => {
    console.log('❌ Twilio WebSocket closed');
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
