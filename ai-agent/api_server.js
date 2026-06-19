import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.join(__dirname, '..', 'state.json');

const PORT = parseInt(process.env.API_PORT || '3100', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/state.json' && req.method === 'GET') {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'state.json not found' }));
    }
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', endpoints: ['/state.json', '/health'] }));
});

server.listen(PORT, () => {
  console.log(`[CogniVault Pipeline API] Serving state.json on port ${PORT}`);
  console.log(`  CORS Origin: ${CORS_ORIGIN}`);
  console.log(`  Endpoints: GET /state.json, GET /health`);
});
