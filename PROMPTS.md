# ContextFabric Prompt Engineering

This document records the Gemma 4 extraction prompt used by ContextFabric and the decisions behind it.

## Goal

ContextFabric uses Gemma 4 locally to turn messy user-owned text into structured memory nodes. The model is not asked to chat. It is asked to extract durable facts that another AI assistant should remember later.

## Extraction Schema

The canonical node types are:

- `project`: what the user is building, maintaining, researching, or planning.
- `style`: how the user writes, communicates, designs, codes, or prefers answers to be shaped.
- `decision`: a choice already made, including reasoning, rejected alternatives, tradeoffs, or reversibility.
- `preference`: a stable working preference, constraint, tool choice, privacy preference, format preference, or habit.
- `person`: a collaborator, stakeholder, user, client, author, or named human with relationship or role context.

Every extracted node includes:

- `type`
- `title`
- `summary`
- `confidence` from `0.0` to `1.0`
- `evidence`
- `entities`
- `tags`
- `metadata`

## Current Prompt

The production prompt is defined in [contextExtraction.ts](src/shared/contextExtraction.ts) as `CONTEXT_EXTRACTION_SYSTEM_PROMPT`.

The prompt requires JSON only, caps output to six nodes, and tells Gemma 4 to drop weak guesses below `0.55` confidence.

## Why JSON Only

ContextFabric stores extracted memory in a graph database. The app needs predictable machine-readable output, not prose. The parser accepts plain JSON, repairs common markdown fences/trailing commas, validates node types, clamps confidence, and drops invalid or weak nodes.

## Why Confidence Scores

The graph should distinguish directly stated facts from softer inference. The prompt uses:

- `0.85+` when the input states the fact clearly.
- `0.55-0.84` when the node is a reasonable direct inference.
- below `0.55` for weak guesses, which the parser drops.

## Retry Strategy

The first Gemma 4 response is parsed with schema validation. If invalid, ContextFabric sends the original prompt plus the validation errors and asks Gemma 4 to return corrected JSON only. If the repaired output is still invalid, the app keeps the raw source node and skips extracted child nodes instead of corrupting memory.

## Input Types Tested

The parser and benchmark cover:

- conversation
- notes
- code comments
- bullet points
- prose

Run:

```bash
npm run test:extraction
npm run benchmark:extraction
```

## Design Tradeoffs

The first sync path stays fast by saving raw chunks and deterministic hash embeddings immediately. Gemma 4 extraction runs during background enrichment. That makes the app usable right away while still upgrading the graph with real typed context nodes when the local model is available.

## Conflict Detection

The conflict detector prompt is defined in [conflictDetection.ts](src/shared/conflictDetection.ts) as `CONFLICT_DETECTION_PROMPT`.

It compares one existing memory node with one new memory node and returns JSON with:

- `conflict`
- `maybe`
- `confidence`
- `type`
- `severity`
- `reason`
- `suggestedResolution`

The `maybe` flag is required because personal context often changes by project, time, or scope. For example, "prefer concise answers" and "prefer detailed implementation notes" may be a true conflict, or they may both be valid in different situations. ContextFabric stores those uncertain cases for user review instead of deleting memory automatically.

Run:

```bash
npm run test:conflicts
```
