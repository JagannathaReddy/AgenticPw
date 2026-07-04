# Issue-thread comments to post

## Closing comment for #1 — Developer trial report (close the issue after posting)

> Thank you for the most useful bug report this project has received — a fresh
> Windows machine plus a real internal suite found more in one afternoon than
> weeks of happy-path testing. Every blocker you filed is now fixed and shipped:
>
> **Installability (v0.2.1-installability, issues #2–#9):**
> - #2 build order — workspaces now compile in dependency order
> - #3 `.env` never loaded — all entrypoints use Node's `--env-file-if-exists`
> - #4 `resolveModel` ignored a lone `OPENAI_API_KEY` — fixed, gpt-4o-mini default
> - #5 hardcoded `--project=chromium` — now `PLAYWRIGHT_PROJECT`, or auto-detected
>   from your `playwright.config` at onboarding (#12)
> - #6 rejections now persist the baseline output to `local-artifacts/<id>/`
> - #7 regex classifier misses → LLM fallback classifier before giving up
> - #8/#9 CLI truncation + `--name` path validation
>
> **From your suite's structure (v0.3.0-dx):**
> - #10 the healer now walks the failure's stack trace and loads helper classes
>   (like your `DashboardPage` → `CreateStreetlightPage` chain) as context. When
>   the fix belongs inside a helper it can't patch, you get an explicit
>   `out_of_scope` refusal naming the file, with the model's suggested patch
>   saved in the artifact. `--include '<glob>'` hands it more files explicitly.
> - #11 `agent doctor` — the one-shot environment check this trial clearly needed
> - #13 heal is dry-run by default now: colored diff, `agent apply` to commit it
>
> **And since your report, two more releases you'd care about:**
> - v0.4.0-steward — `agent steward` runs your suite 3×, separates flaky from
>   broken, and names heal candidates in a health report with trend deltas.
> - v0.5.0-batch — #14 shipped: `agent batch --from-steward <id>` heals every
>   candidate under one parent manifest with a per-batch cost cap, then
>   `agent apply --batch <id>` applies all verified patches at once.
>
> Run `git pull && npm install && npm run agent -- doctor` and it should come up
> green. If you have another afternoon in you, I'd genuinely value a second pass —
> the remaining open items (#16 feedback loop, #18 CI mode) are roadmap-ranked
> by exactly this kind of report.

---

# Deferred enhancements — comments to post

The v0.2.x pass through issues #11–#20 is done except for two items whose scope
is bigger than a one-shot commit. Each has a real dependency chain. Comments
below are copy-paste-ready for the issue threads (no `gh` CLI available in the
sandbox that ran the batch).

~~#14 batch heal~~ — shipped in v0.5.0-batch and auto-closed by commit b26bfdc;
no comment needed.

---

## Comment for #16 — Human-in-the-loop feedback signal

> Deferring to a follow-up milestone. Rationale:
>
> Every heal today runs "cold" — the healer has the RepoProfile from #12/#39
> but no memory of prior decisions on this repo. That's the gap #16 wants to
> close (e.g. "we already told the healer never to touch `pages/checkout.page.ts`").
>
> The dependency I don't want to skip:
> 1. **New table `heal_feedback`** with `(workspace_id, repo_id, category,
>    veredict, notes, source_manifest_id, created_at)` and RLS the same way
>    `manifests` has it. New migration.
> 2. **A retrieval step in the healer prompt** — like the RAG few-shot picker
>    (#24) but for feedback rows, not example specs. Needs its own tuning to
>    avoid ballooning the prompt.
> 3. **A CLI verb** — probably `agent feedback <manifestId> --thumbs-{up,down}
>    --note "..."`, plus a `--reason` on `agent apply` that records positive
>    signal automatically.
> 4. **An eval story** — otherwise this feature has no way to prove it
>    actually reduces refuse-to-heal errors. Would extend the eval harness.
>
> Estimated shape: 1 migration, 1 activity (feedback retrieval), 3 CLI verbs,
> new eval slice. ~3 days.
>
> Leaving open, unlabeled → roadmap.

---

## Comment for #18 — GitHub Action / CI mode

> Deferring to a follow-up milestone. Rationale:
>
> Everything in v0.2.x has been laptop-first on purpose (that's why we
> rewrote from cloud SaaS in the first place). CI mode is a real target
> but has infra requirements that the laptop story deliberately punted.
>
> Blockers before this can ship:
> 1. **Postgres in CI** — the Action needs a Postgres service container with
>    RLS + pgvector + our 11 migrations applied on cold start. Not hard but
>    an actual GH Action YAML change.
> 2. **Secrets model** — LLM keys as GH secrets, budget cap per run,
>    `NO_CACHE` gating so caches from #20 don't cross runs on shared
>    runners. Needs a short SECURITY-CI.md.
> 3. **Failure UX** — the CLI's SSE progress + colored diff (#13/#17) don't
>    translate to a GH check summary. Need a `--format=github-actions`
>    output mode that emits `::error` / job summary markdown instead.
> 4. **Cache reuse across runs** — the cache from #20 was built for the same
>    machine. For CI it needs to hook `actions/cache` around the
>    `local-artifacts/cache/` dir.
>
> Estimated shape: 1 `.github/actions/` composite action, 1 CLI output mode,
> 1 docs file. ~2 days once someone actually wants CI.
>
> Leaving open, unlabeled → roadmap.
