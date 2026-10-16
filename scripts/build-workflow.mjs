// Claims Evidence Desk (Knee MRI RAG + Agents), built in code with @n8n/workflow-sdk.
// Mirrors the 22-node map in the build guide (section 3). Prompts and sample data
// live in prompts/ and data/ so they can be edited without touching this file.
//
//   node scripts/build-workflow.mjs   -> validates and writes n8n/claims-evidence-desk-<DATASET>.json
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  languageModel,
  memory,
  tool,
  embedding,
  documentLoader,
  textSplitter,
  expr,
} from '@n8n/workflow-sdk';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CREDENTIAL_NAME = 'OpenAI - Claims Desk';

// DATASET picks data/<name>/ (policy, claims, dataset.json, optional prompt overrides).
//   guide        - the build guide's MP-KNEE-07 sample (default)
//   payer-sample - MP-KNEE-08, modelled on public payer knee-MRI criteria
export const DATASET = process.env.DATASET || 'guide';
const DATA_DIR = join(ROOT, 'data', DATASET);
const dataset = JSON.parse(readFileSync(join(DATA_DIR, 'dataset.json'), 'utf8'));
export const WORKFLOW_NAME = dataset.workflowName;

const EMBEDDING_MODEL = 'text-embedding-3-small'; // must be identical on both embeddings nodes (ingest + query)
const READER_MODEL = 'gpt-4o-mini'; // extraction only
const ORCHESTRATOR_MODEL = 'gpt-4.1-mini'; // guide's "better reasoning" option; 4o-mini misjudged thresholds in testing
const CHAT_WEBHOOK_ID = 'b7f1c2d4-9a3e-4c5b-8f6d-1e2a3b4c5d6e';

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').trim();
const readData = (...p) => readFileSync(join(DATA_DIR, ...p), 'utf8').trim();
// A dataset can override any prompt by placing a file with the same name in data/<name>/prompts/.
const readPrompt = (file) =>
  existsSync(join(DATA_DIR, 'prompts', file)) ? readData('prompts', file) : read('prompts', file);
const MEMORY_KEYS = {
  policy: `medical_policy${dataset.memoryKeySuffix}`,

};

// Text is pasted inside a JS template literal in the Code nodes, as in the guide.
function asTemplateLiteral(text, source) {
  if (text.includes('`') || text.includes('${')) {
    throw new Error(`${source} contains a backtick or "\${" - remove it (see guide troubleshooting)`);
  }
  return '`' + text + '`';
}

export function buildWorkflow({ credentialId } = {}) {
  const openAi = {
    openAiApi: credentialId ? { id: credentialId, name: CREDENTIAL_NAME } : newCredential(CREDENTIAL_NAME),
  };

  const openAiEmbeddings = (name) =>
    embedding({
      type: '@n8n/n8n-nodes-langchain.embeddingsOpenAi',
      version: 1.2,
      config: { name, parameters: { model: EMBEDDING_MODEL, options: {} }, credentials: openAi },
    });

  const openAiChatModel = (name, model, temperature) =>
    languageModel({
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
      version: 1.3,
      config: {
        name,
        parameters: {
          model: { __rl: true, mode: 'list', value: model },
          options: { temperature },
        },
        credentials: openAi,
      },
    });

  const splitter = (name) =>
    textSplitter({
      type: '@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter',
      version: 1,
      config: { name, parameters: { chunkSize: 800, chunkOverlap: 100, options: {} } },
    });

  const loader = (name, metadataFields) =>
    documentLoader({
      type: '@n8n/n8n-nodes-langchain.documentDefaultDataLoader',
      version: 1.1,
      config: {
        name,
        parameters: {
          dataType: 'json',
          jsonMode: 'expressionData',
          jsonData: expr('{{ $json.text }}'),
          textSplittingMode: 'custom',
          options: {
            metadata: {
              metadataValues: metadataFields.map((f) => ({ name: f, value: expr(`{{ $json.${f} }}`) })),
            },
          },
        },
        subnodes: { textSplitter: splitter(name.replace('Loader', 'Splitter')) },
      },
    });

  const insertStore = (name, memoryKey, embeddingsName, loaderNode) =>
    node({
      type: '@n8n/n8n-nodes-langchain.vectorStoreInMemory',
      version: 1.3,
      config: {
        name,
        parameters: {
          mode: 'insert',
          memoryKey: { __rl: true, mode: 'id', value: memoryKey },
          clearStore: true, // re-running INGEST never duplicates chunks
        },
        subnodes: { embedding: openAiEmbeddings(embeddingsName), documentLoader: loaderNode },
      },
    });

  const retrieveTool = (name, memoryKey, description, topK, embeddingsName) =>
    tool({
      type: '@n8n/n8n-nodes-langchain.vectorStoreInMemory',
      version: 1.3,
      config: {
        name, // in v1.3 the node name is the tool name the agent sees
        parameters: {
          mode: 'retrieve-as-tool',
          toolDescription: description,
          memoryKey: { __rl: true, mode: 'id', value: memoryKey },
          topK,
          includeDocumentMetadata: true,
        },
        subnodes: { embedding: openAiEmbeddings(embeddingsName) },
      },
    });

  // ---------------- Section 1: INGEST (Steps 2-3) ----------------

  const ingestTrigger = trigger({
    type: 'n8n-nodes-base.manualTrigger',
    version: 1,
    config: { name: '1. INGEST -- load documents' },
  });

  const policyText = node({
    type: 'n8n-nodes-base.code',
    version: 2,
    config: {
      name: `Policy ${dataset.policyId} (text)`,
      parameters: {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `const policyText = ${asTemplateLiteral(readData('policy.txt'), 'policy')};

return [{
  json: {
    text: policyText,
    doc_id: '${dataset.policyId}',
    doc_type: 'medical_policy'
  }
}];`,
      },
    },
  });

  const insertPolicy = insertStore(
    'Insert policy chunks',
    MEMORY_KEYS.policy,
    'Embeddings (policy ingest)',
    loader('Policy Loader', ['doc_id', 'doc_type']),
  );

  // Claim files are NOT put in a vector store: similarity search returned the same section
  // of every claim and dropped sections of the requested one. get_claim_file returns the
  // whole file by ID instead (a real deployment would read it from the claims system).
  const claimEntries = readdirSync(join(DATA_DIR, 'claims'))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => `  '${f.replace(/\.txt$/, '')}': ${asTemplateLiteral(readData('claims', f), f)},`)
    .join('\n');

  const getClaimFile = tool({
    type: '@n8n/n8n-nodes-langchain.toolCode',
    version: 1.3,
    config: {
      name: 'get_claim_file',
      parameters: {
        description: readPrompt('tool-get_claim_file.md'),
        language: 'javaScript',
        jsCode: [
          '// Synthetic claim files (data/<dataset>/claims), keyed by claim ID.',
          'const claims = {',
          claimEntries,
          '};',
          '',
          "const id = (String(query).toUpperCase().match(/CLM-\\d+/) || [])[0];",
          "if (!id) return 'No claim ID found in the request. Use the format CLM-####.';",
          "if (!claims[id]) return 'Claim ' + id + ' not found. Known claims: ' + Object.keys(claims).join(', ');",
          'return claims[id];',
        ].join('\n'),
      },
    },
  });

  const dateDiff = tool({
    type: '@n8n/n8n-nodes-langchain.toolCode',
    version: 1.3,
    config: {
      name: 'date_diff',
      parameters: {
        description: readPrompt('tool-date_diff.md'),
        language: 'javaScript',
        specifyInputSchema: true,
        schemaType: 'fromJson',
        jsonSchemaExample: '{\n  "start_date": "2026-07-20",\n  "end_date": "2026-09-21"\n}',
        jsCode: [
          'const toUtc = (s) => {',
          "  const m = String(s).trim().match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);",
          '  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;',
          '};',
          'const start = toUtc(query.start_date);',
          'const end = toUtc(query.end_date);',
          "if (isNaN(start) || isNaN(end)) return 'Dates must be YYYY-MM-DD, got: ' + JSON.stringify(query);",
          'const days = Math.round((end - start) / 86400000);',
          'return JSON.stringify({',
          '  start_date: query.start_date,',
          '  end_date: query.end_date,',
          '  days,',
          '  weeks: Math.round((days / 7) * 10) / 10,',
          '  full_weeks: Math.trunc(days / 7),',
          '});',
        ].join('\n'),
      },
    },
  });

  // ---------------- Section 2: ASK (Steps 4-7) ----------------

  const chatTrigger = trigger({
    type: '@n8n/n8n-nodes-langchain.chatTrigger',
    version: 1.5,
    config: {
      name: '2. ASK -- chat with the Claims Desk',
      parameters: { public: false, options: {} },
    },
  });

  const mriReader = tool({
    type: '@n8n/n8n-nodes-langchain.agentTool',
    version: 3,
    config: {
      name: 'mri_reader_agent',
      parameters: {
        toolDescription: readPrompt('tool-mri_reader_agent.md'),
        text: "={{ $fromAI('Prompt__User_Message_', ``, 'string') }}",
        options: { systemMessage: readPrompt('mri-reader-system.md'), maxIterations: 6 },
      },
      subnodes: {
        model: openAiChatModel('OpenAI Chat Model (MRI reader)', READER_MODEL, 0),
        // No memory: every call starts fresh so facts never leak between claims.
        tools: [getClaimFile],
      },
    },
  });

  const orchestrator = node({
    type: '@n8n/n8n-nodes-langchain.agent',
    version: 3.1,
    config: {
      name: 'Claims Evidence Orchestrator',
      parameters: {
        // The chat message, plus a per-turn reminder when it names a claim: in testing the model
        // sometimes answered follow-ups from chat memory without reading the claim file.
        promptType: 'define',
        text:
          "={{ $json.chatInput }}{{ (m => m ? '\\n\\n[Reminder: call mri_reader_agent for ' + m[0].toUpperCase() + " +
          "' in this turn before answering.]' : '')($json.chatInput.match(/CLM-\\d+/i)) }}",
        options: { systemMessage: readPrompt('orchestrator-system.md'), maxIterations: 10 },
      },
      subnodes: {
        model: openAiChatModel('OpenAI Chat Model (orchestrator)', ORCHESTRATOR_MODEL, 0.2),
        memory: memory({
          type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
          version: 1.4,
          config: {
            name: 'Simple Memory (window = 5)',
            parameters: { sessionIdType: 'fromInput', contextWindowLength: 5 },
          },
        }),
        tools: [
          tool({
            type: '@n8n/n8n-nodes-langchain.toolCalculator',
            version: 1,
            config: { name: 'calculator', parameters: {} },
          }),
          dateDiff,
          retrieveTool(
            'search_medical_policy',
            MEMORY_KEYS.policy,
            readPrompt('tool-search_medical_policy.md'),
            4,
            'Embeddings (policy query)',
          ),
          mriReader,
        ],
      },
    },
  });

  // ---------------- Step 8A: sticky notes ----------------

  const ingestNote = sticky(
    `## 1 · INGEST -- split the policy into chunks\nRun once (and after every n8n restart). Loads ${dataset.policyId} into \`${MEMORY_KEYS.policy}\`. Claim files are read whole by get_claim_file, not searched.`,
    [ingestTrigger, policyText, insertPolicy],
    { color: 7 },
  );
  const askNote = sticky(
    `## 2 · ASK -- AI drafts, human decides\nOrchestrator agent → calls the MRI Reader sub-agent (reads the full claim file via get_claim_file), search_medical_policy (RAG over ${dataset.policyId}), date_diff (exact day counts) and calculator. Output is a draft rationale with policy citations -- never a decision.`,
    [chatTrigger, orchestrator],
    { color: 5 },
  );

  const wf = workflow('claims-evidence-desk', WORKFLOW_NAME)
    .add(ingestTrigger)
    .to(policyText)
    .to(insertPolicy)
    .add(chatTrigger)
    .to(orchestrator)
    .add(ingestNote)
    .add(askNote);

  const result = wf.validate();
  const errors = result.errors ?? [];
  for (const w of result.warnings ?? []) console.warn(`warning: ${w.message ?? JSON.stringify(w)}`);
  if (errors.length) {
    throw new Error('Workflow validation failed:\n' + errors.map((e) => `- ${e.message ?? JSON.stringify(e)}`).join('\n'));
  }

  const json = wf.toJSON({ tidyUp: true });
  json.settings = { executionOrder: 'v1', ...(json.settings ?? {}) };
  // The SDK does not emit webhookId; fix it so the chat URL survives redeploys.
  json.nodes.find((n) => n.name === chatTrigger.name).webhookId = dataset.chatWebhookId ?? CHAT_WEBHOOK_ID;
  return json;
}

// Run directly: build and write the JSON (no credential id -> placeholder credential).
//   --cloud  leave the credential empty (ids differ per instance) and write to n8n/cloud/ for
//            "Import from File" on another instance such as n8n Cloud.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cloud = process.argv.includes('--cloud');
  const wf = buildWorkflow({ credentialId: cloud ? undefined : process.env.N8N_OPENAI_CREDENTIAL_ID });
  const dir = join(ROOT, 'n8n', ...(cloud ? ['cloud'] : []));
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `claims-evidence-desk-${DATASET}.json`);
  writeFileSync(out, JSON.stringify(wf, null, 2) + '\n');
  const real = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
  console.log(`Wrote ${out}: ${real.length} nodes (+ ${wf.nodes.length - real.length} sticky notes)`);
}
