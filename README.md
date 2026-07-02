# Playwright Specialist POC

Loop Engineering for Playwright in **Cursor** and **VS Code Copilot**, with an optional **Stagehand** autonomous agent.

## Quick start

```bash
npm install
npx playwright install chromium
npm test                    # seed smoke test (https://playwright.dev)
npm run loop                # next loop phase / verification prompt
npm run loop:verify         # run suite + record pass in .loop/
```

**Documentation:** [docs/README.md](docs/README.md) — architecture, IDE setup, loop workflow, agent daemon, npm scripts.

**Before changing tests:** read [docs/LOOP-ENGINEERING.md](docs/LOOP-ENGINEERING.md).
