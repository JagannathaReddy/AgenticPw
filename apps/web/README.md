# @poc/web — AgenticPw Console

Next.js UI for the AgenticPw platform. Design reference: [`docs/design/console/`](../../docs/design/console/).

## Dev

From the repo root (with Postgres + API running):

```bash
npm run dev          # api (:3001) + worker + web (:3000)
# or web only:
npm run dev -w @poc/web
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The app proxies `/v1/*` to the Fastify API (`API_URL`, default `http://127.0.0.1:3001`).

## Stack

- Next.js 16 App Router, React 19, Tailwind CSS 4
- Zustand client store, polling against live API data
- Replaces the static SPA previously served at `/console` on the API
