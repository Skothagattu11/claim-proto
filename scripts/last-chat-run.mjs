// Print the latest chat execution: question, tool calls in order, and the orchestrator's answer.
//   node scripts/last-chat-run.mjs [afterExecutionId]
import { api } from './n8n-api.mjs';

const after = Number(process.argv[2] || 0);
let e;
for (let i = 0; i < 60; i++) {
  const page = await api('GET', '/executions?limit=1&includeData=true');
  e = page.data[0];
  if (e && Number(e.id) > after && e.status !== 'running' && e.status !== 'new' && e.finished !== false) break;
  if (e && Number(e.id) > after && ['success', 'error', 'crashed', 'canceled'].includes(e.status)) break;
  await new Promise((r) => setTimeout(r, 3000));
}
const rd = e.data?.resultData ?? {};
const runData = rd.runData ?? {};
const question = runData['2. ASK -- chat with the Claims Desk']?.[0]?.data?.main?.[0]?.[0]?.json?.chatInput;
console.log(`execution ${e.id} | ${e.status} | ${((new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000).toFixed(1)}s`);
console.log(`Q: ${question}`);
if (rd.error) console.log(`ERROR: ${rd.error.message} ${rd.error.description ?? ''}`);

const tools = ['mri_reader_agent', 'get_claim_file', 'search_medical_policy', 'date_diff', 'calculator'];
const calls = [];
for (const t of tools) for (const run of runData[t] ?? []) calls.push({ t, start: run.startTime, input: run.inputOverride?.ai_tool?.[0]?.[0]?.json });
calls.sort((a, b) => a.start - b.start);
console.log('Tool calls:');
for (const c of calls) {
  const q = c.t === 'date_diff' ? JSON.stringify(c.input) : c.input?.query ?? c.input?.input ?? c.input?.Prompt__User_Message_ ?? JSON.stringify(c.input ?? {});
  console.log(`  - ${c.t}: ${String(q).slice(0, 110)}`);
}
const out = runData['Claims Evidence Orchestrator']?.[0]?.data?.main?.[0]?.[0]?.json?.output;
console.log('\nANSWER:\n' + (out ?? '(no output)'));
