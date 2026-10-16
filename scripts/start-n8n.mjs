// Start the pinned local n8n (installed in .n8n-runtime) on Node 24, with data kept in ./.n8n-data.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(ROOT, '.n8n-runtime', 'node_modules');
const node24 = join(runtime, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
const n8nBin = join(runtime, 'n8n', 'bin', 'n8n');

const child = spawn(node24, [n8nBin, 'start'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    N8N_USER_FOLDER: join(ROOT, '.n8n-data'),
    N8N_HOST: 'localhost',
    N8N_PORT: '5678',
    N8N_LISTEN_ADDRESS: '127.0.0.1', // this machine only
    N8N_DIAGNOSTICS_ENABLED: 'false', // no telemetry
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_TEMPLATES_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_SECURE_COOKIE: 'false', // plain http on localhost
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
