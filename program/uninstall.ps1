# 계약업무 도우미 제거 — 프로그램과 바로가기만 지움. 서류(문서\지출서류도우미)는 남김
$ErrorActionPreference = 'Continue'
$Dest = Join-Path $env:LOCALAPPDATA 'JichulHelper'
$Name = '계약업무 도우미'
$run = Join-Path $Dest 'running.json'
if (Test-Path -LiteralPath $run) {
  try {
    $r = Get-Content -LiteralPath $run -Raw -Encoding UTF8 | ConvertFrom-Json
    $wc = New-Object System.Net.WebClient; $wc.Headers.Add('X-JH-Token', $r.token)
    $null = $wc.UploadString("http://127.0.0.1:$($r.port)/api/quit", '')
    Start-Sleep -Milliseconds 800
  } catch {}
}
foreach ($p in @((Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk"), (Join-Path ([Environment]::GetFolderPath('Programs')) "$Name.lnk"))) {
  Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $Dest -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host '  계약업무 도우미를 제거했습니다.' -ForegroundColor Green
Write-Host '  넣어 둔 서류는 문서\계약업무도우미 폴더에 그대로 있습니다.' -ForegroundColor Green
Write-Host ''
