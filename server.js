const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "online",
        servidor: "X-Stream Universal Server-Driven",
        fila: filaMidias,
        indice: indiceReproduzindo,
        tempoMs: calcularTempoAtualMs(),
        play: isPlaying,
        totalDispositivos: clientesConectados.size
    }));
});

const wss = new WebSocket.Server({ server });

let filaMidias = []; 
let indiceReproduzindo = 0; 
let isPlaying = false;

// Controle de tempo de alta precisão em milissegundos
let timestampInicioEpoch = 0; 
let milissegundosAcumuladosAntesDoPause = 0; 

// MAPA DE CLIENTES REAIS (Garante contagem exata sem duplicar ou acumular)
const clientesConectados = new Map();

function calcularTempoAtualMs() {
    if (!isPlaying || filaMidias.length === 0) {
        return milissegundosAcumuladosAntesDoPause;
    }
    const agora = Date.now();
    const decorrido = agora - timestampInicioEpoch;
    return milissegundosAcumuladosAntesDoPause + decorrido;
}

// RELÓGIO MESTRE DE ALTA PRECISÃO
setInterval(() => {
    if (isPlaying && filaMidias.length > 0) {
        broadcastParaTodos({
            comando: "SYNC_TEMPO",
            posicaoMs: calcularTempoAtualMs(),
            timestampServidor: Date.now(),
            reproduzindo: isPlaying,
            totalDispositivos: clientesConectados.size
        });
    }
}, 1000);

wss.on('connection', (ws, req) => {
    const clientId = req.socket.remoteAddress + "_" + Date.now();
    clientesConectados.set(ws, clientId);

    console.log('Novo dispositivo conectado. Total real:', clientesConectados.size);
    
    enviarEstadoInicial(ws);
    broadcastContador();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Comando recebido:', data);

            const tipo = data.tipo || data.acao;
            const url = data.url;
            const slink = data.slink || data.comando;

            // 1. ADICIONAR MÍDIA À FILA
            if (tipo === 'midia' || tipo === 'adicionar_midia' || url) {
                if (url) {
                    const novaMidia = {
                        id: Date.now().toString(),
                        url: url,
                        titulo: data.titulo || `Mídia ${filaMidias.length + 1}`
                    };
                    filaMidias.push(novaMidia);

                    if (filaMidias.length === 1) {
                        indiceReproduzindo = 0;
                        milissegundosAcumuladosAntesDoPause = 0;
                        timestampInicioEpoch = Date.now();
                        isPlaying = true;
                    }
                    broadcastEstadoTotal();
                }
            }

            // 2. O PLAYER AVISOU QUE O VÍDEO ACABOU
            else if (tipo === 'proximo_video') {
                if (filaMidias.length > 0) {
                    indiceReproduzindo++;
                    if (indiceReproduzindo >= filaMidias.length) {
                        indiceReproduzindo = 0; 
                    }
                    milissegundosAcumuladosAntesDoPause = 0;
                    timestampInicioEpoch = Date.now();
                    isPlaying = true;
                    broadcastEstadoTotal();
                }
            }

            // 3. COMANDOS DE CONTROLE REMOTO
            else if (slink || tipo === 'comando') {
                const cmd = slink || tipo;

                if (cmd === 'clear' || cmd === 'limpar') {
                    filaMidias = [];
                    indiceReproduzindo = 0;
                    milissegundosAcumuladosAntesDoPause = 0;
                    isPlaying = false;
                } else if (cmd === 'next') {
                    if (filaMidias.length > 0) {
                        indiceReproduzindo = (indiceReproduzindo + 1) % filaMidias.length;
                        milissegundosAcumuladosAntesDoPause = 0;
                        timestampInicioEpoch = Date.now();
                        isPlaying = true;
                    }
                } else if (cmd === 'prev') {
                    if (filaMidias.length > 0) {
                        indiceReproduzindo = (indiceReproduzindo - 1 + filaMidias.length) % filaMidias.length;
                        milissegundosAcumuladosAntesDoPause = 0;
                        timestampInicioEpoch = Date.now();
                        isPlaying = true;
                    }
                } else if (cmd === 'pause') {
                    if (isPlaying) {
                        milissegundosAcumuladosAntesDoPause = calcularTempoAtualMs();
                        isPlaying = false;
                    }
                } else if (cmd === 'play') {
                    if (!isPlaying) {
                        timestampInicioEpoch = Date.now();
                        isPlaying = true;
                    }
                }
                broadcastEstadoTotal();
            }

        } catch (e) {
            console.error('Erro ao processar mensagem JSON:', e);
        }
    });

    ws.on('close', () => {
        clientesConectados.delete(ws);
        console.log('Dispositivo desconectado. Total remanescente real:', clientesConectados.size);
        broadcastContador();
    });

    ws.on('error', () => {
        clientesConectados.delete(ws);
        broadcastContador();
    });
});

function enviarEstadoInicial(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        const payload = {
            comando: "ESTADO_TOTAL",
            fila: filaMidias,
            indice: indiceReproduzindo,
            midiaAtual: filaMidias.length > 0 ? filaMidias[indiceReproduzindo] : null,
            posicaoMs: calcularTempoAtualMs(),
            timestampServidor: Date.now(),
            reproduzindo: isPlaying,
            totalDispositivos: clientesConectados.size
        };
        ws.send(JSON.stringify(payload));
    }
}

function broadcastContador() {
    const payload = JSON.stringify({
        totalDispositivos: clientesConectados.size
    });
    clientesConectados.forEach((id, client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

function broadcastParaTodos(obj) {
    obj.totalDispositivos = clientesConectados.size;
    const str = JSON.stringify(obj);
    clientesConectados.forEach((id, client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(str);
        }
    });
}

function broadcastEstadoTotal() {
    clientesConectados.forEach((id, client) => {
        enviarEstadoInicial(client);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de alta precisão rodando na porta ${PORT}`);
});
