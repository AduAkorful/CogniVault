import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const services = [
  { name: 'SIM', cmd: 'node', args: [path.join(__dirname, 'market_simulator.js')] },
  { name: 'RELAYER', cmd: 'node', args: [path.join(__dirname, 'relayer.js')] },
  { name: 'API', cmd: 'node', args: [path.join(__dirname, 'api_server.js')] }
];

const children = [];

function startService(service) {
  console.log(`[RUNNER] Starting service: ${service.name}...`);
  const child = spawn(service.cmd, service.args, {
    cwd: __dirname,
    env: process.env
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) console.log(`[${service.name}] ${line}`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) console.error(`[${service.name}] [ERR] ${line}`);
    });
  });

  child.on('exit', (code, signal) => {
    console.error(`[RUNNER] Service ${service.name} exited with code ${code} and signal ${signal}`);
    cleanupAndExit(code ?? 1);
  });

  children.push({ name: service.name, process: child });
}

let exiting = false;
function cleanupAndExit(code) {
  if (exiting) return;
  exiting = true;
  console.log('[RUNNER] Shutting down all services...');
  children.forEach(child => {
    if (child.process && !child.process.killed) {
      console.log(`[RUNNER] Killing ${child.name}...`);
      child.process.kill('SIGTERM');
    }
  });
  process.exit(code);
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));

services.forEach(startService);
