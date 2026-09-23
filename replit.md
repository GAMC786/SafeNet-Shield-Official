# SafeNet DNS

## Overview

SafeNet DNS is a cyberpunk-themed DNS management application with security features including AI Shield protection, firewall rules, dynamic DNS updating, and access logging. The application provides a web-based dashboard for managing DNS servers, blocklists, and monitoring network traffic. It's built as a full-stack TypeScript application with mobile deployment capability via Capacitor.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack Query for server state, local React state for UI
- **Styling**: Tailwind CSS with custom cyberpunk theme, shadcn/ui component library
- **Animations**: Framer Motion for smooth transitions
- **Charts**: Recharts for data visualization
- **Build Tool**: Vite with path aliases (@/, @shared/, @assets/)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful endpoints defined in shared/routes.ts with Zod validation
- **Database ORM**: Drizzle ORM with PostgreSQL (Neon serverless)
- **Build**: esbuild for server bundling, Vite for client

### Data Storage
- **Database**: PostgreSQL via Neon serverless driver
- **Schema Location**: shared/schema.ts using Drizzle table definitions
- **Migrations**: drizzle-kit with migrations in /migrations folder
- **Tables**: dns_servers, blocklists, access_logs, app_settings, ddns_updaters, firewall_rules, conversations, messages

### API Structure
- Routes defined declaratively in shared/routes.ts with Zod schemas
- Endpoints follow pattern: /api/{resource} for CRUD operations
- Input validation using Zod with type-safe schemas
- Shared types between frontend and backend via @shared imports

### Mobile Deployment
- **Framework**: Capacitor for Android APK generation
- **Config**: capacitor.config.ts with app ID com.safenet.dns
- **PWA Support**: Service worker and manifest.json for offline capability

### AI Integrations
- OpenAI-compatible API for chat and image generation
- Chat routes: /api/conversations, /api/chat
- Image routes: /api/generate-image
- Batch processing utilities with rate limiting and retries

### Key Design Patterns
- **Type Safety**: Shared Zod schemas ensure frontend-backend type consistency
- **Storage Interface**: IStorage interface abstracts database operations
- **API Hooks**: Custom React hooks (use-dns, use-settings, etc.) wrap TanStack Query
- **Component Library**: shadcn/ui components with cyberpunk theme customizations

## External Dependencies

### Database
- **Neon Serverless PostgreSQL**: Primary database via @neondatabase/serverless
- **Connection**: Requires DATABASE_URL environment variable

### AI Services
- **OpenAI API**: Used for chat completions and image generation
- **Environment Variables**: AI_INTEGRATIONS_OPENAI_API_KEY, AI_INTEGRATIONS_OPENAI_BASE_URL

### DDNS Providers (supported integrations)
- DuckDNS
- No-IP
- Dynu
- DNS-O-Matic
- Cloudflare

### External APIs
- ipify.org: Public IP detection for DDNS updates

### Headscale and Headplane
- SafeNet includes the upstream Headplane source under `headplane/` as an isolated companion service; it does not merge Headplane routes into the SafeNet Express/Vite app.
- Run the companion with `npm run headplane:dev` or `npm run headplane:start` after `npm run headplane:install`.
- Configure `HEADSCALE_URL` with the Headscale API URL, `HEADPLANE_URL` with the Headplane `/admin` URL, `HEADSCALE_API_KEY` with a server-side Headscale API key, and `HEADPLANE_COOKIE_SECRET` with an exactly 32-character session secret.
 - The physical Android mesh proof additionally uses the server-only `HEADPLANE_NODE_API_URL` and scoped `HEADPLANE_NODE_API_TOKEN` documented in `docs/headscale-external-host.md`.
- Headscale must run on a compatible external Linux/Docker host. The SafeNet web service and Railway TCP proxy are not the WireGuard data plane.
- Headscale coordinates a Tailscale-compatible private mesh; Android users need a compatible Tailscale client rather than a standard WG-Easy QR workflow.
 - See `headplane/README.safenet.md` and `docs/headscale-external-host.md` for the companion-service boundary, external Headscale setup, and official installation references.
### Build & Development
- Replit plugins: vite-plugin-runtime-error-modal, vite-plugin-cartographer, vite-plugin-dev-banner
- p-limit and p-retry for batch processing rate limiting

#### GitHub Actions workflow linting

Install the pinned workflow lint tools in one command:

```sh
npm run setup:workflow-lint
```

The setup reads the exact actionlint and ShellCheck versions from the
`workflowLint` section of `package.json`, downloads matching releases, and
stores them in the repo-local `.tools/workflow-lint` directory. It supports
Linux x64/arm64, macOS x64/arm64, and Windows x64. Run the lint command after
setup to confirm both installed versions and lint every workflow:

```sh
npm run lint:workflows
```

The GitHub Actions gate uses the same versions, so local results match CI.
