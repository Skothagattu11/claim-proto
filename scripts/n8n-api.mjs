// Minimal client for the n8n Public REST API (local instance by default).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env (KEY=VALUE lines) without a dependency.
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const N8N_URL = (process.env.N8N_URL || 'http://localhost:5678').replace(/\/$/, '');

export async function api(method, path, body) {
  const key = process.env.N8N_API_KEY;
  if (!key) throw new Error('N8N_API_KEY is not set (create one in n8n: Settings > n8n API, then put it in .env)');
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return data;
}
