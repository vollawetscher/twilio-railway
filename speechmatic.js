const WebSocket = require('ws');

function connectToSpeechmatics(onTranscript, onError) {
  const SM_WS_URL = 'wss://eu2.rt.speechmatics.com/v2';
  const apiKey = process.env.SPEECHMATICS_API_KEY;

  const socket = new WebSocket(SM_WS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  socket.on('open', () => {
    console.log('✅ Connected to Speechmatics');

    socket.send(JSON.stringify({
      type: 'start',
      transcription_config: {
        language: 'de',
        operating_point: 'enhanced',
        enable_partials: true
      }
    }));
  });

  socket.on('message', (msg) => {
    const data = JSON.parse(msg);
    if (data.type === 'transcript') {
      onTranscript(data);
    }
  });

  socket.on('error', (err) => {
    console.error('❌ Speechmatics error:', err);
    onError?.(err);
  });

  return socket;
}

module.exports = connectToSpeechmatics;
