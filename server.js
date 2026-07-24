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

// Notifica todos os clientes conectados sobre atualizações no estado
function broadcastEstado() {
    // Calcula o total de clientes conectados para mandar no JSON (compatível com o Android)
    let totalClientes = 0;
    wss.clients.forEach(client => {
        if (client.readyState === 1) totalClientes++;
    });

    const dados = JSON.stringify({
        comando: "ESTADO_TOTAL",
        totalDispositivos: totalClientes,
        ...estadoGlobal
    });

    wss.clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(dados);
        }
    });
}

// Conexão WebSocket
wss.on('connection', (ws) => {
    console.log('Novo cliente conectado via WebSocket.');

    // Envia o estado atual e contagem assim que conecta
    let totalClientes = 0;
    wss.clients.forEach(client => { if (client.readyState === 1) totalClientes++; });

    ws.send(JSON.stringify({
        comando: "ESTADO_TOTAL",
        totalDispositivos: totalClientes,
        ...estadoGlobal
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            processarAcao(data);
        } catch (e) {
            console.error('Erro ao processar mensagem do WebSocket:', e);
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado.');
        broadcastEstado(); // Atualiza contador para os demais
    });
});

// Processamento unificado de comandos e mídias
function processarAcao(dados) {
    // Identifica o tipo de ação vinda do app ou API
    const tipoAcao = dados.tipo || dados.comando || dados.slink;

    if (tipoAcao === 'midia') {
        const novaMidia = {
            url: dados.url,
            titulo: dados.titulo || "Mídia sem título",
            id: dados.id || Date.now().toString()
        };
        estadoGlobal.fila.push(novaMidia);
        if (!estadoGlobal.midiaAtual) {
            estadoGlobal.midiaAtual = novaMidia;
            estadoGlobal.reproduzindo = true;
        }
    } else {
        // Trata comandos de controle ou ações diretas (ex: 'proximo_video', 'next', 'play', etc.)
        const cmd = dados.tipo || dados.comando || dados.slink;

        switch (cmd) {
            case 'play':
                estadoGlobal.reproduzindo = true;
                break;
            case 'pause':
                estadoGlobal.reproduzindo = false;
                break;
            case 'next':
            case 'proximo_video': // <--- CORRIGIDO: Agora atende o Android
                if (estadoGlobal.fila.length > 0) {
                    estadoGlobal.fila.shift();
                    estadoGlobal.midiaAtual = estadoGlobal.fila[0] || null;
                    estadoGlobal.reproduzindo = !!estadoGlobal.midiaAtual;
                }
                break;
            case 'limpar':
                estadoGlobal.fila = [];
                estadoGlobal.midiaAtual = null;
                estadoGlobal.reproduzindo = false;
                break;
            case 'REGISTRAR_DISPOSITIVO':
            case 'DESCONECTAR':
                // Apenas gerencia conexões, não altera estado de mídia, mas atualiza contador
                broadcastEstado();
                return;
            default:
                console.log('Comando desconhecido:', cmd);
                break;
        }
    }
    broadcastEstado();
}

// Rotas HTTP auxiliares
app.post('/enviar', (req, res) => {
    const { url, titulo, id } = req.body;
    if (url) {
        processarAcao({ tipo: 'midia', url, titulo, id });
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

// Rota /status adicionada para testes
app.get('/status', (req, res) => {
    let totalClientes = 0;
    wss.clients.forEach(client => { if (client.readyState === 1) totalClientes++; });
    
    res.status(200).json({
        status: "online",
        clientesConectados: totalClientes,
        estado: estadoGlobal
    });
});

app.get('/', (req, res) => {
    res.send('X-Stream Server rodando perfeitamente!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor X-Stream rodando na porta ${PORT}`);
});
