const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "online",
        tempoServidor: Math.floor(tempoAtualTransmissao),
        filaAtual: filaMidias,
        indiceAtual: indiceReproduzindo
    }));
});

const wss = new WebSocket.Server({ server });

let filaMidias = []; 
let indiceReproduzindo = 0; 
let tempoAtualTransmissao = 0; // O "relógio" oficial da live em segundos
let isTransmitindo = false;

// O CORAÇÃO BATE A CADA 1 SEGUNDO: Mantém o tempo oficial da live correndo
setInterval(() => {
    if (isTransmitindo && filaMidias.length > 0) {
        tempoAtualTransmissao++;
        
        // Dispara a cada 2 segundos a posição exata para todos os players conectados (Sincronia Ao Vivo)
        if (tempoAtualTransmissao % 2 === 0) {
            broadcastSincroniaTempo();
        }
    }
}, 1000);

wss.on('connection', (ws) => {
    console.log('Novo dispositivo conectado à transmissão ao vivo.');
    enviarEstadoParaCliente(ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const tipo = data.tipo;

            if (tipo === 'midia' || tipo === 'adicionar_midia') {
                const novaMidia = {
                    id: Date.now().toString(),
                    url: data.url,
                    titulo: data.titulo || `Transmissão ${filaMidias.length + 1}`
                };
                filaMidias.push(novaMidia);

                if (filaMidias.length === 1) {
                    indiceReproduzindo = 0;
                    tempoAtualTransmissao = 0;
                    isTransmitindo = true;
                }
                broadcastEstadoGeral();
            }
            else if (tipo === 'proximo_video') {
                if (filaMidias.length > 0) {
                    indiceReproduzindo++;
                    if (indiceReproduzindo >= filaMidias.length) {
                        indiceReproduzindo = 0; // Loop da grade ao vivo
                    }
                    tempoAtualTransmissao = 0; // Reseta o relógio para o novo vídeo
                    isTransmitindo = true;
                }
                broadcastEstadoGeral();
            }
            else if (tipo === 'comando' || data.slink) {
                const cmd = data.slink || data.acao;
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
                broadcastEstadoGeral();
            }
        } catch (e) {
            console.error('Erro ao processar mensagem:', e);
        }
    });

    ws.on('close', () => {
        console.log('Dispositivo desconectado da live.');
    });
});

function enviarEstadoParaCliente(ws) {
    if (ws.readyState === WebSocket.OPEN) {
        const payload = {
            tipo: 'sincronizacao_ao_vivo',
            fila: filaMidias,
            indiceAtual: indiceReproduzindo,
            midiaAtual: filaMidias.length > 0 ? filaMidias[indiceReproduzindo] : null,
            tempoTransmissao: tempoAtualTransmissao,
            isTransmitindo: isTransmitindo
        };
        ws.send(JSON.stringify(payload));
    }
}

function broadcastSincroniaTempo() {
    const payload = JSON.stringify({
        tipo: 'tick_ao_vivo',
        tempoTransmissao: tempoAtualTransmissao,
        isTransmitindo: isTransmitindo
    });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

function broadcastEstadoGeral() {
    wss.clients.forEach((client) => {
        enviarEstadoParaCliente(client);
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Coração do Servidor Ao Vivo rodando na porta ${PORT}`);
});
