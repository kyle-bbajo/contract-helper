# 계약업무 도우미 — PC 안 AI(Ollama + 한국어 모델) 설치
# - 설치.bat(install.ps1)이 처음 설치할 때 이 창에서 바로 실행하고, 실패하면 프로그램이 켜질 때 뒤에서 다시 시도함
# - 관리자 권한 없이 내 사용자 폴더(%LOCALAPPDATA%\Programs\Ollama)에 설치
# - 진행 상황은 %LOCALAPPDATA%\JichulHelper\ai-status.json 에 적어 프로그램 화면에 보여 줌
param(
  [string]$Model = 'gemma3:4b',
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$Home2 = Join-Path $env:LOCALAPPDATA 'JichulHelper'
if (-not (Test-Path -LiteralPath $Home2)) { New-Item -ItemType Directory -Path $Home2 -Force | Out-Null }
$StatusFile = Join-Path $Home2 'ai-status.json'
$Api = 'http://127.0.0.1:11434'

function Say([string]$m, [string]$c = 'Gray') { if (-not $Quiet) { Write-Host $m -ForegroundColor $c } }
function Set-Status([string]$state, [string]$msg, [int]$pct = -1) {
  $o = @{ state = $state; msg = $msg; pct = $pct; model = $Model; at = (Get-Date).ToString('s'); pid = $PID }
  try { [IO.File]::WriteAllText($StatusFile, ($o | ConvertTo-Json -Compress), $Utf8) } catch {}
}
function Find-Ollama {
  $c = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
  )
  foreach ($p in $c) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  $g = Get-Command ollama.exe -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  return $null
}
function Test-Api {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri "$Api/api/version" -TimeoutSec 3; return ($r.StatusCode -eq 200) } catch { return $false }
}
function Start-Api([string]$exe) {
  if (Test-Api) { return $true }
  Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (Test-Api) { return $true } }
  return $false
}
function Has-Model {
  try {
    $t = (Invoke-WebRequest -UseBasicParsing -Uri "$Api/api/tags" -TimeoutSec 5).Content | ConvertFrom-Json
    foreach ($m in $t.models) { if ($m.name -eq $Model -or $m.model -eq $Model) { return $true } }
  } catch {}
  return $false
}

# 이미 다른 설치가 돌고 있으면 그만둠
if (Test-Path -LiteralPath $StatusFile) {
  try {
    $s = Get-Content -LiteralPath $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($s.pid -and $s.pid -ne $PID -and @('download', 'install', 'pull') -contains $s.state -and (Get-Process -Id $s.pid -ErrorAction SilentlyContinue)) { Say '  · PC AI 설치가 이미 진행 중입니다.'; exit 0 }
  } catch {}
}

try {
  # 1) Ollama 프로그램
  $exe = Find-Ollama
  if (-not $exe) {
    Set-Status 'download' 'AI 프로그램(Ollama) 내려받는 중' 0
    Say '  · PC AI 프로그램(Ollama) 내려받는 중 — 수 분 걸립니다'
    $setup = Join-Path $env:TEMP 'OllamaSetup.exe'
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile('https://ollama.com/download/OllamaSetup.exe', $setup)
    Unblock-File -LiteralPath $setup -ErrorAction SilentlyContinue
    Set-Status 'install' 'AI 프로그램 설치 중' 0
    Say '  · PC AI 프로그램 설치 중'
    $p = Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -PassThru -Wait
    Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
    $exe = Find-Ollama
    if (-not $exe) { throw 'AI 프로그램을 설치하지 못했습니다.' }
  }
  # 2) 실행
  if (-not (Start-Api $exe)) { throw 'AI 프로그램을 켜지 못했습니다.' }
  # 3) 모델
  if (-not (Has-Model)) {
    Set-Status 'pull' "한국어 AI 모델($Model) 내려받는 중" 0
    Say "  · 한국어 AI 모델($Model, 약 3GB) 내려받는 중 — 네트워크에 따라 5~20분"
    # 진행률을 상태 파일에 적으며 받음
    $req = [Net.HttpWebRequest]::Create("$Api/api/pull")
    $req.Method = 'POST'; $req.ContentType = 'application/json'; $req.Timeout = 7200000; $req.ReadWriteTimeout = 7200000
    $body = $Utf8.GetBytes((@{ model = $Model; stream = $true } | ConvertTo-Json -Compress))
    $rs = $req.GetRequestStream(); $rs.Write($body, 0, $body.Length); $rs.Close()
    $sr = New-Object IO.StreamReader($req.GetResponse().GetResponseStream(), $Utf8)
    $last = -1
    while (($line = $sr.ReadLine()) -ne $null) {
      if (-not $line) { continue }
      $j = $line | ConvertFrom-Json
      if ($j.error) { throw ('모델을 받지 못했습니다: ' + $j.error) }
      if ($j.total -and $j.completed) {
        $pct = [int](100 * $j.completed / $j.total)
        if ($pct -ne $last) { $last = $pct; Set-Status 'pull' "한국어 AI 모델($Model) 내려받는 중" $pct; if (-not $Quiet) { Write-Progress -Activity 'PC AI 모델 내려받기' -Status "$pct%" -PercentComplete $pct } }
      }
    }
    $sr.Close()
    if (-not $Quiet) { Write-Progress -Activity 'PC AI 모델 내려받기' -Completed }
    if (-not (Has-Model)) { throw '모델을 받지 못했습니다.' }
  }
  Set-Status 'ready' 'PC AI 준비됨' 100
  Say '  · PC AI 준비 완료' 'Green'
  exit 0
} catch {
  Set-Status 'error' ($_.Exception.Message) -1
  Say ('  · PC AI는 지금 설치하지 못했습니다(' + $_.Exception.Message + '). 프로그램을 켜면 뒤에서 다시 시도합니다.') 'Yellow'
  exit 0
}
