// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- Usuários (mock login) ---
const users = {
  "ownerhuss@huss.com": { password: "J84kkv_#jsQt", role: "owner" },
  "user01@huss.com": { password: "P@ssw0rd_Alpha", role: "user" },
  "user02@huss.com": { password: "Secr3t_Beta", role: "user" },
  "user03@huss.com": { password: "Gamma_Key_77", role: "user" },
};

// Mapeamentos
// email -> [ socketId, ... ]
const userSocketMap = {};
// socketId -> { email, role, roomId }
const socketMeta = {};

// Static
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Login endpoint (mock)
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (users[email] && users[email].password === password) {
    res.json({ success: true, user: { email, role: users[email].role } });
  } else {
    res.json({ success: false, message: "Credenciais inválidas." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/room.html", (req, res) => {
  res.sendFile(path.join(__dirname, "room.html"));
});

// Socket.IO signaling & room logic
io.on("connection", (socket) => {
  console.log("Novo socket conectado:", socket.id);

  socket.on("join-room", (roomId, email, role) => {
    // store meta
    socket.join(roomId);
    socketMeta[socket.id] = { email, role, roomId };

    if (!userSocketMap[email]) userSocketMap[email] = [];
    userSocketMap[email].push(socket.id);

    // build list of current participants in the room
    const participants = [];
    for (const [sId, meta] of Object.entries(socketMeta)) {
      if (meta.roomId === roomId) participants.push({ socketId: sId, email: meta.email, role: meta.role });
    }

    // send current-users to the joining socket (list of participants)
    io.to(socket.id).emit("current-users", participants);

    // announce to others in room that a new participant connected
    socket.to(roomId).emit("user-connected", { socketId: socket.id, email, role });

    console.log(`join-room: ${email} (${socket.id}) -> ${roomId}`);
  });

  // forward offers/answers/ice by target socket id
  socket.on("offer", (payload) => {
    const target = payload.target;
    if (target) {
      io.to(target).emit("offer", payload);
    }
  });

  socket.on("answer", (payload) => {
    const target = payload.target;
    if (target) {
      io.to(target).emit("answer", payload);
    }
  });

  socket.on("ice-candidate", (payload) => {
    const target = payload.target;
    if (target) {
      io.to(target).emit("ice-candidate", payload);
    }
  });

  // admin commands: sent to single socketId target
  socket.on("admin-command", (data) => {
    // only allow if this socket is owner
    const meta = socketMeta[socket.id];
    if (!meta || meta.role !== "owner") return;
    const targetSocketId = data.targetSocketId;
    if (targetSocketId) {
      io.to(targetSocketId).emit("receive-admin-command", data);
    }
  });

  socket.on("disconnect", () => {
    const meta = socketMeta[socket.id];
    if (meta) {
      const { email, roomId } = meta;
      // remove from userSocketMap
      if (userSocketMap[email]) {
        userSocketMap[email] = userSocketMap[email].filter(sid => sid !== socket.id);
        if (userSocketMap[email].length === 0) delete userSocketMap[email];
      }
      // remove socketMeta
      delete socketMeta[socket.id];

      // inform others in room
      socket.to(roomId).emit("user-disconnected", { socketId: socket.id, email });
      console.log(`Socket desconectado: ${socket.id} (${email})`);
    } else {
      console.log("Socket desconectado (sem meta):", socket.id);
    }
  });
});

server.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
