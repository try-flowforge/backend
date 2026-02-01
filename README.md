# Agentic Workflow Automation Backend

A powerful workflow automation backend supporting both Web2 and Web3 workflows. Built with Node.js, TypeScript, Express, PostgreSQL, Redis, and BullMQ.

## Architecture Overview

This backend treats every workflow as a JSON-defined directed acyclic graph (DAG) with:

- **Nodes**: Units of execution
- **Edges**: Connections defining execution order and data flow
- **Data-driven**: Workflows are replayable and deterministic
- **Extensible**: Plug-and-play node types

## Features

- User management with PostgreSQL
- RESTful API with Express
- Redis for caching and job queues
- BullMQ for job orchestration (ready for workers)
- Docker containerization
- TypeScript for type safety
- Comprehensive error handling
- Request validation with Joi
- Structured logging with Pino
- Database migrations
- Graceful shutdown handling

## Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- Docker & Docker Compose (optional)

## Installation

### Local Development

1. **Clone the repository**

```bash
git clone <repository-url>
cd agentic-backend
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start PostgreSQL and Redis** (if not using Docker)

```bash
# Using Docker for databases only
docker-compose up -d postgres redis
```

5. **Run database migrations**

```bash
npm run build
npm run migrate up
```

6. **Start the development server**

```bash
npm run dev
```

The API will be available at `http://localhost:3000`

### Docker Development

1. **Start all services**

```bash
docker-compose up -d
```

2. **Run migrations**

```bash
docker-compose exec api npm run migrate up
```

3. **View logs**

```bash
docker-compose logs -f api
```

## API Documentation

### Base URL

```http
http://localhost:3000/api/v1
```

### Endpoints

#### Health Check

```http
GET /api/v1/health
```

#### Users

**Create User**

```http
POST /api/v1/users
Content-Type: application/json

{
  "id": "user123",
  "address": "0x1234567890abcdef",
  "email": "user@example.com",
  "onboarded_at": "2026-01-02T06:04:35.000Z"
}
```

**Get All Users**

```http
GET /api/v1/users?limit=50&offset=0
```

**Get User by ID**

```http
GET /api/v1/users/:id
```

**Get User by Address**

```http
GET /api/v1/users/address/:address
```

**Update User**

```http
PUT /api/v1/users/:id
Content-Type: application/json

{
  "address": "0xnewaddress",
  "email": "newemail@example.com"
}
```

**Delete User**

```http
DELETE /api/v1/users/:id
```

### Response Format

All API responses follow this structure:

**Success Response**

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-01-02T06:04:35.000Z"
  }
}
```

**Error Response**

```json
{
  "success": false,
  "error": {
    "message": "Error message",
    "code": "ERROR_CODE",
    "details": { ... }
  },
  "meta": {
    "timestamp": "2026-01-02T06:04:35.000Z"
  }
}
```

## Project Structure

```bash
agentic-backend/
├── src/
│   ├── config/           # Configuration files (database, redis)
│   ├── controllers/      # Request handlers
│   ├── middleware/       # Express middleware
│   ├── migrations/       # Database migrations
│   ├── models/           # Data models and schemas
│   │   └── users/        # User model and schema
│   ├── routes/           # API routes
│   ├── services/         # Business logic (future)
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Utility functions
│   ├── app.ts            # Express app setup
│   └── index.ts          # Application entry point
├── .env.example          # Environment variables template
├── .gitignore
├── docker-compose.yml    # Docker services configuration
├── Dockerfile            # Container image definition
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration

### Environment Variables

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `NODE_ENV` | Environment (development/production) | development |
| `PORT` | Server port | 3000 |
| `API_VERSION` | API version | v1 |
| `DB_HOST` | PostgreSQL host | localhost |
| `DB_PORT` | PostgreSQL port | 5432 |
| `DB_NAME` | Database name | agentic_workflow |
| `DB_USER` | Database user | postgres |
| `DB_PASSWORD` | Database password | postgres |
| `REDIS_HOST` | Redis host | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `LOG_LEVEL` | Logging level | info |

## Testing

```bash
npm test
```

## Database Migrations

**Run migrations**

```bash
npm run migrate up
```

**Rollback last migration**

```bash
npm run migrate down
```

## Docker Commands

**Start all services**

```bash
docker-compose up -d
```

**Stop all services**

```bash
docker-compose down
```

**View logs**

```bash
docker-compose logs -f [service-name]
```

**Rebuild containers**

```bash
docker-compose up -d --build
```

**Start with workers**

```bash
docker-compose --profile workers up -d
```

## Future Roadmap

### Phase 1: Core Workflow Engine (Current)

- User management (Complete)
- Workflow definition and storage (In Progress)
- Node execution engine (In Progress)
- DAG resolution and validation (In Progress)

### Phase 2: Execution & Queue System

- BullMQ worker implementation
- Node execution context
- Retry and error handling
- Execution state persistence

### Phase 3: Web3 Integration

- Wallet management
- On-chain read operations
- Transaction execution
- Gas estimation

### Phase 4: Node Library

- Trigger nodes
- Web2 API nodes
- Web3 nodes
- Logic & flow control nodes
- AI/LLM nodes

### Phase 5: Advanced Features

- Secrets management
- Webhook triggers
- Scheduled workflows
- Workflow versioning

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

ISC

## Support

For issues and questions, please open an issue on GitHub.
