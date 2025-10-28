/* client.js atualizado - Huss Video Chat
   - grid UI melhorada
   - identificação dos participantes
   - fake cam (video/image) renderizando no canvas
   - share screen preview (local) e envio da track para peers (substitui vídeo)
   - botão "Ouvir Microfone" (monitor)
*/

const socket = io('/');
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
let peers = {};        // userId -> RTCPeerConnection
let connectedUsers = {}; // userId -> true
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

// helper to create tile id
function tileIdFor(userId, kind='cam') {
  return `tile-${kind}-${btoa(userId).replace(/=/g,'')}`;
}

// get user media
async function startLocalMedia() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    myStream = s;
    addOrUpdateLocalTile(user.email, s, true);
    monitorMicLevel(s);
    socket.emit('join-room', ROOM_ID, user.email, user.role);
  } catch (err) {
    console.error('media failed', err);
    alert('Permita acesso à câmera e microfone.');
  }
}
startLocalMedia();

/* ---------- Signaling handlers (dependem do seu server) ---------- */
socket.on('current-users', (users) => {
  connectedUsers = {};
  users.forEach(u => connectedUsers[u] = true);
  updateAdminPanel();
});

socket.on('user-connected', (userId, role) => {
  connectedUsers[userId] = true;
  // conecta a nova pessoa (será quem cria oferta do nosso lado)
  connectToNewUser(userId, myStream);
  updateAdminPanel();
});

socket.on('user-disconnected', (userId) => {
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  connectedUsers[userId] && delete connectedUsers[userId];
  removeTile(userId);
  updateAdminPanel();
});

// these events must be emitted by server to clients (offer/answer/ice)
socket.on('offer', handleOffer);
socket.on('answer', handleAnswer);
socket.on('ice-candidate', handleIceCandidate);

// admin commands
socket.on('receive-admin-command', (data) => {
  switch(data.command) {
    case 'toggle-mute': toggleMute(); break;
    case 'toggle-camera': toggleCamera(); break;
    case 'remove-fake-cam':
      if (fakeCam.active) stopFakeCam();
      break;
    case 'remove-voice-synth':
      if (voiceSynth.active) toggleVoiceSynth();
      break;
  }
});

/* ---------- WebRTC core ---------- */
function createPeerConnection(remoteUserId) {
  const pc = new RTCPeerConnection({ iceServers:[{ urls:'stun:stun.l.google.com:19302' }] });

  // add local tracks
  if (myStream) myStream.getTracks().forEach(t => pc.addTrack(t, myStream));
  if (fakeCam.active && fakeCam.stream) {
    // if fake cam active we expect updateMediaStream to replace senders
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', { caller: user.email, candidate: e.candidate });
    }
  };

  pc.ontrack = (ev) => {
    addOrUpdateRemoteTile(remoteUserId, ev.streams[0]);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removeTile(remoteUserId);
    }
  };

  return pc;
}

function connectToNewUser(targetUserId, stream) {
  // create pc and offer
  if (peers[targetUserId]) return;
  const pc = createPeerConnection(targetUserId);
  peers[targetUserId] = pc;

  pc.createOffer()
    .then(offer => pc.setLocalDescription(offer))
    .then(() => {
      socket.emit('offer', { caller: user.email, sdp: pc.localDescription });
    })
    .catch(err => console.error('offer error', err));
}

async function handleOffer(payload) {
  // payload.caller, payload.sdp
  const caller = payload.caller;
  if (!caller) return;
  const pc = createPeerConnection(caller);
  peers[caller] = pc;

  await pc.setRemoteDescription(payload.sdp);
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  socket.emit('answer', { caller: user.email, sdp: pc.localDescription });
}

async function handleAnswer(payload) {
  const pc = peers[payload.caller];
  if (!pc) return;
  await pc.setRemoteDescription(payload.sdp);
}

async function handleIceCandidate(payload) {
  const pc = peers[payload.caller];
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
  } catch (e) {
    console.warn('ICE add failed', e);
  }
}

/* ---------- UI: Tiles & status ---------- */

function addOrUpdateLocalTile(userId, stream, isLocal=false) {
  addOrUpdateTile(userId, stream, { local:isLocal, label: 'Você' });
}

function addOrUpdateRemoteTile(userId, stream) {
  addOrUpdateTile(userId, stream, { local:false, label: userId });
}

function addOrUpdateTile(userId, stream, opts={}) {
  const id = tileIdFor(userId);
  let container = document.getElementById(id);
  if (!container) {
    container = document.createElement('div');
    container.id = id;
    container.className = 'video-tile';
    container.innerHTML = `
      <video autoplay playsinline></video>
      <div class="tile-label">
        <span class="name"></span>
        <span class="mic-indicator status-dot"></span>
      </div>
    `;
    videoGrid.prepend(container);
  }
  const videoEl = container.querySelector('video');
  const nameEl = container.querySelector('.name');
  const micIndicator = container.querySelector('.mic-indicator');

  nameEl.textContent = opts.label || userId;

  if (!stream) {
    // show placeholder
    videoEl.style.display = 'none';
    if (!container.querySelector('.placeholder')) {
      const ph = document.createElement('div');
      ph.className = 'tile-placeholder placeholder';
      ph.textContent = nameEl.textContent.split('@')[0] || 'User';
      container.appendChild(ph);
    }
    micIndicator.classList.toggle('status-mic', false);
    return;
  }

  // remove placeholder if any
  const ph = container.querySelector('.placeholder');
  if (ph) ph.remove();

  videoEl.style.display = '';
  videoEl.srcObject = stream;
  videoEl.onloadedmetadata = () => videoEl.play().catch(()=>{});

  // check if audio exists in stream (for indicator)
  const hasAudio = stream.getAudioTracks().length > 0;
  micIndicator.classList.toggle('status-mic', hasAudio);
}

function removeTile(userId) {
  const id = tileIdFor(userId);
  const el = document.getElementById(id);
  if (el) el.remove();
}

/* ---------- Controls behavior ---------- */

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

/* ---------- Fake Cam (image/video rendered to canvas) ---------- */
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

  // replace local preview (we'll update local tile)
  addOrUpdateLocalTile(user.email, stream, true);

  // replace video senders for peers
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

  // restore local preview
  addOrUpdateLocalTile(user.email, myStream, true);

  // restore tracks
  for (const id in peers) {
    const pc = peers[id];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(myStream.getVideoTracks()[0]);
  }
}

/* ---------- Share screen (preview local, and replace outgoing video track) ---------- */
shareScreenBtn.addEventListener('click', async () => {
  if (!myStream) return;
  try {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    // local preview
    screenPreview.hidden = false;
    screenPreviewVideo.srcObject = screen;
    screenPreviewVideo.play().catch(()=>{});
    // replace outgoing video track on all peers
    const screenTrack = screen.getVideoTracks()[0];
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    }
    // when ends, restore
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

/* ---------- Voice synthesizer toggle (simple example using filter) ---------- */
voiceSynthBtn.addEventListener('click', toggleVoiceSynth);
function toggleVoiceSynth() {
  voiceSynth.active = !voiceSynth.active;
  voiceSynthBtn.classList.toggle('active', voiceSynth.active);
  voiceSynthBtn.textContent = voiceSynth.active ? 'Voz Normal' : 'Ativar Voz Sintética';

  // implement by creating processed audio track and replacing senders
  if (!myStream) return;
  if (voiceSynth.active) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(new MediaStream([myStream.getAudioTracks()[0]]));
    const bi = audioCtx.createBiquadFilter();
    bi.type = 'lowshelf'; bi.frequency.value = 1000; bi.gain.value = 20;
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(bi); bi.connect(dest);
    const procTrack = dest.stream.getAudioTracks()[0];
    // replace audio sender
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(procTrack);
    }
    // store for cleanup
    voiceSynth._ctx = audioCtx;
    voiceSynth._procTrack = procTrack;
  } else {
    // restore original track
    for (const id in peers) {
      const sender = peers[id].getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) sender.replaceTrack(myStream.getAudioTracks()[0]);
    }
    if (voiceSynth._procTrack) voiceSynth._procTrack.stop();
    if (voiceSynth._ctx) voiceSynth._ctx.close();
    voiceSynth._procTrack = null;
    voiceSynth._ctx = null;
  }
}

/* ---------- Monitor (ouvir microfone) ---------- */
monitorBtn.addEventListener('click', () => {
  monitor.active = !monitor.active;
  monitorBtn.classList.toggle('active', monitor.active);
  monitorBtn.textContent = monitor.active ? 'Parar Ouvir' : 'Ouvir Microfone';
  if (monitor.active) enableMonitor();
  else disableMonitor();
});

function enableMonitor() {
  if (!myStream) return;
  if (monitor.audioEl) return;
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.muted = false;
  // create stream with own audio track only
  const out = new MediaStream([myStream.getAudioTracks()[0]]);
  audio.srcObject = out;
  document.body.appendChild(audio);
  monitor.audioEl = audio;
  // WARNING: isso pode causar eco se você tiver alto-falantes e microfone não isolados
}

function disableMonitor() {
  if (!monitor.audioEl) return;
  monitor.audioEl.srcObject = null;
  monitor.audioEl.remove();
  monitor.audioEl = null;
}

/* ---------- Audio meter ---------- */
function monitorMicLevel(stream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    function frame() {
      analyser.getByteFrequencyData(data);
      const sum = data.reduce((a,b)=>a+b,0);
      const avg = sum / data.length;
      const width = Math.min(200, Math.max(2, avg * 0.8));
      audioLevelBar.style.width = width + 'px';
      requestAnimationFrame(frame);
    }
    frame();
  } catch(e) {
    console.warn('audio meter failed', e);
  }
}

/* ---------- Admin panel UI ---------- */
adminToggle.addEventListener('click', () => {
  if (user.role === 'owner') adminPanel.hidden = !adminPanel.hidden;
  else alert('Você não é o dono.');
});

function updateAdminPanel() {
  userListEl.innerHTML = '';
  Object.keys(connectedUsers).forEach(uid => {
    if (uid === user.email) return;
    const div = document.createElement('div');
    div.className = 'user-controls';
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:13px">${uid}</div>
        <div style="display:flex;gap:6px">
          <button class="btn" data-cmd="toggle-mute" data-target="${uid}">Mutar</button>
          <button class="btn" data-cmd="toggle-camera" data-target="${uid}">Câmera</button>
          <button class="btn" data-cmd="remove-fake-cam" data-target="${uid}">Remover Fake</button>
          <button class="btn" data-cmd="remove-voice-synth" data-target="${uid}">Remover Voz</button>
        </div>
      </div>
    `;
    userListEl.appendChild(div);
  });

  // attach click handlers
  userListEl.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const cmd = b.dataset.cmd;
      const tgt = b.dataset.target;
      socket.emit('admin-command', { targetUserId: tgt, command: cmd });
    };
  });
}

/* ---------- utils ---------- */
function tileIdFor(userId) {
  // safe id
  return 'tile-' + btoa(userId).replace(/=/g,'');
}

/* note: when peer connections are present, updateMediaStream should be used to swap tracks for all peers */
function updateMediaStream() {
  // video: pick fakeCam.stream if active else local camera
  const videoTrack = fakeCam.active && fakeCam.stream
    ? fakeCam.stream.getVideoTracks()[0]
    : myStream && myStream.getVideoTracks()[0];

  const audioTrack = (voiceSynth.active && voiceSynth._procTrack)
    ? voiceSynth._procTrack
    : (myStream ? myStream.getAudioTracks()[0] : null);

  for (const id in peers) {
    const pc = peers[id];
    const senders = pc.getSenders();
    const sVideo = senders.find(s => s.track && s.track.kind === 'video');
    const sAudio = senders.find(s => s.track && s.track.kind === 'audio');
    if (sVideo && videoTrack) sVideo.replaceTrack(videoTrack);
    if (sAudio && audioTrack) sAudio.replaceTrack(audioTrack);
  }

  // update our local preview
  addOrUpdateLocalTile(user.email, fakeCam.active && fakeCam.stream ? fakeCam.stream : myStream, true);
}

/* ---------- finish ---------- */
window.addEventListener('beforeunload', () => {
  try { socket.disconnect(); } catch(e){}
});
