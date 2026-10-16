// Pull the live workflow from n8n (including edits made in the UI) into n8n/exported/ for review in git.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, ROOT } from './n8n-api.mjs';
import { WORKFLOW_NAME, DATASET } from './build-workflow.mjs';

const list = await api('GET', '/workflows?limit=250');
const hit = list.data.find((w) => w.name === WORKFLOW_NAME);
if (!hit) throw new Error(`Workflow "${WORKFLOW_NAME}" not found in n8n`);

const wf = await api('GET', `/workflows/${hit.id}`);
const { name, nodes, connections, settings } = wf;
const dir = join(ROOT, 'n8n', 'exported');
mkdirSync(dir, { recursive: true });
const file = join(dir, `claims-evidence-desk-${DATASET}.json`);
writeFileSync(file, JSON.stringify({ name, nodes, connections, settings }, null, 2) + '\n');
console.log(`Exported ${hit.id} -> ${file}`);
