# StoryBoard — Light Novel Writing & Continuity Tool

Single-user desktop app for writing a serial fantasy light novel and publishing it to
Royal Road. Optimized for one specific job: **the author is forgetful, and a long serial
outlives memory.**

## Goal

The author writes a fantasy serial light novel with hundreds of chapters, illustrations,
and a large cast. StoryBoard exists so the author never has to reread a chapter to recall
what happened, and never accidentally contradicts something established 200 pages ago.

## Non-goals

- Not a prose generator. The AI never writes the author's prose.
- Not a general-purpose note-taking app.
- Not collaborative. Single user, single machine.
- Not a publishing client. Royal Road has no API, so export produces files a human uploads.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Authoring surface | Plain-text / markdown editor in-app | Continuity checks need the prose. Google Docs/Word would hide it from the app. |
| Storage | PostgreSQL in Docker, localhost | Chosen by author. Enables schema constraints and future LAN access. |
| Architecture | Electron + React renderer, main process talks to Postgres directly | No HTTP server, no auth, no network layer for a local single-user tool. |
| Entity model | Five first-class types: character, place, faction, item, rule | Plot-critical facts must be queryable, not buried in prose. |
| Glossary | Mandatory | Author is not a native English speaker. Stops the tool "correcting" invented terms and proper names. |
| Relations | One table; timeline + sentiment only where meaningful | Mixing "loves Kaito" with "owns the blade" in one shape pollutes every query. |
| Facts | One store, three filtered tabs | Independent stores drift. Tabs are lenses on one table. |
| Continuity checking | Deferred until real prose exists | Cannot be built or validated without chapters. |
| Image hosting | Catbox (`api.catbox.moe`) | Only confirmed host with a documented anonymous API, no API key, permanent retention. |
| Chapter structure | `volume → arc → chapter`; interlude is a chapter *type* | Keeps interludes on one timeline, excludable at export. |
| POV | Third-person limited, one per chapter | Format convention, and enables two cheap mechanical checks. |

### Open, by author request

Chapter count, volume count, and total length are not fixed. Nothing in the schema or the
code may assume a maximum number of chapters, volumes, entities, or facts.

## Workflow

### Writing

1. Create entity records (characters, places, factions, items, rules) and fill structured
   fields as canon becomes known.
2. Build the outline: `volume → arc → chapter`. Each chapter gets a one-line summary at
   minimum; goal/conflict/outcome/beat for structurally important chapters.
3. Write prose in the plain-text editor. Chapter marked `draft → done`.
4. On chapter-complete, the export pipeline produces files for Royal Road.

### Illustrations

1. Place an image slot at a paragraph boundary in the chapter.
2. Drop the file in.
3. App uploads to Catbox, stores the returned permanent URL on the slot.
4. Export emits the hotlink.

The local file is the source of truth. The URL is derived and re-derivable. Never store
only the URL, never store only the path — a deleted hotlink breaks a published chapter
permanently, and the app must show which slots have no live URL.

### Publishing

Royal Road has no API (official API request was marked *Rejected*). Export terminates at
a file the author uploads by hand.

- **`.docx` per volume** for bulk import. Royal Road maps document headings to chapter
  titles, so the exporter emits one `Heading 1` per chapter and no junk formatting.
  Whether images embedded inside an imported `.docx` survive is **unconfirmed** — so
  `.docx` is treated as text-only.
- **`.html` per chapter** for any chapter containing illustrations. This is the only path
  where a hotlinked `<img>` is definitely preserved.
- **Release preview** — a single screen showing exactly how the chapter and its image
  placements will appear, reviewed before any file is written.

## Royal Road export constraints

Verified against Royal Road's knowledge base and live published chapter HTML.

- Images are **hotlinked, never re-hosted**. `<img src="https://..." width="900" height="600">`
- Royal Road provides **no internal image hosting**. External hosting is mandatory.
- Chapter import accepts **`.docx`** (Author Premium). `.zip` for separate chapter docs.
- Headings in the source document become chapter titles.
- Single-chapter entry is **browser-form only** — HTML plus legacy BBCode, with a source editor.
- **`class` attributes are stripped.** Inline styles only.
- Use `<br />` for line breaks; 2–3 consecutive for paragraph gaps.
- `alt` survives on `<img>`. Alt text is required in the export.
- No figure or caption concept exists.

## Architecture

```
StoryBoard/
├── docs/
├── scripts/                  seed, pg_dump automation
├── electron/                 main process — Postgres, filesystem, export
│   ├── main.ts
│   ├── preload.ts
│   ├── ipc/                  handler registration only
│   ├── db/                   drizzle client, pool, migrations runner
│   ├── repositories/         drizzle queries, no business logic
│   ├── services/             business logic
│   ├── controllers/          validate + shape responses
│   ├── interfaces/           catbox.interface.ts, docx-writer.interface.ts
│   └── lib/                  logger.ts
├── src/                      React renderer
│   ├── components/
│   │   └── ui/               shadcn/ui, copied in
│   ├── features/             chapters, entities, relations, glossary, illustrations
│   ├── stores/               zustand
│   └── lib/                  ipc client wrappers, zod schemas
├── db/
│   ├── migrations/           forward-only SQL
│   └── seed/
└── tests/
```

**Process model.** The Electron main process is the only component that touches Postgres or
the filesystem. The renderer is sandboxed and reaches the database solely through typed IPC
handlers defined in `preload.ts`. No query is ever constructed in renderer code, and Drizzle
is imported only inside `electron/repositories/`.

**Why no backend server.** The app is local and single-user. An HTTP layer would add a
process to supervise, an auth system to get wrong, a port to secure, and a serialization
boundary to maintain — all to serve one client that already runs on the same machine.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | Electron + electron-builder | Not Tauri — the main process needs Node libraries (`pg`, `docx`) |
| Renderer | React 19 + TypeScript strict + Vite | |
| Styling | Tailwind CSS | Dev-only. Compiles to CSS. |
| Components | shadcn/ui | Copied into `src/components/ui`, not a runtime dep |
| Animation | Motion (`motion/react`) | See below |
| State | Zustand | Editor buffer, selected chapter, active tab, filters |
| Validation | Zod | Both directions of every IPC boundary |
| Database | PostgreSQL 16 in Docker | localhost |
| DB access | **Drizzle ORM + `pg`** | Type-safe queries, no codegen step, migrations in plain SQL |
| Docx export | `docx` | |
| Tests | Vitest + `pg-mem` | Golden files for export |

### Database access — Drizzle over raw `pg`

Drizzle, not Knex, not Prisma, not raw SQL strings.

- **Type-safe without codegen.** Prisma requires a generate step and a client binary; Drizzle
  infers types from the schema definition and stays pure TypeScript.
- **Migrations stay plain SQL.** Forward-only `.sql` files in `db/migrations/` are still the
  source of truth. Drizzle's `drizzle-kit` is used for diffing only, never for applying.
- **Constraints stay in the database.** `CHECK` and `NOT NULL` on `facts.source_chapter_id`
  / `source_quote` are enforced by Postgres. An ORM cannot weaken them, which is what makes it
  safe to use one here.
- **The renderer still never builds SQL.** Drizzle lives only in `electron/repositories/`.

### Motion — used sparingly

Motion is present but has one job in this app: **the image slot drifting out of position**
after paragraphs are deleted, and transitions on tab/dialog entry. It is not used for text
reflow. Animated text in a writing tool causes layout thrash while typing, which reads as
lag. Rules for Motion use in this codebase:

- Never animate the prose textarea's height or content
- Never animate anything during an active keystroke
- Duration 150–200ms, ease-out only
- `prefers-reduced-motion` respected via `useReducedMotion()`

## Data model

All entities carry a UUID primary key and are never renamed destructively. Everything is
queryable; nothing important lives only inside a prose blob.

### entities

Canonical record for any tracked thing.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, stable forever |
| `project_id` | uuid | FK |
| `type` | enum | `character` \| `place` \| `faction` \| `item` \| `rule` |
| `canonical_name` | text | The name used everywhere. Never change it. |
| `aliases` | text[] | Alternate names, honorifics, former names |
| `summary` | text | One-line role in the story |
| `appearance` | text | Prose. Atmosphere only, never checked. |
| `personality` | text | Prose. Atmosphere only, never checked. |
| `backstory` | text | Prose. Atmosphere only, never checked. |
| `origin_entity_id` | uuid → entities | FK, typically a `place` |
| `metadata` | jsonb | Type-specific structured detail |

Appearance, personality, and backstory are deliberately free prose. They are not queried,
so constraining them buys nothing and costs writing friction.

### entity_abilities

Powers and named moves. One table with a `kind` discriminator — both are the same shape
of thing and splitting them would duplicate every query.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `entity_id` | uuid → entities | Owner |
| `kind` | enum | `power` \| `technique` |
| `name` | text | As written in the text |
| `first_use_chapter_id` | uuid → chapters | Null = not yet used on page |
| `cost` | text | Stated limitation |
| `limitation` | text | When it fails |
| `notes` | text | |

`first_use_chapter_id` is what makes "he used a technique he has not learned yet" a
detectable error rather than a memory failure.

### relations

One table. Columns that only apply to certain categories stay null.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `from_entity_id` | uuid → entities | |
| `to_entity_id` | uuid → entities | Any type |
| `category` | enum | `social` \| `possession` \| `membership` |
| `type_label` | text | "ally", "rival", "sibling", "member of" |
| `sentiment` | smallint −5..5 | **social only** |
| `rank` | text | **membership only** |
| `valid_from_chapter_id` | uuid → chapters | Null = from the beginning |
| `valid_to_chapter_id` | uuid → chapters | Null = still true |
| `is_secret` | bool | Does anyone know? |
| `notes` | text | |

`social` carries sentiment and a timeline because affection is an arc — hostile in
volume 1, allied in volume 3. `possession` is state with start and end. `membership`
carries rank, and rank changes are plot events, so it has a timeline too.

### relation_known_by

| Column | Type | Notes |
|---|---|---|
| `relation_id` | uuid → relations | |
| `entity_id` | uuid → entities | Who knows about this relation |

Lets the app answer "who currently knows about the twin" without scanning prose.

### volumes / arcs / chapters

| Table | Key columns |
|---|---|
| `volumes` | `id`, `project_id`, `title`, `ordinal`, `summary` |
| `arcs` | `id`, `volume_id`, `title`, `ordinal`, `summary` |
| `chapters` | `id`, `arc_id`, `title`, `ordinal`, `type`, `pov_entity_id`, `status`, `outline_goal`, `outline_conflict`, `outline_outcome`, `outline_beat`, `body_md`, `word_count`, `rr_url`, `published_at` |

`chapters.type` ∈ `chapter` \| `prologue` \| `epilogue` \| `interlude`.
`chapters.status` ∈ `outline` \| `draft` \| `done`.
Interludes stay in the same timeline, flagged by type, and are excluded from main-arc
consistency checks so a side story raises no false alarms.

### facts

The single source of truth for the three tabs. Tabs are filtered views; they are not
separate stores, because separate stores drift.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `project_id` | uuid | |
| `scope_type` | enum | `chapter` \| `entity` \| `relation` \| `global` |
| `scope_id` | uuid | Polymorphic target |
| `kind` | enum | `event` \| `character_fact` \| `new_entity` \| `relation_shift` \| `open_promise` \| `unresolved` |
| `content` | text | |
| `source_chapter_id` | uuid → chapters | Where it came from |
| `source_quote` | text | The exact line |
| `status` | enum | `draft` \| `approved` \| `rejected` |

Every fact must carry a source chapter and quote. A fact with no source is unverifiable and
must not be enterable — this is the invariant that prevents tab drift.

`open_promise` is the type that matters most: a hook the reader now expects. It is how a
serial avoids dropping a thread for forty chapters.

**Tab mapping.**

- Tab 1 — chapter summary and facts: `scope_type = 'chapter' AND scope_id = <chapter>`
- Tab 2 — character info: the `entities` row for `scope_type = 'entity'`, plus its
  abilities and relations
- Tab 3 — relations: the `relations` table, with `relation_known_by` expanded

### glossary_terms

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `project_id` | uuid | |
| `canonical_form` | text | Correct spelling, always |
| `kind` | enum | `name` \| `term` \| `honorific` \| `style` |
| `notes` | text | |

Every proper noun, invented magic term, and honorific is pinned here. The glossary is what
stops a spell-checker from "correcting" the author's invented vocabulary.

### illustrations

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `chapter_id` | uuid → chapters | |
| `after_paragraph_index` | int | Slot position — see below |
| `local_path` | text | Source of truth |
| `remote_url` | text | Derived, re-derivable |
| `provider` | enum | `catbox` \| `imgbb` \| `manual` |
| `width` / `height` | int | Emitted on the `<img>` tag |
| `alt_text` | text | Required in export |
| `caption` | text | Rendered as a paragraph after the image |

Images anchor to a **paragraph index**, not a character offset. A character offset breaks on
every edit above the image; a paragraph index breaks only when paragraphs are added or
removed. The editor warns when a chapter's paragraph count drops below an existing slot's
index so slots can be re-anchored deliberately rather than silently drifting.

A slot with a `local_path` and a null `remote_url` has not been uploaded yet and must be
visible in the UI — that state means the export will emit a broken or missing image.

## v1 scope

**In:**

- Entity records for all five types, with abilities and structured metadata
- Relations with category, sentiment, rank, and validity timeline
- Relation graph view with time filtering
- Glossary
- `volume → arc → chapter` outline with the four outline fields
- Plain-text chapter editor
- Three tabs: chapter summary and facts, character info, relations
- Manual fact entry with source chapter and quote
- Illustration slots with Catbox upload
- `.docx` export per volume, `.html` export per chapter, release preview
- Export to Markdown and JSON for the whole project

**Not in v1:**

- AI fact extraction and chapter summarization
- Continuity checking
- Prompt editor, custom agents, plugin system
- Canary suite
- Full-text search
- Critique and revision passes
- Vector retrieval

None of the deferred items can be built or validated without existing prose. The build order
is: finish v1, write ten chapters, then build the AI half against real text.

## Risks

| Risk | Mitigation |
|---|---|
| Author writes zero chapters and never validates the tool | Write the first chapters in Obsidian on plain markdown now. The app adopts those files later with no conversion. |
| PostgreSQL container holds the only copy of the manuscript | Scheduled `pg_dump` from day one. Treat this as a required feature, not a convenience. |
| Catbox link dies | Local file is the source of truth; one-click re-upload; UI flags slots with no live URL. |
| Fact drift between tabs | One `facts` table, source chapter and quote required on every row. |
| Docx image behaviour unconfirmed | `.docx` treated as text-only; illustrated chapters use `.html`. |
| Tool becomes procrastination | v1 deliberately excludes every feature that does not need the app to exist yet. |

## Build order

1. Schema and migrations, Postgres in Docker, Drizzle client, seed script
2. Electron shell, preload, typed IPC contract
3. Entity CRUD with the two-tab-vs-drift invariant enforced in the database
4. Relations and the graph view
5. Glossary
6. Outline: volumes, arcs, chapters
7. Plain-text editor
8. Facts, three tabs
9. Illustration slots, Catbox adapter
10. Export: `.docx`, `.html`, release preview, Markdown/JSON archive
11. `pg_dump` automation

## Dependencies

Runtime: `electron`, `react`, `react-dom`, `drizzle-orm`, `pg`, `docx`, `zod`,
`zustand`, `motion`, `tailwindcss`

Dev: `electron-builder`, `vite`, `@vitejs/plugin-react`, `typescript`,
`drizzle-kit` (diffing only), `vitest`, `pg-mem`, `@testing-library/react`,
`eslint`, `typescript-eslint`, `prettier`

shadcn/ui is copied into `src/components/ui` at init and carries no runtime dependency.
