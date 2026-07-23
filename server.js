const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: "online", totalDispositivos: dispositivosUnicosMap.size }));
});

const wss = new WebSocket.Server({ server });

let filaMidias = []; 
let indiceReproduzindo = 0; 
let isPlaying = false;
let timestampInicioEpoch = 0; 
let milissegundosAcumuladosAntesDoPause = 0; 

// MAPA DE DISPOSITIVOS REAIS
const dispositivosUnicosMap = new Map();

function calcularTempoAtualMs() {
    if (!isPlaying || filaMidias.length === 0) return milissegundosAcumuladosAntesDoPause;
    return milissegundosAcumuladosAntesDoPause + (Date.now() - timestampInicioEpoch);
}

// SINCRONIZAÇÃO DA MÍDIA
setInterval(() => {
    if (isPlaying && filaMidias.length > 0) {
        broadcastParaTodos({
            comando: "SYNC_TEMPO", posicaoMs: calcularTempoAtualMs(),
            timestampServidor: Date.now(), reproduzindo: isPlaying
        });
    }
}, 1000);

// RADAR ANTI-FANTASMA (Limpa quem ficou travado a cada 4 segundos)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Derrubando conexao fantasma!');
            return ws.terminate(); // Força a queda
        }
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

            // 1. APARELHO ENTROU
            if (data.tipo === 'REGISTRAR_DISPOSITIVO' && data.deviceId) {
                meuIdRegistrado = data.deviceId;
                if (dispositivosUnicosMap.has(meuIdRegistrado)) {
                    const socketAntigo = dispositivosUnicosMap.get(meuIdRegistrado);
                    if (socketAntigo !== ws && socketAntigo.readyState === WebSocket.OPEN) {
                        socketAntigo.close();
                    }
                }
                dispositivosUnicosMap.set(meuIdRegistrado, ws);
                console.log(`ENTROU: ${meuIdRegistrado} | Total na tela: ${dispositivosUnicosMap.size}`);
                enviarEstadoInicial(ws);
                broadcastContador();
                return;
            }

            // 2. APARELHO AVISOU QUE SAIU (Botão Home, Minimizar, etc)
            if (data.tipo === 'DESCONECTAR') {
                if (meuIdRegistrado && dispositivosUnicosMap.get(meuIdRegistrado) === ws) {
                    dispositivosUnicosMap.delete(meuIdRegistrado);
                    console.log(`SAIU RAPIDO: ${meuIdRegistrado} | Total na tela: ${dispositivosUnicosMap.size}`);
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

    // 3. SE O APARELHO FECHAR POR ERRO OU QUEDA DE ENERGIA
    ws.on('close', () => {
        if (meuIdRegistrado && dispositivosUnicosMap.get(meuIdRegistrado) === ws) {
            dispositivosUnicosMap.delete(meuIdRegistrado);
            console.log(`SAIU (Desconexao Nativa): ${meuIdRegistrado} | Total na tela: ${dispositivosUnicosMap.size}`);
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
