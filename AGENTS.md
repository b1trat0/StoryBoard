# StoryBoard — Agent Instructions

Local-only, single-user desktop app for writing a serial fantasy light novel and publishing it to
Royal Road. Electron + React + TypeScript renderer, PostgreSQL in Docker.

**Purpose:** the author is forgetful and a long serial outlives memory. StoryBoard exists so the
author never rereads a chapter to recall what happened, and never contradicts something established
200 pages ago.

This file is the sole reference for this project and is self-contained.

## Hard rules

1. **The renderer never touches the database or the filesystem.** All Postgres access and file I/O
   happen in the Electron main process, reached only through typed IPC declared in `preload.ts`. No
   SQL string is ever built in renderer code.
2. **There is no backend server.** No HTTP layer, no auth, no port. One client is already on this
   machine.
3. **The AI never writes the author's prose.** No generation, rewriting or autocomplete. Future AI
   work is read-only analysis the author confirms or rejects.
4. **The author makes every decision.** No automatic writes to canonical data.
5. **Never discard the author's typing without asking.** The prose buffer lives in
   `useChapterDraft`, called by the shell *above* the section switch, because
   `src/features/chapters/chapter-editor.tsx` unmounts whenever another section shows. Switching
   sections must never lose prose; switching chapters genuinely replaces the buffer, so it asks
   first. Do not move the buffer back into the editor, and do not add a bare `key` on the editor —
   that remounts it and discards what was typed.

## Naming

Files kebab-case. Components and types PascalCase. Variables and functions camelCase. Booleans
prefixed `is`/`has`/`should`. Constants `UPPER_SNAKE_CASE`. Enums: PascalCase type,
`UPPER_SNAKE_CASE` members.

Layers by suffix, never skipping one: `*.repository.ts` (SQL only) → `*.service.ts` (business logic)
→ `*.controller.ts` (request/response only) → `*.router.ts` (wiring only), plus `*.interface.ts`
for third-party contracts under `interfaces/`.

## Running the app

```bash
npm run db:up        # start PostgreSQL in Docker
npm run db:migrate   # apply migrations
npm run db:seed      # create the one project
npm start            # build both sides and open the window
```

`npm run dev` is the hot-reload equivalent, also one command, and it is the only entry point — it
starts the database, Vite and Electron together and shuts Vite down when Electron exits, so there is
no two-terminal setup. `dev:electron` is an alias for `npm run dev`. `dev:vite` opens the renderer in
a plain browser with no preload and renders the "no bridge" screen by design — a styling aid, not a
way to run the app. `dev:electron:bare` starts only Electron against an already compiled build and an
already-running Vite on port 5173; it exists for debugging the main process.

**Preload:** `preload.ts` is bundled by `vite.preload.config.ts`, not `tsc`, and must stay
sandbox-safe. A sandboxed preload is plain CommonJS and cannot require a relative file, so its only
non-`electron` import must be `./ipc/channels.js`, which must have no imports at all. Breaking
either rule opens a blank window with no error anywhere.

## Project layout

- `electron/` — `main.ts`, `preload.ts`, `ipc/` (`channels.ts` has no imports, `handlers.ts`),
  `db/`, `repositories/`, `services/`, `controllers/`, `interfaces/`, `lib/` (`logger.ts`,
  `paths.ts`, `chapter-text.ts`, `royal-road-html.ts`, `release-chapter.ts`)
- `src/` — renderer: `components/`, `features/` (chapters, entities, relations, glossary,
  illustrations, export), `lib/` (bridge, zod schemas), `styles/`
- `db/migrations/` forward-only SQL · `scripts/` seed and pg_dump automation · `tests/`

## Database

PostgreSQL, single `storyboard` database, Docker on localhost. Migrations are the source of truth.

- **Every fact requires `source_chapter_id` and `source_quote`.** Enforce with `NOT NULL` plus a
  `CHECK`, not application validation alone. An unsourced fact is how tab drift starts.
- **Entity UUIDs come from the database**, never generated in application code.
- **Never assume a maximum.** Chapter, volume, entity and fact counts are unbounded. No `LIMIT`, no
  truncation, no "top N" without explicit consent in the UI.
- **Never rename an entity destructively.** Changing `canonical_name` breaks every fact, relation
  and chapter referencing it. Add to `aliases` instead.
- **Migrations are forward-only and never edited after being applied.**

### Tables

- `entities` — character, place, faction, item, rule. `canonical_name`, `aliases[]`, prose
  `appearance`/`personality`/`backstory` (never queried, deliberately unconstrained),
  `origin_entity_id`, `metadata` jsonb.
- `entity_abilities` — powers and named moves in one table with a `kind` discriminator
  (`power`|`technique`). Columns: `entity_id`, `name`, `first_use_chapter_id` (null = not yet used on
  page), `cost`, `limitation`, `notes`. `first_use_chapter_id` is what makes "he used a technique he
  has not learned yet" detectable rather than a memory failure.
- `relations` — one table for every kind. `category` ∈ `social`|`possession`|`membership`;
  `sentiment` (−5..5, social only), `rank` (membership only), `valid_from_chapter_id` /
  `valid_to_chapter_id` (null = from the beginning / still true), `is_secret`. Do not merge the
  categories into one non-null shape — it forces defensive `WHERE` clauses onto every query.
- `relation_known_by` — `relation_id` + `entity_id`. Answers "who currently knows" without scanning
  prose.
- `volumes` / `arcs` / `chapters` — the outline hierarchy.
  - `type` ∈ `chapter`|`prologue`|`epilogue`|`interlude`; `status` ∈ `outline`|`draft`|`done`.
    Interludes stay on the same timeline but are excluded from main-arc consistency checks and
    main-arc exports.
  - Outline columns `outline_goal`, `outline_conflict`, `outline_outcome`, `outline_beat`. One-line
    summary is the floor.
  - `pov_entity_id` — third-person limited, one POV per chapter, switches only at breaks.
  - `body_md` — the prose. Markdown, blank-line-separated paragraphs.
  - `author_note_pre` / `author_note_post` — Royal Road author notes. Both `NOT NULL` and saved by
    the same explicit action as the body, so a note cannot be discarded by a body-only save.
    **Excluded from `word_count`** — Royal Road counts chapter content only.
  - `rr_url`, `published_at` — publication tracking.
- `facts` — **the single source of truth behind all three tabs**; the tabs are filtered views over
  this table, not separate stores, because separate stores drift. `scope_type` ∈
  `chapter`|`entity`|`relation`|`global` with polymorphic `scope_id`; `kind` ∈
  `event`|`character_fact`|`new_entity`|`relation_shift`|`open_promise`|`unresolved`; `status` ∈
  `draft`|`approved`|`rejected`. `open_promise` is the highest-value kind: a hook the reader now
  expects, and how a serial avoids dropping a thread for forty chapters.
  Tab mapping: **tab 1** = `scope_type='chapter'` for that chapter; **tab 2** = the `entities` row
  plus its abilities and relations; **tab 3** = `relations` expanded with `relation_known_by`.
- `glossary_terms` — `canonical_form`, `kind` ∈ `name`|`term`|`honorific`|`style`, `notes`. Pins
  every proper noun, invented magic term and honorific, which is what stops a spell-checker from
  "correcting" the author's invented vocabulary.
- `illustrations` — `chapter_id`, `after_paragraph_index`, `local_path`, `remote_url`,
  `provider` ∈ `catbox`|`imgbb`|`manual`, `width`, `height`, `alt_text`, `caption`.

## Royal Road export constraints

Verified against Royal Road's knowledge base and live published chapter HTML. Treat as test
assertions.

- Images are **hotlinked, never re-hosted**: `<img src="..." width="900" height="600" alt="...">`.
  Royal Road provides **no internal image hosting**, so external hosting is mandatory.
- **No `class` attributes.** Royal Road strips them. Inline styles only.
- `<br />` for line breaks, not `\n`. 2–3 consecutive for paragraph gaps.
- `.docx` is **text-only** — whether embedded images survive an import is unconfirmed, so never
  embed them. `.html` is the only path where a hotlinked image is definitely preserved.
- **One `Heading 1` per chapter** in `.docx`; Royal Road maps document headings to chapter titles.
- Alt text is required on every exported image. There is no figure or caption concept — render a
  caption as a paragraph after the image.
- Bulk `.docx` import is Author Premium. Single-chapter entry is browser-form only.
- **Royal Road has no API** (the official request was Rejected). Export terminates at a file the
  author uploads by hand. Do not attempt to automate publishing.
- **Length limits are enforced.** Minimum 500 characters or it cannot be published; recommended
  ceiling 10,000 words, roughly 2,000 a release, one Royal Road page is 275 words.
- **Arcs do not exist on Royal Road** — volume to chapter, nothing between. Arc boundaries are
  internal and must be flattened out; a reader must never see an arc heading.
- **Volumes carry no summary and no volume-specific stats.** They order chapters and hold covers.
- **No indentation, no line spacing.** Single-spaced, first lines not indented. Never emit leading
  spaces or `text-indent`.
- **The editor's own fields are Title, Author Notes and Chapter Content.** Anything else the app
  stores is internal and must never be emitted as chapter body.

### What the author writes is not what Royal Road accepts

Re-verified against `royalroad.com/support/knowledgebase/83`.

- **Royal Road understands no markdown.** Its toolbar is bold, italic, underline and strikethrough;
  anything more goes in through BBCode or the source view, so `**bold**` reaches a published chapter
  as literal asterisks. **Settled decision: markdown is converted at export, not prohibited at
  authoring time.** The author writes plain markdown on disk and in Obsidian; `toRoyalRoadHtml` in
  `electron/lib/royal-road-html.ts` translates at the export boundary.
  - **It is not a markdown engine.** It converts emphasis (`**bold**`, `*italic*`, `_italic_`,
    `~~strikethrough~~`) and scene breaks (`---`, `***`, `* * *`, `___`) and nothing else. A general
    parser would need a dependency and would silently reshape the author's files.
  - **Anything it cannot translate is reported, not passed through.** Headings, lists, blockquotes,
    links, images and code come back as `warnings` for the release preview. A literal `#` reaching a
    published chapter is worse than a loud message.
- **The app carries its own formatting reference, and it is verified.**
  `src/features/export/formatting-examples.ts` holds the data, `formatting-reference.tsx` renders it,
  and `tests/unit/formatting-examples.test.ts` asserts every documented example against
  `toRoyalRoadHtml`. **Add new syntax to the data, never hand-written text on the screen.** A
  reference that drifted from the converter sends the author into chapters that are wrong in a way
  nobody notices until they are published.
  - **Underline is the known gap.** Royal Road has it, plain markdown cannot express it. State that
    rather than inventing syntax that does not work.
- **A blank line is a paragraph; a single newline is a line break.** Not a guess: Royal Road's "clean
  paste" option exists to repair content where "some editors only use line breaks instead of
  paragraphs for spacing". `splitParagraphs` implements it and illustration anchoring depends on it.

### Export pipeline

1. **Release preview** — **built.** `buildChapterRelease` (`electron/lib/release-chapter.ts`) is the
   pure assembler, `release.service.ts` reads the stored chapter, `release-preview.tsx` renders it.
   It reads committed data and never an editor buffer, and renders the outgoing HTML rather than
   re-deriving it — a second implementation of the export rules would eventually disagree with the
   first. Blockers and advisories are visually distinct. Interludes are excluded from the output but
   still listed with the reason.
2. **`.docx` per volume** — **built.** `planVolumeDocx` (`electron/lib/volume-docx-plan.ts`) is the
   pure selector, `renderVolumeDocx` (`electron/lib/docx-writer.ts`) is the writer, and
   `volume-docx-export.tsx` runs the panel above the preview. One `Heading 1` per chapter in outline
   order, no volume or arc headings, no media, no indentation. Runs are tokenized from the
   converter's own closed tag set (`docx-runs.ts`), so the `.docx` cannot disagree with the preview.
   A blocker refuses the write. Interludes, images and author notes are dropped and **counted in the
   result**, because a `.docx` cannot say what it left out. Cancelling the save dialog is a result,
   not an error. The per-chapter `.html` path stays the only way to publish illustrations.
3. **`.html` per chapter** for any chapter with illustrations.
4. **Markdown + JSON archive** of the project. This is the author's backup; it is what saves the
   manuscript if Postgres is lost.

## Images

The **local file is the source of truth** and the remote URL is derived and re-derivable. Never store
only a URL or only a path — store both. A slot with a `local_path` and a null `remote_url` is
unuploaded and must be visible in the UI.

Catbox (`api.catbox.moe`) is the default: `reqtype=fileupload`, no API key, permanent retention.
ImgBB is the fallback (requires a key, 32 MB cap). Imgur needs a registered Client ID — do not make
it the default.

Anchor by `after_paragraph_index`, never a character offset: an offset breaks on every edit above
the image. When a chapter's paragraph count drops below an existing slot's index, the editor must
warn so the slot is re-anchored **deliberately**. Never silently re-anchor.

## TypeScript

Strict mode. No `any`. No non-null assertion (`!`) without a comment naming the invariant that
guarantees it. No `console.log` — use `electron/lib/logger.ts`. No placeholders, empty function
bodies or `TODO`s in a diff.

Zod schemas are the contract for every IPC payload. Validate in main on the way in and out; the
renderer is not trusted.

## Testing

- Repository and service logic: unit tests, mock the repository, no database.
- Migrations and constraints: integration tests against a throwaway database.
- Export pipeline: golden-file tests asserting the constraints above. A test that does not check for
  `class` attributes or verify `<br />` usage is incomplete.
- `.docx` writer: unzip the produced bytes and assert on the XML, never on a mocked writer. A `.docx`
  that passes because it was handed the right runs proves nothing about what a reader sees.
- Tests live outside the two `tsconfig` projects, so **typecheck does not cover them.** A wrong
  constructor arity in a test compiles nowhere and fails only if it is actually called. Check call
  sites by hand when a signature changes.
- Every bug fix ships with the test that would have caught it, in the same commit.

Run lint, typecheck and tests before considering any task done.

## Scope

**Out of scope until real chapters exist, not to be built speculatively:** AI fact extraction,
chapter summarization, continuity checking, a system prompt editor or custom agents, an agent plugin
system, a canary suite for prompt regression, full-text search, critique and revision passes, vector
retrieval.

None can be built or validated without existing prose. Do not add an abstraction "in case" the AI
layer arrives. When it does: one agent with a swappable prompt, proposing only, never deciding.

## Operational requirements

**`pg_dump` automation is required, not a convenience.** The container holds the only copy of the
manuscript. Scheduled dumps with retention, and the author must be told where they land.

The author writes the first chapters outside this app (Obsidian, plain markdown on disk) and this
app adopts those files with no conversion — keep the markdown plain.

## Git

Never commit directly to `main`. Branch first, one branch per concern (`feat/relations-graph`,
`fix/docx-heading-levels`).

Never `git add -A` or `git add .` — stage explicit paths. Run `git status --short` and inspect the
diff before every commit.

Every commit carries this full body:

```
type(scope): summary

Why:
- the problem

What:
- the change

Impact:
- user or system effect, compatibility note

Validation:
- commands run and results
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `perf`, `build`, `chore`, `style`. Never amend or
force-push a pushed commit. Never self-attribution in commits, comments or manifests.

## Dependencies

Adding a package requires explicit approval. Prefer existing dependencies. No new runtime dependency
without stating what it is for, what version, and why the existing stack cannot do it. Stable
versions only — never alpha, beta or RC.