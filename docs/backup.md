# Backup and restore

The manuscript lives in a PostgreSQL container on one machine. This document is the
whole recovery story: what runs, where the files are, and how to prove a dump is good.

## What runs

| Piece | Purpose |
|---|---|
| **Backup** button in the app header | Dumps, verifies, writes, retains and reports the file. Shows the path and the restore command afterwards. |
| `scripts/pg-dump.ts` (`npm run db:dump`) | The same service, from a terminal. |
| `scripts/restore.ts` (`npm run db:restore`) | Restores the newest dump into a throwaway database and compares row counts with live. |

The app and the CLI call the same service (`electron/services/backup.service.ts`), so a
dump taken from the button and one taken from the terminal cannot diverge in
verification, retention or naming.

**There is no scheduler.** A scheduled task that stops working fails silently, and this
app has no server to notice the difference. A button that reports the file it just wrote
cannot lie quietly. The cost is honest: back up when you finish writing, and treat the
"last backup" line as the reminder.

## Where the files go

| What | Default | Override |
|---|---|---|
| Dumps | `D:\storyboard-backups` | `STORYBOARD_BACKUPS_DIR` |
| Optional mirror copy | none | `STORYBOARD_BACKUP_MIRROR_DIR` |
| Illustration files | `D:\storyboard-assets\illustrations` | `STORYBOARD_ILLUSTRATIONS_DIR` |
| Exported `.docx` / `.html` | `D:\storyboard-exports` | `STORYBOARD_EXPORTS_DIR` |

Dumps go to the secondary drive because the system drive holds the Docker image, the
Postgres volume and `node_modules` already. The backup service refuses to write inside
the application directory, so a future misconfiguration cannot put manuscript data
where `git add` can reach it.

## What the button guarantees

The service performs these steps in this order, and nothing is deleted until a verified
dump is on disk:

1. `pg_dump --format=custom --compress=6` to memory.
2. Check the `PGDMP` header.
3. Prove the archive is readable end to end with `pg_restore -l`.
4. Write under a `.partial` name, then rename.
5. Copy to the mirror directory, if one is configured.
6. Delete expired dumps.
7. Report the file path, size and the row counts it contains.

## Restore drill

Run this after any schema change, and at least once a month:

```bash
npm run db:restore                 # newest dump
npm run db:restore -- --file=D:\storyboard-backups\storyboard-20261106-005343.dump
npm run db:restore -- --keep       # keep the throwaway database to inspect it
```

It drops and recreates `storyboard_restore_check`, restores the archive with
`--exit-on-error --no-owner --no-privileges`, then compares `chapters`, `entities`,
`facts` and `relations` against the live database. **A non-zero exit code means the
backup is not trustworthy** — do not delete the old ones until it passes.

## Retention

- Always keep the newest 14 dumps.
- Always keep one dump per ISO week, for the most recent 8 weeks.
- Never delete a file that does not match `storyboard-YYYYMMDD-HHmmss.dump`.

Rules live in `electron/lib/backup-policy.ts` and are unit tested; the service only
executes the decision.

## Manual recovery, no app

If the app will not start but Docker is fine:

```bash
docker compose up -d db
npm run db:restore -- --keep
docker exec -it storyboard-db psql -U storyboard -d storyboard_restore_check -c "\dt"
```

To promote the verified copy to live, stop the app first, then (destructive, asks by
name):

```bash
docker exec storyboard-db psql -U storyboard -d postgres -c "DROP DATABASE storyboard"
docker exec storyboard-db psql -U storyboard -d postgres -c "CREATE DATABASE storyboard"
docker exec -i storyboard-db pg_restore -U storyboard -d storyboard --no-owner < D:\storyboard-backups\<file>.dump
```

If the container or the volume is gone, recreate it with `npm run db:up`,
`npm run db:migrate`, then restore the newest dump into the new volume.

## Known gap: no off-machine copy

A dump on `D:` survives a mistake, a bad migration and a dead system drive. It does
**not** survive fire, theft or ransomware, because it is on the same machine. The backup
screen says so every time until a mirror is configured.

To close it without filling `C:`, point `STORYBOARD_BACKUP_MIRROR_DIR` at a
cloud-synced folder that itself lives on `D:`. Every verified dump is then copied there
automatically.

**Encryption is out of scope by decision.** Windows 11 Home has no BitLocker, so dumps
are plaintext at rest. If a mirror is configured, whatever service hosts it can read the
manuscript — that is an accepted trade, not a surprise.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pg_dump failed ... Is the database container running?` | Container stopped | `npm run db:up` |
| `Refusing to write backups inside the repository` | `STORYBOARD_BACKUPS_DIR` points at the app directory | Point it at `D:\...` |
| `The archive is not readable by pg_restore` | Disk full, or Docker died mid-stream | Free space, re-run; nothing was written |
| `A backup with this exact timestamp already exists` | Two backups in the same second | Try again in a second |
| Restore counts differ | The dump is from a different database, or a partial restore | Do not delete older dumps; restore an earlier one |
