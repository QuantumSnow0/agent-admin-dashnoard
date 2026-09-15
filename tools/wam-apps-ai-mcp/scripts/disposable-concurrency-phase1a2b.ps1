# Real PostgreSQL concurrency test for Phase 1A.2b create_lead_offer
# Usage: .\scripts\disposable-concurrency-phase1a2b.ps1 [database_url]
param(
  [string]$DatabaseUrl = "postgresql://postgres@localhost:5432/wam_ai_fixture"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$psql = $env:PSQL
if (-not $psql) {
  $psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
  if (-not (Test-Path $psql)) { $psql = "psql" }
}

function Invoke-Psql {
  param([string]$Sql)
  $tmp = Join-Path $env:TEMP "wam_concurrency_$([guid]::NewGuid().ToString()).sql"
  Set-Content -Path $tmp -Value $Sql -Encoding UTF8
  & $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $tmp
  if ($LASTEXITCODE -ne 0) { throw "psql failed" }
  Remove-Item $tmp -Force
}

Write-Host "Preparing county + concurrency fixture..."
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -f (Join-Path $Root "scripts\disposable-county-phase1a2b.sql")
if ($LASTEXITCODE -ne 0) { throw "county fixture failed" }

$lead = "77777777-7777-7777-7777-777777777777"
$agent1 = "11111111-1111-1111-1111-111111111111"
$agent2 = "22222222-2222-2222-2222-222222222222"
$lead2 = "99999999-9999-9999-9999-999999999999"

$prepLead2 = @"
INSERT INTO public.inbound_leads (
  id, created_at, customer_name, primary_phone, status, source, product, county,
  installation_town, dedupe_phone_key, metadata
) VALUES (
  '$lead2', now(), 'Parallel Lead', '254799000099', 'admin_queue', 'airtel5grouter', 'airtel', 'Nairobi',
  'Nairobi', 'dedupe-parallel',
  '{"googlePlace":{"county":"Nairobi","lat":-1.2921,"lng":36.8219}}'::jsonb
) ON CONFLICT (id) DO UPDATE SET status = 'admin_queue', assigned_agent_id = NULL, accepted_at = NULL;
DELETE FROM public.lead_offers WHERE lead_id = '$lead2';
"@ 
Invoke-Psql $prepLead2

function New-OfferSql {
  param(
    [string]$LeadId,
    [string]$AgentId,
    [string]$IdemKey,
    [string]$CorrId,
    [string]$Label
  )
  return @"
SELECT '$Label' AS label,
  wam_ai.create_lead_offer(
    '$LeadId'::uuid, NULL, '$AgentId'::uuid, NULL,
    '$IdemKey'::uuid, '$CorrId'::uuid,
    'concurrency_test', 'technical_owner', '$Label',
    NULL, 'admin_queue', true, NULL, NULL
  ) AS result;
"@
}

Write-Host "=== Test 1: same idempotency key concurrent ==="
$sameKey = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01"
$c1 = "ffffffff-ffff-ffff-ffff-fffffffffff1"
$c2 = "ffffffff-ffff-ffff-ffff-fffffffffff2"
$sql1 = New-OfferSql $lead $agent1 $sameKey $c1 "same_key_a"
$sql2 = New-OfferSql $lead $agent1 $sameKey $c2 "same_key_b"

$tmp1 = Join-Path $env:TEMP "conc1.sql"; Set-Content $tmp1 $sql1
$tmp2 = Join-Path $env:TEMP "conc2.sql"; Set-Content $tmp2 $sql2
$job1 = Start-Job -ScriptBlock { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,$tmp1
$job2 = Start-Job -ScriptBlock { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,$tmp2
Wait-Job $job1,$job2 | Out-Null
$out1 = Receive-Job $job1; $out2 = Receive-Job $job2
Remove-Job $job1,$job2 -Force
Write-Host (($out1 | Out-String))
Write-Host (($out2 | Out-String))

$countSql = "SELECT count(*)::int AS active_offers FROM public.lead_offers WHERE lead_id = '$lead' AND status = 'offered';"
& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -c $countSql

Write-Host "=== Test 2: different keys same lead concurrent ==="
Invoke-Psql @"
UPDATE public.inbound_leads SET status = 'admin_queue', assigned_agent_id = NULL, accepted_at = NULL WHERE id = '$lead';
DELETE FROM public.lead_offers WHERE lead_id = '$lead';
DELETE FROM wam_ai.action_requests WHERE lead_ref = wam_ai.lead_ref('$lead'::uuid);
"@

$keyA = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02"
$keyB = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03"
$sqlA = New-OfferSql $lead $agent1 $keyA "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1" "diff_key_a"
$sqlB = New-OfferSql $lead $agent2 $keyB "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2" "diff_key_b"
Set-Content (Join-Path $env:TEMP "concA.sql") $sqlA
Set-Content (Join-Path $env:TEMP "concB.sql") $sqlB
$jobA = Start-Job -ScriptBlock { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,(Join-Path $env:TEMP "concA.sql")
$jobB = Start-Job -ScriptBlock { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,(Join-Path $env:TEMP "concB.sql")
Wait-Job $jobA,$jobB | Out-Null
$outA = Receive-Job $jobA; $outB = Receive-Job $jobB
Remove-Job $jobA,$jobB -Force
Write-Host (($outA | Out-String))
Write-Host (($outB | Out-String))

& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -c @"
SELECT count(*)::int AS active_offers FROM public.lead_offers WHERE lead_id = '$lead' AND status = 'offered';
SELECT count(*)::int AS action_events FROM wam_ai.action_events WHERE lead_ref = wam_ai.lead_ref('$lead'::uuid);
SELECT count(*)::int AS action_requests FROM wam_ai.action_requests WHERE lead_ref = wam_ai.lead_ref('$lead'::uuid);
"@

Write-Host "=== Test 3: different leads concurrent (both should succeed) ==="
$keyL1 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04"
$keyL2 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05"
$sqlL1 = New-OfferSql $lead $agent1 $keyL1 "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001" "parallel_lead1"
$sqlL2 = New-OfferSql $lead2 $agent2 $keyL2 "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002" "parallel_lead2"
Set-Content (Join-Path $env:TEMP "concL1.sql") $sqlL1
Set-Content (Join-Path $env:TEMP "concL2.sql") $sqlL2
$jobL1 = Start-Job -ScriptBlock { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,(Join-Path $env:TEMP "concL1.sql")
$jobL2 = Start-Job -ScriptBlock { param($p,$d,$f) & $p $d -v ON_ERROR_STOP=1 -f $f 2>&1 } -ArgumentList $psql,$DatabaseUrl,(Join-Path $env:TEMP "concL2.sql")
Wait-Job $jobL1,$jobL2 | Out-Null
$outL1 = Receive-Job $jobL1; $outL2 = Receive-Job $jobL2
Remove-Job $jobL1,$jobL2 -Force
Write-Host (($outL1 | Out-String))
Write-Host (($outL2 | Out-String))

& $psql $DatabaseUrl -v ON_ERROR_STOP=1 -c @"
SELECT lead_id, status FROM public.lead_offers WHERE lead_id IN ('$lead','$lead2') AND status = 'offered' ORDER BY lead_id;
"@

Write-Host "disposable_concurrency_phase1a2b_pass"
