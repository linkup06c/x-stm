const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "online",
        servidor: "X-Stream Universal Server-Driven",
        fila: filaMidias,
        indice: indiceReproduzindo,
        tempo: tempoAtualSegundos,
        play: isPlaying
    }));
});

const wss = new WebSocket.Server({ server });

let filaMidias = []; 
let indiceReproduzindo = 0; 
let tempoAtualSegundos = 0; 
let isPlaying = false;

// RELÓGIO MESTRE DA TRANSMISSÃO (O coração batendo a cada 1 segundo)
setInterval(() => {
    if (isPlaying && filaMidias.length > 0) {
        tempoAtualSegundos++;
        // Envia o pulso de tempo a cada 2 segundos para sincronizar todos os players
        if (tempoAtualSegundos % 2 === 0) {
            broadcastParaTodos({
                comando: "SYNC_TEMPO",
                posicao: tempoAtualSegundos,
                reproduzindo: isPlaying
            });
        }
    }
}, 1000);

wss.on('connection', (ws) => {
    console.log('Novo dispositivo conectado ao núcleo.');
    enviarEstadoInicial(ws);

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

                    // Se for a única na fila, inicia o player imediatamente do zero
                    if (filaMidias.length === 1) {
                        indiceReproduzindo = 0;
                        tempoAtualSegundos = 0;
                        isPlaying = true;
                    }
                    broadcastEstadoTotal();
                }
            }

            // 2. O PLAYER AVISOU QUE O VÍDEO ACABOU (Loop / Próximo)
            else if (tipo === 'proximo_video') {
                if (filaMidias.length > 0) {
                    indiceReproduzindo++;
                    if (indiceReproduzindo >= filaMidias.length) {
                        indiceReproduzindo = 0; // Volta para o primeiro (Loop infinito)
                    }
                    tempoAtualSegundos = 0;
                    isPlaying = true;
                    broadcastEstadoTotal();
                }
            }

            // 3. COMANDOS DE CONTROLE REMOTO (Play, Pause, Próximo, Limpar)
            else if (slink || tipo === 'comando') {
                const cmd = slink || tipo;

                if (cmd === 'clear' || cmd === 'limpar') {
                    filaMidias = [];
                    indiceReproduzindo = 0;
                    tempoAtualSegundos = 0;
                    isPlaying = false;
                } else if (cmd === 'next') {
                    if (filaMidias.length > 0) {
                        indiceReproduzindo = (indiceReproduzindo + 1) % filaMidias.length;
                        tempoAtualSegundos = 0;
                        isPlaying = true;
                    }
                } else if (cmd === 'prev') {
                    if (filaMidias.length > 0) {
                        indiceReproduzindo = (indiceReproduzindo - 1 + filaMidias.length) % filaMidias.length;
                        tempoAtualSegundos = 0;
                        isPlaying = true;
                    }
                } else if (cmd === 'pause') {
                    isPlaying = false;
                } else if (cmd === 'play') {
                    isPlaying = true;
                }
                broadcastEstadoTotal();
            }

        } catch (e) {
            console.error('Erro ao processar mensagem JSON:', e);
        }
    });

    ws.on('close', () => {
        console.log('Dispositivo desconectado.');
    });
});

function enviarEstadoInicial(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        const payload = {
            comando: "ESTADO_TOTAL",
            fila: filaMidias,
            indice: indiceReproduzindo,
            midiaAtual: filaMidias.length > 0 ? filaMidias[indiceReproduzindo] : null,
            posicao: tempoAtualSegundos,
            reproduzindo: isPlaying
        };
        ws.send(JSON.stringify(payload));
    }
}

function broadcastParaTodos(obj) {
    const str = JSON.stringify(obj);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(str);
        }
    });
}

function broadcastEstadoTotal() {
    wss.clients.forEach((client) => {
        enviarEstadoInicial(client);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor definitivo rodando na porta ${PORT}`);
});
