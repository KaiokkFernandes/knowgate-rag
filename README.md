# KnowGate

> Internal knowledge assistant that answers from company documents **with citations**, shows each
> user **only what their team can see**, and **masks personal data** before anything reaches the LLM.

**Status:** phase 1a — monorepo skeleton, local infrastructure and health check.

## The problem

Company knowledge is scattered across PDFs, policies and manuals. Plugging a generic AI assistant on
top of it creates two new risks: leaking documents across teams (or across companies, in a SaaS) and
sending personal data (CPF, e-mail, phone) to a third-party model. KnowGate answers only from the
documents the user is allowed to read, cites the source of every answer, says "not found" instead of
inventing, and tracks LLM cost per organization with a daily limit.

## Architecture

```
apps/web  (Next.js: chat + admin panel)
     │ HTTP (JWT)
apps/api  (NestJS)
   ├── auth        → JWT, organizations, teams, roles (ADMIN, MEMBER)
   ├── documents   → upload, parsing, chunking, contextualization, embeddings
   ├── retrieval   → hybrid search (pgvector + full-text) with access filter
   ├── chat        → Claude answers with citations, conversations
   ├── privacy     → personal data masking
   └── usage       → tokens, cost, daily limit (Redis)
     │
   ├── PostgreSQL + pgvector (data, vectors, full-text)
   ├── Redis (usage limits, cache)
   ├── Voyage AI (embeddings)
   └── Claude API (answers, Contextual Retrieval)

apps/mcp  (MCP server) → exposes KnowGate search as a tool, same access rules
packages/shared        → types and Zod schemas shared by api and web
```

## Running locally

Requirements: **Node 26** (`nvm use`), **pnpm 12** and **Docker** with Compose.

```bash
pnpm install
cp .env.example .env          # then edit the values
docker compose up -d          # Postgres (pgvector) + Redis, with healthchecks
pnpm dev                      # api on :3001, web on :3000
curl http://localhost:3001/health
```

`GET /health` returns `200` when Postgres and Redis respond, and `503` with the failing dependency
otherwise.

### Scripts (root)

| Script              | What it does                                  |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Builds `shared`, then runs every app in watch |
| `pnpm build`        | Builds every package in dependency order      |
| `pnpm lint`         | ESLint in every package                       |
| `pnpm typecheck`    | `tsc --noEmit` in every package               |
| `pnpm test`         | Unit tests (Jest)                             |
| `pnpm format:check` | Prettier check                                |

## Technical decisions

To be documented as the project evolves: chunk size, hybrid search with RRF, pgvector instead of a
dedicated vector database, tenant isolation, masking and LLM cost control.

---

## Em português

KnowGate é um assistente de conhecimento interno: responde com base nos documentos da empresa,
cita a fonte, respeita a visibilidade por time e mascara dados pessoais antes de chamar o modelo.
Projeto de portfólio, desenvolvido em fases (veja o status no topo).
