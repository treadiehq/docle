# Docle

Check if an email address is real before you hit send. Verifies syntax, DNS, MX records, SMTP mailbox existence, and cross-references multiple providers. All in real time, no signup required.

## What it checks

- **Syntax & DNS** — validates format, MX records, A-record fallback
- **SMTP mailbox probe** — RCPT TO with STARTTLS and greylisting retry
- **Provider verification** — direct account checks for Google, Apple, Microsoft
- **Cross-referencing** — Gravatar, GitHub, PGP keyservers, HIBP breaches
- **Domain intelligence** — website liveness, parked detection, domain age, DNSBL blacklists
- **Pattern analysis** — entropy scoring, business pattern matching, bulk anomaly detection
- **Typo detection** — suggests corrections for common domain misspellings

## Agent access (Vestauth)

Docle is a [Vestauth](https://github.com/vestauth/vestauth) tool. Agents can authenticate with cryptographic signatures and get higher rate limits.

```bash
# create an agent identity
vestauth agent init

# verify an email
vestauth agent curl -X POST https://docle.co/api/verify \
  -H "Content-Type: application/json" \
  -d '{"emails":["test@example.com"]}'

# check your usage
vestauth agent curl https://docle.co/api/agent/usage
```

Authenticated agents get 60 requests/min and 5,000 emails/day (vs 10/min and 500/day for anonymous).

## Rate limits

| Limit | Default |
|---|---|
| Requests/min per IP | 10 |
| Emails/day per IP | 500 |
| Max batch size | 500 |
| Concurrent requests per IP | 2 |
| Global daily ceiling | 50,000 |

All configurable via environment variables (e.g. `NUXT_RATE_LIMIT_DAILY_EMAIL_CAP=1000`).

## Setup

```bash
npm install -g openboot
boot setup
```

## Development

```bash
boot dev # or boot up
```

## Optional

Set `NUXT_HIBP_API_KEY` to enable Have I Been Pwned breach checks ($3.50/month from haveibeenpwned.com).

## License

[FSL-1.1-MIT](LICENSE)
