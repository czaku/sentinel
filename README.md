# Sentinel

Product integrity guardian — schema, contracts, chaos, visual, and flow testing across every platform.

Sentinel is a standalone tool used by any project that ships to multiple platforms (iOS, Android, web, API). It is the single thing that answers: *is this product correct, consistent, and complete?*

## What It Does

| Layer | Command | What it checks |
|-------|---------|----------------|
| **Schema** | `sentinel schema:validate` | Feature completeness, platform drift, stale generated files |
| **Generate** | `sentinel schema:generate` | Tokens → Swift/Kotlin/CSS, strings → Swift/XML/TS, flags → all platforms, models → Swift structs/Kotlin data classes, navigation → AppRoute enums |
| **Contracts** | `sentinel contracts` | API endpoints without consumers, views without API backing, feature matrix |
| **Chaos** | `sentinel chaos` | Network failure, auth failure, data corruption, platform-specific edge cases |
| **Flows** | `sentinel flows` | Maestro (native) + Playwright (web) E2E flows |
| **Visual** | `sentinel visual` | Screenshot capture, regression diff, AI cross-platform parity |
| **Perf** | `sentinel perf` | API response time budgets (p50/p95 vs declared maxMs) |
| **Brain** | `sentinel brain` | AI analysis of all results → GitHub issues |

## Setup

```bash
# In your project root:
npx sentinel init
```

This creates:
- `sentinel.yaml` — the contract declaration
- `sentinel/` — all sentinel-owned files (schemas, chaos, flows, visual, perf)

## Project Structure

Every project using sentinel has this layout:

```
myproject/
├── sentinel.yaml              ← declare what this project promises
├── sentinel/                  ← sentinel owns everything in here
│   ├── schemas/
│   │   ├── features/          ← one .json per feature
│   │   ├── design/
│   │   │   ├── tokens.json    ← design tokens (source of truth)
│   │   │   └── strings.json   ← all copy (source of truth)
│   │   ├── platform/
│   │   │   ├── navigation.json       ← screens, tabs, deep links
│   │   │   └── feature-flags.json   ← flag keys per platform
│   │   └── models/            ← shared data model schemas
│   │       └── workout.json
│   ├── chaos/                 ← project-specific chaos scenarios
│   ├── flows/
│   │   ├── maestro/           ← native E2E flows (.yaml)
│   │   └── playwright/        ← web E2E tests (.spec.ts)
│   ├── visual/
│   │   └── baselines/         ← screenshot baselines
│   └── perf/
│       └── budgets.yaml       ← p50/p95 response time budgets per endpoint
└── docs/                      ← human documentation only
```

The internal structure of `sentinel/` is fixed. Projects do not configure it.

## sentinel.yaml

```yaml
sentinel: "1.0"
project: fitkind
version: 1.0.0
location: ./sentinel          # hardcoded convention — don't change

platforms:
  api:
    path: ./backend
    language: typescript
    framework: nestjs

  apple:
    path: ./apple
    language: swift
    output:
      tokens:  ./apple/FitKind/DesignSystem/Tokens/FitKindTokens.swift
      strings: ./apple/FitKind/Resources/Strings.swift
      flags:   ./apple/FitKind/Core/FeatureFlags.swift

  google:
    path: ./google
    language: kotlin
    output:
      tokens:  ./google/app/src/main/kotlin/com/fitkind/design/FitKindTokens.kt
      strings: ./google/app/src/main/res/values/strings.xml
      flags:   ./google/app/src/main/kotlin/com/fitkind/core/FeatureFlags.kt

chaos:
  targets:
    api: http://localhost:3000
```

## Feature Schema

Each feature in `sentinel/schemas/features/` declares what it promises across every platform:

```json
{
  "$sentinel": "1.0",
  "type": "feature",
  "id": "workout-logging",
  "name": "Workout Logging",
  "milestone": 1,
  "status": "planned",
  "tier": "free",
  "platforms": {
    "api":    { "status": "planned", "endpoints": ["POST /workouts", "GET /workouts"] },
    "apple":  { "status": "planned", "screens": ["WorkoutListView", "ActiveWorkoutView"] },
    "google": { "status": "planned", "screens": ["WorkoutListScreen", "ActiveWorkoutScreen"] }
  },
  "flags": ["WORKOUT"],
  "strings": ["workout.start_button", "workout.finish_button"]
}
```

Sentinel validates: every declared screen exists, every endpoint has a consumer, no platform is left behind.

## Model Schema

Shared data models in `sentinel/schemas/models/` generate Swift structs and Kotlin data classes from a single definition:

```json
{
  "$sentinel": "1.0",
  "type": "model",
  "id": "workout",
  "name": "Workout",
  "platforms": ["apple", "google"],
  "fields": [
    { "name": "id",         "type": "UUID",    "optional": false },
    { "name": "name",       "type": "String",  "optional": false },
    { "name": "startedAt",  "type": "Date",    "optional": false },
    { "name": "durationMs", "type": "Int",     "optional": true  }
  ]
}
```

Generates:
- `struct Workout: Codable, Identifiable` (Swift)
- `@Serializable data class Workout(...)` (Kotlin)

Enums are supported via `"isEnum": true` with `"enumValues": [{ "name": "active", "rawValue": "active" }]`.

## Chaos Scenarios

Sentinel ships built-in scenario categories — no setup required:

| Category | Scenarios |
|----------|-----------|
| **auth** | No token → 401, expired token → 401, wrong role → 403 |
| **network** | Offline mode, slow 3G simulation, concurrent requests |
| **data** | Corrupt JSON → 400, empty collection → `[]`, large payload → 413 |
| **payment** | Card declined → 402/403, subscription expired, webhook shape |
| **platform** | Low storage, background kill recovery, clock skew |

Write project-specific chaos scenarios in `sentinel/chaos/`:

```typescript
// sentinel/chaos/workout-offline.ts
import { NetworkChaosScenario } from 'sentinel/chaos/scenarios/network'

export default class WorkoutOfflineScenario extends NetworkChaosScenario {
  id = 'workout-offline'
  description = 'Active workout → network drops → must save locally, no data loss'

  async run(opts) {
    return this.simulateOffline(opts, async () => {
      // assert offline save behaviour
      return { passed: true, observations: ['Local save succeeded'] }
    })
  }
}
```

## CI Integration

A ready-to-use GitHub Actions workflow template is at [`templates/sentinel-ci.yml`](./templates/sentinel-ci.yml). Copy it into your project:

```bash
cp node_modules/sentinel/templates/sentinel-ci.yml .github/workflows/sentinel.yml
```

The template runs schema validation, contract checks, and chaos tests on every push, with optional perf and visual checks on staging. It posts results to the GitHub Actions step summary and can create GitHub issues for failures when `ANTHROPIC_API_KEY` and `SENTINEL_GITHUB_TOKEN` are configured.

## Adopters

- [fitkind](../fitkind) — native iOS/Android fitness tracker
- [univiirse](../univiirse) — AI storytelling platform
- [goala](../goala) — AI productivity assistant
