# Gameng — System Architecture

> Visual reference of the full Gameng system: Engine, BFF, Sandbox, auth flows, and data model.

---

## 1. High-Level Overview

```mermaid
graph TB
  subgraph Clients["🌐 Clients"]
    direction LR
    Browser["Browser / SPA"]
    Mobile["Mobile App"]
    Bot["Bot / Script"]
  end

  subgraph BFF_Layer["🔐 BFF — Backend For Frontend  :5000"]
    direction TB
    JWT["JWT Auth<br/><small>register · login · refresh</small>"]
    GameAPI["Game API<br/><small>/game/* typed routes</small>"]
    AdminAPI["Admin API<br/><small>/admin/* X-Admin-Secret</small>"]
    SQLite[("SQLite<br/><small>users · sessions</small>")]
    RateLimit["Rate Limiter<br/>Helmet"]
  end

  subgraph Engine_Layer["⚙️ Engine — Game Core  :3000"]
    direction TB
    TxProcessor["TX Processor<br/><small>20+ transaction types</small>"]
    AuthEngine["Actor Auth<br/><small>Bearer API key</small>"]
    StatsCalc["Stats Calculator<br/><small>growth · gear · sets · clamps</small>"]
    StateStore["Game State<br/><small>in-memory Map</small>"]
    Snapshots["Snapshot Manager<br/><small>atomic file persist</small>"]
    Idempotency["Idempotency Cache<br/><small>FIFO per instance</small>"]
    Config["Game Config<br/><small>JSON Schema validated</small>"]
  end

  subgraph Sandbox["🧪 Sandbox — Dev Tools"]
    direction TB
    WebSPA["React SPA  :5173<br/><small>Config · Admin · Player · GM</small>"]
    Launcher["Launcher  :4010<br/><small>Process Manager + Proxy</small>"]
  end

  subgraph Storage["💾 Persistence"]
    SnapFiles[("Snapshots<br/><small>JSON files</small>")]
    BffDb[("bff.sqlite<br/><small>users table</small>")]
    ConfigFiles[("Config JSON<br/><small>game_config</small>")]
  end

  %% Client flows
  Browser -->|"HTTPS + JWT"| JWT
  Mobile -->|"HTTPS + JWT"| GameAPI
  Bot -->|"HTTPS + JWT"| GameAPI

  %% BFF internal
  JWT --> SQLite
  GameAPI --> SQLite
  AdminAPI --> SQLite
  RateLimit -.->|guards| JWT
  RateLimit -.->|guards| GameAPI

  %% BFF → Engine
  GameAPI -->|"HTTP + Bearer apiKey"| TxProcessor
  GameAPI -->|"HTTP"| StatsCalc
  AdminAPI -->|"HTTP + Admin Key"| TxProcessor
  JWT -->|"CreateActor + CreatePlayer"| TxProcessor

  %% Engine internal
  TxProcessor --> AuthEngine
  TxProcessor --> StateStore
  TxProcessor --> Idempotency
  StatsCalc --> StateStore
  StatsCalc --> Config
  StateStore --> Snapshots

  %% Sandbox flow
  WebSPA -->|"HTTP"| Launcher
  Launcher -->|"proxy /engine/*"| TxProcessor
  Launcher -->|"spawn/stop"| Engine_Layer

  %% Storage
  Snapshots --> SnapFiles
  SQLite --> BffDb
  Config --> ConfigFiles

  %% Styling
  classDef client fill:#e8f4fd,stroke:#2196f3,stroke-width:2px,color:#1565c0
  classDef bff fill:#fff3e0,stroke:#ff9800,stroke-width:2px,color:#e65100
  classDef engine fill:#e8f5e9,stroke:#4caf50,stroke-width:2px,color:#2e7d32
  classDef sandbox fill:#f3e5f5,stroke:#9c27b0,stroke-width:2px,color:#6a1b9a
  classDef storage fill:#fce4ec,stroke:#e91e63,stroke-width:2px,color:#880e4f

  class Browser,Mobile,Bot client
  class JWT,GameAPI,AdminAPI,SQLite,RateLimit bff
  class TxProcessor,AuthEngine,StatsCalc,StateStore,Snapshots,Idempotency,Config engine
  class WebSPA,Launcher sandbox
  class SnapFiles,BffDb,ConfigFiles storage
```

---

## 2. Network Topology & Ports

```mermaid
graph LR
  subgraph Internet
    Client
  end

  subgraph Production
    BFF["BFF :5000"]
    ENG["Engine :3000"]
  end

  subgraph Sandbox
    SPA["React SPA :5173"]
    LNCH["Launcher :4010"]
    ENGDEV["Engine :3000"]
  end

  Client -->|"JWT + HTTPS"| BFF
  BFF -->|"Bearer apiKey"| ENG

  SPA -->|"HTTP"| LNCH
  LNCH -->|"proxy /engine/*"| ENGDEV
  LNCH -.->|"spawn / stop"| ENGDEV
```

---

## 3. Authentication Chain

The system uses a **dual-auth model**: JWT for external clients (via BFF), Bearer API keys for engine-level identity.

```mermaid
sequenceDiagram
  autonumber
  participant C as 🌐 Client
  participant B as 🔐 BFF
  participant DB as 🗄️ SQLite
  participant E as ⚙️ Engine

  Note over C,E: Registration (once per user)

  C->>+B: POST /auth/register<br/>{email, password}
  B->>B: Validate input + check duplicate

  B->>+E: POST /tx CreateActor<br/>Authorization: Bearer ADMIN_KEY
  E-->>-B: accepted

  B->>+E: POST /tx CreatePlayer<br/>Authorization: Bearer apiKey
  E-->>-B: accepted

  B->>B: bcrypt.hash(password)
  B->>DB: INSERT user (email, hash, actorId, apiKey, playerId)
  B->>B: jwt.sign(sub, actorId, playerId)
  B-->>-C: 201 token + playerId

  Note over C,E: Login (returns existing actor + player)

  C->>+B: POST /auth/login<br/>{email, password}
  B->>DB: SELECT user WHERE email = ?
  B->>B: bcrypt.compare(password, hash)
  Note over B: Actor, Player, Characters, Gear<br/>all persist in Engine — nothing created
  B->>B: jwt.sign(sub, actorId, playerId)
  B-->>-C: 200 token + playerId

  Note over C,E: Authenticated Game Request (after register OR login)

  C->>+B: POST /game/equip<br/>Authorization: Bearer JWT
  B->>B: jwt.verify(token)
  B->>DB: SELECT api_key WHERE id = jwt.sub
  B->>+E: POST /tx EquipGear<br/>Authorization: Bearer apiKey
  E->>E: resolveActor(apiKey)
  E->>E: actorOwnsPlayer(actor, playerId)
  E->>E: Process transaction
  E-->>-B: accepted + stateVersion
  B-->>-C: accepted + stateVersion
```

---

## 4. Identity & Ownership Model

```mermaid
erDiagram
  BFF_USER ||--|| ENGINE_ACTOR : "1:1 mapping"
  ENGINE_ACTOR ||--|| ENGINE_PLAYER : "owns"
  ENGINE_PLAYER ||--o{ CHARACTER : "has many"
  ENGINE_PLAYER ||--o{ GEAR_INSTANCE : "owns many"
  CHARACTER ||--o{ EQUIPPED_SLOT : "has slots"
  GEAR_INSTANCE ||--o| CHARACTER : "equipped by"

  BFF_USER {
    int id PK
    string email UK
    string password_hash
    string actor_id FK
    string api_key
    string player_id FK
  }

  ENGINE_ACTOR {
    string actorId PK
    string apiKey UK
    string[] playerIds
  }

  ENGINE_PLAYER {
    string playerId PK
    map characters
    map gear
    map resources
  }

  CHARACTER {
    string characterId PK
    string classId FK
    int level
    map equipped
    map resources
  }

  GEAR_INSTANCE {
    string gearId PK
    string gearDefId FK
    int level
    string equippedBy
  }

  EQUIPPED_SLOT {
    string slotName PK
    string gearId FK
  }
```

---

## 5. Transaction Processing Pipeline

```mermaid
flowchart TB
  Start([POST /:gameInstanceId/tx])

  Start --> ValidateInstance{Instance<br/>exists?}
  ValidateInstance -->|No| E404[404 INSTANCE_NOT_FOUND]
  ValidateInstance -->|Yes| CheckIdempotency{txId in<br/>cache?}

  CheckIdempotency -->|Yes| CachedResponse[Return cached response]
  CheckIdempotency -->|No| CheckType{TX type?}

  subgraph AdminBlock["Admin TX (no actor auth)"]
    AdminAuth{Admin Key<br/>matches?}
    AdminAuth -->|No| E401A[401 UNAUTHORIZED]
    AdminAuth -->|Yes| AdminHandler["CreateActor<br/>GrantResources<br/>GrantCharacterResources"]
  end

  subgraph PlayerBlock["Player TX (actor auth)"]
    ActorAuth{Bearer token<br/>valid?}
    ActorAuth -->|No| E401B[401 UNAUTHORIZED]
    ActorAuth -->|Yes| OwnerCheck{Actor owns<br/>player?}
    OwnerCheck -->|No| E403[403 OWNERSHIP_VIOLATION]
    OwnerCheck -->|Yes| TxHandler
  end

  CheckType -->|"CreateActor<br/>GrantResources<br/>GrantCharResources"| AdminAuth
  CheckType -->|"All other types"| ActorAuth

  TxHandler["Process TX<br/><small>CreatePlayer · CreateCharacter<br/>CreateGear · EquipGear · UnequipGear<br/>LevelUpCharacter · LevelUpGear</small>"]

  AdminHandler --> MutateState
  TxHandler --> MutateState

  MutateState["Mutate GameState<br/>Bump stateVersion"]
  MutateState --> CacheResponse["Cache in txIdCache"]
  CacheResponse --> Response(["200 accepted + stateVersion"])

  E404 --> End(["Response sent"])
  E401A --> CacheErr["Cache error response"]
  E401B --> CacheErr
  E403 --> CacheErr
  CacheErr --> End
  CachedResponse --> End
  Response --> End

  classDef success fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
  classDef error fill:#ffcdd2,stroke:#c62828,color:#b71c1c
  classDef process fill:#e3f2fd,stroke:#1565c0,color:#0d47a1
  classDef cache fill:#fff9c4,stroke:#f9a825,color:#f57f17

  class Response,AdminHandler,TxHandler success
  class E404,E401A,E401B,E403 error
  class MutateState,Start process
  class CachedResponse,CacheResponse,CacheErr cache
```

---

## 6. Stats Computation Pipeline

```mermaid
flowchart LR
  subgraph Step1["Step 1: Base Stats"]
    ClassDef["ClassDef<br/><small>baseStats map</small>"]
  end

  subgraph Step2["Step 2: Growth"]
    Growth["Growth Algorithm<br/><small>flat · linear · exponential</small>"]
    Factor["factor = f(level)<br/><small>linear: 1 + (lvl-1) × mult</small>"]
  end

  subgraph Step3["Step 3: Gear"]
    GearStats["GearDef Stats<br/><small>per equipped piece</small>"]
    GearGrowth["Gear Growth<br/><small>same algorithm, gear level</small>"]
  end

  subgraph Step4["Step 4: Set Bonuses"]
    SetCheck["Count equipped<br/>per setId"]
    Bonus2["2-piece bonus"]
    Bonus4["4-piece bonus"]
  end

  subgraph Step5["Step 5: Clamps"]
    Clamp["statClamps<br/><small>min/max per stat</small>"]
  end

  ClassDef --> Growth --> Factor
  Factor -->|"× class stats"| Sum["Sum All"]
  GearStats --> GearGrowth -->|"× gear stats"| Sum
  SetCheck --> Bonus2 --> Sum
  SetCheck --> Bonus4 --> Sum
  Sum --> Clamp --> Final(["finalStats"])

  classDef step fill:#e8eaf6,stroke:#3f51b5,color:#1a237e
  classDef result fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20

  class ClassDef,Growth,Factor step
  class GearStats,GearGrowth step
  class SetCheck,Bonus2,Bonus4 step
  class Clamp step
  class Final result
```

---

## 7. BFF Route Map

```mermaid
graph TB
  subgraph Public["🔓 Public (no auth)"]
    H["GET /health"]
    GH["GET /game/health"]
    GC["GET /game/config"]
    GV["GET /game/version"]
  end

  subgraph Auth["🔑 Auth Routes (rate-limited)"]
    REG["POST /auth/register<br/><small>5 req/min</small>"]
    LOG["POST /auth/login<br/><small>10 req/min</small>"]
    REF["POST /auth/refresh<br/><small>JWT required</small>"]
  end

  subgraph Game["🎮 Game Routes (JWT required)"]
    GP["GET /game/player"]
    GS["GET /game/stats/:charId"]
    CC["POST /game/character"]
    CG["POST /game/gear"]
    EQ["POST /game/equip"]
    UE["POST /game/unequip"]
    LC["POST /game/levelup/character"]
    LG["POST /game/levelup/gear"]
    TX["POST /game/tx<br/><small>raw passthrough</small>"]
  end

  subgraph Admin["🛡️ Admin Routes (X-Admin-Secret)"]
    GR["POST /admin/grant-resources"]
    GCR["POST /admin/grant-character-resources"]
    LU["GET /admin/users"]
  end

  subgraph Engine["⚙️ Engine"]
    ETXP["POST /:id/tx"]
    EGET["GET /:id/state/player/:pid"]
    ESTAT["GET /:id/character/:cid/stats"]
    ECONF["GET /:id/config"]
    EVER["GET /:id/stateVersion"]
    EHLT["GET /health"]
  end

  H -->|probe| EHLT
  GH --> EHLT
  GC --> ECONF
  GV --> EVER

  REG -->|"CreateActor + CreatePlayer"| ETXP
  GP -->|"inject apiKey"| EGET
  GS -->|"inject apiKey"| ESTAT
  CC -->|"auto-fill txId, playerId"| ETXP
  CG --> ETXP
  EQ --> ETXP
  UE --> ETXP
  LC --> ETXP
  LG --> ETXP
  TX --> ETXP

  GR -->|"admin key"| ETXP
  GCR -->|"admin key"| ETXP

  classDef pub fill:#e8f5e9,stroke:#4caf50,color:#1b5e20
  classDef auth fill:#fff3e0,stroke:#ff9800,color:#e65100
  classDef game fill:#e3f2fd,stroke:#2196f3,color:#0d47a1
  classDef admin fill:#fce4ec,stroke:#e91e63,color:#880e4f
  classDef eng fill:#f5f5f5,stroke:#616161,color:#212121

  class H,GH,GC,GV pub
  class REG,LOG,REF auth
  class GP,GS,CC,CG,EQ,UE,LC,LG,TX game
  class GR,GCR,LU admin
  class ETXP,EGET,ESTAT,ECONF,EVER,EHLT eng
```

---

## 8. Sandbox Architecture

```mermaid
graph TB
  subgraph Browser["🖥️ Browser"]
    subgraph Pages["React SPA  :5173"]
      P1["⚡ Server Control<br/><small>start · stop · restart · logs</small>"]
      P2["📝 Config Editor<br/><small>visual + JSON · presets · validate</small>"]
      P3["👑 Admin Console<br/><small>seed demo · grant resources</small>"]
      P4["🎮 Player Client<br/><small>equip · level up · activity feed</small>"]
      P5["🔍 GM Dashboard<br/><small>inspect · tx builder · registry</small>"]
      P6["🎬 Scenario Runner<br/><small>scripted flows · variables · export</small>"]
    end
  end

  subgraph Launcher_Process["Launcher  :4010"]
    Control["Control API<br/><small>/control/*</small>"]
    Proxy["Engine Proxy<br/><small>/engine/*</small>"]
    ConfigMgr["Config Manager<br/><small>save active.json</small>"]
    EPM["EngineProcessManager<br/><small>spawn · stop · restart</small>"]
    LogBuf["LogBuffer<br/><small>2000-line ring</small>"]
  end

  subgraph Engine_Process["Engine  :3000"]
    EngRoutes["Routes<br/><small>tx · state · stats · config</small>"]
    EngState["GameState<br/><small>in-memory</small>"]
    EngSnap["Snapshots<br/><small>sandbox/data/snapshots/</small>"]
  end

  P1 -->|"POST /control/start"| Control
  P1 -->|"GET /control/logs"| LogBuf
  P2 -->|"POST /control/save-config"| ConfigMgr
  P3 -->|"POST /engine/:id/tx"| Proxy
  P4 -->|"POST /engine/:id/tx"| Proxy
  P4 -->|"GET /engine/:id/stateVersion"| Proxy
  P5 -->|"POST /engine/:id/tx"| Proxy
  P6 -->|"POST /engine/:id/tx"| Proxy

  Control --> EPM
  EPM -->|"child_process.spawn"| Engine_Process
  Proxy -->|"HTTP forward"| EngRoutes
  ConfigMgr -->|"write active.json"| EngSnap

  EngRoutes --> EngState
  EngState --> EngSnap

  classDef page fill:#e8eaf6,stroke:#5c6bc0,color:#1a237e
  classDef launcher fill:#fff3e0,stroke:#ff9800,color:#e65100
  classDef engine fill:#e8f5e9,stroke:#4caf50,color:#1b5e20

  class P1,P2,P3,P4,P5,P6 page
  class Control,Proxy,ConfigMgr,EPM,LogBuf launcher
  class EngRoutes,EngState,EngSnap engine
```

---

## 9. Snapshot Lifecycle

```mermaid
stateDiagram-v2
  [*] --> Empty: First boot (no snapshot)
  [*] --> Restore: Snapshot exists on disk

  Restore --> Migrate: migrateStateToConfig()
  Migrate --> Running: State in memory

  Empty --> Running: Fresh GameState created

  Running --> Dirty: TX processed (stateVersion++)
  Dirty --> Flush: Periodic timer OR app.close()
  Flush --> AtomicWrite: Write .tmp file
  AtomicWrite --> Rename: Validate JSON Schema
  Rename --> Running: snapshot.json updated

  Dirty --> Running: Read-only requests (stats, config)

  Running --> [*]: Process exit
```

---

## 10. Scoped Resources & Cost Flow

```mermaid
flowchart TB
  subgraph Wallets["Resource Wallets"]
    PW["Player.resources<br/><small>{gold: 1000, gems: 50}</small>"]
    CW["Character.resources<br/><small>{xp: 500, dust: 100}</small>"]
  end

  subgraph Algorithm["Cost Algorithm"]
    LC["levelCostCharacter<br/><small>mixed_linear_cost</small>"]
    LG["levelCostGear<br/><small>linear_cost</small>"]
  end

  subgraph Parse["parseScopedCost()"]
    Split["Split by prefix:<br/><small>player.gold → player wallet<br/>character.xp → character wallet</small>"]
  end

  subgraph Validate["Validation"]
    Check1["hasResources(player, playerCost)?"]
    Check2["hasResources(character, charCost)?"]
  end

  LC -->|"{ player.gold: 15, character.xp: 150 }"| Split
  LG -->|"{ player.gold: 10 }"| Split
  Split --> Check1
  Split --> Check2
  Check1 -->|OK| Deduct1["Deduct from Player"]
  Check2 -->|OK| Deduct2["Deduct from Character"]
  Check1 -->|Fail| Err["INSUFFICIENT_RESOURCES"]
  Check2 -->|Fail| Err

  Deduct1 --> PW
  Deduct2 --> CW

  classDef wallet fill:#e8f5e9,stroke:#4caf50,color:#1b5e20
  classDef algo fill:#e3f2fd,stroke:#2196f3,color:#0d47a1
  classDef err fill:#ffcdd2,stroke:#c62828,color:#b71c1c

  class PW,CW wallet
  class LC,LG,Split algo
  class Err err
```

---

## 11. Environment Variables Summary

| Variable | Default | Component | Description |
|----------|---------|-----------|-------------|
| `PORT` | `3000` | Engine | HTTP listen port |
| `HOST` | `0.0.0.0` | Engine | Listen address |
| `ADMIN_API_KEY` | _(none)_ | Engine | Admin bearer token for CreateActor/Grant |
| `SNAPSHOT_DIR` | `snapshots/` | Engine | Persistence directory |
| `SNAPSHOT_INTERVAL_MS` | `10000` | Engine | Auto-flush interval (0 = disabled) |
| `GAMENG_E2E` | _(none)_ | Engine | Enables `POST /__shutdown` |
| `GAMENG_MAX_IDEMPOTENCY_ENTRIES` | `1000` | Engine | txId cache size |
| `BFF_PORT` | `5000` | BFF | HTTP listen port |
| `ENGINE_URL` | `http://localhost:3000` | BFF | Engine base URL |
| `GAME_INSTANCE_ID` | `instance_001` | BFF | Target engine instance |
| `BFF_JWT_SECRET` | _(required)_ | BFF | JWT signing key |
| `BFF_ADMIN_API_KEY` | _(required)_ | BFF | Engine admin key (for registration) |
| `BFF_INTERNAL_ADMIN_SECRET` | _(none)_ | BFF | X-Admin-Secret header value |
| `BFF_DB_PATH` | `bff/data/bff.sqlite` | BFF | SQLite database path |
| `BFF_BCRYPT_ROUNDS` | `12` | BFF | Password hashing cost |
| `BFF_RATE_LIMIT_MAX` | `100` | BFF | Max requests per window |
| `LAUNCHER_PORT` | `4010` | Sandbox | Launcher HTTP port |

---

## 12. Security Layers

```mermaid
graph LR
  subgraph External["External Boundary"]
    Helmet["🛡️ Helmet<br/><small>Security headers</small>"]
    Rate["⏱️ Rate Limit<br/><small>100 req/min global<br/>5/min register<br/>10/min login</small>"]
    CORS["🌐 CORS<br/><small>origin: configurable</small>"]
  end

  subgraph Auth_Layer["Authentication"]
    JWT_V["🔑 JWT Verify<br/><small>requireAuth preHandler</small>"]
    AdminS["🛡️ X-Admin-Secret<br/><small>header check</small>"]
    BcryptH["🔒 bcrypt<br/><small>12 rounds (prod)</small>"]
  end

  subgraph Engine_Auth["Engine Auth"]
    Bearer["🎫 Bearer API Key<br/><small>resolveActor()</small>"]
    Owner["👤 Ownership<br/><small>actorOwnsPlayer()</small>"]
    AdminK["🔑 ADMIN_API_KEY<br/><small>gated admin TXs</small>"]
  end

  subgraph Data_Safety["Data Safety"]
    Idemp["♻️ Idempotency<br/><small>duplicate TX prevention</small>"]
    Schema["📋 Schema Validation<br/><small>JSON Schema draft-07</small>"]
    Atomic["💾 Atomic Writes<br/><small>.tmp → rename</small>"]
  end

  External --> Auth_Layer --> Engine_Auth --> Data_Safety

  classDef ext fill:#e8eaf6,stroke:#5c6bc0
  classDef auth fill:#fff3e0,stroke:#ff9800
  classDef eng fill:#e8f5e9,stroke:#4caf50
  classDef data fill:#fce4ec,stroke:#e91e63

  class Helmet,Rate,CORS ext
  class JWT_V,AdminS,BcryptH auth
  class Bearer,Owner,AdminK eng
  class Idemp,Schema,Atomic data
```

---

## 13. Project Structure

```
gameng/
├── src/                          # Engine source
│   ├── app.ts                    # createApp() factory
│   ├── server.ts                 # Bootstrap + listen
│   ├── state.ts                  # Domain types (GameState, Player, Character...)
│   ├── auth.ts                   # Actor auth (resolveActor, actorOwnsPlayer)
│   ├── migrator.ts               # State migration on snapshot restore
│   ├── snapshot-manager.ts       # Atomic persist + restore
│   ├── idempotency-store.ts      # FIFO txId cache
│   ├── algorithms/
│   │   ├── growth.ts             # flat · linear · exponential
│   │   └── level-cost.ts         # flat · free · linear_cost · mixed_linear_cost
│   └── routes/
│       ├── health.ts             # GET /health
│       ├── tx.ts                 # POST /:id/tx (all transactions)
│       ├── player-state.ts       # GET /:id/state/player/:pid
│       ├── stats.ts              # GET /:id/character/:cid/stats
│       ├── state-version.ts      # GET /:id/stateVersion
│       └── config.ts             # GET /:id/config
│
├── bff/                          # Backend For Frontend
│   ├── src/
│   │   ├── server.ts             # Bootstrap (Fastify + JWT + DB + routes)
│   │   ├── config.ts             # Env var resolution → BffConfig
│   │   ├── proxy.ts              # proxyToEngine() HTTP forwarder
│   │   ├── db.ts                 # SQLite init + migrations
│   │   ├── user-store.ts         # User CRUD (prepared statements)
│   │   ├── types.ts              # Request body interfaces
│   │   ├── auth/
│   │   │   ├── jwt.ts            # registerJwt() + JwtPayload
│   │   │   ├── passwords.ts      # bcrypt hash/verify
│   │   │   └── middleware.ts     # requireAuth preHandler
│   │   └── routes/
│   │       ├── auth-routes.ts    # register · login · refresh
│   │       ├── game-routes.ts    # /game/* typed endpoints
│   │       ├── admin-routes.ts   # /admin/* X-Admin-Secret
│   │       └── health-routes.ts  # GET /health (engine probe + DB)
│   ├── migrations/
│   │   └── 001-initial.sql       # Users table DDL
│   └── tests/                    # 54 unit + 30 E2E tests
│
├── sandbox/                      # Development tools
│   └── apps/
│       ├── launcher/             # Engine process manager (:4010)
│       │   └── src/
│       │       ├── engine.ts     # EngineProcessManager
│       │       ├── routes.ts     # Control + proxy routes
│       │       └── log-buffer.ts # 2000-line ring buffer
│       └── web/                  # React SPA (:5173)
│           └── src/pages/
│               ├── ServerControl.tsx
│               ├── ConfigEditor.tsx
│               ├── AdminPanel.tsx
│               ├── PlayerView.tsx
│               ├── GameMaster.tsx
│               └── ScenarioRunner.tsx
│
├── schemas/                      # JSON Schema draft-07
├── openapi/                      # OpenAPI 3.1.0 spec
├── examples/                     # Golden config/state files
├── tests/                        # Engine tests (358 unit + 51 E2E)
└── docs/                         # Documentation
```
