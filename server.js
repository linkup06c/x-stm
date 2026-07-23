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

// --- ESTADO GLOBAL DO SERVIDOR (Tudo fica aqui para não precisar mexer nos APKs depois) ---
let filaMidias = []; // Lista de links: [ { id, url, titulo } ]
let indiceReproduzindo = 0; // Qual o índice da lista está rodando agora
let estadoGlobal = {
    acao: "play", // play, pause, seek, stop
    posicao: 0    // milissegundos se precisar sincronizar
};

wss.on('connection', (ws) => {
    console.log('Novo cliente conectado ao servidor central.');

    // 1. Assim que alguém conecta (Player ou Browser), envia o estado atual imediatamente
    sincronizarCliente(ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Comando recebido:', data);

            // CASO 1: O Browser enviou um novo link para adicionar à fila
            if (data.tipo === 'adicionar_midia' && data.url) {
                const novaMidia = {
                    id: Date.now().toString(),
                    url: data.url,
                    titulo: data.titulo || `Mídia ${filaMidias.length + 1}`
                };
                filaMidias.push(novaMidia);

                // Se for o único item, já começa a reproduzir ele
                if (filaMidias.length === 1) {
                    indiceReproduzindo = 0;
                }
                broadcastEstado();
            }

            // CASO 2: O Player avisou que o vídeo atual acabou (Auto-Play / Próximo da Fila)
            else if (data.tipo === 'proximo_video') {
                if (filaMidias.length > 0) {
                    indiceReproduzindo++;
                    // Se chegou ao fim da fila, faz o Loop e volta para o primeiro (índice 0)
                    if (indiceReproduzindo >= filaMidias.length) {
                        indiceReproduzindo = 0;
                    }
                }
                broadcastEstado();
            }

            // CASO 3: Comando de controle remoto vindo do HTML (Play, Pause, Próximo, Anterior, Limpar Fila)
            else if (data.tipo === 'comando') {
                const cmd = data.slink; // Ex: "play", "pause", "next", "prev", "clear"

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
                } else {
                    // Armazena o estado de play/pause global
                    estadoGlobal.acao = cmd;
                }
                broadcastEstado();
            }

        } catch (e) {
            console.error('Erro ao processar mensagem:', e);
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado.');
    });
});

// Função para enviar o pacote completo de sincronização para um cliente específico
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

// Função para atualizar TODOS os conectados (Browser, Controle HTML e Player Android) ao mesmo tempo
function broadcastEstado() {
    wss.clients.forEach((client) => {
        sincronizarCliente(client);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Server-Driven rodando na porta ${PORT}`);
});
