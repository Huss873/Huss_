const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Usuários (mock login) ---
const users = {
  "ownerhuss@huss.com": { password: "J84kkv_#jsQt", role: "owner" },
  "user01@huss.com": { password: "P@ssw0rd_Alpha", role: "user" },
  "user02@huss.com": { password: "Secr3t_Beta", role: "user" },
  "user03@huss.com": { password: "Gamma_Key_77", role: "user" },
};

let userSocketMap = {}; // userId -> socket.id

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// --- Login ---
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (users[email] && users[email].password === password) {
    res.json({ success: true, user: { email, role: users[email].role } });
  } else {
    res.json({ success: false, message: "Credenciais inválidas." });
  }
});

// --- Página inicial ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- WebRTC + Controle via Socket.IO ---
io.on("connection", (socket) => {
  console.log("Novo usuário conectado:", socket.id);

  socket.on("join-room", (roomId, userId, userRole) => {
    socket.join(roomId);
    socket.userId = userId;
    socket.userRole = userRole;
    userSocketMap[userId] = socket.id;

    socket.to(roomId).emit("user-connected", userId, userRole);
    io.to(socket.id).emit("current-users", Object.keys(userSocketMap));

    socket.on("disconnect", () => {
      console.log("Usuário desconectado:", socket.id);
      delete userSocketMap[userId];
      socket.to(roomId).emit("user-disconnected", userId);
    });

    // Sinalização WebRTC
    socket.on("offer", (payload) => {
      io.to(payload.target).emit("offer", payload);
    });
    socket.on("answer", (payload) => {
      io.to(payload.target).emit("answer", payload);
    });
    socket.on("ice-candidate", (payload) => {
      io.to(payload.target).emit("ice-candidate", payload);
    });

    // Comandos administrativos
    socket.on("admin-command", (data) => {
      if (socket.userRole !== "owner") return;
      const targetSocketId = userSocketMap[data.targetUserId];
      if (targetSocketId) {
        io.to(targetSocketId).emit("receive-admin-command", data);
      }
    });
  });
});

server.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
