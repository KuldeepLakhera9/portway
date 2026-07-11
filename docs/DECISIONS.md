# Architectural Decisions

This file lists the major design and engineering decisions made during the construction of Portway.

## 1. Programming Language & Framework

* **Decision**: Node.js (v22.18.0) + TypeScript + Fastify.
* **Context**: The product plan suggested Go as the primary candidate, with Node.js/Fastify/TS as the primary alternative. Since Go is not installed on the system, Node.js + Fastify was chosen.
* **Consequences**:
  * Fastify provides outstanding throughput, clean asynchronous support, and native support for Pino structured JSON logging.
  * Direct Docker Engine API connection will be handled using the official `dockerode` library (in later phases).
  * BullMQ will be used for the build worker queue.

## 2. Database Migration Engine

* **Decision**: Lightweight native migration script.
* **Context**: Avoided heavy frameworks (like Prisma or TypeORM) to prevent command-line dependencies, keeping setup simple and fast.
* **Consequences**:
  * The migration script (`apps/api/src/db/migrate.ts`) reads `schema.sql` directly and runs the queries against the database pool on start.
  * Ensures schema tables are always up to date upon container starting.

## 3. Schema Design Assumptions

* **Decision**:
  * `id` fields are UUID v4 values.
  * Created indices on critical search attributes (`user_id`, `team_id`, `project_id`).
  * Enforced unique constraints on:
    * `teams.slug` (for URL parsing)
    * `team_members(team_id, user_id)` (prevents duplicate memberships)
    * `projects(team_id, slug)` (unique project URLs within a team)
    * `environment_variables(project_id, key, environment)` (prevents duplicate config flags per environment scope)
