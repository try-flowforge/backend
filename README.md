# FlowForge Backend

TypeScript/Express API for FlowForge. Handles workflow CRUD, DAG execution, node processors (swap, lending, social, AI, control flow), BullMQ workers, PostgreSQL and Redis.

## Architecture

Workflows are JSON-defined DAGs: **nodes** (triggers, swap, lending, IF/Switch, Telegram, Slack, Email, Wallet, LLM Transform, oracles) and **edges** (execution order, data flow). The engine walks the graph and runs the appropriate node processor for each step.

## Project Structure

```bash
backend/
├── src/
│   ├── config/           # Database, Redis, chains
│   ├── controllers/      # Request handlers
│   ├── middleware/       # Privy auth, etc.
│   ├── migrations/       # Database migrations
│   ├── models/           # Data models
│   ├── routes/           # API routes
│   ├── services/         # Workflow engine, swap, lending, llm, workers
│   ├── types/            # TypeScript types
│   └── utils/            # Logger, encryption, template engine
├── examples/
├── docker-compose.yml    # PostgreSQL + Redis
└── package.json
```

## Setup & Run

**Prerequisites:** Node.js 20+, PostgreSQL 16+, Redis 7+

```bash
npm install
cp .env.example .env
# Edit .env (see Environment variables below)
```

```bash
docker-compose up -d postgres redis
npm run build && npm run migrate:up
npm run dev
```

Optional workers: `npm run worker`

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Start dev server |
| `npm run migrate:up` | Run migrations |
| `npm run migrate:down` | Rollback migration |
| `npm run worker` | Start BullMQ workers |

## API

Base URL: `http://localhost:3000/api/v1`

**Health:** `GET /health`, `/health/live`, `/health/ready`  
**Users:** `POST /users`, `GET /users`, `GET /users/:id`, `GET /users/address/:address`, `PUT /users/:id`, `DELETE /users/:id`, `GET /users/me`  
**Workflows:** `POST /workflows`, `GET /workflows`, `GET /workflows/:id`, `PUT /workflows/:id`, `DELETE /workflows/:id`, `POST /workflows/:id/execute`  
**Swaps:** `POST /swaps/quote`, `/swaps/build-transaction`, `/swaps/build-safe-transaction`, `/swaps/execute-with-signature`, `GET /swaps/providers`, `GET /swaps/executions`  
**Lending:** `POST /lending/quote`, `GET /lending/position`, `/account`, `/asset`, `/assets`, `/providers`, `/executions`  
**Integrations:** Slack (OAuth, connections, webhooks, send, test), Telegram (connections, send, test, verification), Email (send, test)  
**Relay:** `POST /relay/create-safe`, `POST /relay/enable-module`  
**Meta & Oracle:** `GET /meta/runtime-config`, `GET /oracle/feeds`, `/oracle/config`

Response: success `{ "success": true, "data": {...}, "meta": { "timestamp": "..." } }`, error `{ "success": false, "error": { "message", "code", "details" }, "meta": {...} }`

## Environment variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `NODE_ENV` | Environment | development |
| `PORT` | Server port | 3000 |
| `API_VERSION` | API version | v1 |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL | localhost, 5432, agentic_workflow, postgres |
| `REDIS_HOST`, `REDIS_PORT` | Redis | localhost, 6379 |
| `LOG_LEVEL` | Logging level | info |
| `JWT_SECRET` | JWT secret | — |
| `ENCRYPTION_KEY` | 64-char hex key | — |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Privy | — |
| `RELAYER_PRIVATE_KEY` | Relayer wallet (0x + 64 hex) | — |
| `CORS_ORIGIN` | CORS origin | * |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack OAuth | — |
| `API_BASE_URL` | Base URL for OAuth callbacks | — |
| `SMTP_*` | SMTP for email nodes | — |
| `HMAC_SECRET` | Shared secret with LLM service | — |
| `LLM_SERVICE_BASE_URL` | LLM service URL | `http://localhost:3002` |

## Docker

```bash
docker-compose up -d postgres redis   # Start databases
docker-compose down                    # Stop
docker-compose logs -f postgres        # Logs
```

## LICENSE

[MIT License](LICENSE)
