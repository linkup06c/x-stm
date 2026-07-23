const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Configuração do Socket.io para a voz / sinalização
const io = new Server(server, {
  cors: { origin: "*" }
});

const SALA_UNICA_VOZ = "sala_principal_xstream";
const activeUsers = new Map();

io.on("connection", (socket) => {
  console.log("Cliente conectado na voz:", socket.id);

  socket.on("join-room", ({ user }) => {
    const room = SALA_UNICA_VOZ;

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
  });

  socket.on("signal", (data) => {
    if (data && data.to) {
      io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
    }
  });

  socket.on("disconnect", () => {
    if (socket.user && socket.user.id) {
      activeUsers.delete(socket.user.id);
    }
    if (socket.room) {
      socket.to(socket.room).emit("user-left", socket.id);
    }
  });
});

// WebSocket Tradicional para Fila de Mídia e Sincronização
const wss = new WebSocket.Server({ noServer: true });

let filaMidias = []; 
let indiceReproduzindo = 0; 
let isPlaying = false;
let timestampInicioEpoch = 0; 
let milissegundosAcumuladosAntesDoPause = 0; 
const dispositivosUnicosMap = new Map();

function calcularTempoAtualMs() {
    if (!isPlaying || filaMidias.length === 0) return milissegundosAcumuladosAntesDoPause;
    return milissegundosAcumuladosAntesDoPause + (Date.now() - timestampInicioEpoch);
}

setInterval(() => {
    if (isPlaying && filaMidias.length > 0) {
        broadcastParaTodos({
            comando: "SYNC_TEMPO", 
            posicaoMs: calcularTempoAtualMs(),
            timestampServidor: Date.now(), 
            reproduzindo: isPlaying
        });
    }
}, 1000);

wss.on('connection', (ws) => {
    let meuIdRegistrado = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.tipo === 'REGISTRAR_DISPOSITIVO' && data.deviceId) {
                meuIdRegistrado = data.deviceId;
                if (dispositivosUnicosMap.has(meuIdRegistrado)) {
                    const socketAntigo = dispositivosUnicosMap.get(meuIdRegistrado);
                    if (socketAntigo !== ws && socketAntigo.readyState === WebSocket.OPEN) socketAntigo.close();
                }
                dispositivosUnicosMap.set(meuIdRegistrado, ws);
                enviarEstadoInicial(ws);
                broadcastContador();
                return;
            }

            if (data.tipo === 'DESCONECTAR') {
                if (meuIdRegistrado && dispositivosUnicosMap.get(meuIdRegistrado) === ws) {
                    dispositivosUnicosMap.delete(meuIdRegistrado);
                    broadcastContador();
                }
                ws.close();
                return;
            }

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
        } catch (e) {
            console.error("Erro:", e.message);
        }
    });

    ws.on('close', () => {
        if (meuIdRegistrado && dispositivosUnicosMap.get(meuIdRegistrado) === ws) {
            dispositivosUnicosMap.delete(meuIdRegistrado);
            broadcastContador();
        }
    });
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

app.get('/', (req, res) => {
    res.json({ status: "online", totalDispositivos: dispositivosUnicosMap.size });
});

function enviarEstadoInicial(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            comando: "ESTADO_TOTAL", fila: filaMidias, indice: indiceReproduzindo,
            midiaAtual: filaMidias.length > 0 ? filaMidias[indiceReproduzindo] : null,
            posicaoMs: calcularTempoAtualMs(), timestampServidor: Date.now(),
            reproduzindo: isPlaying, totalDispositivos: dispositivosUnicosMap.size
        }));
    }
}

function broadcastContador() {
    const payload = JSON.stringify({ totalDispositivos: dispositivosUnicosMap.size });
    dispositivosUnicosMap.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(payload); });
}

function broadcastParaTodos(obj) {
    obj.totalDispositivos = dispositivosUnicosMap.size;
    const str = JSON.stringify(obj);
    dispositivosUnicosMap.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(str); });
}

function broadcastEstadoTotal() { dispositivosUnicosMap.forEach((client) => enviarEstadoInicial(client)); }

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
