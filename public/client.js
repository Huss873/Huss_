// client.js
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

// controls
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
    // join the room (send email & role)
    socket.emit('join-room', ROOM_ID, user.email, user.role);
  } catch (err) {
    console.error('media failed', err);
    alert('Permita acesso à câmera e microfone.');
  }
}
startLocalMedia();

/* signaling handlers */
socket.on('connect', () => {
  console.log('socket connected', socket.id);
});

socket.on('current-users', (participants) => {
  // participants: [{ socketId, email, role }, ...] (includes us + others)
  participants.forEach(p => {
    connectedParticipants[p.socketId] = { email: p.email, role: p.role };
  });

  updateAdminPanel();
  // create peers to all other participants (except ourselves)
  participants.forEach(p => {
    if (p.socketId === socket.id) return;
    if (!peers[p.socketId]) {
      connectToNewUser(p.socketId);
    }
  });
});

socket.on('user-connected', (info) => {
  connectedParticipants[info.socketId] = { email: info.email, role: info.role };
  updateAdminPanel();
  // Wait briefly, then create an offer to the newcomer
  setTimeout(() => {
    if (!peers[info.socketId]) connectToNewUser(info.socketId);
  }, 250);
});

socket.on('user-disconnected', (info) => {
  const sid = info.socketId;
  if (peers[sid]) {
    peers[sid].close();
    delete peers[sid];
  }
  delete connectedParticipants[sid];
  removeTile(sid);
  updateAdminPanel();
});

socket.on('offer', async (payload) => {
  // payload: { callerSocketId, callerEmail, sdp, target }
  const caller = payload.callerSocketId;
  if (!caller || caller === socket.id) return;
  // create pc if not exists
  const pc = createPeerConnection(caller);
  peers[caller] = pc;

  await pc.setRemoteDescription(payload.sdp);
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  socket.emit('answer', { callerSocketId: socket.id, target: caller, sdp: pc.localDescription });
});

socket.on('answer', async (payload) => {
  const caller = payload.callerSocketId; // the one who answered (their socket id)
  const pc = peers[payload.callerSocketId] || peers[payload.target];
  // we created an offer earlier; find the pc by payload.target (if any) or by the caller
  const targetPc = peers[payload.target] || peers[payload.callerSocketId];
  if (!targetPc) return;
  await targetPc.setRemoteDescription(payload.sdp);
});

socket.on('ice-candidate', async (payload) => {
  const from = payload.callerSocketId;
  const pc = peers[from];
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
  } catch (e) {
    console.warn('ICE add failed', e);
  }
});

// admin commands received
socket.on('receive-admin-command', (data) => {
  if (!data || !data.command) return;
  switch (data.command) {
    case 'toggle-mute': toggleMute(); break;
    case 'toggle-camera': toggleCamera(); break;
    case 'remove-fake-cam': if (fakeCam.active) stopFakeCam(); break;
    case 'remove-voice-synth': if (voiceSynth.active) toggleVoiceSynth(); break;
  }
});

/* WebRTC core */
function createPeerConnection(remoteSocketId) {
  const pc = new RTCPeerConnection({ iceServers:[{ urls:'stun:stun.l.google.com:19302' }] });

  // add local tracks
  if (myStream) myStream.getTracks().forEach(t => pc.addTrack(t, myStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', { callerSocketId: socket.id, target: remoteSocketId, candidate: e.candidate });
    }
  };

  pc.ontrack = (ev) => {
    addOrUpdateRemoteTile(remoteSocketId, ev.streams[0]);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removeTile(remoteSocketId);
    }
  };

  return pc;
}

function connectToNewUser(targetSocketId) {
  if (peers[targetSocketId]) return;
  const pc = createPeerConnection(targetSocketId);
  peers[targetSocketId] = pc;

  pc.createOffer()
    .then(offer => pc.setLocalDescription(offer))
    .then(() => {
      socket.emit('offer', { callerSocketId: socket.id, callerEmail: user.email, target: targetSocketId, sdp: pc.localDescription });
    })
    .catch(err => console.error('offer error', err));
}

/* UI - tiles */
function addOrUpdateLocalTile(stream) {
  const id = tileIdFor(socket.id);
  let container = document.getElementById(id);
  if (!container) {
    container = document.createElement('div');
    container.id = id;
    container.className = 'video-tile';
    container.innerHTML = `
      <video autoplay playsinline muted></video>
      <div class="tile-label"><span class="name">Você (${user.email.split('@')[0]})</span><span class="mic-indicator status-dot"></span></div>
    `;
    videoGrid.prepend(container);
  }
  const videoEl = container.querySelector('video');
  const micIndicator = container.querySelector('.mic-indicator');

  videoEl.srcObject = stream;
  videoEl.onloadedmetadata = () => videoEl.play().catch(()=>{});
  micIndicator.classList.toggle('status-mic', stream.getAudioTracks().length > 0);
}

function addOrUpdateRemoteTile(socketId, stream) {
  const id = tileIdFor(socketId);
  let container = document.getElementById(id);
  const name = (connectedParticipants[socketId] && connectedParticipants[socketId].email) ? connectedParticipants[socketId].email.split('@')[0] : socketId;
  if (!container) {
    container = document.createElement('div');
    container.id = id;
    container.className = 'video-tile';
    container.innerHTML = `
      <video autoplay playsinline></video>
      <div class="tile-label"><span class="name">${name}</span><span class="mic-indicator status-dot"></span></div>
    `;
    videoGrid.prepend(container);
  }
  const videoEl = container.querySelector('video');
  const micIndicator = container.querySelector('.mic-indicator');

  if (!stream) {
    videoEl.style.display = 'none';
    if (!container.querySelector('.placeholder')) {
      const ph = document.createElement('div');
      ph.className = 'tile-placeholder placeholder';
      ph.textContent = name;
      container.appendChild(ph);
    }
    micIndicator.classList.toggle('status-mic', false);
    return;
  }
  const ph = container.querySelector('.placeholder');
  if (ph) ph.remove();

  videoEl.style.display = '';
  videoEl.srcObject = stream;
  videoEl.onloadedmetadata = () => videoEl.play().catch(()=>{});
  micIndicator.classList.toggle('status-mic', stream.getAudioTracks().length > 0);
}

function removeTile(socketId) {
  const id = tileIdFor(socketId);
  const el = document.getElementById(id);
  if (el) el.remove();
}

/* Controls */
function toggleMute() {
  if (!myStream) return;
  const t = myStream.getAudioTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  muteBtn.classList.toggle('active', !t.enabled);
  muteBtn.textContent = t.enabled ? 'Mutar' : 'Desmutar';
}
muteBtn.addEventListener('click', toggleMute);

function toggleCamera() {
  if (!myStream) return;
  const t = myStream.getVideoTracks()[0];
  if (!t) return;
  t.enabled = !t.enabled;
  cameraBtn.classList.toggle('active', !t.enabled);
  cameraBtn.textContent = t.enabled ? 'Desligar Câmera' : 'Ligar Câmera';
}
cameraBtn.addEventListener('click', toggleCamera);

disconnectBtn.addEventListener('click', () => {
  socket.disconnect();
  location.href = '/';
});

/* Fake cam */
fakeCamInput.addEventListener('change', startFakeCam);

function startFakeCam() {
  const file = fakeCamInput.files[0];
  if (!file || !myStream) return;

  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
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
    vid.muted = true;
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
  // replace video senders
  for (const id in peers) {
    const pc = peers[id];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(stream.getVideoTracks()[0]);
  }
}

function stopFakeCam() {
  fakeCam.active = false;
  if (fakeCam.animationFrameId) cancelAnimationFrame(fakeCam.animationFrameId);
  fakeCam.stream && fakeCam.stream.getTracks().forEach(t => t.stop());
  fakeCam.stream = null;
  addOrUpdateLocalTile(myStream);
  for (const id in peers) {
    const pc = peers[id];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(myStream.getVideoTracks()[0]);
  }
}

/* Share screen */
shareScreenBtn.addEventListener('click', async () => {
  if (!myStream) return;
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenPreview.hidden = false;
    screenPreviewVideo.srcObject = screen;
    screenPreviewVideo.play().catch(()=>{});
    const screenTrack = screen.getVideoTracks()[0];
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    }
    screenTrack.onended = () => {
      screenPreview.hidden = true;
      screenPreviewVideo.srcObject = null;
      for (const id in peers) {
        const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(myStream.getVideoTracks()[0]);
      }
    };
  } catch (err) {
    console.warn('share screen fail', err);
  }
});

/* Voice synth (simple) */
voiceSynthBtn.addEventListener('click', toggleVoiceSynth);
function toggleVoiceSynth() {
  voiceSynth.active = !voiceSynth.active;
  voiceSynthBtn.classList.toggle('active', voiceSynth.active);
  voiceSynthBtn.textContent = voiceSynth.active ? 'Voz Normal' : 'Ativar Voz Sintética';

  if (!myStream) return;
  if (voiceSynth.active) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(new MediaStream([myStream.getAudioTracks()[0]]));
    const bi = audioCtx.createBiquadFilter();
    bi.type = 'lowshelf'; bi.frequency.value = 1000; bi.gain.value = 20;
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(bi); bi.connect(dest);
    const procTrack = dest.stream.getAudioTracks()[0];
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(procTrack);
    }
  } else {
    // restore original audio
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(myStream.getAudioTracks()[0]);
    }
  }
}

/* Audio meter (simple) */
function monitorMicLevel(stream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i=0;i<data.length;i++) sum += data[i];
      const avg = sum / data.length;
      const pct = Math.min(100, Math.round(avg));
      audioLevelBar.style.width = pct + '%';
      requestAnimationFrame(tick);
    }
    tick();
  } catch (e) { /* ignore */ }
}

/* Admin panel */
adminToggle.addEventListener('click', () => {
  adminPanel.hidden = !adminPanel.hidden;
  updateAdminPanel();
});

function updateAdminPanel() {
  userListEl.innerHTML = '';
  const ordered = Object.entries(connectedParticipants);
  ordered.forEach(([sid, info]) => {
    const div = document.createElement('div');
    div.className = 'user-controls';
    div.innerHTML = `
      <div><strong>${info.email.split('@')[0]}</strong> <small>(${info.role})</small></div>
      <div>
        <button class="btn" data-action="mute" data-target="${sid}">Mutar</button>
        <button class="btn" data-action="camera" data-target="${sid}">Desligar Câmera</button>
        <button class="btn" data-action="kick" data-target="${sid}">Remover FakeCam</button>
      </div>
    `;
    userListEl.appendChild(div);
  });

  // attach handlers
  userListEl.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const action = b.dataset.action;
      const target = b.dataset.target;
      if (!target) return;
      // map to admin commands
      let cmd = null;
      if (action === 'mute') cmd = { command: 'toggle-mute', targetSocketId: target };
      if (action === 'camera') cmd = { command: 'toggle-camera', targetSocketId: target };
      if (action === 'kick') cmd = { command: 'remove-fake-cam', targetSocketId: target };
      if (cmd) socket.emit('admin-command', cmd);
    };
  });
}
