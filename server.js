const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "online",
        filaAtual: filaMidias,
        indiceAtual: indiceReproduzindo,
        estadoPlayer: estadoGlobal
    }));
});

const wss = new WebSocket.Server({ server });

let filaMidias = []; 
let indiceReproduzindo = 0; 
let estadoGlobal = {
    acao: "play",
    posicao: 0
};

wss.on('connection', (ws) => {
    console.log('Cliente conectado com sucesso!');
    sincronizarCliente(ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensagem recebida:', data);

            const tipo = data.tipo;

            // TRATAMENTO FLEXÍVEL: Aceita "midia" ou "adicionar_midia" vindo do Browser
            if ((tipo === 'midia' || tipo === 'adicionar_midia') && data.url) {
                const novaMidia = {
                    id: Date.now().toString(),
                    url: data.url,
                    titulo: data.titulo || `Mídia ${filaMidias.length + 1}`
                };
                filaMidias.push(novaMidia);

                // Se for a primeira mídia da fila, já define para tocar
                if (filaMidias.length === 1) {
                    indiceReproduzindo = 0;
                }
                broadcastEstado();
            }

            // O Player avisou que o vídeo acabou
            else if (tipo === 'proximo_video') {
                if (filaMidias.length > 0) {
                    indiceReproduzindo++;
                    if (indiceReproduzindo >= filaMidias.length) {
                        indiceReproduzindo = 0; // Loop automático para o primeiro
                    }
                }
                broadcastEstado();
            }

            // Comandos de controle (Play, Pause, Próximo, Limpar)
            else if (tipo === 'comando' || data.slink) {
                const cmd = data.slink || data.acao;

                if (cmd === 'clear' || cmd === 'limpar') {
                    filaMidias = [];
                    indiceReproduzindo = 0;
                } else if (cmd === 'next') {
                    if (filaMidias.length > 0) {
                        indiceReproduzindo = (indiceReproduzindo + 1) % filaMidias.length;
                    }
                } else if (cmd === 'prev') {
                    if (filaMidias.length > 0) {
                        indiceReproduzindo = (indiceReproduzindo - 1 + filaMidias.length) % filaMidias.length;
                    }
                } else if (cmd) {
                    estadoGlobal.acao = cmd;
                }
                broadcastEstado();
            }

        } catch (e) {
            console.error('Erro ao processar JSON:', e);
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado.');
    });
});

function sincronizarCliente(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        const payload = {
            tipo: 'sincronizacao',
            fila: filaMidias,
            indiceAtual: indiceReproduzindo,
            midiaAtual: filaMidias.length > 0 ? filaMidias[indiceReproduzindo] : null,
            estado: estadoGlobal
        };
        ws.send(JSON.stringify(payload));
    }
}

function broadcastEstado() {
    wss.clients.forEach((client) => {
        sincronizarCliente(client);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
