// Build the workflow from prompts/ + data/ and create or update it in n8n via the Public API.
//   node scripts/deploy.mjs            create/update (by workflow name)
//   node scripts/deploy.mjs --activate also activate it (needed for the public chat URL)
import { writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { api, ROOT, N8N_URL } from './n8n-api.mjs';
import { buildWorkflow, CREDENTIAL_NAME, DATASET } from './build-workflow.mjs';

async function ensureOpenAiCredential() {
  if (process.env.N8N_OPENAI_CREDENTIAL_ID) return process.env.N8N_OPENAI_CREDENTIAL_ID;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      'No OPENAI_API_KEY or N8N_OPENAI_CREDENTIAL_ID in .env: deploying without a credential. ' +
        'The workflow will open in n8n but cannot run until you add the key and deploy again.',
    );
    return undefined;
  }
  const cred = await api('POST', '/credentials', {
    name: CREDENTIAL_NAME,
    type: 'openAiApi',
    data: { apiKey },
  });
  // Remember the id so re-deploys reuse the same credential.
  const envFile = join(ROOT, '.env');
  const prefix = existsSync(envFile) && !readFileSync(envFile, 'utf8').endsWith('\n') ? '\n' : '';
  appendFileSync(envFile, `${prefix}N8N_OPENAI_CREDENTIAL_ID=${cred.id}\n`);
  console.log(`Created credential "${CREDENTIAL_NAME}" (${cred.id}) and saved its id to .env`);
  return cred.id;
}

async function findWorkflowByName(name) {
  let cursor;
  do {
    const page = await api('GET', `/workflows?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
    const hit = page.data.find((w) => w.name === name);
    if (hit) return hit;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

const credentialId = await ensureOpenAiCredential();
const wf = buildWorkflow({ credentialId });
writeFileSync(join(ROOT, 'n8n', `claims-evidence-desk-${DATASET}.json`), JSON.stringify(wf, null, 2) + '\n');

// The Public API accepts only these top-level fields.
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
const existing = await findWorkflowByName(wf.name);
const saved = existing
  ? await api('PUT', `/workflows/${existing.id}`, body)
  : await api('POST', '/workflows', body);
console.log(`${existing ? 'Updated' : 'Created'} workflow "${saved.name}" -> ${N8N_URL}/workflow/${saved.id}`);

if (process.argv.includes('--activate')) {
  await api('POST', `/workflows/${saved.id}/activate`);
  console.log('Activated.');
}
