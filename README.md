# Docle

Privacy-friendly email pre-check tool. Validates syntax, domain, MX records, and flags risky addresses (role-based, disposable) — without sending any email.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000).

## Production build

```bash
npm run build
node .output/server/index.mjs
```

## How it works

- **Syntax** — pragmatic regex check
- **Domain** — parsed from the address
- **MX records** — DNS lookup (server-side via `dns/promises`)
- **Risk flags** — role-based local parts (`info@`, `admin@`, etc.) and disposable domains (mailinator, yopmail, etc.)

No SMTP mailbox probing. No data stored. All processing in-memory.

## Configuration

Runtime config values in `nuxt.config.ts`:

| Key | Default | Description |
|-----|---------|-------------|
| `maxEmailsPerRequest` | 10,000 | Max emails per API call |
| `dnsCacheTtlMs` | 600,000 | MX cache TTL (10 min) |
| `dnsTimeoutMs` | 5,000 | DNS lookup timeout |
| `dnsConcurrency` | 20 | Parallel DNS lookups |
| `rateLimitWindowMs` | 60,000 | Rate limit window |
| `rateLimitMaxRequests` | 30 | Max requests per window per IP |
