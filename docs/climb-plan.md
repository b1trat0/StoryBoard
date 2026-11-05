# Climb plan — from 6.6 to 9+

Written 6 November 2026. Scope decisions come from the seven answers given in this
session; the score baselines come from `docs/project-audit.html` revision 2.

**Shape of the work:** weekends only, no deadline. Every milestone is 1–2 weekend
sessions of roughly 4–6 hours, ends with the app runnable, and is committed
separately so a bad weekend can be rolled back without losing the month.

---

## 1. Decisions this plan is built on

| Question | Answer | Consequence |
|---|---|---|
| Content scope | Multiple novels, no research model (option B) | Project layer, not a research table. `facts` stays strict. |
| Backups land | Second local drive (`D:`), outside the repo | Two copies means an off-machine copy too; that part is still missing — see §2.1. |
| Encryption | Out of scope by decision | Plaintext at rest, accepted. Security caps at 9.0. |
| DeepSeek | Full prose, opt-in per chapter | Checker and extractor are per-chapter actions, never automatic. |
| Distribution | Docker now, installer later | No embedded Postgres work in this plan. |
| Rhythm | Weekends only, no deadline | Milestones are independently shippable, no cross-weekend half-states. |
| Existing prose | None written yet | Import drops to P3. AI moves last, gated on real chapters. |

---

## 2. Decisions taken, and one that reshapes the scoring

### 2.1 Encryption is out of scope — accepted, with a named cost

Windows 11 Home Single Language has no BitLocker (`manage-bde` refuses; the volume
encryption WMI class is empty). You chose to leave encryption out rather than work
around it. That is a valid call for a manuscript you intend to publish, and it is
recorded here rather than quietly dropped.

Consequences, so nobody is surprised later:

- Dumps are **plaintext at rest** on `D:`.
- If a cloud mirror is ever configured, that provider can read the manuscript.
- **Security stays at 9.0 and data safety tops out at 9.0**, not 9.5+, because
  "stolen laptop" and "sync provider" remain open risks. The plan does not pretend
  otherwise, and nothing below depends on encryption existing.

Everything that is in scope still gets done: no secrets in git, API key in the OS
keystore, strict CSP, localhost-only database, and no prose in logs.

### 2.2 C: has 29.5 GB free, D: has 107.5 GB — durable data moves to D:

Dumps, exports and illustration files now default to `D:`. Docker's own disk image
still lives on `C:` and holds three projects' volumes
(`storyboard_storyboard-pgdata`, `ontrack_pgdata`, `companycomms_pgdata`), so moving
it affects work outside this repository. That move is a separate approved step with
its own checkpoint — see §7.

---

## 3. What "9+" honestly means

Nine of eleven metrics can reach 9+ with code. Two cannot, and pretending otherwise
would be the same dishonesty this audit criticises elsewhere.

| Metric | Today | Target | Can code alone get there? |
|---|---:|---:|---|
| Data model & integrity | 9.5 | **9.5** | Already there. Do not touch it. |
| Type safety & contracts | 9.0 | **9.5** | Yes — split `contract.ts`, name services per domain. |
| Architecture & layering | 8.5 | **9.0** | Yes — plus an import-boundary test. |
| Security | 9.0 | **9.0** | Capped by the no-encryption decision (§2.1). Nothing to build. |
| Testing | 8.5 | **9.0** | Yes — typecheck tests, kill `act()` warnings, coverage gate. |
| DX & maintainability | 8.0 | **9.0** | Yes — local pre-commit gate, faster suite. |
| Data safety & operability | 3.0 | **9.0** | Yes — dump, restore, guard, single instance. |
| Feature completeness | 4.5 | **9.5** | Yes — the screens already have a backend. |
| UI / UX | 6.0 | **9.0** | Yes — keyboard, search, versions, ergonomics. |
| Generality / content model | 3.0 | **9.0** | Yes — project layer. Research stays out by choice. |
| Performance & scale | 7.0 | **8.5** | Partly — needs 100+ chapters to measure honestly. |
| Agentic / AI readiness | 2.0 | **8.0** | Partly — the architecture can be 9; *quality* is unmeasurable until chapters exist. |

**Realistic end state: 9.0–9.2 weighted.** Not because the work stops, but because
two metrics are defined by data you do not have yet. When you have thirty written
chapters, the AI and performance scores get measured instead of estimated, and that
is the only honest route to 9+ on both.

---

## 4. Milestones

Order is deliberate: **safety → identity → screens → export → ergonomics → recall →
AI.** Safety first because it is cheap and irreversible. Identity second because
every screen built before the project layer will have to be reopened afterwards.

### M0 — The book cannot be lost
**Weekend 1–2 · scores: data safety 3 → 8.5**

- `scripts/pg-dump.ts` — `docker exec storyboard-db pg_dump -Fc`, timestamped
  filename, retention (14 daily + 8 weekly), refuses to write inside the repo,
  verifies the file is non-empty and parseable with `pg_restore -l`, then copies to
  `D:\storyboard-backups` and the OneDrive folder.
- `scripts/restore.ts` — restores a chosen dump into a throwaway database and
  compares chapter/fact counts against the source. **A backup that has never been
  restored is a rumour.**
- `scripts/backup-task.ps1` + Task Scheduler registration — daily, plus a catch-up
  run at logon if the last backup is older than 36 hours.
- `docs/backup.md` — where every file lands, how to restore by hand, what to do if
  the container is gone.
- Unit tests on the pure parts: filename, retention selection, path-safety check.

**Done when:** you delete a test chapter, run the restore, and the chapter comes back.

### M1 — The app cannot lose your typing
**Weekend 2–3 · scores: data safety 8.5 → 9, UI/UX 6 → 7.5, testing 8.5 → 9**

- `before-quit` guard: main asks the renderer whether prose is dirty, then Save &
  quit / Discard / Cancel.
- `Ctrl+S`, shown in the editor footer.
- Crash draft: debounced write to `userData/drafts/<chapterId>.md` every ~20s,
  offered on next open. Never auto-commits to canon.
- Single-instance lock (`app.requestSingleInstanceLock`).
- Database-unavailable dialog naming the container and `npm run db:up`.
- **Test hygiene:** add `tsconfig.tests.json` so typecheck covers tests; fix the
  `act(...)` warnings; `isolate: false` to cut ~24s; coverage thresholds in
  `vitest.config.ts`, enforced by a `verify` script (`typecheck && lint && test`).

**Done when:** killing the app mid-sentence loses nothing.

### M2 — More than one work
**Weekend 3–5 · scores: generality 3 → 9**

- Migration `0004_projects.sql`: `kind` enum (`novel` | `light_novel`), `summary`,
  `export_profile` (`royal_road` | `plain`), `archived_at`, `updated_at`.
- `projects:*` channels — list, create, rename, archive. Zod in and out, as always.
- Last-opened work persisted in main (not in the renderer's localStorage — the
  renderer owns nothing durable).
- A picker on first launch and a switcher in the header. Neutral copy: "Work", not
  "My Serial".
- Replace `ACTIVE_PROJECT_ID` at every call site; seed only creates a default on an
  empty database.
- `export_profile` gates the release warnings, so a plain novel is not told it is
  too short for Royal Road.

**Done when:** two works with different casts coexist, and switching is one click.

### M3 — The two tabs that are the whole point
**Weekend 5–8 · scores: completeness 4.5 → 8, UI/UX 7.5 → 8**

- **Relations screen:** category-specific fields, "who knows" multi-select, validity
  range column, secret badge. Reuses `relations:*` untouched.
- **Facts:** chapter tab under the editor (with source quote visible), entity tab on
  the storybook sheet, relation tab on the relations screen. One store, three lenses.
- Accept / reject controls driving `status` — the same buttons the AI layer will use.
- Empty, loading and error states designed once and reused.

**Done when:** you can answer "what happened in chapter 12" and "who knows this
secret" without scrolling prose.

### M4 — Glossary and illustrations
**Weekend 8–9 · scores: completeness 8 → 9**

- Glossary screen grouped by kind, editable notes. This is also the never-touch list
  the English checker will use.
- Illustrations: file picker → slot with `local_path`, anchor warning when the
  chapter has fewer paragraphs than the index, unuploaded badge, explicit
  "this leaves your machine" confirmation before a Catbox upload, error surface for
  a failed upload.
- Volume covers (column + UI), because the spec says volumes hold them and the schema
  does not.

### M5 — Export, finished
**Weekend 9–10 · scores: completeness 9 → 9.5**

- "Copy release HTML" button on the preview — one clipboard call, ends the
  select-the-preview workflow.
- Per-chapter `.html` write with a save dialog (only path that definitely preserves a
  hotlinked image).
- Markdown + JSON archive: a folder of `.md` files plus one manifest. No archive
  dependency; a folder is more durable than a zip anyway.

### M6 — Writing ergonomics
**Weekend 10–12 · scores: UI/UX 8 → 9, data safety 9 → 9.5**

- Move/reorder chapters and arcs in one transaction with ordinal renumbering.
- Version snapshots on every prose save, last 20 kept, one-click restore.
- Soft delete (trash) for chapter/arc/volume with restore.
- Publish tracking: `rr_url` and `published_at` finally writable.
- POV selector wired to `pov_entity_id`.
- Find & replace inside a chapter.

### M7 — Recall
**Weekend 12–13 · scores: UX search, safety completeness**

- `Ctrl+K` search across entities, glossary and facts (`ILIKE` is sufficient at this
  scale; no full-text dependency).
- Alias/duplicate collision check across existing entities.
- Restore-from-dump action in the app, behind a typed confirmation.

### M8 — The DeepSeek layer
**Weekend 13–16 · scores: agentic 2 → 8 · gated on ≥10 written chapters**

- API key in Electron `safeStorage` (DPAPI on Windows), never in a file, never
  returned over IPC, never logged.
- `interfaces/ai-provider.interface.ts` + `deepseek.interface.ts`: timeout, retry,
  JSON mode, zod validation of the response, and a fixture-based test suite that
  never calls the network.
- **English checker:** returns spans and suggestions. Accepting one span is the only
  way text changes. The glossary is injected as a never-touch list.
- **Fact proposals:** write `status='draft'` with a verbatim `source_quote`; the
  service rejects a proposal whose quote is not in the chapter. You approve.
- **Continuity warnings** in the release preview, derived from approved facts.
- **Character graph:** radial layout around the POV, edges from `relations`,
  sentiment as colour, secret as dashes. No graph library.

---

## 5. Security checklist for your specific answers

| Item | Decision | Where it lands |
|---|---|---|
| Disk encryption | **Out of scope by decision (§2.1).** Plaintext at rest, accepted. | — |
| Dumps at rest | Plain, on `D:\storyboard-backups`, outside the repo; path guard in code | M0 ✓ |
| Cloud copies | Not configured. `STORYBOARD_BACKUP_MIRROR_DIR` exists for when you want one | M0 ✓ |
| DB credentials | Localhost-bound; default password documented as such | M0 ✓ |
| DeepSeek key | `safeStorage`, never in `.env`, never over IPC | M8 |
| Prose leaving the machine | Only on an explicit per-chapter action, with a one-time notice | M8 |
| CSP | Unchanged — AI traffic happens in main, so `connect-src 'self'` stays | — |
| Logs | Shapes, latency and token counts only. Never prose. | M8 |
| Second instance | Blocked by single-instance lock | M1 |
| Backups monitored | Task Scheduler + `backup.log`; in-app "last backup" line later | M0 ✓ / M7 |

---

## 6. Score trajectory

| After | Weighted | Biggest mover |
|---|---:|---|
| Today | 6.6 | — |
| M0 + M1 | ~7.5 | data safety 3 → 9 |
| M2 | ~7.9 | generality 3 → 9 |
| M3 + M4 | ~8.6 | completeness 4.5 → 9 |
| M5 | ~8.8 | completeness → 9.5 |
| M6 + M7 | ~9.0 | UX → 9, safety stays 9 (cap) |
| M8 | **~9.1** | agentic 2 → 8 |

---

## 7. Decisions resolved — and the one step still outstanding

Resolved before M0:

1. **Backup destination** — `D:\storyboard-backups`. No cloud copy, because `C:` is
   full. `STORYBOARD_BACKUP_MIRROR_DIR` stays available for when a synced folder on
   `D:` exists; until then there is no off-machine copy and §2.1 says so.
2. **Encryption** — out of scope. Recorded, with consequences, in §2.1.
3. **Docker data location** — approved: move it to `D:`. **Not done yet.** Docker
   Desktop holds three volumes from other projects, so the move is done through its
   own settings (which relocates the data safely) and is scheduled after M0's backup
   is proven, so a restore path exists before anything is moved.
4. **Project migration** — approved. It lands in M2.
5. **Repository** — public GitHub repo `b1trat0/StoryBoard`. No secrets, no
   manuscript data, no dumps, no keys are ever committed; `.gitignore` and the
   dump script's path guard both enforce it.

### Docker data move — the checkpoint procedure

Run only after a dump has been restored successfully:

1. `npm run db:dump` and `npm run db:restore` both green.
2. Docker Desktop → Settings → Resources → Advanced → **Disk image location** →
   `D:\docker-data`. Docker relocates the image itself; do not move files by hand.
3. Restart Docker, then verify all three databases answer:
   `docker ps` and `docker exec storyboard-db pg_isready -U storyboard -d storyboard`.
4. Run `npm run db:restore` again to prove the manuscript survived the move.
5. If anything fails, the dumps on `D:` are the recovery path — this is why the move
   comes after step 1, not before.
