# Claims Evidence Desk (Knee MRI RAG + Agents)

The n8n workflow from `Claims_Evidence_Desk_n8n_Build_Guide.pdf`, built in code with n8n's official
`@n8n/workflow-sdk` and deployed through the n8n REST API. After deploying, manage it in the n8n UI as usual.

## Changes from the guide (found by end-to-end testing)

| Guide | Here | Why |
|---|---|---|
| Claim files in a vector store, searched by `search_claim_files` | `get_claim_file` Code tool returns the whole file by claim ID | Search returned the same section of *every* claim and dropped sections of the requested one (missed an injury, a "catching vs locking" description) |
| `calculator` for date maths | `date_diff` Code tool (exact days/weeks); calculator kept for plain arithmetic | The calculator read `2026-09-14 - 2026-07-20` as subtraction and returned `4` |
| Orchestrator on `gpt-4o-mini` | `gpt-4.1-mini` (the guide's "better reasoning" option); reader stays on `gpt-4o-mini` | 4o-mini treated "189 days" as meeting a 90-day limit |
| Prompt checks the criteria it thinks are relevant | Prompt requires every criterion + exclusion, value-vs-limit for numbers, policy definitions over physician labels | Missed exclusions; accepted leading questions ("does X rule it out?") |

The workflow has 17 nodes (the claims ingest branch is gone; INGEST loads only the policy).

## Datasets

| `DATASET` | Policy | Claims | Expected answers |
|---|---|---|---|
| `guide` (default) | MP-KNEE-07 (guide Appendix C) | CLM-1001..1003 (Appendix D) | guide Appendix E |
| `payer-sample` | MP-KNEE-08: synthetic, modelled on public payer knee-MRI criteria (wording original) | CLM-2001..2005 edge cases | `data/payer-sample/expected.md` |

All data is synthetic. A dataset can override any file in `prompts/` via `data/<dataset>/prompts/`.

| Path | What it is |
|---|---|
| `scripts/build-workflow.mjs` | The workflow definition, validated by the SDK |
| `prompts/` | System prompts and tool descriptions |
| `scripts/deploy.mjs` / `export.mjs` | Push to n8n / pull UI edits back into `n8n/exported/` |
| `scripts/last-chat-run.mjs` | Prints the latest chat run: tool calls in order + answer |
| `docs/n8n-build-guide-review.md` | Review of the guide |

## Run locally

```bash
npm install
npm run n8n                                   # pinned n8n 2.42.7 on Node 24, http://localhost:5678 (127.0.0.1 only)
npm run deploy                                # guide dataset
DATASET=payer-sample npm run deploy           # MP-KNEE-08 dataset (PowerShell: $env:DATASET="payer-sample"; npm run deploy)
```

First time: create the owner account in the UI, then **Settings → n8n API → Create API key**.
Copy `.env.example` to `.env` and fill in `N8N_API_KEY` and `OPENAI_API_KEY`.

## Use it

1. Open the workflow and click **Execute workflow** (loads the policy). Repeat after every n8n restart: the Simple Vector Store lives in memory.
2. Click **Open chat** and ask a test question, e.g. `Claim CLM-1001: is the knee MRI medically necessary under MP-KNEE-07?`
3. **Logs** panel (or `node scripts/last-chat-run.mjs`) shows each tool call and what came back.

## n8n Cloud

Import `n8n/claims-evidence-desk-<dataset>.json` (*⋯ → Import from File*) and pick the OpenAI credential on the
OpenAI nodes, or set `N8N_URL`/`N8N_API_KEY` in `.env` to your Cloud instance and run `npm run deploy` (needs a plan with the n8n API).
