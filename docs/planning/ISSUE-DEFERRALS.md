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

# Deferred enhancements — none left

The v0.2.x pass through issues #11–#20 is now fully shipped; nothing remains
deferred. Kept for the record:

~~#14 batch heal~~ — shipped in v0.5.0-batch and auto-closed by commit b26bfdc;
no comment needed.

~~#16 feedback loop~~ — shipped in v0.6.0-feedback (migration 0013
`heal_feedback`, `agent feedback` + implicit 👍 on apply, healer prompt
retrieval, 3-triple eval slice under the `feedback` tag); auto-closed by the
release commit. No comment needed.

~~#18 GitHub Action~~ — shipped in v0.7.0-ci (`.github/actions/heal`
composite action, `--format github` CLI mode, `heal-on-failure.yml` dogfood
workflow, SECURITY-CI.md); auto-closed by the release commit. No comment
needed.

---
