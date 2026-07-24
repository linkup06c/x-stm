const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Estado global da transmissão
let estadoGlobal = {
    reproduzindo: false,
    midiaAtual: null,
    fila: []
};

// Notifica todos os clientes conectados sobre atualizações no estado e quantidade online
function broadcastEstado() {
    const totalOnline = wss.clients ? wss.clients.size : 0;
    
    const dados = JSON.stringify({
        comando: "ESTADO_TOTAL",
        online: totalOnline,
        ...estadoGlobal
    });

    wss.clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            try {
                client.send(dados);
            } catch (err) {
                console.error('Erro ao enviar dados para cliente WebSocket:', err);
            }
        }
    });
}

// Conexão WebSocket
wss.on('connection', (ws, req) => {
    console.log('Novo cliente conectado via WebSocket IP:', req.socket.remoteAddress);

    // Envia imediatamente o estado atual para o novo cliente recém-chegado
    try {
        const totalOnline = wss.clients ? wss.clients.size : 0;
        ws.send(JSON.stringify({
            comando: "ESTADO_TOTAL",
            online: totalOnline,
            ...estadoGlobal
        }));
    } catch (e) {
        console.error('Erro ao enviar estado inicial:', e);
    }

    // Atualiza todos sobre a nova contagem de conexões
    broadcastEstado();

    ws.on('message', (message) => {
        try {
            const mensagemStr = message.toString();
            const data = JSON.parse(mensagemStr);
            console.log('Ação recebida:', data);
            processarAcao(data);
        } catch (e) {
            console.error('Erro ao processar mensagem JSON do WebSocket:', e);
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado.');
        broadcastEstado();
    });

    ws.on('error', (error) => {
        console.error('Erro na conexão WebSocket:', error);
    });
});

// Processamento unificado de comandos e mídias
function processarAcao(dados) {
    if (dados.tipo === 'midia') {
        const novaMidia = {
            url: dados.url,
            titulo: dados.titulo || "Mídia sem título"
        };
        estadoGlobal.fila.push(novaMidia);
        if (!estadoGlobal.midiaAtual) {
            estadoGlobal.midiaAtual = novaMidia;
            estadoGlobal.reproduzindo = true;
        }
    } else if (dados.tipo === 'comando' || dados.comando) {
        const cmd = dados.comando || dados.slink;

        switch (cmd) {
            case 'play':
                estadoGlobal.reproduzindo = true;
                break;
            case 'pause':
                estadoGlobal.reproduzindo = false;
                break;
            case 'next':
                if (estadoGlobal.fila.length > 0) {
                    estadoGlobal.fila.shift();
                    estadoGlobal.midiaAtual = estadoGlobal.fila[0] || null;
                    estadoGlobal.reproduzindo = !!estadoGlobal.midiaAtual;
                }
                break;
            case 'prev':
                break;
            case 'rewind_15':
                console.log('Comando recebido: Voltar 15 segundos');
                break;
            case 'forward_15':
                console.log('Comando recebido: Avançar 15 segundos');
                break;
            case 'limpar':
                estadoGlobal.fila = [];
                estadoGlobal.midiaAtual = null;
                estadoGlobal.reproduzindo = false;
                break;
            default:
                console.log('Comando desconhecido:', cmd);
                break;
        }
    }
    broadcastEstado();
}

// Rotas HTTP auxiliares
app.post('/enviar', (req, res) => {
    const { url, titulo } = req.body;
    if (url) {
        processarAcao({ tipo: 'midia', url, titulo });
        return res.status(200).json({ sucesso: true, mensagem: 'Mídia adicionada com sucesso.' });
    }
    res.status(400).json({ sucesso: false, erro: 'URL não informada.' });
});

app.post('/controle', (req, res) => {
    const { comando, slink } = req.body;
    const acao = comando || slink;
    if (acao) {
        processarAcao({ tipo: 'comando', comando: acao });
        return res.status(200).json({ sucesso: true, comando: acao });
    }
    res.status(400).json({ sucesso: false, erro: 'Comando não informado.' });
});

app.get('/', (req, res) => {
    res.send('X-Stream Server rodando perfeitamente!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor X-Stream rodando na porta ${PORT}`);
});
