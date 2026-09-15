# Phase 1A.6 deterministic concurrency verification for prepare/finalize SMS
# Usage: .\scripts\disposable-concurrency-phase1a6.ps1 [database_url]
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
$overlapBody = "Parallel overlap SMS probe $sameKey"
$corr1 = [guid]::NewGuid().ToString()
$corr2 = [guid]::NewGuid().ToString()
$conflictKey = [guid]::NewGuid().ToString()

function Invoke-PsqlScalar {
  param([string]$Sql)
  $tmp = Join-Path $env:TEMP ("phase1a6_" + [guid]::NewGuid().ToString() + ".sql")
  Set-Content $tmp $Sql -Encoding UTF8
  $out = & $psql $DatabaseUrl -v ON_ERROR_STOP=1 -t -A -f $tmp 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $out" }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  return $out.Trim()
}

$destFp = Invoke-PsqlScalar @"
SELECT wam_ai.preview_agent_sms_recipient('$agent'::uuid, NULL, 'airtel')->>'destination_fingerprint';
"@

Write-Host "=== Overlap test: prepare lock held while parallel identical prepare runs ==="

$holdSql = @"
BEGIN;
SELECT wam_ai.prepare_send_agent_sms(
  '$agent'::uuid, NULL,
  '$overlapBody', 'airtel',
  '$sameKey'::uuid,
  '$corr1'::uuid,
  'conc-overlap', 'technical_owner', 'Overlap holder', 'approved', 'A-AAAAAAAA', '$destFp'
);
SELECT pg_sleep(4);
SELECT wam_ai.finalize_send_agent_sms(
  '$sameKey'::uuid,
  '$corr1'::uuid,
  'conc-overlap', 'technical_owner',
  'provider_accepted', 'mock-overlap-1', NULL, NULL, true,
  '$overlapBody'
);
COMMIT;
"@

$parallelSql = @"
SELECT wam_ai.prepare_send_agent_sms(
  '$agent'::uuid, NULL,
  '$overlapBody', 'airtel',
  '$sameKey'::uuid,
  '$corr2'::uuid,
  'conc-overlap', 'technical_owner', 'Overlap waiter', 'approved', 'A-AAAAAAAA', '$destFp'
) AS result;
"@

$tmpHold = Join-Path $env:TEMP "phase1a6_hold.sql"
$tmpParallel = Join-Path $env:TEMP "phase1a6_parallel.sql"
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
  throw "parallel waiter must idempotent_replay while holder completes"
}

$verifyOverlap = @"
DO `$`$
DECLARE
  c_intent int;
  c_req int;
  c_evt int;
BEGIN
  SELECT count(*)::int INTO c_intent FROM wam_ai.sms_send_intents
  WHERE idempotency_key = '$sameKey'::uuid;
  IF c_intent <> 1 THEN RAISE EXCEPTION 'expected 1 sms_send_intent, got %', c_intent; END IF;

  SELECT count(*)::int INTO c_req FROM wam_ai.action_requests
  WHERE idempotency_key = '$sameKey'::uuid AND operation_name = 'send_agent_sms';
  IF c_req <> 1 THEN RAISE EXCEPTION 'expected 1 action_request, got %', c_req; END IF;

  SELECT count(*)::int INTO c_evt FROM wam_ai.action_events
  WHERE idempotency_key = '$sameKey'::uuid AND operation_name = 'send_agent_sms';
  IF c_evt <> 1 THEN RAISE EXCEPTION 'expected 1 action_event, got %', c_evt; END IF;
END;
`$`$;
"@
$tmpVerify = Join-Path $env:TEMP "phase1a6_overlap_verify.sql"
Set-Content $tmpVerify $verifyOverlap -Encoding UTF8
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $tmpVerify
if ($LASTEXITCODE -ne 0) { throw "overlap verify failed" }

Write-Host "=== Changed-content race under same idempotency key ==="
$raceBodyA = "Race body A $conflictKey"
$raceBodyB = "Race body B $conflictKey"
$raceCorrA = [guid]::NewGuid().ToString()
$raceCorrB = [guid]::NewGuid().ToString()
$raceA = @"
SELECT wam_ai.prepare_send_agent_sms(
  '$agent'::uuid, NULL,
  '$raceBodyA', 'airtel',
  '$conflictKey'::uuid,
  '$raceCorrA'::uuid,
  'race-overlap', 'technical_owner', 'Race A', 'approved', 'A-AAAAAAAA', '$destFp'
);
SELECT wam_ai.finalize_send_agent_sms(
  '$conflictKey'::uuid,
  '$raceCorrA'::uuid,
  'race-overlap', 'technical_owner',
  'provider_accepted', 'mock-race-a', NULL, NULL, false,
  '$raceBodyA'
);
"@
$raceB = @"
SELECT wam_ai.prepare_send_agent_sms(
  '$agent'::uuid, NULL,
  '$raceBodyB', 'airtel',
  '$conflictKey'::uuid,
  '$raceCorrB'::uuid,
  'race-overlap', 'technical_owner', 'Race B', 'approved', 'A-AAAAAAAA', '$destFp'
);
SELECT wam_ai.finalize_send_agent_sms(
  '$conflictKey'::uuid,
  '$raceCorrB'::uuid,
  'race-overlap', 'technical_owner',
  'provider_accepted', 'mock-race-b', NULL, NULL, false,
  '$raceBodyB'
);
"@
$tmpA = Join-Path $env:TEMP "phase1a6_race_a.sql"
$tmpB = Join-Path $env:TEMP "phase1a6_race_b.sql"
Set-Content $tmpA $raceA -Encoding UTF8
Set-Content $tmpB $raceB -Encoding UTF8

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
  SELECT count(*)::int INTO c FROM wam_ai.sms_send_intents
  WHERE idempotency_key = '$conflictKey'::uuid;
  IF c <> 1 THEN RAISE EXCEPTION 'changed-content race must leave exactly one intent, got %', c; END IF;
  SELECT count(*)::int INTO c FROM wam_ai.action_requests
  WHERE idempotency_key = '$conflictKey'::uuid AND operation_name = 'send_agent_sms';
  IF c <> 1 THEN RAISE EXCEPTION 'expected one action_request for conflict key, got %', c; END IF;
END;
`$`$;
"@
$tmpRaceVerify = Join-Path $env:TEMP "phase1a6_race_verify.sql"
Set-Content $tmpRaceVerify $verifyRace -Encoding UTF8
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $tmpRaceVerify
if ($LASTEXITCODE -ne 0) { throw "race verify failed" }

Write-Host "disposable_concurrency_phase1a6_pass"
