const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

let filaMidias = []; 
let indiceReproduzindo = 0; 
let isPlaying = false;
let timestampInicioEpoch = 0; 
let milissegundosAcumuladosAntesDoPause = 0; 
const activeUsers = new Map();

function calcularTempoAtualMs() {
    if (!isPlaying || filaMidias.length === 0) return milissegundosAcumuladosAntesDoPause;
    return milissegundosAcumuladosAntesDoPause + (Date.now() - timestampInicioEpoch);
}

setInterval(() => {
    if (isPlaying && filaMidias.length > 0) {
        io.emit("message", JSON.stringify({
            comando: "SYNC_TEMPO", 
            posicaoMs: calcularTempoAtualMs(),
            timestampServidor: Date.now(), 
            reproduzindo: isPlaying,
            totalDispositivos: io.engine.clientsCount
        }));
    }
}, 1000);

io.on("connection", (socket) => {
  socket.emit("message", JSON.stringify({
      comando: "ESTADO_TOTAL", 
      fila: filaMidias, 
      indice: indiceReproduzindo,
      midiaAtual: filaMidias.length > 0 ? filaMidias[indiceReproduzindo] : null,
      posicaoMs: calcularTempoAtualMs(), 
      timestampServidor: Date.now(),
      reproduzindo: isPlaying, 
      totalDispositivos: io.engine.clientsCount
  }));

  socket.on("join-room", (data) => {
    const room = data.room || "sala_principal_xstream";
    const user = data.user;

    if (user && user.id && activeUsers.has(user.id)) {
      const oldSocketId = activeUsers.get(user.id);
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) oldSocket.disconnect(true);
    }

    if (user && user.id) {
      activeUsers.set(user.id, socket.id);
    }

    socket.join(room);
    socket.user = user;
    socket.room = room;

    const clients = Array.from(io.sockets.sockets.values())
      .filter(s => s.room === room && s.user)
      .map(s => ({ id: s.id, user: s.user }));

    socket.emit("room-users", clients);
    socket.to(room).emit("user-joined", { id: socket.id, user });
    io.emit("message", JSON.stringify({ totalDispositivos: io.engine.clientsCount }));
  });

  socket.on("signal", (data) => {
    if (data && data.to) {
      io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
    }
  });

  socket.on("message", (msgStr) => {
    try {
      const data = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
      const tipo = data.tipo || data.acao;
      const url = data.url;
      const slink = data.slink || data.comando;

      if (tipo === 'midia' || tipo === 'adicionar_midia' || url) {
          if (url) {
              filaMidias.push({ id: Date.now().toString(), url: url, titulo: data.titulo || `Mídia ${filaMidias.length + 1}` });
              if (filaMidias.length === 1) { indiceReproduzindo = 0; milissegundosAcumuladosAntesDoPause = 0; timestampInicioEpoch = Date.now(); isPlaying = true; }
              broadcastEstadoTotal();
          }
      } else if (tipo === 'proximo_video') {
          if (filaMidias.length > 0) {
              indiceReproduzindo = (indiceReproduzindo + 1) % filaMidias.length;
              milissegundosAcumuladosAntesDoPause = 0; timestampInicioEpoch = Date.now(); isPlaying = true;
              broadcastEstadoTotal();
          }
      } else if (slink || tipo === 'comando') {
          const cmd = slink || tipo;
          if (cmd === 'clear' || cmd === 'limpar') { filaMidias = []; indiceReproduzindo = 0; milissegundosAcumuladosAntesDoPause = 0; isPlaying = false; }
          else if (cmd === 'next') { if (filaMidias.length > 0) { indiceReproduzindo = (indiceReproduzindo + 1) % filaMidias.length; milissegundosAcumuladosAntesDoPause = 0; timestampInicioEpoch = Date.now(); isPlaying = true; } }
          else if (cmd === 'prev') { if (filaMidias.length > 0) { indiceReproduzindo = (indiceReproduzindo - 1 + filaMidias.length) % filaMidias.length; milissegundosAcumuladosAntesDoPause = 0; timestampInicioEpoch = Date.now(); isPlaying = true; } }
          else if (cmd === 'pause') { if (isPlaying) { milissegundosAcumuladosAntesDoPause = calcularTempoAtualMs(); isPlaying = false; } }
          else if (cmd === 'play') { if (!isPlaying) { timestampInicioEpoch = Date.now(); isPlaying = true; } }
          broadcastEstadoTotal();
      }
    } catch (e) {}
  });

  socket.on("disconnect", () => {
    if (socket.user && socket.user.id) {
      activeUsers.delete(socket.user.id);
    }
    if (socket.room) {
      socket.to(socket.room).emit("user-left", socket.id);
    }
    io.emit("message", JSON.stringify({ totalDispositivos: io.engine.clientsCount }));
  });
});

function broadcastEstadoTotal() {
    const payload = JSON.stringify({
        comando: "ESTADO_TOTAL", 
        fila: filaMidias, 
        indice: indiceReproduzindo,
        midiaAtual: filaMidias.length > 0 ? filaMidias[indiceReproduzindo] : null,
        posicaoMs: calcularTempoAtualMs(), 
        timestampServidor: Date.now(),
        reproduzindo: isPlaying, 
        totalDispositivos: io.engine.clientsCount
    });
    io.emit("message", payload);
}

app.get('/', (req, res) => {
    res.json({ status: "online", totalDispositivos: io.engine.clientsCount });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT);
