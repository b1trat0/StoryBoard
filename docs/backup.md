# Backup and restore

The manuscript lives in a PostgreSQL container on one machine. This document is the
whole recovery story: what runs, where the files are, and how to prove a dump is good.

## What runs

| Piece | Purpose |
|---|---|
| `scripts/pg-dump.ts` (`npm run db:dump`) | Dumps the database, verifies the archive, writes it, then applies retention. |
| `scripts/restore.ts` (`npm run db:restore`) | Restores the newest dump into a throwaway database and compares row counts with live. |
| `scripts/backup.ps1` | Task Scheduler wrapper. Appends to `backup.log` next to the dumps. |
| `scripts/register-backup-task.ps1` (`npm run backup:task`) | Registers the daily trigger plus a logon catch-up. Idempotent. |

Nothing here is started automatically by the app. A writing session and a backup run
are independent, which is deliberate: the backup must work when the app is closed.

## Where the files go

| What | Default | Override |
|---|---|---|
| Dumps and `backup.log` | `D:\storyboard-backups` | `STORYBOARD_BACKUPS_DIR` |
| Optional mirror copy | none | `STORYBOARD_BACKUP_MIRROR_DIR` |
| Illustration files | `D:\storyboard-assets\illustrations` | `STORYBOARD_ILLUSTRATIONS_DIR` |
| Exported `.docx` / `.html` | `D:\storyboard-exports` | `STORYBOARD_EXPORTS_DIR` |

Dumps go to the secondary drive because the system drive holds the Docker image, the
Postgres volume and `node_modules` already. The dump script itself refuses to write
inside the repository, so a future misconfiguration cannot put manuscript data where
`git add` can reach it.

## Schedule it once

```powershell
npm run backup:task
```

That registers **StoryBoard Backup**: daily at 21:00, plus a logon run that only fires
when the newest dump is over 36 hours old. It does not need elevation and does not
store a password; it runs while you are logged on.

Check it:

```powershell
Get-ScheduledTask -TaskName 'StoryBoard Backup' | Get-ScheduledTaskInfo
Start-ScheduledTask -TaskName 'StoryBoard Backup'
Get-Content D:\storyboard-backups\backup.log -Tail 20
```

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
- A dump is only written after `pg_restore -l` proves the archive is readable, and it
  is written to a `.partial` name first so an interrupted run cannot leave a file that
  looks complete.

Rules live in `electron/lib/backup-policy.ts` and are unit tested; the script only
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

## Known gap: no off-machine copy yet

A dump on `D:` survives a mistake, a bad migration and a dead system drive. It does
**not** survive fire, theft or ransomware, because it is on the same machine.

Two ways to close that, both without filling `C:`:

1. Point `STORYBOARD_BACKUP_MIRROR_DIR` at a cloud-synced folder that itself lives on
   `D:`, and every verified dump is copied there automatically.
2. Keep doing what this document says and copy `D:\storyboard-backups` to external
   media after each writing session.

**Encryption is out of scope by decision.** Windows 11 Home has no BitLocker, so the
dumps are plaintext at rest. If a mirror is ever configured, whatever service hosts it
can read the manuscript — treat that as an accepted trade, not a surprise.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `pg_dump failed ... connection` | Container not running | `npm run db:up` |
| `Refusing to write backups inside the repository` | `STORYBOARD_BACKUPS_DIR` points at the repo | Point it at `D:\...` |
| `the dump archive is not readable by pg_restore` | Disk full, or Docker died mid-stream | Free space, re-run; nothing was written |
| Restore counts differ | The dump is from a different database, or a partial restore | Do not delete older dumps; restore an earlier one |
| Task runs but no dump appears | `npm` not on the task's PATH | Run `scripts/backup.ps1` by hand; it prints the real error to `backup.log` |
