const WebSocket = require('ws');
const http = require('http');

// Cria um servidor HTTP básico para o Render não derrubar a aplicação por inatividade
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('X-Stream Server Rodando com Sucesso!\n');
});

// Inicializa o WebSocket na mesma porta do HTTP
const wss = new WebSocket.Server({ server });

let ultimoLinkRecebido = null;

wss.on('connection', (ws) => {
    console.log('Novo cliente conectado!');

    // Se já houver um vídeo rodando e um novo player se conectar, envia o link atual para ele sincronizar na hora
    if (ultimoLinkRecebido) {
        ws.send(JSON.stringify({ tipo: 'midia', url: ultimoLinkRecebido }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensagem recebida:', data);

            // Se for um link de mídia, guarda na memória para quem chegar depois
            if (data.tipo === 'midia' && data.url) {
                ultimoLinkRecebido = data.url;
            }

            // Repassa a mensagem (link ou comando de controle) para TODOS os clientes conectados (Browser e Player)
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });

        } catch (e) {
            console.error('Erro ao processar mensagem JSON:', e);
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado.');
    });
});

// Porta padrão fornecida pelo serviço de hospedagem (Render) ou 3000 localmente
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
