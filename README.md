# Sentinel

Cross-platform schema validation, code generation, and **network-level mock generation** for apps shipping on iOS, Android, and web with a shared backend.

Sentinel answers: *"is this product correct, consistent, and complete?"*

---

## What it does

| Command | What it does |
|---------|-------------|
| `sentinel schema:validate` | Validates all schemas, checks for generated-file drift, warns on missing fixtures |
| `sentinel schema:generate` | Generates tokens, strings, feature flags, models for all platforms |
| `sentinel contracts` | Validates endpoint model references are consistent |
| `sentinel mock:generate` | Generates `MockURLProtocol.swift` (iOS) + `MockDispatcher.kt` (Android) from fixture mappings |
| `sentinel mock:validate` | Validates all fixture JSON against endpoint response schemas |
| `sentinel all` | Runs validate → generate → mock:generate |

---

## Network-level mocking

This is Sentinel's flagship feature. The generated mock code intercepts at the **transport layer** — `URLSession` on iOS, `OkHttpClient` on Android. Your app code (ViewModels, Services, APIClient) is completely unaware it is receiving local JSON.

### How it works

```
sentinel/schemas/platform/mock-config.json
    declares: endpoint path → fixture file

sentinel/fixtures/
    radar/nearby.json
    browse/profiles.json
    chat/matches.json
    ...

sentinel mock:generate
    →  ios/…/MockURLProtocol.swift   (URLProtocol subclass, routes URLs → fixture files)
    →  android/…/MockDispatcher.kt   (WireMock Dispatcher, routes paths → asset files)
```

The fixture JSON files live in one place (`sentinel/fixtures/`). Both platforms read from them. When the backend changes a response shape, you update the fixture once and both platforms stay in sync.

### iOS setup

**1. Add `sentinel/fixtures/` as a folder reference in Xcode** (drag into Project Navigator, select "Create folder references", add to **Dev/Debug target only** — never Release).

**2. Register `MockURLProtocol` in your App entry point:**

```swift
// StarterApp.swift
@main
struct MyApp: App {
    init() {
        #if DEBUG
        URLProtocol.registerClass(MockURLProtocol.self)
        #endif
    }
}
```

**3. Run `sentinel mock:generate`** whenever you add or change an endpoint.

That's it. Every `URLSession.shared.data(for:)` call in your app now returns local JSON with a 300ms simulated delay.

### Android setup

**1. Copy or symlink `sentinel/fixtures/` into `android/app/src/debug/assets/fixtures/`** — Gradle includes `debug/assets/` in debug builds only.

**2. Add `MockWebServer` and `okhttp-mockwebserver` to your debug dependencies:**

```kotlin
// build.gradle.kts
debugImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
```

**3. Wire `MockDispatcher` in a Hilt debug module:**

```kotlin
// android/app/src/debug/kotlin/…/DebugNetworkModule.kt
@Module
@InstallIn(SingletonComponent::class)
object DebugNetworkModule {
    @Provides @Singleton
    fun provideMockServer(@ApplicationContext ctx: Context): MockWebServer =
        MockWebServer().apply {
            dispatcher = MockDispatcher(ctx.assets)
            start(8080)
        }

    @Provides @Singleton
    fun provideBaseUrl(server: MockWebServer): String = server.url("/").toString()
}
```

**4. Run `sentinel mock:generate`** whenever you add or change an endpoint.

### Fixture validation

Run `sentinel mock:validate` in CI to catch drift before it ships:

```
✓ GET  /api/v1/radar/nearby     → radar/nearby.json
✓ GET  /api/v1/matches          → chat/matches.json
✗ GET  /api/v1/profile/me       → profile/me.json: missing required field 'displayName'
```

If a backend engineer removes or renames a field in the response, CI fails. No silent drift.

---

## Project setup

**1. Install sentinel as a dev dependency:**

```bash
npm install --save-dev sentinel
```

**2. Copy `sentinel.yaml.example` to your repo root as `sentinel.yaml`:**

```bash
cp node_modules/sentinel/sentinel.yaml.example sentinel.yaml
```

Edit the output paths to match your project structure.

**3. Create your schema directory:**

```
sentinel/
├── schemas/
│   ├── design/
│   │   ├── tokens.json
│   │   └── strings.json
│   ├── features/
│   │   └── auth-endpoints.json
│   ├── models/
│   │   └── user.json
│   └── platform/
│       ├── feature-flags.json
│       ├── mock-config.json     ← endpoint → fixture mappings
│       └── navigation.json
└── fixtures/
    ├── auth/
    │   ├── verify-response.json
    │   └── magic-link-response.json
    └── radar/
        └── nearby.json
```

**4. Add to your pre-commit hook or CI:**

```bash
npx sentinel schema:validate
npx sentinel mock:validate
```

---

## mock-config.json format

```json
{
  "$sentinel": "1.0",
  "type": "mock-config",
  "id": "mock-config",

  "fixtures": [
    { "platform": "ios",     "path": "sentinel/fixtures" },
    { "platform": "android", "path": "sentinel/fixtures" }
  ],

  "endpoints": [
    { "method": "GET",  "path": "/api/v1/radar/nearby",   "fixture": "radar/nearby.json" },
    { "method": "POST", "path": "/api/v1/auth/magic-link/verify", "fixture": "auth/verify-response.json" },
    { "method": "GET",  "path": "/api/v1/chat/:matchId/messages", "fixture": "chat/messages.json", "statusCode": 200 }
  ]
}
```

Path parameters like `:matchId` are automatically treated as wildcards in the generated URL routing.

---

## sentinel.yaml platform output fields

```yaml
platforms:
  ios:
    language: swift
    output:
      tokens:    ios/MyApp/DesignSystem/AppTokens.swift
      strings:   ios/MyApp/Core/Strings.swift
      flags:     ios/MyApp/Core/FeatureFlags.swift
      models:    ios/MyApp/Core/Models.swift
      endpoints: ios/MyApp/Core/GeneratedEndpoints.swift
      mock:      ios/MyApp/Core/Network/MockURLProtocol.swift   # ← new

  android:
    language: kotlin
    output:
      tokens:    android/app/src/main/kotlin/…/AppTokens.kt
      strings:   android/app/src/main/res/values/strings.xml
      flags:     android/app/src/main/kotlin/…/FeatureFlags.kt
      models:    android/app/src/main/kotlin/…/Models.kt
      mock:      android/app/src/debug/kotlin/…/MockDispatcher.kt  # ← new
```
