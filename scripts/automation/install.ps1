param([switch]$SkipTaskRegistration)
$ErrorActionPreference = 'Stop'
$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$statePath = Join-Path $env:LOCALAPPDATA 'RetroLoopAutomation'
New-Item -ItemType Directory -Path $statePath -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $statePath 'runtime') -Force | Out-Null
$nodePath = (Get-Command node.exe).Source
$codexCommand = (Get-Command codex).Source
$codexEntry = Join-Path (Split-Path $codexCommand) 'node_modules/@openai/codex/bin/codex.js'
$npmEntry = Join-Path (Split-Path $nodePath) 'node_modules/npm/bin/npm-cli.js'
if (!(Test-Path -LiteralPath $codexEntry) -or !(Test-Path -LiteralPath $npmEntry)) {
  throw 'Cannot resolve installed Codex/npm entry points. No tools were downloaded.'
}
$commands = @{
  node = @{ file = $nodePath; args = @() }
  npm = @{ file = $nodePath; args = @($npmEntry) }
  codex = @{ file = $nodePath; args = @($codexEntry) }
}
foreach ($name in @('claude', 'gh', 'git')) {
  $commands[$name] = @{ file = (Get-Command "$name.exe").Source; args = @() }
}
$encoding = New-Object System.Text.UTF8Encoding($false)
$installation = @{ repositoryPath = $repositoryPath; commands = $commands }
[IO.File]::WriteAllText((Join-Path $statePath 'installation.json'), ($installation | ConvertTo-Json -Depth 8), $encoding)
foreach ($file in @('run.mjs', 'core.mjs', 'github-app.mjs')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $statePath "runtime/$file") -Force
}
foreach ($file in @('policy.json', 'result.schema.json', 'review.schema.json')) {
  Copy-Item -LiteralPath (Join-Path $repositoryPath "automation/$file") -Destination (Join-Path $statePath $file) -Force
}
$launcher = @'
$ErrorActionPreference = 'Stop'
$env:RETRO_AUTOMATION_HOME = $PSScriptRoot
$config = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'installation.json') | ConvertFrom-Json
& $config.commands.node.file (Join-Path $PSScriptRoot 'runtime/run.mjs') @args
exit $LASTEXITCODE
'@
[IO.File]::WriteAllText((Join-Path $statePath 'launch.ps1'), $launcher, $encoding)
if (!(Test-Path -LiteralPath (Join-Path $statePath 'audit.json'))) {
  $services = @{}
  foreach ($name in @('codex','claude','github','vercel','neon','gemini','resend','devlake')) {
    $services[$name] = @{ mode = 'unverified'; verifiedAt = $null; evidence = '' }
  }
  $audit = @{ policyHash = ''; autoRechargeDisabled = $false; productionLiveCallsDisabled = $false; rollbackLiveCallsDisabled = $false; vercelGitDeploymentsDisabled = $false; services = $services }
  [IO.File]::WriteAllText((Join-Path $statePath 'audit.json'), ($audit | ConvertTo-Json -Depth 8), $encoding)
}
if (!$SkipTaskRegistration) {
  if ((Get-TimeZone).Id -ne 'Tokyo Standard Time') { throw 'Task registration requires the Windows timezone to be Tokyo Standard Time.' }
  # Launch Node directly: no dependency on PowerShell's script execution policy.
  $taskBootstrap = "process.env.RETRO_AUTOMATION_HOME=process.cwd();import('./runtime/run.mjs')"
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "--input-type=module -e `"$taskBootstrap`"" -WorkingDirectory $statePath
  $triggers = @(
    (New-ScheduledTaskTrigger -Daily -At '05:00'),
    (New-ScheduledTaskTrigger -Daily -At '13:00'),
    (New-ScheduledTaskTrigger -Daily -At '21:00'),
    (New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name))
  )
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 95) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'RetroLoop-AutonomousImprovement' -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'JST 05:00/13:00/21:00. Billing audit required; paid calls disabled by default.' -Force | Select-Object TaskName, State
}
Write-Output "Installed: $statePath"
Write-Output 'Existing audit is preserved. Development and production release prerequisites are checked separately; run launch.ps1 --dry-run for current status (exit 2 = blocked).'
