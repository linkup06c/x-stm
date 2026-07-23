const WebSocket = require('ws');
const http = require('http');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

// INSIRA SUAS CREDENCIAIS DO AGORA AQUI (Pegue grátis no console.agora.io)
const AGORA_APP_ID = "9935747469c74640bce6fd4be3bf0197";
const AGORA_APP_CERTIFICATE = "5eecc6cdadc64f8eb3cfa79fc54d9099";

const server = http.createServer((req, res) => {
    // Rota para o Android pedir o token de voz da Call
    if (req.url.startsWith('/token-voz')) {
        const channelName = "sala_principal_xstream";
        const uid = 0; // UID automático
        const role = RtcRole.PUBLISHER;
        const expirationTimeInSeconds = 3600 * 24; // Token válido por 24 horas
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

        const token = RtcTokenBuilder.buildTokenWithUid(
            AGORA_APP_ID,
            AGORA_APP_CERTIFICATE,
            channelName,
            uid,
            role,
            privilegeExpiredTs
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ appId: AGORA_APP_ID, channel: channelName, token: token, uid: uid }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: "online", totalDispositivos: dispositivosUnicosMap.size }));
});

const wss = new WebSocket.Server({ server });

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
            comando: "SYNC_TEMPO", posicaoMs: calcularTempoAtualMs(),
            timestampServidor: Date.now(), reproduzindo: isPlaying
        });
    }
}, 1000);

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 4000);

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
        } catch (e) { }
    });

    ws.on('close', () => {
        if (meuIdRegistrado && dispositivosUnicosMap.get(meuIdRegistrado) === ws) {
            dispositivosUnicosMap.delete(meuIdRegistrado);
            broadcastContador();
        }
    });
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
