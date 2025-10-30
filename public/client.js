// client.js - versão estável (tudo funcionando)
const socket = io();
const videoGrid = document.getElementById('video-grid');
const screenPreview = document.getElementById('screen-preview');
const screenPreviewVideo = document.getElementById('screen-preview-video');

const user = JSON.parse(sessionStorage.getItem('huss_user'));
if (!user) location.href = '/';

const ROOM_ID = 'huss-private-room';
let myStream;
let peers = {};
let connectedUsers = {};

const muteBtn = document.getElementById('mute-btn');
const camBtn = document.getElementById('camera-btn');
const shareBtn = document.getElementById('share-screen-btn');
const fakeCamInput = document.getElementById('fake-cam-input');
const synthBtn = document.getElementById('voice-synth-btn');
const discBtn = document.getElementById('disconnect-btn');
const adminToggle = document.getElementById('admin-toggle');
const adminPanel = document.getElementById('admin-panel');
const userList = document.getElementById('user-list');
const audioBar = document.getElementById('audio-level');

async function startMedia() {
  try {
    myStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    addVideoTile(socket.id, myStream, true);
    monitorAudio(myStream);
    socket.emit('join-room', ROOM_ID, user.email, user.role);
  } catch (e) {
    alert('Permita acesso à câmera e microfone.');
  }
}
startMedia();

socket.on('connect', () => console.log('socket conectado', socket.id));

socket.on('current-users', users => {
  users.forEach(u => {
    connectedUsers[u.socketId] = u;
    if (u.socketId !== socket.id) createOffer(u.socketId);
  });
  updateAdminPanel();
});

socket.on('user-connected', u => {
  connectedUsers[u.socketId] = u;
  updateAdminPanel();
  createOffer(u.socketId);
});

socket.on('user-disconnected', u => {
  delete connectedUsers[u.socketId];
  if (peers[u.socketId]) peers[u.socketId].close();
  delete peers[u.socketId];
  removeTile(u.socketId);
  updateAdminPanel();
});

socket.on('offer', async d => {
  if (d.callerSocketId === socket.id) return;
  const pc = getPeer(d.callerSocketId);
  await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  socket.emit('answer', { callerSocketId: socket.id, target: d.callerSocketId, sdp: pc.localDescription });
});

socket.on('answer', async d => {
  const pc = peers[d.target];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(d.sdp));
});

socket.on('ice-candidate', async d => {
  const pc = peers[d.callerSocketId];
  if (pc) await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
});

socket.on('receive-admin-command', d => {
  if (!d || !d.command) return;
  if (d.command === 'toggle-mute') toggleMute();
  if (d.command === 'toggle-camera') toggleCam();
});

function getPeer(id) {
  if (peers[id]) return peers[id];
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  myStream.getTracks().forEach(t => pc.addTrack(t, myStream));
  pc.onicecandidate = e => e.candidate && socket.emit('ice-candidate', { callerSocketId: socket.id, target: id, candidate: e.candidate });
  pc.ontrack = e => addVideoTile(id, e.streams[0]);
  pc.onconnectionstatechange = () => {
    if (['closed', 'failed', 'disconnected'].includes(pc.connectionState)) removeTile(id);
  };
  peers[id] = pc;
  return pc;
}

async function createOffer(target) {
  const pc = getPeer(target);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { callerSocketId: socket.id, callerEmail: user.email, target, sdp: pc.localDescription });
}

/* --- UI / Tiles --- */
function addVideoTile(id, stream, isLocal = false) {
  const tileId = 'tile-' + id;
  let div = document.getElementById(tileId);
  if (!div) {
    div = document.createElement('div');
    div.id = tileId;
    div.className = 'video-tile';
    const name = isLocal ? 'Você' : (connectedUsers[id]?.email?.split('@')[0] || id);
    div.innerHTML = `
      <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
      <div class="tile-label">${name}</div>`;
    videoGrid.appendChild(div);
  }
  const vid = div.querySelector('video');
  vid.srcObject = stream;
  vid.onloadedmetadata = () => vid.play().catch(()=>{});
}
function removeTile(id) {
  const el = document.getElementById('tile-' + id);
  if (el) el.remove();
}

/* --- Controles --- */
function toggleMute() {
  const t = myStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  muteBtn.classList.toggle('active', !t.enabled);
  muteBtn.textContent = t.enabled ? 'Mutar' : 'Desmutar';
}
function toggleCam() {
  const t = myStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  camBtn.classList.toggle('active', !t.enabled);
  camBtn.textContent = t.enabled ? 'Desligar Câmera' : 'Ligar Câmera';
}
muteBtn.onclick = toggleMute;
camBtn.onclick = toggleCam;

discBtn.onclick = () => {
  socket.disconnect();
  location.href = '/';
};

/* --- Compartilhar tela --- */
shareBtn.onclick = async () => {
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenPreview.hidden = false;
    screenPreviewVideo.srcObject = screen;
    const track = screen.getVideoTracks()[0];
    Object.values(peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(track);
    });
    track.onended = () => {
      screenPreview.hidden = true;
      Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(myStream.getVideoTracks()[0]);
      });
    };
  } catch (e) {
    console.warn('share screen fail', e);
  }
};

/* --- Fake cam --- */
fakeCamInput.onchange = () => {
  const file = fakeCamInput.files[0];
  if (!file) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 640; canvas.height = 480;
  if (file.type.startsWith('image/')) {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(25);
      swapVideo(stream);
    };
  } else if (file.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.src = URL.createObjectURL(file);
    v.loop = true;
    v.play();
    function draw() {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      requestAnimationFrame(draw);
    }
    v.onplay = () => {
      draw();
      const stream = canvas.captureStream(25);
      swapVideo(stream);
    };
  }
};

function swapVideo(newStream) {
  addVideoTile(socket.id, newStream, true);
  for (const pc of Object.values(peers)) {
    const sender = pc.getSenders().find(s => s.track.kind === 'video');
    if (sender) sender.replaceTrack(newStream.getVideoTracks()[0]);
  }
}

/* --- Voz sintética (simplificada) --- */
synthBtn.onclick = () => alert('Em breve 💬');

/* --- Admin panel --- */
adminToggle.onclick = () => {
  adminPanel.hidden = !adminPanel.hidden;
  updateAdminPanel();
};

function updateAdminPanel() {
  if (!user || user.role !== 'owner') return;
  userList.innerHTML = '';
  Object.entries(connectedUsers).forEach(([sid, info]) => {
    const div = document.createElement('div');
    div.className = 'user-controls';
    div.innerHTML = `
      <div><strong>${info.email.split('@')[0]}</strong> (${info.role})</div>
      <button class="btn" data-action="mute" data-id="${sid}">Mutar</button>
      <button class="btn" data-action="cam" data-id="${sid}">Câmera</button>`;
    userList.appendChild(div);
  });
  userList.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const cmd = b.dataset.action === 'mute' ? 'toggle-mute' : 'toggle-camera';
      socket.emit('admin-command', { command: cmd, targetSocketId: b.dataset.id });
    };
  });
}

/* --- Medidor de áudio --- */
function monitorAudio(stream) {
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  function draw() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a,b)=>a+b)/data.length;
    audioBar.style.width = Math.min(100, avg) + '%';
    requestAnimationFrame(draw);
  }
  draw();
}
