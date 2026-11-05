#requires -Version 5.1
<#
.SYNOPSIS
    Takes a verified dump of the StoryBoard manuscript database.

.DESCRIPTION
    Wrapper for `npm run db:dump` so Task Scheduler has one stable target. The dump
    script itself decides retention and refuses to write inside the repository; this
    file only locates the backups directory, appends output to a log next to the
    dumps, and propagates the exit code.

.PARAMETER OnlyIfStale
    Skips the run when the newest dump is under 36 hours old. Used by the logon
    trigger so a machine that was asleep at 21:00 still catches up, without dumping
    on every login.
#>
param(
    [switch]$OnlyIfStale
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backupsDir = if ($env:STORYBOARD_BACKUPS_DIR) {
    $env:STORYBOARD_BACKUPS_DIR
} else {
    'D:\storyboard-backups'
}

New-Item -ItemType Directory -Force -Path $backupsDir | Out-Null
$logPath = Join-Path $backupsDir 'backup.log'

if ($OnlyIfStale) {
    $newest = Get-ChildItem -Path $backupsDir -Filter 'storyboard-*.dump' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -ne $newest) {
        $ageHours = ((Get-Date) - $newest.LastWriteTime).TotalHours
        if ($ageHours -lt 36) {
            "[$(Get-Date -Format o)] skipped, newest dump is $([math]::Round($ageHours, 1))h old" |
                Out-File -FilePath $logPath -Append -Encoding utf8
            exit 0
        }
    }
}

"[$(Get-Date -Format o)] backup started" | Out-File -FilePath $logPath -Append -Encoding utf8

Push-Location $repoRoot
try {
    & npm.cmd run db:dump *>&1 | Out-File -FilePath $logPath -Append -Encoding utf8
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

"[$(Get-Date -Format o)] backup finished with exit code $exitCode" |
    Out-File -FilePath $logPath -Append -Encoding utf8

exit $exitCode
