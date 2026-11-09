# KnowGate

[![CI](https://github.com/KaiokkFernandes/knowgate-rag/actions/workflows/ci.yml/badge.svg)](https://github.com/KaiokkFernandes/knowgate-rag/actions/workflows/ci.yml)

> Internal knowledge assistant that answers from company documents **with citations**, shows each
> user **only what their team can see**, and **masks personal data** before anything reaches the LLM.

**Status:** phase 2a — document upload, parsing and chunking with team visibility.

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
packages/db            → Prisma schema, migrations and client (shared by api, mcp and scripts)
```

## Running locally

Requirements: **Node 26** (`nvm use`), **pnpm 12** and **Docker** with Compose.

```bash
pnpm install
cp .env.example .env          # then edit the values
docker compose up -d          # Postgres (pgvector) + Redis, with healthchecks
pnpm db:migrate               # apply migrations
pnpm dev                      # api on :3001, web on :3000
curl http://localhost:3001/health
```

`GET /health` returns `200` when Postgres and Redis respond, and `503` with the failing dependency
otherwise.

### Everything in Docker

```bash
cp .env.example .env          # set JWT_SECRET (openssl rand -hex 32) and POSTGRES_PASSWORD
docker compose --profile app up -d --build
```

This builds the images, runs the migrations as a one-shot `migrate` job, then starts the API
(`:3001`) and the web app (`:3000`), each waiting for its dependencies to be healthy. Set
`COMPOSE_PROFILES=app` in `.env` to make it the default for `docker compose up`.

On a fresh clone, run `pnpm build` once before `pnpm lint` or `pnpm typecheck`: they resolve
`@knowgate/shared` from its build output and need the generated Prisma client.

### Scripts (root)

| Script                  | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| `pnpm dev`              | Builds `shared`, then runs every app in watch    |
| `pnpm build`            | Builds every package in dependency order         |
| `pnpm lint`             | ESLint in every package                          |
| `pnpm typecheck`        | `tsc --noEmit` in every package                  |
| `pnpm test`             | Unit tests (Jest)                                |
| `pnpm test:integration` | Integration tests (Testcontainers, needs Docker) |
| `pnpm db:migrate`       | Create/apply migrations (`prisma migrate dev`)   |
| `pnpm db:generate`      | Generate the Prisma client                       |
| `pnpm db:reset`         | Drop the dev database and re-apply migrations    |
| `pnpm db:studio`        | Open Prisma Studio                               |
| `pnpm format:check`     | Prettier check                                   |

## Technical decisions

### Database

- **PostgreSQL + pgvector** instead of a dedicated vector database: the domain is relational
  (organizations, teams, roles, visibility), a document and its chunks are written in one
  transaction, and Row Level Security can be added as a second isolation layer.
- **Tenant-safe composite foreign keys:** `Chunk`, `DocumentTeam` and `TeamMember` reference
  `(organizationId, id)`, so the database itself rejects a chunk whose organization differs from
  its document, or a document shared with another organization's team.
- **Embeddings:** Voyage `voyage-4-large`, 1024 dimensions, HNSW index with cosine distance.
  Voyage vectors are unit-length (cosine and inner product rank identically); cosine stays
  correct for non-normalized vectors such as test fakes.
- **Full-text:** a `portuguese_unaccent` text search configuration (unaccent as a dictionary,
  then Portuguese stemming) feeding a `STORED` generated `tsvector` column with a GIN index.
- **Prisma and hand-written SQL:** Prisma cannot represent the HNSW index or the generated
  column and would drop them on every new migration, so `Chunk` is declared as an external table
  (`prisma.config.ts`) and its DDL is written by hand. An integration test fails if Prisma ever
  detects drift.
- **Ids:** UUIDv7 generated by Postgres 18 (`uuidv7()`), time-ordered for B-tree locality.

### Authentication

- **Passwords:** Argon2id with the OWASP minimum parameters (19 MiB, 2 iterations, 1 lane),
  8 to 128 characters (NIST SP 800-63B), automatic rehash on login if parameters get stronger.
- **Access token:** HS256 JWT, 15 minutes, only the user id as claim; algorithm, issuer and
  audience are pinned on verification. Roles are checked per request, never stored in the token,
  so removing a member takes effect immediately.
- **Refresh token:** 32 random bytes in an `httpOnly`, `SameSite=Strict`, `Path=/auth` cookie;
  only its SHA-256 is stored. Rotated on every use; reusing a rotated token revokes every session
  of the user (theft detection). The revocation is a conditional update, so concurrent refreshes
  with the same token cannot both succeed.
- **No account enumeration on login:** the same 401 for unknown e-mail and wrong password, with a
  dummy Argon2 verification so both take the same time.
- **Secure by default:** a global guard requires a token on every route unless it is `@Public()`.
- **Abuse protection:** Helmet headers; rate limit of 100 req/min per IP, 5 req/min on login and
  register (429 with `Retry-After`).

### Organizations and access control

| Endpoint                                               | Who        |
| ------------------------------------------------------ | ---------- |
| `POST /orgs` (creator becomes ADMIN)                   | any user   |
| `GET /orgs/:orgId`, `GET .../members`, `GET .../teams` | members    |
| `POST/PATCH/DELETE .../members[/:userId]`              | admins     |
| `DELETE .../members/:ownId` (leave)                    | any member |
| `POST/DELETE .../teams[/:teamId]`                      | admins     |
| `PUT/DELETE .../teams/:teamId/members/:userId`         | admins     |

- **Tenant in the route, membership checked per request:** a global guard runs on every route
  with `:orgId` (secure by default) and loads the membership by primary key on each request.
  Roles never live in the token, so removing a member or changing a role applies immediately.
- **404 for non-members, 403 for insufficient role:** outsiders cannot tell whether an
  organization exists; members already know it, so a missing role is a plain 403.
- **No IDOR:** team queries always filter by the team id and the organization id from the route,
  never by the id alone; composite foreign keys enforce the same rule in the database.
- **Always one admin:** membership changes lock the organization row (`SELECT ... FOR UPDATE`).
  Without the lock, two admins demoting each other at the same time left the organization with
  no admin in 7 of 8 attempts; with it, an integration test runs the race and always keeps one.

### Documents and chunking

| Endpoint                                    | Who                                   |
| ------------------------------------------- | ------------------------------------- |
| `POST /orgs/:orgId/documents` (multipart)   | admins                                |
| `GET /orgs/:orgId/documents[/:documentId]`  | members (only the documents they see) |
| `DELETE /orgs/:orgId/documents/:documentId` | admins                                |

- **Visibility:** `ORG` (every member) or `TEAMS` (members of the listed teams). Admins see every
  document of the organization because they manage them. A document a user cannot see answers
  `404`, the same as one that does not exist.
- **Trust the content, not the name:** the type is checked by extension **and** content (PDF
  magic bytes, strict UTF-8 without NUL bytes for text), so a renamed binary gets `415`. Files
  over `UPLOAD_MAX_BYTES` get `413`; PDFs without a text layer (scans) get `422`. Uploads stay in
  memory and are never written to disk.
- **Fail fast, then store atomically:** parsing and chunking run inside the request, so a bad
  file is rejected immediately; the document and all its chunks are then written in one
  transaction. The document stays `PENDING` until its chunks get embeddings.
- **Parsing keeps the citation target:** PDF text per page (`unpdf`, a server build of Mozilla's
  pdf.js, no native dependencies), Markdown per heading (reference = heading trail, such as
  `Reembolso > Prazos`), plain text per paragraph range.
- **Structure-aware chunking:** paragraphs are packed up to **400 estimated tokens** with
  **60 tokens (15%) of overlap**; a chunk never crosses a page or section, so every chunk has an
  exact reference. Oversized paragraphs are split by sentence, then by word.
  - Why 400: internal policies and manuals have short sections; small chunks make citations
    precise and keep the prompt cheap. The cost is less surrounding context per chunk, which
    Contextual Retrieval (phase 5) addresses. Both values are settings, to be compared in the
    eval.
  - Tokens are estimated as characters / 4 (no tokenizer dependency); the exact number of
    embedded tokens comes from the embeddings API.

### Continuous integration

GitHub Actions runs three parallel jobs on every pull request and on `main`:

| Job           | What it proves                                                                           |
| ------------- | ---------------------------------------------------------------------------------------- |
| `check`       | Build, lint (including no secrets in `.env.example`), Prettier, typecheck, unit tests    |
| `integration` | Integration tests against real Postgres (pgvector) and Redis containers (Testcontainers) |
| `docker`      | The API, migrate and web images still build (no push), with layer cache                  |

- **Supply chain:** third-party actions are pinned to a commit SHA, since a tag can be moved to
  different code; the workflow token is read-only and the checkout does not persist it.
- **No paid APIs in CI:** tests never call Claude or Voyage, so CI needs no secrets.

### Docker images

- **Multi-stage builds** from the repository root: `pnpm fetch` caches dependencies by lockfile
  only, so changing code does not reinstall them; the runtime stage gets only what it runs.
- **API:** `pnpm deploy --prod` copies the API with its production dependencies and the built
  workspace packages, without dev tools or sources. Migrations ship in a separate `migrate`
  target, so the server image carries no migration files.
- **Web:** Next.js `standalone` output (only the traced files plus a minimal `server.js`).
  `NEXT_PUBLIC_API_URL` is a build argument because Next inlines it in the browser bundle.
- **Debian slim, not Alpine:** Prisma and Argon2 ship prebuilt native binaries for glibc; musl
  needs different binaries and is a common source of runtime errors.
- **Hardened:** non-root `node` user, healthchecks, ports bound to `127.0.0.1`, `.env` excluded
  by `.dockerignore`; secrets reach containers only as environment variables at runtime.

To be documented as the project evolves: chunk size, hybrid search with RRF, masking and LLM
cost control.

## Known limitations

- Uploads are parsed in the API process, which blocks the event loop for large PDFs; ingestion
  moves to a queue and a worker (S3, SQS, Lambda) in phase 6. The original file is not stored:
  citations point to the stored chunk text.
- Scanned PDFs (images without a text layer) are rejected; OCR is out of scope.
- The API image (~190 MB compressed) still contains the Prisma CLI: `@prisma/client` declares it
  as a peer, and pnpm links it from the `@knowgate/db` dev dependency even in a production deploy.
- Accented Portuguese stopwords ("são", "já") are unaccented before the stopword check and are
  kept as search tokens, which adds a little noise to full-text ranking.
- Changing the `portuguese_unaccent` configuration does not recompute existing `searchVector`
  values; rows must be updated explicitly.
- Rate limit counters live in memory: with several API instances they must move to Redis.
- Registering an existing e-mail answers 409, which reveals that the account exists (mitigated by
  the rate limit; avoiding it would require e-mail confirmation, out of scope).
- Members are added by e-mail only if they already have an account; invitation links for new
  users are a next step.
- Deleting a team removes its document shares: a document restricted to that team only becomes
  visible to admins only until it is shared again.

---

## Em português

KnowGate é um assistente de conhecimento interno: responde com base nos documentos da empresa,
cita a fonte, respeita a visibilidade por time e mascara dados pessoais antes de chamar o modelo.
Projeto de portfólio, desenvolvido em fases (veja o status no topo).
