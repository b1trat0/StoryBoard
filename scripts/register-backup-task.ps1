#requires -Version 5.1
<#
.SYNOPSIS
    Registers the daily StoryBoard backup with Task Scheduler.

.DESCRIPTION
    One daily trigger at the given time, plus a logon trigger that only runs when the
    newest dump is older than 36 hours. Idempotent: re-running replaces the task
    rather than creating a second one.

    Run this once, from a normal PowerShell window owned by the same user who writes.
    It does not need elevation, and the task runs only while that user is logged on —
    a scheduled task holding a stored password is a worse trade than a catch-up run
    at logon.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-backup-task.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-backup-task.ps1 -Time 22:30
#>
param(
    [string]$Time = '21:00'
)

$ErrorActionPreference = 'Stop'

$taskName = 'StoryBoard Backup'
$backupScript = Join-Path $PSScriptRoot 'backup.ps1'

if (-not (Test-Path -LiteralPath $backupScript)) {
    throw "Backup script not found at $backupScript"
}

$powershellExe = Join-Path $PSHOME 'powershell.exe'
$dailyAction = New-ScheduledTaskAction -Execute $powershellExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$backupScript`""
$logonAction = New-ScheduledTaskAction -Execute $powershellExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$backupScript`" -OnlyIfStale"

$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $Time
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action @($dailyAction, $logonAction) `
    -Trigger @($dailyTrigger, $logonTrigger) `
    -Settings $settings `
    -Description 'Dumps the StoryBoard manuscript database to the secondary drive and verifies it.' `
    -Force | Out-Null

Write-Host "Registered '$taskName'."
Write-Host "  daily at   $Time"
Write-Host "  at logon   only if the newest dump is older than 36 hours"
Write-Host ''
Write-Host 'Verify with:'
Write-Host "  Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host '  Start-ScheduledTask -TaskName ''StoryBoard Backup'''
