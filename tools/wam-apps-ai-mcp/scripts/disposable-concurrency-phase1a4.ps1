# Phase 1A.4 deterministic concurrency verification for send_agent_notification
# Usage: .\scripts\disposable-concurrency-phase1a4.ps1 [database_url]
param(
  [string]$DatabaseUrl = "postgresql://postgres@localhost:5432/postgres"
)

$ErrorActionPreference = "Stop"
$psql = $env:PSQL
if (-not $psql) {
  $psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
  if (-not (Test-Path $psql)) { $psql = "psql" }
}

$agent = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
$sameKey = [guid]::NewGuid().ToString()
$overlapTitle = "Parallel overlap $sameKey"
$corr1 = [guid]::NewGuid().ToString()
$corr2 = [guid]::NewGuid().ToString()
$conflictKey = [guid]::NewGuid().ToString()

function Invoke-PsqlScalar {
  param([string]$Sql)
  $tmp = Join-Path $env:TEMP ("phase1a4_" + [guid]::NewGuid().ToString() + ".sql")
  Set-Content $tmp $Sql -Encoding UTF8
  $out = & $psql $DatabaseUrl -v ON_ERROR_STOP=1 -t -A -f $tmp 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $out" }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  return $out.Trim()
}

Write-Host "=== Overlap test: advisory lock held while parallel identical send runs ==="

$holdSql = @"
BEGIN;
SELECT wam_ai._action_idempotency_advisory_lock('send_agent_notification', '$sameKey'::uuid);
SELECT pg_sleep(4);
SELECT wam_ai.send_agent_notification(
  '$agent'::uuid, NULL,
  '$overlapTitle', 'Deterministic overlap concurrency probe.',
  'SYSTEM_ANNOUNCEMENT', NULL,
  '$sameKey'::uuid,
  '$corr1'::uuid,
  'conc-overlap', 'technical_owner', 'Overlap holder', 'approved', NULL
);
COMMIT;
"@

$parallelSql = @"
SELECT wam_ai.send_agent_notification(
  '$agent'::uuid, NULL,
  '$overlapTitle', 'Deterministic overlap concurrency probe.',
  'SYSTEM_ANNOUNCEMENT', NULL,
  '$sameKey'::uuid,
  '$corr2'::uuid,
  'conc-overlap', 'technical_owner', 'Overlap waiter', 'approved', NULL
) AS result;
"@

$tmpHold = Join-Path $env:TEMP "phase1a4_hold.sql"
$tmpParallel = Join-Path $env:TEMP "phase1a4_parallel.sql"
Set-Content $tmpHold $holdSql -Encoding UTF8
Set-Content $tmpParallel $parallelSql -Encoding UTF8

$holdJob = Start-Job { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,$tmpHold
Start-Sleep -Milliseconds 400
$parallelJob = Start-Job { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,$tmpParallel
Wait-Job $holdJob,$parallelJob | Out-Null
$holdOut = Receive-Job $holdJob | Out-String
$parallelOut = Receive-Job $parallelJob | Out-String
Remove-Job $holdJob,$parallelJob -Force
Write-Host $holdOut
Write-Host $parallelOut

if ($parallelOut -notmatch 'idempotent_replay') {
  throw "parallel waiter must idempotent_replay while holder owns lock"
}

$verifyOverlap = @"
DO `$`$
DECLARE
  c_notif int;
  c_req int;
  c_evt int;
BEGIN
  SELECT count(*)::int INTO c_notif FROM public.notifications
  WHERE agent_id = '$agent'::uuid AND title = '$overlapTitle';
  IF c_notif <> 1 THEN RAISE EXCEPTION 'expected 1 notification row, got %', c_notif; END IF;

  SELECT count(*)::int INTO c_req FROM wam_ai.action_requests
  WHERE idempotency_key = '$sameKey'::uuid AND operation_name = 'send_agent_notification';
  IF c_req <> 1 THEN RAISE EXCEPTION 'expected 1 action_request, got %', c_req; END IF;

  SELECT count(*)::int INTO c_evt FROM wam_ai.action_events
  WHERE idempotency_key = '$sameKey'::uuid AND operation_name = 'send_agent_notification';
  IF c_evt <> 1 THEN RAISE EXCEPTION 'expected 1 action_event, got %', c_evt; END IF;
END;
`$`$;
"@
$tmpVerify = Join-Path $env:TEMP "phase1a4_overlap_verify.sql"
Set-Content $tmpVerify $verifyOverlap -Encoding UTF8
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $tmpVerify
if ($LASTEXITCODE -ne 0) { throw "overlap verify failed" }

Write-Host "=== Changed-content race under same idempotency key ==="
$raceTitleA = "Race title A $conflictKey"
$raceTitleB = "Race title B $conflictKey"
$raceA = @"
SELECT wam_ai.send_agent_notification(
  '$agent'::uuid, NULL,
  '$raceTitleA', 'Same key different content race A.',
  'SYSTEM_ANNOUNCEMENT', NULL,
  '$conflictKey'::uuid,
  gen_random_uuid(),
  'race-overlap', 'technical_owner', 'Race A', 'approved', NULL
) AS result;
"@
$raceB = @"
SELECT wam_ai.send_agent_notification(
  '$agent'::uuid, NULL,
  '$raceTitleB', 'Same key different content race B.',
  'SYSTEM_ANNOUNCEMENT', NULL,
  '$conflictKey'::uuid,
  gen_random_uuid(),
  'race-overlap', 'technical_owner', 'Race B', 'approved', NULL
) AS result;
"@
$tmpA = Join-Path $env:TEMP "phase1a4_race_a.sql"
$tmpB = Join-Path $env:TEMP "phase1a4_race_b.sql"
Set-Content $tmpA ($raceA -replace 'gen_random_uuid\(\)', "'$([guid]::NewGuid())'") -Encoding UTF8
Set-Content $tmpB ($raceB -replace 'gen_random_uuid\(\)', "'$([guid]::NewGuid())'") -Encoding UTF8

$jobA = Start-Job { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,$tmpA
$jobB = Start-Job { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,$tmpB
Wait-Job $jobA,$jobB | Out-Null
$outA = Receive-Job $jobA | Out-String
$outB = Receive-Job $jobB | Out-String
Remove-Job $jobA,$jobB -Force
Write-Host $outA
Write-Host $outB

$verifyRace = @"
DO `$`$
DECLARE c int;
BEGIN
  SELECT count(*)::int INTO c FROM public.notifications
  WHERE agent_id = '$agent'::uuid AND title IN ('$raceTitleA', '$raceTitleB');
  IF c <> 1 THEN RAISE EXCEPTION 'changed-content race must leave exactly one notification, got %', c; END IF;
  SELECT count(*)::int INTO c FROM wam_ai.action_requests
  WHERE idempotency_key = '$conflictKey'::uuid AND operation_name = 'send_agent_notification';
  IF c <> 1 THEN RAISE EXCEPTION 'expected one action_request for conflict key, got %', c; END IF;
END;
`$`$;
"@
$tmpRaceVerify = Join-Path $env:TEMP "phase1a4_race_verify.sql"
Set-Content $tmpRaceVerify $verifyRace -Encoding UTF8
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $tmpRaceVerify
if ($LASTEXITCODE -ne 0) { throw "race verify failed" }

Write-Host "disposable_concurrency_phase1a4_pass"
