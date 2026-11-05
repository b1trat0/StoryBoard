# StoryBoard

A local-only desktop app for writing a serial fantasy light novel and publishing it to
Royal Road. One user, one machine, no server, no accounts.

**The problem it solves:** a long serial outlives memory. StoryBoard exists so the author
never has to reread a chapter to recall what happened, and never contradicts something
established two hundred pages earlier.

## What works today

- **Works** — as many manuscripts as you write, each with its own cast, outline and
  continuity record, a kind (light novel / novel) and a publishing profile. The app
  reopens the work you used last.
- **Storybook** — characters, places, factions, items and rules, with aliases and prose sheets.
- **Relations** — social, possession and membership, with sentiment only where it means
  something, validity ranges, secrets, and who has learned each one.
- **Glossary** — every invented name and word pinned, with notes; the never-touch list for
  the future English checker.
- **Search** — Ctrl+K across entities, aliases, glossary and facts, jumping straight to
  the chapter a fact came from.
- **Illustrations** — slots anchored to a paragraph, alt text required, upload to Catbox
  only after an explicit confirmation, and a warning when the chapter got shorter than an
  existing anchor.
- **Facts** — recorded per chapter and per entity with a required source quote, then
  approved or rejected. This is the tab that stops a reread.
- **Chapters** — volume → arc → chapter outline, prose editor, Royal Road author notes,
  word counts, Ctrl+S, a close guard that refuses to discard unsaved prose, and crash
  recovery that keeps typing when the process dies.
- **Formatting reference** — the exact markdown the exporter understands, verified against
  the converter by tests.
- **Royal Road export** — release preview with blockers and warnings, plus per-volume `.docx`
  for bulk import.
- **Backups** — verified `pg_dump` with retention and a restore drill, from the header button or the CLI.

Not built yet: relations, facts, glossary and illustration screens (the backend for all four
is done), per-chapter `.html` export, the markdown archive, and the AI layer.

## Requirements

- Windows, macOS or Linux with Node 20+
- Docker Desktop with PostgreSQL 16
- A second drive is recommended for dumps; nothing defaults inside the repository

## Run it

```bash
npm install
npm run db:up        # start PostgreSQL in Docker
npm run db:migrate   # apply migrations
npm run db:seed      # create the default work
npm start            # build both sides and open the window
```

`npm run dev` is the hot-reload equivalent and is the normal entry point.

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run db:dump
npm run db:restore   # proves the backup is restorable
```

## Documentation

- `AGENTS.md` — the project's hard rules, data model and export constraints
- `docs/backup.md` — where backups go and how to restore one
- `docs/climb-plan.md` — the milestone plan and score targets
- `docs/project-audit.html` — the engineering audit (open in a browser)

## Privacy

The app is local-only: no telemetry, no HTTP server, no accounts. Nothing leaves the machine
except two deliberate actions: an illustration explicitly uploaded by the author to an image
host, and a single chapter sent to DeepSeek when the author presses a button in the writing
assist dialog. The API key is stored OS-encrypted and is never returned to the UI.

Database credentials are development defaults bound to `127.0.0.1` and are not secrets.
No manuscript text, database dump, API key or local path is ever committed to this
repository.

## Licence

Not decided yet. Treat the repository as source-available until a licence file exists.
