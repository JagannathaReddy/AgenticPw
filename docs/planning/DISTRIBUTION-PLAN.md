# AgenticPw — Distribution plan

> **Status:** Planning · **Audience:** product + eng  
> **Context:** Teammate (Phases 0–6) ships self-hosted today. This doc is how we put it in end users’ hands.

---

## 1. Three delivery modes

| Mode | Who runs infra | End-user setup | Best for |
|------|----------------|----------------|----------|
| **Self-hosted (now)** | Customer | Node, Docker, LLM key, `npm run dev` | Design partners, power users, internal teams |
| **Team server** | Customer IT | One VM + same stack; team hits internal URL | Small QA teams without SaaS |
| **Hosted SaaS (future)** | Us | Sign up, connect GitHub, assign in browser | Paying customers at scale |
| **Desktop shell (optional)** | Customer (bundled launcher) | Install `.app` / `.exe`; app starts local stack | QA leads who won’t use a terminal |

**Not in v1:** Tauri rewrite, embedded Postgres in desktop, auto-merge PRs (L4–L5).

---

## 2. What we ship today (self-hosted)

```bash
git clone …/AgenticPw.git && npm install && npm run dev:up
cp .env.example .env   # LLM key
npm run dev              # API :3001, worker, web :3000
npm run agent -- init /path/to/playwright-repo --name my-app
npm run agent -- assign --regression --repo my-app
```

**Surfaces**

- Web: `http://localhost:3000/teammate` (inbox, assign, reports)
- CLI: `npm run agent -- …` (assign, auth-bootstrap, doctor, qa)
- CI: `.github/workflows/teammate-*.yml`, `.github/actions/teammate`

**Outreach rule** ([OUTREACH-KIT.md](../outreach/OUTREACH-KIT.md)): prospects get a **Loom demo** first; don’t ask cold leads to install locally.

---

## 3. Team rollout (no SaaS yet)

One “platform owner” on a shared VM:

1. `npm run dev:up` + `npm run dev` (or `pm2` / systemd for API + worker)
2. Postgres on same host (Docker)
3. Team uses `http://qa-server:3000` or SSH tunnel
4. CI in each repo calls `POST /v1/webhooks/assignments` or GitHub Action

Same trust model as laptop: diffs until `--auto-apply` (L2).

---

## 4. Hosted SaaS (future — parked)

Target shape is in [Q1-TECHNICAL-DESIGN.md](../design/Q1-TECHNICAL-DESIGN.md) and `infra/future/`.

**User experience**

- Sign up → connect GitHub → pick repo → Assign regression / fix / story
- No Docker on their machine; we run API, worker pool, Postgres (multi-tenant RLS)

**We still don’t host their Playwright repo long-term** — clone for jobs, return diffs/reports/PRs.

**Build order (after self-hosted traction)**

1. Single-tenant cloud deploy (one customer, our VPC)
2. WorkOS auth + workspace model
3. Multi-tenant RLS + billing
4. Optional browser pool (gVisor) — explicitly deferred in TEAMMATE-PLAN

---

## 5. Desktop app (Electron first)

### Why not “just Electron everything”

Current stack = **Postgres + API + Worker (Playwright) + Next.js**. A desktop app is a **shell around a local server**, not a single binary (yet).

| Blocker | Desktop impact |
|---------|----------------|
| Postgres in Docker | Users hate “install Docker first” |
| Playwright browsers | Large, per-OS install |
| Repo on disk | Worker must read customer `local_path` |
| Next.js | Needs Node server unless static export |
| LLM keys | User or org key in settings |

**Tauri:** smaller UI bundle but Node API/worker becomes an awkward **sidecar**. Prefer **Electron** for v1 desktop (same Node ecosystem).

### Phased desktop

#### Phase D1 — Thin shell (≈1–2 weeks)

Electron app that:

1. First launch: run **doctor** checks (Node 22+, Docker, LLM key, Playwright)
2. Start: `dev:up` equivalent + API + worker (child processes)
3. Window: webview → `http://127.0.0.1:3000/teammate`
4. Tray: stop/start stack, open logs, open settings (.env)

**Still requires Docker.** Value = no terminal, one icon, guided setup.

#### Phase D2 — No Docker for desktop (≈1–2 months)

- Desktop edition: **SQLite** or embedded Postgres binary (schema/RLS port)
- Bundle API+worker (single Node process or `pkg` binary)
- First-run: `playwright install chromium` in target repo or app cache
- Auto-update (electron-updater)

#### Phase D3 — Hybrid

- Desktop = inbox + assign + reports only
- Worker runs on **CI** or **team server**; desktop talks to remote API

### Skip if

- Hosted SaaS is the primary GTM and desktop adds little
- Design partners are fine with CLI + web on localhost

---

## 6. Recommended GTM sequence

| Stage | Deliverable | User |
|-------|-------------|------|
| **Now** | Self-hosted + demo video + CI action | Design partners |
| **Next** | One-page `install.sh` / Docker Compose “all-in-one” | Friendly teams |
| **Optional** | Electron D1 thin shell | QA leads anti-terminal |
| **Later** | Single-tenant hosted | First paying customer |
| **Scale** | Multi-tenant SaaS | Many customers |

---

## 7. Success criteria

**Self-hosted**

- One command after clone: `npm run dev:up && npm run dev`
- `agent doctor` green; Teammate assign → report without hand-holding

**Desktop D1**

- Install → doctor → Teammate inbox in &lt;5 min (with Docker already installed)

**Hosted**

- Sign up → connect repo → assign regression → report with no local install

---

## 8. Out of scope

- Tauri-first desktop
- Customer-repo `LOOP.md` / `STATE.md` (TEAMMATE-PLAN §13)
- L4–L5 auto-merge
- Unbounded cloud browser pool in v1

---

## 9. Related docs

- [TEAMMATE-PLAN.md](./TEAMMATE-PLAN.md) — orchestration feature plan (shipped)
- [OUTREACH-KIT.md](../outreach/OUTREACH-KIT.md) — how to share before install
- [Q1-TECHNICAL-DESIGN.md](../design/Q1-TECHNICAL-DESIGN.md) — future SaaS architecture
- [README.md](../../README.md) — current self-hosted quick start
