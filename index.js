import http from 'http';
import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import multicastDns from 'multicast-dns';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PORT = 3000;
const LOCAL_HOSTNAME = 'landu.local';

const parsePort = (value) => {
  if (!value) return null;
  const port = Number.parseInt(value, 10);
  return Number.isNaN(port) || port <= 0 ? null : port;
};

const getPort = () => {
  const args = process.argv.slice(2);
  const flagIndex = args.findIndex((arg) => arg === '--port' || arg === '-p');
  const inline = args.find((arg) => arg.startsWith('--port='));
  return (
    (flagIndex >= 0 ? parsePort(args[flagIndex + 1]) : null) ||
    (inline ? parsePort(inline.split('=')[1]) : null) ||
    parsePort(process.env.PORT) ||
    DEFAULT_PORT
  );
};

const PORT = getPort();
const app = express();
const clientDir = path.resolve(__dirname, 'client');
const clients = new Map();

const localIpv4Addresses = () =>
  Object.values(os.networkInterfaces()).flatMap((values) =>
    (values || [])
      .filter((info) => info.family === 'IPv4' && !info.internal)
      .map((info) => info.address),
  );

const sameDnsName = (name, expected) => name?.replace(/\.$/, '').toLowerCase() === expected;
const localUrl = (host) => `http://${host}${PORT === 80 ? '' : `:${PORT}`}`;

const startLocalMdns = () => {
  let mdns;
  try {
    mdns = multicastDns({ reuseAddr: true });
  } catch (error) {
    console.warn(`mDNS disabled: ${error.message}`);
    return;
  }
  mdns.on('query', (query) => {
    const wantsLandu = query.questions?.some(
      (question) =>
        sameDnsName(question.name, LOCAL_HOSTNAME) &&
        (question.type === 'A' || question.type === 'ANY'),
    );
    if (!wantsLandu) return;
    const answers = localIpv4Addresses().map((address) => ({
      name: LOCAL_HOSTNAME,
      type: 'A',
      ttl: 120,
      data: address,
    }));
    if (answers.length) mdns.respond({ answers });
  });
  mdns.on('error', (error) => {
    console.warn(`mDNS disabled: ${error.message}`);
  });
  process.once('exit', () => mdns.destroy());
};

const decodeInfo = (value = '') => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
};

const send = (client, message) => {
  if (client?.ws.readyState === 1) client.ws.send(JSON.stringify(message));
};

const peerInfo = ({ id, info }) => {
  const { pin, ...publicInfo } = info;
  return { id, ...publicInfo };
};

const samePin = (left, right) => (left.info.pin || '') === (right.info.pin || '');

const peersFor = (client) =>
  [...clients.values()]
    .filter((peer) => peer.id !== client.id && samePin(peer, client))
    .map(peerInfo);

const broadcast = (message, sourceClient) => {
  for (const client of clients.values()) {
    if (client.id !== sourceClient.id && samePin(client, sourceClient)) send(client, message);
  }
};

app.use(express.static(clientDir));
app.get('/api/addresses', (req, res) => {
  const addresses = localIpv4Addresses();
  res.json({
    mdns: localUrl(LOCAL_HOSTNAME),
    ip: addresses[0] ? localUrl(addresses[0]) : '',
    addresses: addresses.map(localUrl),
  });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text) {
    res.status(400).send('missing text');
    return;
  }
  res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 1, width: 180 }));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const id = crypto.randomUUID();
  const params = new URL(req.url, 'http://localhost').searchParams;
  const rawInfo = decodeInfo(params.get('d'));
  if (!rawInfo.token?.startsWith?.('landu:')) {
    ws.close();
    return;
  }
  const info = {
    alias: 'Unknown Device',
    version: '2.1',
    deviceModel: 'Web',
    deviceType: 'WEB',
    pin: '',
    ...rawInfo,
  };
  const client = { id, ws, info };
  clients.set(id, client);

  send(client, { type: 'HELLO', client: peerInfo(client), peers: peersFor(client) });
  broadcast({ type: 'JOIN', peer: peerInfo(client) }, client);

  ws.on('message', (raw) => {
    if (!raw.length) return;
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'UPDATE') {
      client.info = { ...client.info, ...(message.info || {}) };
      broadcast({ type: 'UPDATE', peer: peerInfo(client) }, client);
      return;
    }

    if (message.type === 'RELAY') {
      const target = clients.get(message.target);
      if (target && samePin(target, client)) send(target, { type: 'RELAY', peer: peerInfo(client), payload: message.payload });
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    broadcast({ type: 'LEFT', peerId: id }, client);
  });
});

server.listen(PORT, () => {
  startLocalMdns();
  const urls = new Set([localUrl('localhost'), localUrl(LOCAL_HOSTNAME)]);
  for (const address of localIpv4Addresses()) urls.add(localUrl(address));
  console.log('Landu listening:');
  for (const url of urls) console.log(`  ${url}`);
});
