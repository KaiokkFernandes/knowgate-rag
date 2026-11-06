# KnowGate — prompt geral do projeto

> Cole este arquivo no início de uma nova conversa, ou salve-o como `CLAUDE.md` na raiz do repositório `knowgate-rag` (o Claude Code lê esse arquivo automaticamente em toda sessão).

---

## 1. Quem sou eu e por que este projeto existe

Sou Kaio Fernandes, desenvolvedor Full Stack com cerca de 3 anos de experiência (Node.js, NestJS, TypeScript, React, Next.js, PostgreSQL, Kafka, RabbitMQ, Redis, Docker, Kubernetes, AWS). Estou buscando vagas de **pleno**.

Este é um **projeto de portfólio**. Os objetivos são:
1. Mostrar IA generativa aplicada de verdade: RAG, banco vetorial, tool use e MCP.
2. Cobrir lacunas que aparecem nas vagas: multi-tenant, RBAC, LGPD, testes de integração, observabilidade, controle de custo de LLM e AWS.
3. Ser **defensável em entrevista**: eu preciso conseguir explicar cada decisão e cada linha importante.

Já concluí os cursos *Claude Platform 101* e *Building with the Claude API* (Anthropic Academy), então conheço os conceitos de chunking, embeddings, busca híbrida, reranking, Contextual Retrieval, tool use e MCP.

## 2. Como quero trabalhar (regras para o assistente)

- **Fase por fase.** Não implemente tudo de uma vez. Ao terminar uma fase, pare, resuma o que foi feito e espere minha revisão.
- **Explique as decisões.** Para cada parte relevante, diga por que escolheu aquela abordagem e quais alternativas existiam. Escreva como se estivesse me preparando para uma entrevista.
- **Eu faço os commits.** Sugira a mensagem do commit (Conventional Commits, em inglês), mas não faça commit nem push sem eu pedir.
- **Commits pequenos e com sentido**, um por funcionalidade.
- **Nunca peça, leia ou escreva minhas chaves de API.** Eu coloco as chaves no `.env`. Mantenha um `.env.example` atualizado, sem valores reais.
- **Nada de dados reais de empresas.** Use apenas documentos públicos ou fictícios criados para o projeto.
- **Não invente APIs.** Para o SDK da Anthropic, o da Voyage, o pgvector e o MCP, confirme na documentação oficial antes de escrever o código.
- Código, nomes de variáveis, commits e comentários em **inglês**. As explicações para mim, em **português**.
- Se algo estiver ambíguo, pergunte antes de decidir sozinho.

## 3. O produto

**KnowGate** é um assistente de conhecimento interno para empresas. Ele responde perguntas a partir dos documentos da empresa e:

1. **Cita a fonte** de cada resposta (documento, página ou seção e o trecho).
2. **Mostra só o que o usuário pode ver**, conforme a organização (tenant), o papel e o time dele.
3. **Mascara dados pessoais** (CPF, CNPJ, e-mail e telefone) antes de enviar qualquer texto ao modelo e antes de escrever logs.
4. **Controla o custo**, registrando os tokens e o custo estimado por organização, com limite diário.
5. **Diz "não encontrei nos documentos"** quando não há base, em vez de inventar.

**A dor que resolve:** informação espalhada em PDFs, políticas e manuais, somada ao risco de um assistente de IA vazar documentos entre times ou enviar dados pessoais ao modelo.

### Fluxo do usuário
1. O admin cria a organização, os times e convida os membros.
2. O admin envia documentos (PDF, Markdown ou TXT) e define a visibilidade: toda a organização ou times específicos.
3. O membro pergunta no chat. A resposta vem com citações, e um clique abre o trecho original.
4. O admin acompanha uso, custo e limite num painel.

### Fora do escopo
SSO, integrações com Slack, Notion ou Google Drive, treinamento ou fine-tuning de modelos, pagamentos e múltiplos idiomas na interface.

## 4. Arquitetura

```
apps/web (Next.js: chat + painel admin)
        │ HTTP (JWT)
apps/api (NestJS)
   ├── auth        → JWT, organizações, times, papéis (ADMIN, MEMBER)
   ├── documents   → upload, parsing, chunking, contextualização, embeddings
   ├── retrieval   → busca híbrida (pgvector + full-text) com filtro de acesso
   ├── chat        → resposta do Claude com citações, conversas e mensagens
   ├── privacy     → mascaramento de dados pessoais
   └── usage       → tokens, custo, limite diário (Redis)
        │
   ├── PostgreSQL + pgvector (dados, vetores e full-text)
   ├── Redis (limite de uso e cache)
   ├── Voyage AI (embeddings)
   └── Claude API (respostas e Contextual Retrieval)

apps/mcp (servidor MCP) → expõe a busca do KnowGate como ferramenta, reutilizando a mesma lógica e as mesmas regras de acesso
```

### Monorepo
- **pnpm workspaces:** `apps/api`, `apps/web`, `apps/mcp` e `packages/shared` (tipos e schemas Zod compartilhados).
- **Docker Compose** para PostgreSQL com pgvector, Redis, a API e o front.

## 5. Stack

| Camada | Tecnologia |
|---|---|
| Back-end | NestJS, TypeScript, Prisma (com SQL puro para as consultas vetoriais e de full-text) |
| Banco | PostgreSQL com a extensão pgvector |
| Cache e limite | Redis |
| Front-end | Next.js (App Router), TypeScript, Tailwind CSS |
| LLM | Claude API, com o SDK oficial `@anthropic-ai/sdk` |
| Embeddings | Voyage AI (confirmar o modelo e a dimensão atuais na documentação) |
| Validação | Zod |
| Testes | Jest e Supertest (unitários e de integração), Testcontainers ou banco de teste no Docker, Playwright (E2E na fase 4) |
| Qualidade | ESLint, Prettier, typecheck no CI |
| CI | GitHub Actions: lint, typecheck, testes e build |
| Deploy | Front na Vercel. API, banco e Redis em plano gratuito ou barato (decidir na fase 4) |
| Fases finais | AWS (S3, SQS e Lambda na ingestão) e OpenTelemetry (traces, métricas e logs) |

### Modelo do Claude
- Deixar o modelo configurável por variável de ambiente: `CLAUDE_MODEL`.
- Padrão: `claude-haiku-5-5`, pelo custo baixo (tenho um saldo pré-pago pequeno). Para comparar a qualidade no eval, testar também o `claude-opus-5-5`.
- Usar **prompt caching** no system prompt fixo.
- Avaliar o recurso nativo de **citações** da API (blocos de documento ou de resultado de busca com citações habilitadas) em vez de pedir as citações só pelo prompt. Confirmar o formato atual na documentação antes de implementar.

## 6. Modelo de dados (inicial)

- `Organization` (id, name, dailyTokenLimit, createdAt)
- `User` (id, email, passwordHash, name)
- `Membership` (userId, organizationId, role: ADMIN | MEMBER)
- `Team` (id, organizationId, name) e `TeamMember` (teamId, userId)
- `Document` (id, organizationId, title, sourceType, visibility: ORG | TEAMS, status: PENDING | PROCESSING | READY | FAILED, createdById, createdAt)
- `DocumentTeam` (documentId, teamId)
- `Chunk` (id, documentId, organizationId, content, context, reference como "p. 3" ou "Seção 2.1", tokenCount, embedding `vector(N)`, coluna `tsvector` para o full-text em português)
- `Conversation` (id, organizationId, userId, createdAt) e `Message` (id, conversationId, role, content, citations JSON, inputTokens, outputTokens, costUsd)
- `UsageEvent` (id, organizationId, userId, kind: CHAT | EMBEDDING | CONTEXTUALIZE, inputTokens, outputTokens, costUsd, createdAt)

`organizationId` fica repetido no `Chunk` para que **toda** consulta vetorial filtre pelo tenant sem join. Avaliar Row Level Security no PostgreSQL como reforço.

## 7. Regras de negócio e segurança

- **Isolamento:** nenhuma consulta pode retornar dados de outra organização. Toda busca filtra por `organizationId` **e** pela visibilidade (`ORG`, ou um time do usuário).
- **Papéis:** só o ADMIN envia e apaga documentos, gerencia times e vê o painel de custo.
- **Mascaramento:** CPF, CNPJ, e-mail e telefone são trocados por marcadores (`[CPF]`, `[EMAIL]` etc.) na pergunta e nos trechos, antes da chamada ao Claude. Os logs nunca guardam o conteúdo dos documentos nem as perguntas sem máscara.
- **Limite de uso:** antes de cada chamada ao Claude, checar o consumo do dia da organização no Redis. Ao passar do limite, responder 429 com uma mensagem clara.
- **Sem base, sem resposta:** se a busca não trouxer trechos acima de um limiar de relevância, responder que não encontrou, sem chamar o modelo para inventar.
- **Segurança da API:** senhas com hash (argon2 ou bcrypt), validação de entrada com Zod, rate limiting por IP, CORS restrito, Helmet, limite de tamanho de upload e checagem do tipo de arquivo.
- **Prompt injection:** o conteúdo dos documentos entra no prompt como dado, separado das instruções, e o system prompt manda ignorar instruções que aparecerem dentro dos documentos.

## 8. Pipeline de RAG

1. **Parsing:** extrair o texto de PDF, Markdown e TXT, guardando página ou seção.
2. **Chunking:** por estrutura (títulos e parágrafos), com tamanho alvo e sobreposição configuráveis. Documentar no README o tamanho escolhido e o porquê.
3. **Contextual Retrieval (fase 5):** gerar com o Claude um contexto curto de cada trecho em relação ao documento e guardar em `Chunk.context`, que entra no embedding e no full-text.
4. **Embeddings:** Voyage AI, em lote, com retry e backoff.
5. **Busca híbrida:** similaridade vetorial (pgvector, índice HNSW) mais full-text do PostgreSQL (`to_tsvector('portuguese', ...)`), combinadas com Reciprocal Rank Fusion. Reranking como melhoria opcional.
6. **Resposta:** o Claude responde só com base nos trechos recuperados, com citações e streaming para o front.

## 9. Testes obrigatórios

- **Teste de isolamento entre tenants:** prova automatizada de que o usuário da organização A nunca recebe trechos da B, nem mesmo com uma pergunta idêntica ao conteúdo da B.
- **Teste de visibilidade por time:** um membro fora do time não recebe trechos de documentos restritos.
- **Mascaramento:** testes unitários para cada tipo de dado pessoal, incluindo formatos com e sem pontuação.
- **Limite de uso:** a requisição acima do limite recebe 429.
- **Integração:** os principais endpoints com Supertest e banco real no Docker.
- Os testes não chamam as APIs pagas: Claude e Voyage ficam atrás de interfaces (`LlmProvider` e `EmbeddingProvider`), com implementações falsas nos testes.

## 10. Eval

- Arquivo `eval/questions.json` com 15 a 20 perguntas sobre os documentos de exemplo, cada uma com a resposta esperada e o documento ou trecho que deve ser citado.
- Script `pnpm eval` que roda as perguntas e mede: acerto da recuperação (o trecho certo veio no top-k?), presença de citação correta e recusa correta quando não há base.
- O script mostra o custo estimado da rodada antes de executar e pede confirmação, porque gasta créditos.
- Guardar os resultados de cada rodada para comparar mudanças (tamanho de chunk, busca híbrida e Contextual Retrieval).

## 11. Fases e critérios de pronto

| Fase | Entrega | Pronto quando |
|---|---|---|
| 1 | Monorepo, Docker Compose (PostgreSQL + pgvector e Redis), README inicial, schema do Prisma, autenticação, organizações, times e papéis | `docker compose up` sobe tudo; cadastro, login e criação de time funcionam com testes; o CI roda |
| 2 | Upload, parsing, chunking, embeddings e busca híbrida com filtro de acesso | Os testes de isolamento e de visibilidade passam; endpoint de busca retorna trechos com referência |
| 3 | Resposta com citações e streaming, mascaramento, registro de uso e limite diário | Uma pergunta gera resposta citada; dados pessoais nunca saem sem máscara; o limite devolve 429 |
| 4 | Front em Next.js (chat, citações, upload, painel de uso), testes E2E e deploy | Demo publicada, com link e GIF no README |
| 5 | Eval, Contextual Retrieval e servidor MCP | Relatório do eval antes e depois do Contextual Retrieval no README; a busca funciona no Claude Desktop pelo MCP |
| 6 | AWS (upload no S3, fila SQS e Lambda para processar a ingestão) e OpenTelemetry | Ingestão assíncrona funcionando; traces da pergunta até a resposta visíveis num painel |

## 12. README (o que precisa ter)

- O problema e a solução em 3 linhas, com GIF da demo e link.
- Diagrama da arquitetura.
- Como rodar localmente (com `.env.example`).
- **Decisões técnicas e trade-offs:** tamanho do chunk, busca híbrida, RRF, pgvector em vez de um banco vetorial dedicado, isolamento por tenant, mascaramento e controle de custo.
- Resultados do eval.
- Limites conhecidos e próximos passos.
- Seção curta em português no topo ou no fim (o resto em inglês).

## 13. Documentos de exemplo

Criar em `samples/` documentos **fictícios** de uma empresa inventada: política de reembolso, guia de onboarding, política de home office, manual de segurança da informação e um documento restrito ao time de RH. Incluir dados pessoais falsos (CPFs gerados para teste) em alguns, para testar o mascaramento.

## 14. Por onde começar

Comece pela **fase 1**. Antes de escrever código, me mostre:
1. A estrutura de pastas proposta.
2. O schema inicial do Prisma.
3. A lista de dependências com o motivo de cada uma.

Espere minha aprovação e só então implemente.

## 15. Decisões de banco

Valem para todas as fases. Mudar alguma delas exige discutir antes.

- **PostgreSQL + pgvector** em vez de MongoDB Atlas ou de um banco vetorial dedicado (Pinecone, Qdrant etc.): o domínio é relacional (organizações, times, papéis, visibilidade); o RLS serve de segunda camada de isolamento; documento e chunks são gravados numa única transação; e não há dependência de um serviço gerenciado a mais.
- **Busca vetorial com filtro:** o HNSW filtra *depois* de buscar os vizinhos, então um filtro seletivo (como o tenant) pode devolver menos de k resultados. Usar pgvector >= 0.8 com `SET LOCAL hnsw.iterative_scan = relaxed_order` (e `hnsw.max_scan_tuples` se precisar) na fase 2. O teste de isolamento deve ter uma organização com **muito mais** chunks que a outra, para provar que a organização pequena ainda recebe os seus resultados.
- **Full-text:** usar uma configuração de texto própria para português com `unaccent` como dicionário (`portuguese_unaccent`), e não a função `unaccent()`, que é só STABLE e não pode ser usada numa coluna gerada.
- **Visibilidade por time:** começar com join em `Document`/`DocumentTeam` na consulta de busca. Desnormalizar a visibilidade e os times no `Chunk` (por exemplo, um array de `teamIds` com índice GIN) é uma alternativa documentada, caso o join pese.
- **SQL vetorial e de full-text** fica concentrado num `ChunkRepository`, com `$queryRaw` (tagged template, nunca `$queryRawUnsafe` com entrada do usuário).
- **Uso e custo:** o PostgreSQL (`UsageEvent`) é a fonte da verdade. O Redis é só o contador rápido do limite diário e pode ser reconstruído a partir do banco.

### RLS (implementar depois, não agora)

1. Na migration: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY` nas tabelas com `organizationId`, com a política `USING ("organizationId" = current_setting('app.current_org_id', true)::uuid)`.
2. A aplicação conecta com um papel sem `BYPASSRLS` e que não é dono das tabelas; as migrations rodam com o papel dono.
3. Em cada requisição, as consultas rodam dentro de `prisma.$transaction`, começando por `SELECT set_config('app.current_org_id', ${orgId}, true)`. O `true` (escopo local) limita o valor à transação, para que ele não vaze para outra requisição que reutilize a mesma conexão do pool.
4. Encapsular isso numa Client Extension do Prisma (`$extends`), para que nenhuma consulta escape do contexto do tenant.
