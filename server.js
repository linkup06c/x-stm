const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

let estadoGlobal = {
    reproduzindo: false,
    midiaAtual: null,
    fila: []
};

function broadcastEstado() {
    const totalOnline = wss.clients ? wss.clients.size : 0;
    const dados = JSON.stringify({
        comando: "ESTADO_TOTAL",
        online: totalOnline,
        ...estadoGlobal
    });

    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            try { client.send(dados); } catch (e) {}
        }
    });
}

wss.on('connection', (ws) => {
    broadcastEstado();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            processarAcao(data);
        } catch (e) {}
    });

    ws.on('close', () => {
        broadcastEstado();
    });
});

function processarAcao(dados) {
    if (dados.tipo === 'midia') {
        const novaMidia = {
            url: dados.url,
            titulo: dados.titulo || "Mídia"
        };
        estadoGlobal.fila.push(novaMidia);
        if (!estadoGlobal.midiaAtual) {
            estadoGlobal.midiaAtual = novaMidia;
            estadoGlobal.reproduzindo = true;
        }
    } else if (dados.tipo === 'comando' || dados.comando) {
        const cmd = dados.comando || dados.slink;
        if (cmd === 'play') estadoGlobal.reproduzindo = true;
        if (cmd === 'pause') estadoGlobal.reproduzindo = false;
        if (cmd === 'limpar') {
            estadoGlobal.fila = [];
            estadoGlobal.midiaAtual = null;
            estadoGlobal.reproduzindo = false;
        }
    }
    broadcastEstado();
}

app.post('/enviar', (req, res) => {
    const { url, titulo } = req.body;
    if (url) {
        processarAcao({ tipo: 'midia', url, titulo });
        return res.status(200).json({ sucesso: true });
    }
    res.status(400).json({ sucesso: false });
});

app.post('/controle', (req, res) => {
    const { comando, slink } = req.body;
    const acao = comando || slink;
    if (acao) {
        processarAcao({ tipo: 'comando', comando: acao });
        return res.status(200).json({ sucesso: true });
    }
    res.status(400).json({ sucesso: false });
});

app.get('/', (req, res) => res.send('Server X-Stream OK'));

const PORT = process.env.PORT || 3000;
server.listen(PORT);
