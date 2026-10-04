# StoryBoard — Agent Instructions

Local-only, single-user desktop app for writing a serial fantasy light novel and
publishing it to Royal Road. Electron + React + TypeScript renderer, PostgreSQL in Docker.

**The app's purpose:** the author is forgetful, and a long serial outlives memory. StoryBoard
exists so the author never has to reread a chapter to recall what happened, and never
accidentally contradicts something established 200 pages ago.

**This file is the sole reference for this project.** It is self-contained. Nothing outside
it should be required to work on the codebase.

## Hard rules

1. **The renderer never touches the database or the filesystem.** All Postgres access and
   file I/O happen in the Electron main process. The renderer reaches them only through
   typed IPC handlers declared in `preload.ts`. No SQL string is ever built in renderer code.

2. **There is no backend server.** Do not add one, an HTTP layer, an auth system, or a port.
   The app is local and single-user; a server would add a process, an auth surface, and a
   serialization boundary for one client already on the same machine.

3. **The AI never writes the author's prose.** No generation, no rewriting, no autocomplete.
   Any future AI work is read-only analysis whose output the author confirms or rejects.

4. **The author makes every decision.** No automatic writes to canonical data.

5. **Never discard the author's typing without asking.** The prose buffer lives in
   `useChapterDraft`, which the shell calls *above* the section switch, because
   `ChapterEditor` unmounts whenever another section is showing and a buffer held inside
   it would be destroyed by simply looking at the export preview. Switching sections must
   never lose unsaved prose. Switching chapters genuinely replaces the buffer, so that
   one asks first. Do not move the buffer back into the editor, and do not add a bare
   `key` on the editor: that remounts it and silently discards whatever was typed.

## Naming

- Files: kebab-case (`chapter-editor.tsx`, `royal-road-export.ts`)
- Components: PascalCase (`ChapterEditor`, `RelationGraph`)
- Variables and functions: camelCase (`chapterId`, `createRelation()`)
- Booleans: `is`/`has`/`should` prefix (`isPublished`, `hasIllustration`)
- Constants: `UPPER_SNAKE_CASE`
- Types and interfaces: PascalCase (`Entity`, `IllustrationSlot`)
- Enums: PascalCase type, `UPPER_SNAKE_CASE` members

Layered, by suffix:

- `*.controller.ts` — request/response handling only, no business logic
- `*.service.ts` — business logic
- `*.repository.ts` — SQL and data access only, no business logic
- `*.interface.ts` — third-party contracts (Catbox, docx writer), under `interfaces/`
- `*.router.ts` — route and IPC wiring only

Repositories are called by services. Services are called by controllers. Controllers are
called by the IPC layer. Never skip a layer.

## Running the app

```bash
npm run db:up        # start PostgreSQL in Docker
npm run db:migrate   # apply migrations
npm run db:seed      # create the one project the app works against
npm start            # build and open the window
```

`npm start` builds both sides and launches Electron in one command. That is the
normal way to run the app.

`npm run dev` is the hot-reload variant, and it is also one command: it compiles the
main process and preload, starts Vite, launches Electron pointed at the Vite server, and
shuts Vite down when Electron exits. There is no two-terminal setup.

`dev:electron` is an alias for `npm run dev`. `dev:vite` opens the renderer in a plain
browser with no preload, which renders the "no bridge" screen by design; it is a styling
aid, not a way to run the app. `dev:electron:bare` starts only Electron against an already
compiled build and an already-running Vite on port 5173 — it exists for debugging the main
process and is not the normal entry point.

Before changing anything that touches the preload, read this: **`preload.ts` is
bundled by `vite.preload.config.ts`, not by `tsc`**, and it must stay importable
in Electron's sandbox. A sandboxed preload is plain CommonJS and cannot require a
relative file, so its only non-`electron` import must be `./ipc/channels.js`,
which itself must have no imports at all. Breaking either rule produces a window
that opens blank with no error anywhere.

## Project layout

```
StoryBoard/
├── docs/
├── scripts/                  seed, pg_dump automation
├── electron/
│   ├── main.ts
│   ├── preload.ts            bundled to preload.cjs by vite.preload.config.ts
│   ├── ipc/                  channels.ts (no imports), handlers.ts
│   ├── db/                   pool, migrations runner
│   ├── repositories/
│   ├── services/
│   ├── controllers/
│   ├── interfaces/           catbox.interface.ts, docx-writer.interface.ts
│   └── lib/                  logger.ts, paths.ts, chapter-text.ts
├── src/                      React renderer
│   ├── components/
│   ├── features/             chapters, entities, relations, glossary, illustrations
│   ├── lib/                  ipc client wrappers, zod schemas
│   └── styles/
├── db/
│   └── migrations/           forward-only SQL
└── tests/
```

## Database rules

PostgreSQL, single `storyboard` database, in Docker on localhost. Migrations are the
source of truth for schema.

**Every fact requires a `source_chapter_id` and a `source_quote`.** Enforce with `NOT NULL`
plus a `CHECK`, not application validation alone. A fact without a source is unverifiable,
and unverifiable facts are how tab drift starts.

**Every entity gets a UUID from the database**, never generated in application code.

**Never assume a maximum.** Chapter count, volume count, entity count, and fact count are
unbounded by author decision. No `LIMIT`, no truncation, no "top N" without explicit
consent in the UI.

**Never rename an entity destructively.** Changing `canonical_name` breaks every fact,
relation, and chapter referencing it. Add to `aliases` instead.

**Migrations are forward-only and never edited after being applied.** Add a new migration.

### Tables

`entities` — character, place, faction, item, rule. `canonical_name` + `aliases[]` +
prose `appearance`/`personality`/`backstory` (never queried, deliberately unconstrained) +
`origin_entity_id` FK + `metadata` jsonb.

`entity_abilities` — powers and named moves in one table with a `kind` discriminator
(`power` | `technique`). Columns: `entity_id`, `name`, `first_use_chapter_id` (null = not
yet used on page), `cost`, `limitation`, `notes`. `first_use_chapter_id` is what makes "he
used a technique he has not learned yet" detectable rather than a memory failure.

`relations` — one table for all relation kinds. `category` ∈ `social` | `possession` |
`membership`. Columns `sentiment` (−5..5, social only), `rank` (membership only),
`valid_from_chapter_id` / `valid_to_chapter_id` (null = from the beginning / still true),
`is_secret`. Social relations carry a timeline because affection is an arc; possession is
state; membership rank changes are plot events. Do not merge these into one non-null shape —
it forces defensive `WHERE` clauses onto every query.

`relation_known_by` — `relation_id` + `entity_id`. Lets the app answer "who currently knows
about the twin" without scanning prose.

`volumes` / `arcs` / `chapters` — the outline hierarchy.
- `chapters.type` ∈ `chapter` | `prologue` | `epilogue` | `interlude`
- `chapters.status` ∈ `outline` | `draft` | `done`
- Interludes stay on the same timeline, flagged by type, excluded from main-arc consistency
  checks and from main-arc exports.
- Outline columns: `outline_goal`, `outline_conflict`, `outline_outcome`, `outline_beat`.
  One-line summary is the floor; goal/conflict/outcome for structurally important chapters.
- `chapters.pov_entity_id` — third-person limited, one POV per chapter, switches only at
  breaks. Enables the two cheap mechanical checks.
- `chapters.body_md` — the prose. Markdown, blank-line-separated paragraphs.
- `chapters.author_note_pre`, `chapters.author_note_post` - Royal Road author notes, the
  housekeeping the author writes for readers rather than for the story. Both `NOT NULL`
  and saved by the same explicit action as the body, so a note cannot be silently
  discarded by a body-only save. They are **excluded from `word_count`**, because Royal Road
  derives its page wordcount from chapter content only and a long note would otherwise
  push the author past the 2,000 word target for no reason.
- `chapters.rr_url`, `published_at` — publication tracking.

`facts` — **the single source of truth behind all three tabs.** The UI tabs are filtered
views over this table, not separate stores, because separate stores drift.
- `scope_type` ∈ `chapter` | `entity` | `relation` | `global`, with polymorphic `scope_id`
- `kind` ∈ `event` | `character_fact` | `new_entity` | `relation_shift` | `open_promise` |
  `unresolved`
- `status` ∈ `draft` | `approved` | `rejected`
- `open_promise` is the highest-value kind: a hook the reader now expects. It is how a
  serial avoids dropping a thread for forty chapters.

Tab mapping: **tab 1** chapter summary and facts = `scope_type='chapter'` for that chapter.
**tab 2** character info = the `entities` row plus its abilities and relations.
**tab 3** relations = `relations` expanded with `relation_known_by`.

`glossary_terms` — `canonical_form`, `kind` ∈ `name` | `term` | `honorific` | `style`,
`notes`. Every proper noun, invented magic term, and honorific is pinned here. The glossary
is what stops a spell-checker from "correcting" the author's invented vocabulary — the
author is not a native English speaker.

`illustrations` — `chapter_id`, `after_paragraph_index`, `local_path`, `remote_url`,
`provider` ∈ `catbox` | `imgbb` | `manual`, `width`, `height`, `alt_text`, `caption`.

## Royal Road export constraints

Verified against Royal Road's knowledge base and live published chapter HTML. Breaking any
of these produces broken output for real published chapters, so treat them as test assertions.

- Images are **hotlinked, never re-hosted**. Emit
  `<img src="..." width="900" height="600" alt="...">`
- Royal Road provides **no internal image hosting**. External hosting is mandatory.
- **No `class` attributes.** Royal Road strips them. **Inline styles only.**
- `<br />` for line breaks, not `\n`. 2–3 consecutive for paragraph gaps.
- `.docx` is **text-only**. Whether images embedded in an imported `.docx` survive is
  unconfirmed, so images are never embedded into docx output.
- `.html` is the only path where a hotlinked image is definitely preserved.
- **One `Heading 1` per chapter** in `.docx`. Royal Road maps document headings to chapter
  titles.
- Alt text is required on every exported image. There is no figure or caption concept —
  render a caption as a paragraph after the image.
- Bulk `.docx` import is Author Premium. Single-chapter entry is browser-form only.
- **Royal Road has no API** (official API request was marked Rejected). Export terminates
  at a file the author uploads by hand. Do not attempt to automate publishing.

### What the author writes is not what Royal Road accepts

Re-verified against `royalroad.com/support/knowledgebase/83`. The gap is the whole reason
the export step exists, so state it plainly rather than letting the author assume the app's
storage format can be pasted straight in.

- **Royal Road understands no markdown.** The editor toolbar is bold, italic, underline and
  strikethrough; anything more goes in through BBCode or the source-code view. `*emphasis*`
  and `**bold**` reach a published chapter as literal asterisks. **Settled decision: markdown
  is converted at export, not prohibited at authoring time.** The author writes plain markdown
  on disk and in Obsidian, and `toRoyalRoadHtml` in `electron/lib/royal-road-html.ts`
  translates it at the export boundary. Two consequences are deliberate:
  - **It is not a markdown engine.** It converts emphasis (`**bold**`, `*italic*`, `_italic_`,
    `~~strikethrough~~`) and scene breaks (`---`, `***`, `* * *`, `___`) and nothing else. A
    general parser would need a dependency and would silently reshape the author's files.
  - **Anything it cannot translate is reported, not passed through.** Headings, lists,
    blockquotes, links, images and code are returned as `warnings` alongside the HTML so the
    release preview can show them. A literal `#` reaching a published chapter is worse than a
    loud message, because the author has no way to notice it after the fact.
- **The app carries its own formatting reference, and it is verified.** The author cannot be
  expected to hold the translation table in their head; that is the same forgetfulness this
  app exists to solve. `src/features/export/formatting-examples.ts` holds the data,
  `formatting-reference.tsx` renders it, and `tests/unit/formatting-examples.test.ts` asserts
  every documented example against `toRoyalRoadHtml`. **Add new syntax to the data, never to the
  screen as hand-written text.** A reference that has drifted from the converter sends the
  author into chapters that are wrong in a way nobody notices until they are published.
  - **Underline is the known gap.** Royal Road's toolbar has it and plain markdown cannot
    express it. State that rather than inventing syntax that does not work.
- **A blank line is a paragraph; a single newline is a line break.** This is not a guess:
  Royal Road's own "clean paste" option exists to repair content where "some editors only use
  line breaks instead of paragraphs for spacing". `splitParagraphs` already implements
  exactly this rule, and illustration anchoring depends on it.
- **No indentation and no line spacing.** Royal Road is single-spaced and does not indent
  first lines. Never emit leading spaces or `<p style="text-indent">` for a paragraph.
- **The chapter editor's own fields are Title, Author Notes, and Chapter Content.** Anything
  the app stores beyond those three is internal and must not be emitted as chapter body.
- **Royal Road volumes are thinner than they look.** Volumes only order chapters on the
  fiction page and hold covers. They carry no summary and no volume-specific stats.
- **Arcs do not exist on Royal Road.** The site has volume to chapter and nothing between.
  Arc boundaries are internal structure and must be flattened out of exported output; a
  reader must never see an arc heading.
- **Chapter length limits are enforced.** Minimum 500 characters, or the chapter cannot be
  published. Recommended ceiling is 10,000 words with roughly 2,000 a release, and one
  Royal Road page is 275 words.

Export pipeline, in order:

1. **Release preview** - one screen showing the chapter and image placements exactly as
   they will appear, reviewed before any file is written. This is where an image landing
   two paragraphs late gets caught. **Built.** `buildChapterRelease` in
   `electron/lib/release-chapter.ts` is the pure assembler, `release.service.ts` reads the
   stored chapter, and `src/features/export/release-preview.tsx` renders it. Two decisions
   worth keeping: the preview reads committed data and never an editor buffer, so it
   cannot show one version and export another; and it renders the outgoing HTML rather
   than re-deriving it from the markdown, because a second implementation of the export
   rules would eventually disagree with the first. Blockers and advisories are visually
   distinct, because a list that mixes a missing alt text with a word-count note gets
   skimmed past. Interludes are excluded from the output but still listed, with the
   reason shown, since a chapter that silently vanishes is the failure this app exists
   to prevent.
2. **`.docx` per volume** for bulk import — headings to chapter titles, no junk formatting.
3. **`.html` per chapter** for any chapter containing illustrations.
4. **Markdown + JSON archive** of the whole project. This is the author's backup; it is
   five lines of code and it is the thing that saves the manuscript if Postgres is lost.

## Images

The **local file is the source of truth**. The remote URL is derived and must be
re-derivable. Never store only a URL, never store only a path — store both. A slot with a
`local_path` and a null `remote_url` is an unuploaded slot and must be visible in the UI.

Catbox (`api.catbox.moe`) is the default host: `reqtype=fileupload`, no API key, permanent
retention. ImgBB is the fallback (requires a key, 32 MB cap). Imgur requires a registered
Client ID — do not make it the default.

Anchoring is by `after_paragraph_index`, not character offset. A character offset breaks on
every edit above the image; a paragraph index breaks only when paragraphs are added or
removed. When a chapter's paragraph count drops below an existing slot's index, the editor
must warn so the slot can be re-anchored **deliberately**. Never silently re-anchor.

## TypeScript

Strict mode. No `any`. No non-null assertions (`!`) without a comment explaining the
invariant that guarantees them. No `console.log` — use the logger in `electron/lib/logger.ts`.
No placeholder implementations, no empty function bodies, no `TODO` comments left in a diff.

Zod schemas are the contract for every IPC payload. Validate in main on the way in and on
the way out; the renderer is not trusted.

## Testing

- Repository and service logic: unit tests, no database required — mock the repository.
- Migrations and constraints: integration tests against a throwaway database.
- Export pipeline: golden-file tests. The output must be asserted against the Royal Road
  constraints above — a test that does not check for `class` attributes or verify `<br />`
  usage is incomplete.
- Every bug fix ships with the test that would have caught it, in the same commit.

Run lint, typecheck, and tests before considering any task done.

## Scope

**Out of scope until real chapters exist, and not to be built speculatively:**

- AI fact extraction and chapter summarization
- Continuity checking
- System prompt editor and custom agents
- Agent plugin system
- Canary suite for prompt regression
- Full-text search
- Critique and revision passes
- Vector retrieval

None of these can be built or validated without existing prose. Do not add an abstraction
"in case" the AI layer arrives later. When it does arrive: one agent with a swappable prompt,
proposing only, never deciding.

## Operational requirements

**`pg_dump` automation is a required feature, not a convenience.** The Postgres container
holds the only copy of the manuscript. Scheduled dumps with retention, and the author must
be told where they land.

The author writes the first chapters outside this app (Obsidian, plain markdown on disk).
This app adopts those files later with no conversion — keep the markdown format plain.

## Git

Never commit directly to `main`. Branch first, one branch per concern
(`feat/relations-graph`, `fix/docx-heading-levels`).

Never use `git add -A` or `git add .` — stage explicit paths, always. Run `git status
--short` and inspect the diff before every commit.

Commit format:

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

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `perf`, `build`, `chore`, `style`.
Every commit carries the full body. Never amend or force-push to a pushed commit. Never
self-attribution in commits, comments, or manifests.

## Dependencies

Adding a package requires explicit approval. Prefer existing dependencies. No new runtime
dependency without stating what it is for, what version, and why the existing stack cannot
do it. Stable versions only — never alpha, beta, or RC.
