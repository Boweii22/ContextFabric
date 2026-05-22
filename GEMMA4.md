# Gemma 4 Usage in ContextFabric

ContextFabric is built for the DEV Gemma 4 Challenge. Gemma 4 is not decorative in this project; it is the local reasoning engine that turns messy user-owned material into portable AI memory.

## Model Choice

The preferred challenge model is **Gemma 4 E2B via Ollama**.

Why E2B:

- It fits the local-first privacy story: useful enough for extraction and assembly, small enough for edge hardware.
- It supports the challenge goal of running AI locally instead of sending personal context to a cloud service.
- It makes the product easier for judges and users to run on ordinary laptops.

ContextFabric creates a low-memory Ollama profile named `cf-gemma4` from the installed Gemma source model. The app constrains context size and output length so inference remains practical on machines with limited RAM.

If `gemma4:e2b` is not available in the user’s Ollama registry yet, the project supports `gemma4:e4b` as a fallback. The submission should still describe E2B as the intended edge model.

## What Gemma 4 Does

Gemma 4 performs four core jobs:

1. **Context extraction**
   It reads notes, project docs, source chunks, and chat exports, then extracts structured memory nodes.

2. **Conflict detection**
   It compares new memory against existing memory and flags contradictions or uncertain overlaps.

3. **Payload assembly**
   It turns relevant graph nodes into an app-aware context brief for Claude, ChatGPT, Cursor, or a generic AI tool.

4. **Question answering**
   It answers user questions over retrieved local memory with source citations and reasoning steps.

## Node Schema

Gemma 4 extracts five durable memory types:

- `project`: what the user is building or maintaining
- `style`: how the user writes, communicates, designs, or codes
- `decision`: choices already made and why
- `preference`: stable working preferences or constraints
- `person`: collaborators, stakeholders, or relevant people

Every extracted node includes:

- title
- summary
- evidence
- confidence score from `0.0` to `1.0`
- entities
- tags
- metadata

## Privacy Properties

Normal generation happens through Ollama on the user’s machine.

The local daemon binds to loopback:

```text
127.0.0.1:47821
127.0.0.1:7749
```

That means the memory API is reachable from the local computer only, not from the internet. The graph database is encrypted at rest, and context access is logged locally.

## Offline Proof

Run:

```bash
npm run verify:gemma
```

Then disconnect WiFi and run it again:

```bash
npm run verify:gemma
```

If the command still passes, Gemma 4 inference is running locally with zero network egress.

## Prompt Documentation

The production prompt designs are documented in:

- `PROMPTS.md`
- `src/shared/contextExtraction.ts`
- `src/shared/conflictDetection.ts`
- `src/shared/contextAssembly.ts`

The important guardrail is that Gemma may only extract or assemble facts supported by the supplied local memory. If it fails or times out, ContextFabric falls back to deterministic local behavior instead of crashing.
