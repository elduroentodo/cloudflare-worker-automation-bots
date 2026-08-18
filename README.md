# Cloudflare Worker Automation Bots

Sanitized, portfolio-ready Cloudflare Worker examples based on Telegram automation systems I developed for operational workflows.

> **Security note:** This repository contains no tokens, API keys, webhook secrets, customer records, phone numbers, payment details, database exports, or production URLs. Use the Worker secrets manager for all credentials; never commit them.

## Projects

| Project | Operational problem | What the Worker does |
| --- | --- | --- |
| [Declara Fácil intake bot](src/declara-facil-worker.js) | Tax-preparation teams spend time explaining required documents, chasing incomplete cases, and manually tracking status. | Guides clients through a conditional checklist, stores case state in D1, receives documents through Telegram, and provides human escalation. |
| [Casanova quotation bot](src/casanova-quotation-worker.js) | Producing service quotations requires repetitive data collection, calculations, document formatting, and back-and-forth corrections. | Collects line items in a Telegram conversation, calculates subtotal/VAT/total, maintains session state, and produces a quotation payload ready for PDF delivery. |

## Architecture

```text
Telegram update
  → Cloudflare Worker webhook
  → validate request + parse event
  → read/write state in Cloudflare D1
  → send guided response through Telegram API
  → optional human handoff or generated document
```

## Running locally

1. Install the [Cloudflare Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/).
2. Copy `wrangler.toml.example` to `wrangler.toml`.
3. Create a D1 database and replace the placeholder database ID locally.
4. Add credentials through Wrangler secrets, for example:

   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_SECRET
   ```

5. Run `npx wrangler dev`.

The values are intentionally not included in this repository.

## Implementation concepts demonstrated

- Webhook endpoints and HTTP status handling
- Telegram Bot API integration
- Event-driven conversational workflows
- Cloudflare D1 schema and parameterized SQL
- Input validation and state transitions
- Duplicate-safe writes using primary keys and upserts
- Human-in-the-loop escalation
- Secrets managed outside source control
