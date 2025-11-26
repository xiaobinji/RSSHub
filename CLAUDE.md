# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RSSHub is an open-source, customizable RSS feed generator that aggregates content from various sources. The codebase is written in TypeScript using the Hono web framework and follows a route-based architecture where each content source is implemented as a separate route module.

## Development Commands

### Running the application
- `pnpm dev` - Start development server with hot reload and debugging on port 1200 (default)
- `pnpm dev:cache` - Start development server with production cache settings
- `pnpm start` - Start production server (requires build first)

### Building
- `pnpm build` - Build the application (generates route registry and compiles TypeScript)
- `pnpm build:vercel` - Build for Vercel deployment
- `pnpm build:docs` - Generate documentation from route definitions

### Testing
- `pnpm test` - Run format checks and tests with coverage
- `pnpm vitest` - Run tests in watch mode
- `pnpm vitest:watch` - Run tests in watch mode with UI
- `pnpm vitest:coverage` - Run tests with coverage report
- `pnpm vitest:fullroutes` - Run full routes test (tests all route handlers)

### Code Quality
- `pnpm format` - Format and fix code with Prettier and ESLint
- `pnpm format:check` - Check formatting without making changes
- `pnpm lint` - Run ESLint to check for code issues

## Architecture

### Core Application Flow

1. **Entry Point**: `lib/index.ts` - Starts the server using Hono with @hono/node-server
2. **Request Rewriter**: `lib/utils/request-rewriter/` - Patches global fetch/got before app starts
3. **App Bootstrap**: `lib/app-bootstrap.tsx` - Sets up Hono app with middleware chain
4. **Registry**: `lib/registry.ts` - Dynamically loads and registers all route modules

### Middleware Chain (in order)

The middleware in `lib/middleware/` is executed in this order:
1. `logger` - Request logging
2. `trace` - OpenTelemetry tracing
3. `sentry` - Error tracking
4. `access-control` - Access key validation and CORS
5. `debug` - Debug mode handling
6. `template` - RSS template rendering
7. `header` - Response header management
8. `anti-hotlink` - Hotlink protection for media
9. `parameter` - Query parameter processing (filter, limit, etc.)
10. `cache` - Response caching (Redis or in-memory)

### Route Structure

Routes are organized in `lib/routes/[namespace]/` directories:

- Each namespace typically contains:
  - `namespace.ts` - Namespace metadata (name, URL, description)
  - Individual route files (e.g., `issue.ts`, `trending.ts`)
  - Each route file exports a `route` object with metadata and a `handler` function

**Route Export Format**:
```typescript
export const route: Route = {
    path: '/path/:param',
    categories: ['programming'],
    example: '/github/issue/DIYgod/RSSHub/open',
    parameters: { /* param definitions */ },
    radar: [{ source: [...], target: '...' }],
    name: 'Route Name',
    maintainers: ['username'],
    handler,
};

async function handler(ctx) {
    // Extract params: ctx.req.param('param')
    // Extract query: ctx.req.query('key')
    // Return Data object with title, link, item[]
}
```

### Type System

Key types in `lib/types.ts`:
- `Route` - Route definition with metadata
- `Data` - RSS feed output format (title, link, item[])
- `DataItem` - Individual feed item (title, description, pubDate, link, etc.)
- `Namespace` - Namespace metadata
- `Context` - Hono request context

### HTTP Utilities

**Primary HTTP client**: `lib/utils/got.ts`
- Wrapper around `ofetch` that provides got-like API
- Automatically handles retries, timeouts, proxies
- Returns `{ data, body }` structure
- Use `@/utils/got` for all HTTP requests

**Configuration**: `lib/config.ts`
- Centralized config loaded from environment variables
- Access via `import { config } from '@/config'`
- Common configs: `config.connect.port`, `config.cache.*`, `config.proxy.*`

### Caching

Cache implementation in `lib/utils/cache/`:
- Supports Redis (production) or in-memory LRU (development)
- Two cache types: route cache (full response) and content cache (individual items)
- Cache TTL configured via `config.cache.routeExpire` and `config.cache.contentExpire`

## Adding New Routes

1. Create directory: `lib/routes/[namespace]/`
2. Create `namespace.ts` with namespace metadata
3. Create route file (e.g., `feed.ts`) with route export
4. Route handler should:
   - Extract parameters using `ctx.req.param()` and `ctx.req.query()`
   - Fetch data using `got` from `@/utils/got`
   - Parse HTML with `cheerio` if needed
   - Return `Data` object with `title`, `link`, and `item` array
   - Use `parseDate` from `@/utils/parse-date` for date parsing
5. Routes are auto-discovered in development, built into registry for production

## Common Utilities

- `@/utils/got` - HTTP client (got-like API over ofetch)
- `@/utils/ofetch` - Lower-level fetch wrapper
- `@/utils/parse-date` - Parse various date formats to Date objects
- `@/utils/common-utils` - Common helpers (getSearchParamsString, etc.)
- `cheerio` - HTML parsing (use version 1.1.2)
- `dayjs` - Date manipulation
- `art-template` - Template rendering for some routes

## Path Aliases

TypeScript path alias `@/*` maps to `lib/*` (configured in tsconfig.json)

## Testing

- Tests use Vitest
- Test files: `*.test.ts` or `*.spec.ts`
- Setup file: `lib/setup.test.ts`
- Mock HTTP requests with `msw` (Mock Service Worker)
- Route tests excluded from coverage by default

## Build System

- Uses `tsdown` for building (esbuild-based)
- Development: Routes loaded dynamically via `directory-import`
- Production: Routes pre-built into `assets/build/routes.js`
- Script `scripts/workflow/build-routes.ts` generates route registry

## Environment

- Node.js >= 22 required
- Package manager: pnpm (version specified in packageManager field)
- TypeScript with ESNext target and ESM modules
- JSX: Uses Hono's JSX runtime (jsx-runtime)
