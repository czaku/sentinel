# sentinel

## One-liner
Sentinel is a cross-platform "product integrity" CLI: a single source of truth and CI/release gate that keeps design tokens, strings, feature flags, data models, API contracts, network mocks, and the screen catalog consistent and validated across iOS, Android, and web.

## Functionality / capabilities (current + PLANNED — the full picture)

Sentinel positions itself around one question: *"Is this product correct, consistent, and complete?"* It is a Node/TypeScript CLI (`@sentinel/cli`, bin `sentinel`) installed as a dev dependency and wired into `package.json` scripts and CI.

**Schema validation + code generation (the core)**
- `schema:validate` — validates all schemas, checks for generated-file drift, warns on missing fixtures. Intended to run before every task ("Before Every Task" in SENTINEL.md) and in CI.
- `schema:generate` — generates platform-native code for tokens, strings, feature flags, data models, and endpoints from one set of JSON schemas. Per-platform generators exist for Apple (Swift), Google/Android (Kotlin), Web, and a shared layer (`src/schema/generators/{apple,google,web,shared}`).
- Schemas live in `sentinel/schemas/` (design tokens, strings, feature flags, models, navigation, mock-config). Generated outputs are declared in `sentinel.yaml → platforms[*].output` and must never be hand-edited — edit schema, regenerate. Individual generator commands are also dispatchable: `tokens`, `strings`, `feature-flags`, `navigation`, `feature`, `model`, `endpoints`, `mock-config`.

**Contracts**
- `contracts` — validates that API endpoint model references are consistent across platforms.
- `contracts:matrix` — contract matrix view across platforms.

**Network-level mocking (described as the "flagship feature")**
- `mock:generate` — generates `MockURLProtocol.swift` (iOS `URLProtocol` subclass) and `MockDispatcher.kt` (Android `MockWebServer` Dispatcher) from `mock-config.json`. Interception happens at the transport layer (`URLSession` / `OkHttpClient`) so app ViewModels/Services/APIClient are unaware they receive local JSON. One fixture JSON set feeds both platforms; path params like `:matchId` become wildcards; simulated ~300ms delay.
- `mock:validate` — validates every fixture file declared in `mock-config.json` exists and matches the endpoint response schema; intended as a CI drift gate (fails when a backend field is removed/changed).

**Screen registry + catalog**
- `registry:scan` — finds screen files (`*View.swift`, `*Screen.kt`, etc.) in the codebase not registered in `sentinel.yaml`. Enforced by a `sentinel-registry` hook; register-first rule before a task is "done".
- `catalog:capture` — captures screenshots for every registered screen via Maestro flows; filterable by screen/os/device/app-variant; supports scroll captures.
- `catalog:upload` — manually upload a single screenshot for screens without a flow.
- `catalog:validate` — CI gate confirming expected legacy screenshots or Atlas artifacts exist.
- `catalog:index` — generates the interactive HTML catalog viewer (the only permitted viewer; hand-crafted screenshot HTML is forbidden).
- Filename convention `{screen}-{os}-{device}-{variant}[-scroll{N}].png`; supported OS `ios18/ios26/android/watchos/tvos`, devices `iphone/ipad/watch/phone/tablet/tv`, variants `light/dark/glossy-light/glossy-dark` (iOS 26 glossy/Liquid-Glass aware).

**Atlas compatibility layer (recently built)**
- `atlas:import` — reads an Atlas manifest + optional session index as a Sentinel compatibility input.
- `atlas:export` — exports legacy `catalog.screens` data into a surface-based migration fixture.
- `atlas:migrate` — writes an explicit migration plan (what Sentinel transforms vs what Atlas owns).
- Models a richer review hierarchy: `surface` (review unit) → `scenario` (one state) → `target` (one OS/device/variant capture). Legacy flat `catalog.screens` is treated as a compatibility layer mapping to a single `default` scenario. Brandie-backed review-pack metadata can be attached by Atlas as resolved `reviewContext`; Sentinel inspects but does not author it.

**Design-token linting**
- `design:validate` — token-drift detection (reuses `checkStaleness`) plus a "no hardcoded values" screen lint (`src/schema/linters/hardcoded-tokens.ts`). Flags hardcoded colours/spacing/font-sizes that should be tokens.

**Quality / doctor / orchestration**
- `doctor` — checks install health, local script wiring, config presence, mock-integration drift, and Atlas migration mistakes; supports Atlas/Brandie diagnostics flags.
- `quality:check` — quality gate command.
- `all` — runs validate → generate → mock:generate.

**Documented but NOT yet wired into the dispatcher (planned / aspirational — open backlog T-LU-016)**
- `chaos` — chaos scenarios (network, auth, data, payment, platform). Source modules exist under `src/chaos/scenarios`.
- `flows` — runs Maestro + Playwright end-to-end flows.
- `visual` — visual parity checks across platforms.
- `perf` — performance benchmarks.
- `brain` — AI-powered ("Claude") root-cause analysis across all Sentinel results; uses `@anthropic-ai/sdk`. README presents it as a feature; backlog notes the command isn't actually wired into the bin.

These five are shipped as npm scripts and documented in the README "What it does" table but error as "Unknown command" when invoked — they are a known gap on the roadmap (decide: wire them up vs mark internal).

## Technology stack
- **Language/runtime:** TypeScript (ESM, `"type": "module"`), Node.js, run via `tsx`; built with `tsc` to `dist/`.
- **CLI:** Commander (`commander ^12`), custom dispatcher in `src/cli/index.ts`.
- **Validation:** AJV (`ajv ^8`) for JSON-schema validation.
- **Config/parsing:** `js-yaml` (sentinel.yaml), `glob`, `chalk`.
- **AI:** `@anthropic-ai/sdk ^0.36` (for `sentinel brain`).
- **Tests:** Vitest (`vitest run`, coverage via `@vitest/coverage-v8`); ~29 test files across config/mock/catalog/doctor/cli/schema/report/chaos.
- **Codegen targets:** Swift (iOS/Apple), Kotlin (Android/Google), Web; mock transports use `URLProtocol` (iOS) and OkHttp `MockWebServer` (Android).
- **External tooling integrations:** Maestro (catalog capture / flows), Playwright (web flows), Firebase (a stray `firebase-debug.log` artifact is committed).
- **Ecosystem:** keel-managed (tasks/specs/decisions), simemu integration, runecode integration, proofy for proof receipts; part of the onlytools monorepo as a git submodule (remote `vykeai/sentinel`).

## Roadmap & keel backlog (the ACTUAL backlog + DECISIONS; describe roadmap + big bets — do NOT judge done-ness/quality)

Sentinel is keel-managed (`keel/` with project.json, waves, specs, tasks). Project tagline in keel: *"Cross-platform integrity and review validation layer."* Stack declared: platforms ios/android/web/api, language TypeScript, frameworks node + simemu. Current shipped version `0.2.1`; an open task (T-LU-025) targets cutting a `v0.3.0` release.

**Big-bet architectural decision (encoded in specs S-001/S-002 and the three completed waves): split of responsibilities with Atlas.** Sentinel is deliberately scoped to be the *validation / audit / migration* layer, NOT the review product. Spec S-001 states Sentinel should own: validation of expected coverage, visual diff + parity, doctor/CI audit behaviour, and compatibility/migration from older proof contracts — and should NOT own the primary surface-catalog authoring workflow, the review dashboard as a standalone product, or app-specific routing. Spec S-001 explicitly lists "reintroducing design token generation responsibilities" as out of scope, indicating an intent to keep Sentinel thin around the Atlas boundary (even though token generation/linting remains present in the codebase).

**Completed waves (status: done):**
- **Wave 1 — Atlas Compatibility + Surface Contract:** normalize platform vocabulary/config aliases, define Atlas adapter types (surface/scenario/path/target), define atlas import/export/migrate CLI contracts + fixtures, session-based capture handoff boundary (T-001..T-004).
- **Wave 2 — Hierarchical Review + Migration:** hierarchical dashboard grouping by path/surface/scenario/target, extend expected-shot/diff/parity validation to Atlas artifacts, doctor checks + migration docs, ecosystem fixtures/compatibility tests for Onlystack/FitKind/Sitches-style configs (T-005..T-008).
- **Wave 3 — Brand-Aware Atlas Diagnostics:** brand-aware Atlas fixtures + docs for Brandie review metadata, doctor diagnostics for missing/stale Brandie review-pack references, optionally surface Brandie review context in dashboard/output, classify validation failures (missing screenshot vs missing review metadata) — keeping Sentinel "thin" while teaching it Brandie awareness (T-009..T-012, spec S-002).

**Recent fix tasks (done):** T-LU-013 fixed CI (add tsc build before `npx sentinel brain` to resolve a `.ts` loader error broken 6+ weeks); T-LU-014 verified sentinel-generated code in downstream consumers (fitkind, sitches, app-starter-kit, goala) is up to date.

**Open backlog — the "open-source launch readiness" wave (todo, P1/P2; from a 2026-06-18 launch-readiness audit):**
- T-LU-015 — `--help` / `--version` are broken (print "Unknown command" and exit 0); add explicit handling.
- T-LU-016 — wire the five documented-but-unimplemented commands (chaos/flows/visual/perf/brain) into the dispatcher, or remove/mark internal.
- T-LU-017 — privacy: real product codenames leak into shipped files (fitkind ×12, sitches, brandie, bundle IDs `com.fitkind.app`); rename to neutral example names.
- T-LU-018 — README Atlas section commands/links are copy-paste broken (reference non-existent `*.fitkind-*` fixtures; 3 absolute `/Users/luke/...` links); fix to `example-app`/`example-brand` + repo-relative.
- T-LU-019 — `onlytools.manifest.json` declares `catalog.tier T0` but owner tiering classifies sentinel as T1 (tier drift); also replace `owner/releaseOwner: luke` with a non-personal handle.
- T-LU-020 — hardcoded maintainer absolute paths leak the home path (keel/project.json, a doctor test fixture); make repo-relative/placeholder.
- T-LU-022 — merge `origin/codex/sentinel-registry-worktree-skip` (27 files, +2256/-619; gate-result.ts, onlytools/validator.ts, scoped mock fixtures) into main before release.
- T-LU-023 — fix npm-audit vulns (2 critical + 4 high + 5 moderate) before open-source release.
- T-LU-024 — run the full ~29-file vitest suite and verify green on main.
- T-LU-025 — cut the first post-merge release tag (v0.3.0), blocked on T-LU-022/023 + remaining open audit tasks.

**Outstanding open branches:** `origin/codex/sentinel-hardening`, `origin/codex/sentinel-registry-worktree-skip` (the latter slated to merge). Recently shipped on main: `design:validate` (token-drift + no-hardcoded-values screen lint), v0.2.0/v0.2.1 releases.

**Roadmap shape:** the near-term roadmap is entirely "harden for open-source launch" (privacy scrub, doc/link fixes, wire-or-remove undocumented commands, fix discovery flags, vuln fixes, green tests, tag v0.3.0). The medium-term architectural bet is the Atlas/Brandie split — Sentinel staying the thin, contract-first validation+migration spine while Atlas owns authoring/review UI and Brandie owns brand/review-pack metadata.

## Moat (defensibility)
- **Cross-platform single-source-of-truth breadth:** one tool spanning tokens + strings + flags + models + API contracts + network mocks + screen catalog across iOS/Android/web. Comparable point tools exist per-concern (Style Dictionary for tokens, codegen tools for models, Maestro/Playwright for flows), but the integrated "one schema → all platforms, validated in CI" surface is the differentiator.
- **Transport-layer mock generation** that produces native interceptors for *both* iOS (`URLProtocol`) and Android (`MockWebServer`) from one fixture set, with schema-validated fixtures as a CI drift gate — a non-trivial, opinionated integration that creates switching cost once wired into an app's debug build + Hilt/Xcode setup.
- **Integration/ecosystem lock-in:** deeply wired into the vyke/onlytools estate (keel, simemu, runecode, proofy, Atlas, Brandie). Downstream apps (fitkind, sitches, app-starter-kit, goala) already depend on its generated code, creating consumer switching costs.
- **Workflow embedding:** register-first hooks, "run before every task", CI gates, and "never hand-edit generated files / never build your own viewer" conventions embed Sentinel as enforced project policy rather than an optional utility.
- **Weak points to note (factual):** TypeScript CLI, no novel algorithm; no license yet (public repo, `licenseInfo: null`); 0 stars; the most differentiated pieces (mock codegen) are replicable by a determined team. Defensibility is integration depth + breadth, not IP.

## Target user & monetization (who pays + pricing/open-core model if known)
**Target user:** teams shipping the same product across iOS + Android (+ web) who need design/string/contract/mock consistency and screenshot-catalog proof — i.e. cross-platform mobile/product engineering teams and the agencies/AI-builders producing such apps. It is explicitly a dev-tooling component of Luke's onlytools open-source dev-tooling initiative (repo is public under `vykeai`, classified T1 "core-tool", `published: false` pending the launch-readiness wave).

**Monetization status:** no pricing or commercial model is defined in the repo. No license file yet. The following are the available, repo-grounded monetization *paths* (not stated decisions):
- **Open-core:** keep the CLI (schema validate/generate, contracts, mock gen, catalog) free and open-source; gate advanced layers behind a paid tier — natural candidates are the AI `brain` analysis, `chaos`/`visual`/`perf` testing suites, and the Atlas hierarchical review/Brandie brand-aware diagnostics.
- **Paid tier / Pro:** team features — shared catalog history, hosted catalog viewer, cross-repo contract registry, CI dashboards, parity reports.
- **Hosted/cloud:** a managed catalog + review service (host the `catalog:index` viewer, store screenshot artifacts, run Atlas review sessions and visual diffs server-side) — fits the existing `prod`/`dev` environment manifest and Atlas/Brandie review model.
- **Licensing / sell-the-shovels to AI builders & agencies:** Sentinel as the integrity/consistency gate inside agentic app factories (it already integrates with runecode, keel, simemu, proofy). Sold as the "is the generated app correct, consistent, complete?" gate for AI-built cross-platform apps — per-seat or per-org licensing to agencies/AI-coding platforms, or bundled as the QA spine of the broader onlytools suite/vyke community offering.

## Sources read
- `/Users/luke/dev/onlytools/sentinel/README.md`
- `/Users/luke/dev/onlytools/sentinel/SENTINEL.md`
- `/Users/luke/dev/onlytools/sentinel/AGENTS.md`
- `/Users/luke/dev/onlytools/sentinel/package.json`, `CHANGELOG.md`, `onlytools.manifest.json`
- `/Users/luke/dev/onlytools/sentinel/keel/` — project.json, execution.yaml, waves/waves.json, specs/S-001.md, specs/S-002.md, and all 25 tasks (T-001..T-012, T-LU-013..T-LU-025)
- `/Users/luke/dev/onlytools/sentinel/src/` tree (cli/index.ts dispatcher cases, schema generators/linters, chaos/visual/perf/brain/flows modules)
- `/Users/luke/dev/onlytools/sentinel/docs/` (atlas-compatibility.md, atlas-migration.md, sitches-pilot.md — listed)
- `/Users/luke/dev/onlytools/onlytools.catalog.json` (sentinel tier/classification entry)
- git log, `git branch -a`, `gh repo view vykeai/sentinel`
- No dedicated DECISIONS doc exists; architectural decisions are encoded in keel specs S-001/S-002 and the three wave definitions. Mac Studio copy not separately consulted (local repo is the canonical working copy and was complete).
