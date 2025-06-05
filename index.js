const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const { parse } = require('url');
const connectToSpeechmatics = require('./speechmatics');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.post('/twilio', (req, res) => {
    console.log('📞 Call from:', req.body.From);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
               <Response>
                   <Start>
                       <Stream url="wss://${req.headers.host}/stream" track="both" statusCallback="https://${req.headers.host}/stream-status">
                           <Parameter name="mediaStreamProtocol" value="audio"/>
                       </Stream>
                   </Start>
                   <Pause length="1"/>
                   <Redirect>${process.env.ELEVENLABS_WEBHOOK}</Redirect>
               </Response>`;
    console.log('📤 TwiML:', twiml);
    res.type('text/xml').send(twiml);
});

app.post('/stream-status', (req, res) => {
    console.log('📡 Stream status:', req.body);
    res.status(200).send();
});

server.on('upgrade', (req, socket, head) => {
    const { url } = req;
    const protocols = req.headers['sec-websocket-protocol'];
    const protocolList = protocols?.split(',').map(p => p.trim()) || [];
  
    console.log('🌐 WS Upgrade requested for path:', url, 'with protocols:', protocolList);
  
    if (url === '/stream' && protocolList.includes('audio')) {
      console.log('✅ Accepting audio protocol on /stream');
  
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
      console.warn('❌ Protocol rejected or wrong path:', url, protocolList);
      socket.destroy();
    }
  });
  


// Pre-initialize Speechmatics
const smSocket = connectToSpeechmatics(
    (data) => {
        const transcript = data.results.map(r => r.alternatives[0].content).join(' ');
        console.log('📝 Transcript:', transcript);
    },
    (err) => console.error('❌ Speechmatics error:', err)
);
let smReady = false;
smSocket.start().then(() => {
    console.log('✅ Speechmatics client ready');
    smReady = true;
}).catch((err) => {
    console.error('❌ Speechmatics start failed:', err);
});

wss.on('connection', (twilioSocket, req) => {
    const protocol = req.headers['sec-websocket-protocol'] || 'none';
    console.log('🔗 Twilio stream connected, Protocol:', protocol);

    let audioBuffer = Buffer.alloc(0);
    let lastSent = 0;
    twilioSocket.on('message', (msg) => {
        try {
            const frame = JSON.parse(msg);
            if (frame.event === 'start') {
                console.log('🚀 Stream started:', frame.streamSid);
            } else if (frame.event === 'media') {
                if (smReady) {
                    const audio = Buffer.from(frame.media.payload, 'base64');
                    audioBuffer = Buffer.concat([audioBuffer, audio]);
                    const now = Date.now();
                    if (audioBuffer.length >= 6000 && now - lastSent >= 750) { // ~750ms chunk, 750ms interval
                        console.log(`📤 Sending audio chunk at ${new Date().toISOString()}: ${audioBuffer.length} bytes`);
                        smSocket.send(audioBuffer);
                        audioBuffer = Buffer.alloc(0);
                        lastSent = now;
                    }
                } else {
                    console.warn('⚠️ Speechmatics not ready, skipping audio');
                }
            } else if (frame.event === 'stop') {
                console.log('🛑 Stream stopped:', frame.streamSid);
                if (audioBuffer.length > 0) {
                    console.log(`📤 Sending final chunk: ${audioBuffer.length} bytes`);
                    smSocket.send(audioBuffer);
                }
            }
        } catch (e) {
            console.error('⚠️ Invalid frame:', e);
        }
    });

    twilioSocket.on('close', () => {
        console.log('❌ Twilio WebSocket closed');
        smSocket.close().catch((err) => console.error('❌ Speechmatics close failed:', err));
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 App running on port ${PORT}, binding to 0.0.0.0`);
});