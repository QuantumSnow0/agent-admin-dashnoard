# Phase 1A.3 concurrency: revert_lead_pending_install idempotency under parallel calls
# Usage: .\scripts\disposable-concurrency-phase1a3.ps1 [database_url]
param(
  [string]$DatabaseUrl = "postgresql://postgres@localhost:5432/postgres"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$psql = $env:PSQL
if (-not $psql) {
  $psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
  if (-not (Test-Path $psql)) { $psql = "psql" }
}

$lead = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1"
$sameKey = [guid]::NewGuid().ToString()
$corr1 = [guid]::NewGuid().ToString()
$corr2 = [guid]::NewGuid().ToString()

$prep = @"
UPDATE public.inbound_leads
SET status = 'installed', commission_earned_ksh = 200, installed_at = now()
WHERE id = '$lead';
"@
$tmpPrep = Join-Path $env:TEMP "phase1a3_conc_prep.sql"
Set-Content $tmpPrep $prep -Encoding UTF8
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $tmpPrep
if ($LASTEXITCODE -ne 0) { throw "prep failed" }

$sql = @"
SELECT wam_ai.revert_lead_pending_install(
  '$lead'::uuid, NULL,
  '$sameKey'::uuid,
  gen_random_uuid(),
  'conc-test', 'technical_owner', 'Concurrent revert', 'installed'
) AS result;
"@

$tmp1 = Join-Path $env:TEMP "phase1a3_conc_a.sql"
$tmp2 = Join-Path $env:TEMP "phase1a3_conc_b.sql"
Set-Content $tmp1 ($sql -replace 'gen_random_uuid\(\)', "'$corr1'") -Encoding UTF8
Set-Content $tmp2 ($sql -replace 'gen_random_uuid\(\)', "'$corr2'") -Encoding UTF8

Write-Host "Running parallel revert_lead_pending_install with same idempotency key..."
$job1 = Start-Job { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,$tmp1
$job2 = Start-Job { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,$tmp2
Wait-Job $job1,$job2 | Out-Null
$out1 = Receive-Job $job1 | Out-String
$out2 = Receive-Job $job2 | Out-String
Remove-Job $job1,$job2 -Force
Write-Host $out1
Write-Host $out2

$verify = @"
DO `$`$
DECLARE c int;
BEGIN
  SELECT count(*)::int INTO c FROM wam_ai.action_requests WHERE idempotency_key = '$sameKey';
  IF c <> 1 THEN RAISE EXCEPTION 'expected exactly one action_request, got %', c; END IF;
  SELECT count(*)::int INTO c FROM public.inbound_leads WHERE id = '$lead' AND status = 'pending_install';
  IF c <> 1 THEN RAISE EXCEPTION 'lead not reverted exactly once'; END IF;
END;
`$`$;
"@
$tmpVerify = Join-Path $env:TEMP "phase1a3_conc_verify.sql"
Set-Content $tmpVerify $verify -Encoding UTF8
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $tmpVerify
if ($LASTEXITCODE -ne 0) { throw "concurrency verify failed" }

Write-Host "disposable_concurrency_phase1a3_pass"
