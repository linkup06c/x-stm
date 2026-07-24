const express = require("express");
const http = require("http");
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

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
        } catch (e) {}
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
server.listen(PORT);
