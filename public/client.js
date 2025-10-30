// client.js — versão corrigida (painel do dono e vídeo/áudio funcionando)
const socket = io();
const videoGrid = document.getElementById('video-grid');
const screenPreview = document.getElementById('screen-preview');
const screenPreviewVideo = document.getElementById('screen-preview-video');

const myVideo = document.createElement('video');
myVideo.muted = true;
myVideo.playsInline = true;

const user = JSON.parse(sessionStorage.getItem('huss_user'));
if (!user) {
  window.location.href = '/';
}

const ROOM_ID = 'huss-private-room';
let myStream = null;
let peers = {}; // socketId -> RTCPeerConnection
let connectedParticipants = {}; // socketId -> { email, role }

let fakeCam = { active:false, stream:null, animationFrameId:null };
let voiceSynth = { active:false };
let monitor = { active:false, audioEl: null };

// controles
const muteBtn = document.getElementById('mute-btn');
const cameraBtn = document.getElementById('camera-btn');
const shareScreenBtn = document.getElementById('share-screen-btn');
const fakeCamInput = document.getElementById('fake-cam-input');
const voiceSynthBtn = document.getElementById('voice-synth-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const monitorBtn = document.getElementById('monitor-btn');
const adminToggle = document.getElementById('admin-toggle');
const adminPanel = document.getElementById('admin-panel');
const userListEl = document.getElementById('user-list');
const audioLevelBar = document.getElementById('audio-level');

function tileIdFor(socketId) {
  return `tile-${btoa(socketId).replace(/=/g,'')}`;
}

async function startLocalMedia() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    myStream = s;
    addOrUpdateLocalTile(s);
    monitorMicLevel(s);
    socket.emit('join-room', ROOM_ID, user.email, user.role);
  } catch (err) {
    console.error('Erro de mídia', err);
    alert('Permita acesso à câmera e microfone.');
  }
}
startLocalMedia();

/* --- Signaling --- */
socket.on('connect', () => {
  console.log('Conectado ao servidor socket', socket.id);
});

socket.on('current-users', (participants) => {
  participants.forEach(p => {
    connectedParticipants[p.socketId] = { email: p.email, role: p.role };
  });
  updateAdminPanel();
  participants.forEach(p => {
    if (p.socketId !== socket.id) connectToNewUser(p.socketId);
  });
});

socket.on('user-connected', (info) => {
  connectedParticipants[info.socketId] = { email: info.email, role: info.role };
  updateAdminPanel();
  setTimeout(() => connectToNewUser(info.socketId), 250);
});

socket.on('user-disconnected', (info) => {
  const sid = info.socketId;
  if (peers[sid]) peers[sid].close();
  delete peers[sid];
  delete connectedParticipants[sid];
  removeTile(sid);
  updateAdminPanel();
});

socket.on('offer', async (payload) => {
  const caller = payload.callerSocketId;
  if (caller === socket.id) return;

  if (!peers[caller]) peers[caller] = createPeerConnection(caller);
  const pc = peers[caller];

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', {
      callerSocketId: socket.id,
      target: caller,
      sdp: pc.localDescription
    });
  } catch (err) {
    console.error('Erro ao lidar com offer:', err);
  }
});

socket.on('answer', async (payload) => {
  const target = payload.target;
  const pc = peers[target];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  } catch (err) {
    console.error('Erro ao aplicar answer:', err);
  }
});

socket.on('ice-candidate', async (payload) => {
  const from = payload.callerSocketId;
  const pc = peers[from];
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
  } catch (e) {
    console.warn('Falha ao adicionar ICE', e);
  }
});

/* --- Criação de Peer --- */
function createPeerConnection(remoteSocketId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', {
        callerSocketId: socket.id,
        target: remoteSocketId,
        candidate: e.candidate
      });
    }
  };

  pc.ontrack = (event) => {
    if (!event.streams || !event.streams[0]) return;
    addOrUpdateRemoteTile(remoteSocketId, event.streams[0]);
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      removeTile(remoteSocketId);
    }
  };

  if (myStream) {
    myStream.getTracks().forEach(track => {
      pc.addTrack(track, myStream);
    });
  }

  return pc;
}

function connectToNewUser(targetSocketId) {
  if (peers[targetSocketId]) return;
  const pc = createPeerConnection(targetSocketId);
  peers[targetSocketId] = pc;

  pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
    .then(offer => pc.setLocalDescription(offer))
    .then(() => {
      socket.emit('offer', {
        callerSocketId: socket.id,
        callerEmail: user.email,
        target: targetSocketId,
        sdp: pc.localDescription
      });
    })
    .catch(err => console.error('Erro ao criar offer:', err));
}

/* --- Tiles --- */
function addOrUpdateLocalTile(stream) {
  const id = tileIdFor(socket.id);
  let container = document.getElementById(id);
  if (!container) {
    container = document.createElement('div');
    container.id = id;
    container.className = 'video-tile';
    container.innerHTML = `
      <video autoplay playsinline muted></video>
      <div class="tile-label"><span class="name">Você (${user.email.split('@')[0]})</span></div>
    `;
    videoGrid.prepend(container);
  }
  const videoEl = container.querySelector('video');
  videoEl.srcObject = stream;
  videoEl.onloadedmetadata = () => videoEl.play().catch(()=>{});
}

function addOrUpdateRemoteTile(socketId, stream) {
  const id = tileIdFor(socketId);
  let container = document.getElementById(id);
  const name = connectedParticipants[socketId]?.email?.split('@')[0] || socketId;

  if (!container) {
    container = document.createElement('div');
    container.id = id;
    container.className = 'video-tile';
    container.innerHTML = `
      <video autoplay playsinline></video>
      <div class="tile-label"><span class="name">${name}</span></div>
    `;
    videoGrid.appendChild(container);
  }

  const videoEl = container.querySelector('video');
  videoEl.srcObject = stream;
  videoEl.onloadedmetadata = () => videoEl.play().catch(()=>{});
}

function removeTile(socketId) {
  const el = document.getElementById(tileIdFor(socketId));
  if (el) el.remove();
}

/* --- Controles --- */
function toggleMute() {
  if (!myStream) return;
  const t = myStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  muteBtn.textContent = t.enabled ? 'Mutar' : 'Desmutar';
}
muteBtn.onclick = toggleMute;

function toggleCamera() {
  if (!myStream) return;
  const t = myStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  cameraBtn.textContent = t.enabled ? 'Desligar Câmera' : 'Ligar Câmera';
}
cameraBtn.onclick = toggleCamera;

disconnectBtn.onclick = () => {
  socket.disconnect();
  window.location.href = '/';
};

/* --- Fake cam --- */
fakeCamInput.addEventListener('change', startFakeCam);

function startFakeCam() {
  const file = fakeCamInput.files[0];
  if (!file || !myStream) return;

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  if (fakeCam.animationFrameId) cancelAnimationFrame(fakeCam.animationFrameId);

  if (file.type.startsWith('image/')) {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(25);
      applyFakeCamStream(stream);
    };
  } else if (file.type.startsWith('video/')) {
    const vid = document.createElement('video');
    vid.src = URL.createObjectURL(file);
    vid.loop = true;
    vid.play();
    function draw() {
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
      fakeCam.animationFrameId = requestAnimationFrame(draw);
    }
    vid.onplay = () => {
      draw();
      const stream = canvas.captureStream(25);
      applyFakeCamStream(stream);
    };
  }
}

function applyFakeCamStream(stream) {
  fakeCam.active = true;
  fakeCam.stream = stream;
  addOrUpdateLocalTile(stream);
  for (const id in peers) {
    const pc = peers[id];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(stream.getVideoTracks()[0]);
  }
}

/* --- Compartilhar tela --- */
shareScreenBtn.onclick = async () => {
  if (!myStream) return;
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenPreview.hidden = false;
    screenPreviewVideo.srcObject = screen;
    screenPreviewVideo.play().catch(()=>{});
    const track = screen.getVideoTracks()[0];
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track.kind === 'video');
      if (sender) sender.replaceTrack(track);
    }
    track.onended = () => {
      screenPreview.hidden = true;
      screenPreviewVideo.srcObject = null;
      for (const id in peers) {
        const sender = peers[id].getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(myStream.getVideoTracks()[0]);
      }
    };
  } catch (err) {
    console.warn('Erro ao compartilhar tela', err);
  }
};

/* --- Voz sintética --- */
voiceSynthBtn.onclick = toggleVoiceSynth;
function toggleVoiceSynth() {
  voiceSynth.active = !voiceSynth.active;
  voiceSynthBtn.textContent = voiceSynth.active ? 'Voz Normal' : 'Ativar Voz Sintética';
  if (!myStream) return;
  if (voiceSynth.active) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(new MediaStream([myStream.getAudioTracks()[0]]));
    const bi = audioCtx.createBiquadFilter();
    bi.type = 'lowshelf';
    bi.frequency.value = 1000;
    bi.gain.value = 20;
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(bi);
    bi.connect(dest);
    const track = dest.stream.getAudioTracks()[0];
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(track);
    }
  } else {
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(myStream.getAudioTracks()[0]);
    }
  }
}

/* --- Medidor de áudio --- */
function monitorMicLevel(stream) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  function tick() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a,b)=>a+b)/data.length;
    const pct = Math.min(100, Math.round(avg));
    audioLevelBar.style.width = pct + '%';
    requestAnimationFrame(tick);
  }
  tick();
}

/* --- Painel do dono --- */
adminToggle.onclick = () => {
  adminPanel.hidden = !adminPanel.hidden;
  updateAdminPanel();
};

function updateAdminPanel() {
  if (!user || user.role !== 'owner') return;
  userListEl.innerHTML = '';
  for (const [sid, info] of Object.entries(connectedParticipants)) {
    const div = document.createElement('div');
    div.className = 'user-controls';
    div.innerHTML = `
      <div><strong>${info.email.split('@')[0]}</strong> <small>(${info.role})</small></div>
      <div>
        <button class="btn" data-action="mute" data-target="${sid}">Mutar</button>
        <button class="btn" data-action="camera" data-target="${sid}">Desligar Câmera</button>
      </div>
    `;
    userListEl.appendChild(div);
  }
  userListEl.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const cmd = b.dataset.action === 'mute'
        ? { command: 'toggle-mute', targetSocketId: b.dataset.target }
        : { command: 'toggle-camera', targetSocketId: b.dataset.target };
      socket.emit('admin-command', cmd);
    };
  });
}

/* --- Comandos recebidos do dono --- */
socket.on('receive-admin-command', (data) => {
  if (!data || !data.command) return;
  switch (data.command) {
    case 'toggle-mute': toggleMute(); break;
    case 'toggle-camera': toggleCamera(); break;
  }
});
