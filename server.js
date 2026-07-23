const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "online",
        versaoServidor: "2.0",
        configuracoesRemotas: {
            tempoSincroniaMs: 2000,
            permitirLoop: true,
            mensagemTela: "Transmissão ao vivo ativa"
        },
        filaAtual: filaMidias,
        indiceAtual: indiceReproduzindo
    }));
});

const wss = new WebSocket.Server({ server });

let filaMidias = []; 
let indiceReproduzindo = 0; 
let tempoAtualTransmissao = 0; 
let isTransmitindo = false;

// Relógio mestre da live
setInterval(() => {
    if (isTransmitindo && filaMidias.length > 0) {
        tempoAtualTransmissao++;
        if (tempoAtualTransmissao % 2 === 0) {
            broadcastUniversal({
                tipo: 'ACAO_SERVIDOR',
                comando: 'SINCRONIZAR_TEMPO',
                posicaoSegundos: tempoAtualTransmissao,
                reproduzindo: isTransmitindo
            });
        }
    }
}, 1000);

wss.on('connection', (ws) => {
    console.log('Cliente conectado ao núcleo universal.');
    enviarEstadoUniversal(ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Comando recebido do app:', data);

            // O servidor decide o que fazer com base na intenção, abstraindo o app
            const acao = data.acao || data.tipo;

            if (acao === 'ADICIONAR_MIDIA' || acao === 'midia') {
                const novaMidia = {
                    id: Date.now().toString(),
                    url: data.url,
                    titulo: data.titulo || `Mídia ${filaMidias.length + 1}`
                };
                filaMidias.push(novaMidia);
                if (filaMidias.length === 1) {
                    indiceReproduzindo = 0;
                    tempoAtualTransmissao = 0;
                    isTransmitindo = true;
                }
                broadcastEstadoUniversal();
            }
            else if (acao === 'PROXIMO_VIDEO' || acao === 'proximo_video') {
                if (filaMidias.length > 0) {
                    indiceReproduzindo++;
                    if (indiceReproduzindo >= filaMidias.length) {
                        indiceReproduzindo = 0;
                    }
                    tempoAtualTransmissao = 0;
                    isTransmitindo = true;
                }
                broadcastEstadoUniversal();
            }
            else if (acao === 'CONTROLE_GERAL' || data.slink) {
                const cmd = data.slink || data.comando;
                if (cmd === 'clear' || cmd === 'limpar') {
                    filaMidias = [];
                    indiceReproduzindo = 0;
                    tempoAtualTransmissao = 0;
                    isTransmitindo = false;
                } else if (cmd === 'pause') {
                    isTransmitindo = false;
                } else if (cmd === 'play') {
                    isTransmitindo = true;
                }
                broadcastEstadoUniversal();
            }

        } catch (e) {
            console.error('Erro ao interpretar payload:', e);
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado.');
    });
});

function enviarEstadoUniversal(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        const payload = {
            tipo: 'ACAO_SERVIDOR',
            comando: 'ATUALIZAR_ESTADO_TOTAL',
            dados: {
                fila: filaMidias,
                indiceAtual: indiceReproduzindo,
                midiaAtual: filaMidias.length > 0 ? filaMidias[indiceReproduzindo] : null,
                posicaoSegundos: tempoAtualTransmissao,
                reproduzindo: isTransmitindo
            }
        };
        ws.send(JSON.stringify(payload));
    }
}

function broadcastUniversal(payloadObj) {
    const str = JSON.stringify(payloadObj);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(str);
        }
    });
}

function broadcastEstadoUniversal() {
    wss.clients.forEach((client) => {
        enviarEstadoUniversal(client);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Universal Server-Driven rodando na porta ${PORT}`);
});
