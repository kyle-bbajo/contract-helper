# 계약업무 도우미 — 내 PC 전용 연결 창구
# - 127.0.0.1(이 PC)에서만 열림. 다른 PC나 인터넷에서는 접속할 수 없음
# - 페이지(app 폴더)를 보여주고, 데이터 폴더에 파일 저장, 나라장터 API 중계, 한글→PDF 변환을 맡음
# - Windows PowerShell 5.1 기준으로 작성(별도 설치 불필요)
param(
  [int]$Port = 17890,
  [switch]$NoBrowser,
  [switch]$SkipAi,
  [switch]$NoUpdate,
  [int]$WaitPid = 0,
  [switch]$StageUpdate,
  [int]$IdleMinutes = 720 # 창이 오래 잠들어(최소화·절전 탭) 신호가 끊겨도 바로 끄지 않음 — 창을 닫으면(bye) 몇 초 뒤 끔
)

$ErrorActionPreference = 'Stop'
$Version = '1.6.33'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebRoot = Join-Path $AppRoot 'app'
$LocalCfg = Join-Path $AppRoot 'local.json'
$RunFile = Join-Path $AppRoot 'running.json'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
# 업데이트 뒤 다시 켤 때: 앞의 창구가 완전히 끝난 뒤에 시작(포트·실행 정보가 겹치지 않게)
if ($WaitPid) { try { Wait-Process -Id $WaitPid -Timeout 20 -ErrorAction SilentlyContinue } catch {} }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

function Get-DefaultDataDir {
  $docs = [Environment]::GetFolderPath('MyDocuments')
  if (-not $docs) { $docs = $HOME }
  $old = Join-Path $docs '지출서류도우미'
  $new = Join-Path $docs '계약업무도우미'
  if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $new)) { return $old }
  return $new
}
function Read-LocalCfg {
  if (Test-Path -LiteralPath $LocalCfg) {
    try { return (Get-Content -LiteralPath $LocalCfg -Raw -Encoding UTF8 | ConvertFrom-Json) } catch {}
  }
  return $null
}
# 데이터 폴더 표식: 폴더를 다른 곳으로 옮겨도 이 표식으로 다시 찾음
$MarkerName = '.계약업무도우미.json'
function Read-Marker([string]$dir) {
  $f = Join-Path $dir $MarkerName
  if (Test-Path -LiteralPath $f) { try { return (Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json) } catch {} }
  return $null
}
function Ensure-Marker([string]$dir, [string]$id) {
  $m = Read-Marker $dir
  if ($m -and $m.id) { return [string]$m.id }
  if (-not $id) { $id = [guid]::NewGuid().ToString('N') }
  $f = Join-Path $dir $MarkerName
  [IO.File]::WriteAllText($f, (@{ id = $id; app = '계약업무 도우미'; created = (Get-Date).ToString('s') } | ConvertTo-Json -Compress), $Utf8)
  try { $it = Get-Item -LiteralPath $f -Force; $it.Attributes = $it.Attributes -bor [IO.FileAttributes]::Hidden } catch {}
  return $id
}
function Find-DataDir([string]$id) {
  $roots = New-Object System.Collections.Generic.List[string]
  foreach ($p in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'), (Join-Path $HOME 'Downloads'), $env:OneDrive, $env:OneDriveCommercial, $HOME)) {
    if ($p -and (Test-Path -LiteralPath $p) -and -not $roots.Contains($p)) { $roots.Add($p) }
  }
  try { foreach ($d in [IO.DriveInfo]::GetDrives()) { if ($d.DriveType -eq 'Fixed' -and $d.IsReady -and -not $roots.Contains($d.RootDirectory.FullName)) { $roots.Add($d.RootDirectory.FullName) } } } catch {}
  $best = $null; $bestTime = [datetime]::MinValue
  foreach ($r in $roots) {
    $depth = 4; if ($r.Length -le 3) { $depth = 3 }
    $hits = @(Get-ChildItem -LiteralPath $r -Filter $MarkerName -Recurse -Depth $depth -Force -File -ErrorAction SilentlyContinue)
    foreach ($h in $hits) {
      try {
        $m = Get-Content -LiteralPath $h.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($m.id -ne $id) { continue }
        $db = Join-Path $h.DirectoryName '서류대장.json'
        $t = $h.LastWriteTime; if (Test-Path -LiteralPath $db) { $t = (Get-Item -LiteralPath $db).LastWriteTime }
        if (-not $best -or $t -gt $bestTime) { $best = $h.DirectoryName; $bestTime = $t }
      } catch {}
    }
    if ($best) { break }
  }
  return $best
}
function Set-DataDir([string]$dir, [string]$id) {
  $o = @{ dataDir = $dir; dataId = $id }; if ($script:WatchDirs.Count) { $o.watchDirs = @($script:WatchDirs) }
  [IO.File]::WriteAllText($LocalCfg, ($o | ConvertTo-Json -Compress), $Utf8)
}

$script:Relocated = $false; $script:Lost = $false; $script:OldDir = ''
$cfg0 = Read-LocalCfg
# 자동으로 읽을 폴더(내려받은 계약 서류를 넣는 곳) — 이 PC에만 기억
$script:WatchDirs = New-Object System.Collections.ArrayList
if ($cfg0 -and $cfg0.watchDirs) { foreach ($w in @($cfg0.watchDirs)) { if ($w) { [void]$script:WatchDirs.Add([string]$w) } } }
elseif ($cfg0 -and $cfg0.watchDir) { [void]$script:WatchDirs.Add([string]$cfg0.watchDir) }
if ($cfg0 -and $cfg0.dataDir -and (Test-Path -LiteralPath ([string]$cfg0.dataDir))) {
  $script:DataDir = [string]$cfg0.dataDir
} elseif ($cfg0 -and $cfg0.dataDir) {
  # 저장해 둔 위치에 폴더가 없음 → 옮겼다고 보고 표식으로 찾음
  $script:OldDir = [string]$cfg0.dataDir
  $found = $null
  if ($cfg0.dataId) { $found = Find-DataDir ([string]$cfg0.dataId) }
  if ($found) { $script:DataDir = $found; $script:Relocated = $true }
  else { $script:DataDir = Get-DefaultDataDir; $script:Lost = $true }
} else {
  $script:DataDir = Get-DefaultDataDir
}
if (-not (Test-Path -LiteralPath $script:DataDir)) { New-Item -ItemType Directory -Path $script:DataDir -Force | Out-Null }
$prevId = $null; if ($cfg0 -and $cfg0.dataId -and -not $script:Lost) { $prevId = [string]$cfg0.dataId }
$script:DataId = Ensure-Marker $script:DataDir $prevId
# 못 찾았을 때는 예전 위치 정보를 지우지 않음(다음 실행 때 다시 찾음)
if (-not $script:Lost) { Set-DataDir $script:DataDir $script:DataId }

# ---------- GitHub 자동 업데이트 ----------
# 켤 때 창을 먼저 띄우고, 새 버전 확인·내려받기는 뒤에서 따로(-StageUpdate) → 받아 둔 것은 다음에 켤 때(또는 [지금 다시 켜기]) 몇 초 만에 바꿔 끼움
# - 공용 설정(app/org.json)의 update { repo, branch, token }. 설치된 곳(%LOCALAPPDATA%\JichulHelper)에서 켤 때만
# - 이 PC 설정(local.json)·실행 정보·데이터 폴더는 건드리지 않음. 인터넷이 막혀 있으면 그냥 건너뜀
$ProgressPreference = 'SilentlyContinue'   # Windows PowerShell 5.1은 진행 막대를 그리면 내려받기가 수십 배 느려짐
$InstalledFile = Join-Path $AppRoot 'installed.json'
$UpdDir = Join-Path $AppRoot 'update'
$script:UpdateErr = ''
function Write-StartLog([string]$m) {
  try {
    $f = Join-Path $AppRoot 'start.log'
    $lines = @(); if (Test-Path -LiteralPath $f) { $lines = @(Get-Content -LiteralPath $f -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -Last 300) }
    $lines += ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + " [$PID] " + $m)
    [IO.File]::WriteAllLines($f, [string[]]$lines, $Utf8)
  } catch {}
}
function Get-UpdateCfg {
  $orgPath = Join-Path $WebRoot 'org.json'
  if (-not (Test-Path -LiteralPath $orgPath)) { return $null }
  try { $o = [IO.File]::ReadAllText($orgPath, $Utf8) | ConvertFrom-Json } catch { return $null }
  $u = $o.update
  if (-not $u -or -not $u.repo -or -not $u.token) { return $null }
  $br = if ($u.branch) { [string]$u.branch } else { 'main' }
  return @{ repo = [string]$u.repo; branch = $br; token = [string]$u.token }
}
function Read-JsonFile([string]$f) { if (Test-Path -LiteralPath $f) { try { return ([IO.File]::ReadAllText($f, $Utf8) | ConvertFrom-Json) } catch {} }; return $null }
function Read-Installed { return (Read-JsonFile $InstalledFile) }
function Test-InstalledCopy { return ($env:LOCALAPPDATA -and $AppRoot.StartsWith((Join-Path $env:LOCALAPPDATA 'JichulHelper'), [StringComparison]::OrdinalIgnoreCase)) }
function Get-Staged { $r = Read-JsonFile (Join-Path $UpdDir 'ready.json'); if ($r -and (Test-Path -LiteralPath (Join-Path $UpdDir 'program\server.ps1'))) { return $r }; return $null }
# (1.6.0의 업데이트 함수 이름은 Invoke-SelfUpdate — 1.6.0은 이 글자가 있는 버전만 받으므로 지우지 말 것)
# 1) 확인·내려받아 update\program에 받아 둠(바꾸지는 않음). 반환: @{ state = none|older|ready; info }
function Save-UpdateStage([int]$CheckTimeout = 8) {
  $u = Get-UpdateCfg; if (-not $u) { return @{ state = 'off' } }
  $hdr = @{ Authorization = "Bearer $($u.token)"; 'User-Agent' = 'JichulHelper'; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
  $c = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$($u.repo)/commits/$($u.branch)" -Headers $hdr -TimeoutSec $CheckTimeout
  $cur = Read-Installed
  $cd = $c.commit.committer.date
  $cdo = if ($cd -is [datetime]) { [DateTimeOffset]$cd } else { [DateTimeOffset]::Parse([string]$cd, [Globalization.CultureInfo]::InvariantCulture) }
  $info = @{ sha = [string]$c.sha; date = $cdo.ToString('o'); message = ([string]$c.commit.message).Split("`n")[0]; checkedAt = (Get-Date).ToString('o') }
  if ($cur -and $cur.sha -eq $info.sha) { return @{ state = 'none'; info = $info } }
  # 압축 파일로 막 설치한 PC: GitHub 것이 이 설치본보다 오래됐으면(아직 안 올린 경우) 되돌아가지 않음
  if (-not $cur) {
    $b = Read-JsonFile (Join-Path $AppRoot 'build.json')
    if ($b -and $b.builtAt) {
      try { $bt = if ($b.builtAt -is [datetime]) { [DateTimeOffset]$b.builtAt } else { [DateTimeOffset]::Parse([string]$b.builtAt, [Globalization.CultureInfo]::InvariantCulture) }
        if ($cdo -lt $bt.AddMinutes(-5)) { return @{ state = 'older'; info = $info } } } catch {}
    }
  }
  $st = Get-Staged; if ($st -and $st.sha -eq $info.sha) { return @{ state = 'ready'; info = $info } }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("jh-update-" + $info.sha.Substring(0, 7))
  $zip = "$tmp.zip"
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -UseBasicParsing -Uri "https://api.github.com/repos/$($u.repo)/zipball/$($info.sha)" -Headers $hdr -OutFile $zip -TimeoutSec 300
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
    $top = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
    $prog = Join-Path $top.FullName 'program'
    # 받은 것이 온전한지(서버·화면 파일이 있어야) 확인한 뒤에만
    if (-not (Test-Path -LiteralPath (Join-Path $prog 'server.ps1')) -or -not (Test-Path -LiteralPath (Join-Path $prog 'app\index.html'))) { throw '받은 파일에 프로그램이 없습니다' }
    # 자동 업데이트가 없는 옛 버전으로는 바꾸지 않음(바꾸면 다시는 자동으로 못 받음)
    if (-not (Select-String -LiteralPath (Join-Path $prog 'server.ps1') -Pattern 'Save-UpdateStage' -SimpleMatch -Quiet)) { throw '받은 버전에 자동 업데이트 기능이 없어 바꾸지 않았습니다(GitHub에 최신본을 올렸는지 확인)' }
    Remove-Item -LiteralPath $UpdDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $UpdDir -Force | Out-Null
    Move-Item -LiteralPath $prog -Destination (Join-Path $UpdDir 'program')
    [IO.File]::WriteAllText((Join-Path $UpdDir 'ready.json'), ($info | ConvertTo-Json -Compress), $Utf8)  # 다 받은 뒤에 마지막으로 씀
  } finally {
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  return @{ state = 'ready'; info = $info }
}
# 2) 받아 둔 것을 바꿔 끼움(켤 때, 창구가 아직 아무것도 안 열었을 때)
function Install-StagedUpdate {
  $st = Get-Staged; if (-not $st) { return $false }
  $prog = Join-Path $UpdDir 'program'
  $appDest = Join-Path $AppRoot 'app'
  $appNew = Join-Path $AppRoot 'app.new'
  Remove-Item -LiteralPath $appNew -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath (Join-Path $prog 'app') -Destination $appNew -Recurse -Force
  # 토큰은 저장소에 없음(zip으로 설치할 때만 들어옴) → 받은 공용 설정에 이 PC의 업데이트 정보(토큰)를 이어 붙임
  try {
    $newOrg = Join-Path $appNew 'org.json'
    $oldU = (Read-JsonFile (Join-Path $appDest 'org.json')).update
    $no = Read-JsonFile $newOrg
    if ($no -and $oldU -and $oldU.token -and -not ($no.update -and $no.update.token)) {
      $no | Add-Member -NotePropertyName update -NotePropertyValue $oldU -Force
      [IO.File]::WriteAllText($newOrg, ($no | ConvertTo-Json -Depth 8), $Utf8)
    }
  } catch {}
  if (Test-Path -LiteralPath $appDest) { Remove-Item -LiteralPath $appDest -Recurse -Force }
  Rename-Item -LiteralPath $appNew -NewName 'app'
  foreach ($f in @('server.ps1', 'ai-setup.ps1', 'uninstall.ps1', 'install.ps1', 'icon.ico', 'version.txt', 'build.json')) {
    $p = Join-Path $prog $f
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $AppRoot $f) -Force }
  }
  Get-ChildItem -LiteralPath $AppRoot -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  $info = @{ sha = $st.sha; date = $st.date; message = $st.message; at = (Get-Date).ToString('o') }
  [IO.File]::WriteAllText($InstalledFile, ($info | ConvertTo-Json -Compress), $Utf8)
  Remove-Item -LiteralPath $UpdDir -Recurse -Force -ErrorAction SilentlyContinue
  return $true
}
function Start-Detached([string]$extra) {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Start-Process -FilePath $ps -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $AppRoot 'server.ps1')`" $extra" -WindowStyle Hidden | Out-Null
}
function Restart-Self { Start-Detached "-SkipAi -WaitPid $PID" }

# 뒤에서 내려받기만 하는 실행(-StageUpdate): 창구는 열지 않음
if ($StageUpdate) {
  try { $r = Save-UpdateStage; [IO.File]::WriteAllText((Join-Path $AppRoot 'update-check.json'), (@{ state = $r.state; info = $r.info; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress -Depth 4), $Utf8); Write-StartLog "업데이트 확인: $($r.state) $($r.info.sha) $($r.info.message)" }
  catch { [IO.File]::WriteAllText((Join-Path $AppRoot 'update-check.json'), (@{ state = 'error'; error = $_.Exception.Message; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress), $Utf8); Write-StartLog "업데이트 확인 실패: $($_.Exception.Message)" }
  exit 0
}
# 켤 때 받아 둔 새 버전이 있으면 바꿔 끼우고 새 버전으로 다시 켬(몇 초)
if (-not $NoUpdate -and (Test-InstalledCopy) -and (Get-Staged)) {
  try { if (Install-StagedUpdate) { Write-StartLog '받아 둔 새 버전으로 바꿈 → 다시 켬'; Start-Detached ("-NoUpdate" + $(if ($SkipAi) { ' -SkipAi' } else { '' })); exit 0 } }
  catch { Write-StartLog "새 버전으로 바꾸지 못함: $($_.Exception.Message)"; Remove-Item -LiteralPath $UpdDir -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---------- 이미 실행 중이면 창만 열고 끝냄 ----------
function Open-Browser([string]$url) {
  if ($NoBrowser) { return }
  $edge = $null
  foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe')) {
    try { $p = (Get-ItemProperty -LiteralPath $k -ErrorAction Stop).'(default)'; if ($p -and (Test-Path -LiteralPath $p)) { $edge = $p; break } } catch {}
  }
  if ($edge) { Start-Process -FilePath $edge -ArgumentList @("--app=$url", '--window-size=1440,920') }
  else { Start-Process $url }
}
if (Test-Path -LiteralPath $RunFile) {
  try {
    $r = Get-Content -LiteralPath $RunFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add('X-JH-Token', $r.token)
    $null = $wc.DownloadString("http://127.0.0.1:$($r.port)/api/ping")
    Open-Browser "http://127.0.0.1:$($r.port)/"
    exit 0
  } catch {}
}

# ---------- 포트 열기(이 PC 전용) ----------
$Token = [guid]::NewGuid().ToString('N')
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.Start(); $listener = $l; $Port = $p; break
  } catch {}
}
if (-not $listener) { throw '사용할 수 있는 포트를 찾지 못했습니다.' }
[IO.File]::WriteAllText($RunFile, (@{ port = $Port; token = $Token; pid = $PID } | ConvertTo-Json -Compress), $Utf8)
$BaseHost = "127.0.0.1:$Port"

# ---------- HTTP 도우미 ----------
$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
  '.woff2' = 'font/woff2'; '.wasm' = 'application/wasm'; '.pdf' = 'application/pdf'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gz' = 'application/octet-stream'; '.bcmap' = 'application/octet-stream'; '.txt' = 'text/plain; charset=utf-8'
}
function Get-Mime([string]$path) {
  $e = [IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($Mime.ContainsKey($e)) { return $Mime[$e] }
  return 'application/octet-stream'
}
function Read-Request($stream) {
  $ms = New-Object System.IO.MemoryStream
  $chunk = New-Object byte[] 65536
  $hdrEnd = -1
  while ($hdrEnd -lt 0) {
    $n = $stream.Read($chunk, 0, $chunk.Length)
    if ($n -le 0) { return $null }
    $ms.Write($chunk, 0, $n)
    $ascii = [Text.Encoding]::ASCII.GetString($ms.GetBuffer(), 0, [int]$ms.Length)
    $hdrEnd = $ascii.IndexOf("`r`n`r`n")
    if ($hdrEnd -lt 0 -and $ms.Length -gt 65536) { return $null }
  }
  $all = $ms.ToArray()
  $head = $Utf8.GetString($all, 0, $hdrEnd)
  $lines = $head -split "`r`n"
  $first = $lines[0] -split ' '
  $req = @{ Method = $first[0].ToUpperInvariant(); Target = $first[1]; Headers = @{}; Body = $null }
  for ($i = 1; $i -lt $lines.Length; $i++) {
    $c = $lines[$i].IndexOf(':')
    if ($c -gt 0) { $req.Headers[$lines[$i].Substring(0, $c).Trim().ToLowerInvariant()] = $lines[$i].Substring($c + 1).Trim() }
  }
  $len = 0
  if ($req.Headers.ContainsKey('content-length')) { $len = [long]$req.Headers['content-length'] }
  $bodyStart = $hdrEnd + 4
  $body = New-Object System.IO.MemoryStream
  $have = $all.Length - $bodyStart
  if ($have -gt 0) { $body.Write($all, $bodyStart, [Math]::Min($have, $len)) }
  while ($body.Length -lt $len) {
    $n = $stream.Read($chunk, 0, [int][Math]::Min($chunk.Length, $len - $body.Length))
    if ($n -le 0) { break }
    $body.Write($chunk, 0, $n)
  }
  # 본문이 다 오기 전에 끊기면(창을 닫는 중 등) 잘린 내용으로 파일을 덮어쓰지 않도록 요청 자체를 버림
  if ($body.Length -lt $len) { return $null }
  $req.Body = $body.ToArray()
  $q = @{}; $path = $req.Target
  $qi = $path.IndexOf('?')
  if ($qi -ge 0) {
    foreach ($pair in $path.Substring($qi + 1) -split '&') {
      if (-not $pair) { continue }
      $kv = $pair -split '=', 2
      $k = [Uri]::UnescapeDataString($kv[0].Replace('+', ' '))
      $v = if ($kv.Length -gt 1) { [Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) } else { '' }
      $q[$k] = $v
    }
    $path = $path.Substring(0, $qi)
  }
  $req.Path = [Uri]::UnescapeDataString($path)
  $req.Query = $q
  return $req
}
function Send-Bytes($stream, [int]$code, [string]$type, [byte[]]$bytes, [hashtable]$extra) {
  $reason = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 409 = 'Conflict'; 500 = 'Internal Server Error'; 502 = 'Bad Gateway' }[$code]
  if (-not $bytes) { $bytes = New-Object byte[] 0 }
  $h = "HTTP/1.1 $code $reason`r`nContent-Type: $type`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`n"
  if ($extra) { foreach ($k in $extra.Keys) { $h += "${k}: $($extra[$k])`r`n" } }
  $h += "`r`n"
  $hb = $Utf8.GetBytes($h)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
}
function Send-Json($stream, [int]$code, $obj) {
  $json = ConvertTo-Json -InputObject $obj -Depth 6 -Compress
  Send-Bytes $stream $code 'application/json; charset=utf-8' ($Utf8.GetBytes($json)) $null
}
function Send-Error($stream, [int]$code, [string]$msg) { Send-Json $stream $code @{ ok = $false; error = $msg } }

function Normalize-Rel([string]$p) {
  $sep = [IO.Path]::DirectorySeparatorChar
  return $p.Replace('\', $sep).Replace('/', $sep).TrimStart($sep)
}
# 데이터 폴더 안의 경로만 허용
function Resolve-DataPath([string]$rel) {
  if ($null -eq $rel) { $rel = '' }
  $rel = (Normalize-Rel $rel)
  $root = [IO.Path]::GetFullPath($script:DataDir).TrimEnd('\', '/')
  $full = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $rel))
  if (-not ($full.Equals($root, 'OrdinalIgnoreCase') -or $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, 'OrdinalIgnoreCase'))) { throw "허용되지 않은 경로: $rel" }
  return $full
}
function Get-RelPath([string]$full) {
  $root = [IO.Path]::GetFullPath($script:DataDir).TrimEnd('\', '/')
  return $full.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
}
function Get-UniquePath([string]$dir, [string]$name) {
  $base = [IO.Path]::GetFileNameWithoutExtension($name); $ext = [IO.Path]::GetExtension($name)
  $p = Join-Path $dir $name; $i = 2
  while (Test-Path -LiteralPath $p) { $p = Join-Path $dir ("{0} ({1}){2}" -f $base, $i, $ext); $i++ }
  return $p
}
function Write-AllBytesSafe([string]$full, [byte[]]$bytes) {
  $dir = Split-Path -Parent $full
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $tmp = "$full.tmp"
  [IO.File]::WriteAllBytes($tmp, $bytes)
  if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Force }
  Move-Item -LiteralPath $tmp -Destination $full -Force
}

# ---------- 한글 → PDF (설치된 한글 프로그램 사용) ----------
$script:Hwp = $null
function Convert-HwpToPdf([string]$src, [string]$dst) {
  Convert-Hwp $src $dst 'PDF'
}
# 한글 보안 승인 창('접근 허용·모두 허용') 안 뜨게: 한컴 보안모듈(FilePathCheckerModuleExample.dll)을
# 데이터 폴더\한글보안모듈(또는 프로그램 폴더)에 넣어 두면 레지스트리(HKCU\Software\HNC\HwpAutomation\Modules)에 등록하고 RegisterModule
$script:HwpSec = ''   # on 등록됨 · nodll 파일 없음 · fail 등록 실패
function Get-HwpSecDir { return (Join-Path $script:DataDir '한글보안모듈') }
function Find-HwpSecDll {
  foreach ($d in @((Get-HwpSecDir), $AppRoot, (Join-Path $AppRoot 'hwp'))) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    $f = Get-ChildItem -LiteralPath $d -Recurse -Depth 2 -Filter 'FilePathChecker*.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { return $f.FullName }
  }
  return $null
}
function Enable-HwpSec($h) {
  $dll = Find-HwpSecDll
  if (-not $dll) { $script:HwpSec = 'nodll'; return }
  try {
    $k = 'HKCU:\Software\HNC\HwpAutomation\Modules'
    if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }
    Set-ItemProperty -LiteralPath $k -Name 'FilePathCheckerModule' -Value $dll
    $r = $false
    if ($h) { $r = $h.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule') }
    if ($r) { $script:HwpSec = 'on' } else { $script:HwpSec = 'fail' }
  } catch { $script:HwpSec = 'fail' }
}
function Get-Hwp {
  if (-not $script:Hwp) {
    try { $script:Hwp = New-Object -ComObject 'HWPFrame.HwpObject' } catch { throw '이 PC에서 한글 프로그램을 찾지 못했습니다.' }
    Enable-HwpSec $script:Hwp
    try { $script:Hwp.XHwpWindows.Item(0).Visible = $false } catch {}
  } elseif ($script:HwpSec -ne 'on') { Enable-HwpSec $script:Hwp }  # 켜 둔 사이 파일을 넣었으면 다시 켜지 않아도 바로 등록
  return $script:Hwp
}
function Convert-Hwp([string]$src, [string]$dst, [string]$fmt) {
  $h = Get-Hwp
  $ok = $h.Open($src, '', 'forceopen:true;suspendpassword:true;versionwarning:false')
  if (-not $ok) { throw '한글 파일을 열지 못했습니다.' }
  try {
    $saved = $h.SaveAs($dst, $fmt, '')
    if (-not $saved -or -not (Test-Path -LiteralPath $dst)) { throw "$fmt 형식으로 저장하지 못했습니다." }
  } finally { try { $null = $h.Clear(1) } catch {} }
}
# 엑셀·워드 → PDF(설치된 MS 오피스 사용, 창은 띄우지 않음)
function Convert-OfficeToPdf([string]$src, [string]$dst) {
  $ext = [IO.Path]::GetExtension($src).ToLowerInvariant()
  # 엑셀·워드는 한 번 띄운 것을 켜 둔 채 다시 씀(파일마다 띄우고 끄면 몇 초씩 걸림) — 이 창구가 꺼질 때 같이 끔
  if ($ext -eq '.xlsx' -or $ext -eq '.xls') {
    $xl = $script:Xl
    try { if ($xl) { $null = $xl.Workbooks.Count } } catch { $xl = $null }
    if (-not $xl) { try { $xl = New-Object -ComObject 'Excel.Application' } catch { throw '이 PC에서 엑셀 프로그램을 찾지 못했습니다.' }; $xl.Visible = $false; $xl.DisplayAlerts = $false; $script:Xl = $xl }
    $wb = $xl.Workbooks.Open($src, 0, $true)
    try { $wb.ExportAsFixedFormat(0, $dst) } finally { $wb.Close($false) }
  } elseif ($ext -eq '.docx' -or $ext -eq '.doc') {
    $wd = $script:Wd
    try { if ($wd) { $null = $wd.Documents.Count } } catch { $wd = $null }
    if (-not $wd) { try { $wd = New-Object -ComObject 'Word.Application' } catch { throw '이 PC에서 워드 프로그램을 찾지 못했습니다.' }; $wd.Visible = $false; $wd.DisplayAlerts = 0; $script:Wd = $wd }
    $doc = $wd.Documents.Open($src, $false, $true)
    try { $doc.SaveAs2($dst, 17) } finally { $doc.Close($false) }
  } else { throw 'PDF로 바꿀 수 없는 파일입니다.' }
  if (-not (Test-Path -LiteralPath $dst)) { throw 'PDF로 저장하지 못했습니다.' }
}
# 한글 양식의 {{항목}}을 값으로 모두 바꿔 새 파일로 저장(설치된 한글 사용)
function Fill-HwpTemplate([string]$src, [string]$dst, $values) {
  $h = Get-Hwp
  $ok = $h.Open($src, '', 'forceopen:true;suspendpassword:true;versionwarning:false')
  if (-not $ok) { throw '양식 파일을 열지 못했습니다.' }
  $count = 0
  try {
    foreach ($p in $values.PSObject.Properties) {
      $act = $h.HAction; $set = $h.HParameterSet.HFindReplace
      $null = $act.GetDefault('AllReplace', $set.HSet)
      $set.FindString = '{{' + $p.Name + '}}'
      $set.ReplaceString = [string]$p.Value
      $set.IgnoreMessage = 1
      $set.Direction = $h.FindDir('AllDoc')
      if ($act.Execute('AllReplace', $set.HSet)) { $count++ }
    }
    $ext = [IO.Path]::GetExtension($dst).TrimStart('.').ToUpperInvariant()
    if ($ext -eq 'HWPX') { $fmt = 'HWPX' } else { $fmt = 'HWP' }
    $saved = $h.SaveAs($dst, $fmt, '')
    if (-not $saved -or -not (Test-Path -LiteralPath $dst)) { throw '새 공고문을 저장하지 못했습니다.' }
  } finally { try { $null = $h.Clear(1) } catch {} }
  return $count
}

# ---------- 요청 처리 ----------
# ---------- PC 안 AI(Ollama) ----------
$script:OllamaStarted = $false
$LocalApp = $env:LOCALAPPDATA; if (-not $LocalApp) { $LocalApp = $AppRoot }
$AiStatusFile = Join-Path (Join-Path $LocalApp 'JichulHelper') 'ai-status.json'
function Find-Ollama {
  foreach ($p in @((Join-Path $LocalApp 'Programs\Ollama\ollama.exe'), ([string]$env:ProgramFiles + '\Ollama\ollama.exe'))) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  $g = Get-Command ollama.exe -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  return $null
}
function Start-AiSetup([string]$model) {
  $script = Join-Path $AppRoot 'ai-setup.ps1'
  if (-not (Test-Path -LiteralPath $script)) { return }
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Start-Process -FilePath $ps -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Quiet -Model $model" -WindowStyle Hidden | Out-Null
}
# 설치 때 AI를 다 받지 못했으면(인터넷이 끊겼거나 창을 닫음) 켤 때마다 뒤에서 이어 받음
function Resume-AiSetup {
  try {
    $sf = $AiStatusFile
    $st = $null; if (Test-Path -LiteralPath $sf) { $st = Get-Content -LiteralPath $sf -Raw -Encoding UTF8 | ConvertFrom-Json }
    if ($st -and $st.state -eq 'ready' -and (Find-Ollama)) { return }
    $model = 'gemma3:4b'; if ($st -and $st.model) { $model = [string]$st.model }
    Start-AiSetup $model
  } catch {}
}

# 폴더 고르기 창: 숨은 창구(백그라운드)에서 띄우면 프로그램 창 뒤에 숨어 '아무것도 안 뜨는' 것처럼 보임
# → 맨 위에 보이는 작은 주인 창을 만들고 앞으로 가져온 뒤 그 위에 띄움
function Show-FolderDialog([string]$desc, [string]$start) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  if (-not ('Jh.JhWin' -as [type])) {
    Add-Type -Namespace 'Jh' -Name 'JhWin' -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
'@
  }
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.FormBorderStyle = 'None'; $owner.Opacity = 0.01
  $owner.StartPosition = 'CenterScreen'; $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Show()
  try { [Jh.JhWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Jh.JhWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) } catch {} # Alt를 눌렀다 떼야 앞으로 가져올 수 있음
  try { [void][Jh.JhWin]::SetForegroundWindow($owner.Handle) } catch {}; $owner.Activate()
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = $desc; $dlg.ShowNewFolderButton = $true
  if ($start -and (Test-Path -LiteralPath $start)) { $dlg.SelectedPath = $start }
  try { if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.SelectedPath } else { return $null } }
  finally { $owner.Close(); $owner.Dispose() }
}
# 자동으로 읽을 폴더 하나 더하기(고르기 창·붙여 넣은 경로·다운로드 같은 바로가기 공용)
function Add-WatchDir([string]$dir) {
  $pick = [IO.Path]::GetFullPath($dir).TrimEnd('\', '/')
  if (-not (Test-Path -LiteralPath $pick -PathType Container)) { throw "폴더가 없습니다: $pick" }
  $root = [IO.Path]::GetFullPath($script:DataDir).TrimEnd('\', '/')
  if ($pick.StartsWith($root, 'OrdinalIgnoreCase') -or $root.StartsWith($pick + [IO.Path]::DirectorySeparatorChar, 'OrdinalIgnoreCase')) { throw '데이터 폴더(또는 그것을 품은 폴더)는 고를 수 없습니다.' }
  if (-not ($script:WatchDirs | Where-Object { $_ -ieq $pick })) { [void]$script:WatchDirs.Add($pick) }
  Set-DataDir $script:DataDir $script:DataId
  return $pick
}
function Get-KnownDir([string]$k) {
  switch ($k) {
    'downloads' { try { $p = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path; if ($p) { return $p } } catch {}; return (Join-Path $env:USERPROFILE 'Downloads') }
    'desktop' { return [Environment]::GetFolderPath('Desktop') }
    'documents' { return [Environment]::GetFolderPath('MyDocuments') }
  }
  return $null
}

function Handle($stream, $req) {
  $hostHdr = [string]$req.Headers['host']
  if ($hostHdr -ne $BaseHost -and $hostHdr -ne "localhost:$Port") { Send-Error $stream 403 'host'; return }
  $path = $req.Path

  if (-not $path.StartsWith('/api/')) {
    # 정적 파일(페이지)
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    $rel = Normalize-Rel $path
    $full = [IO.Path]::GetFullPath((Join-Path $WebRoot $rel))
    if (-not $full.StartsWith([IO.Path]::GetFullPath($WebRoot), 'OrdinalIgnoreCase') -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { Send-Error $stream 404 'not found'; return }
    if ($path -eq '/index.html') {
      $html = [IO.File]::ReadAllText($full, $Utf8).Replace('__JH_TOKEN__', $Token)
      Send-Bytes $stream 200 'text/html; charset=utf-8' ($Utf8.GetBytes($html)) @{ 'Content-Security-Policy' = "default-src 'self' blob: data:; script-src 'self' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data: http://127.0.0.1:11434; worker-src 'self' blob:; frame-ancestors 'none'" }
    } else {
      Send-Bytes $stream 200 (Get-Mime $full) ([IO.File]::ReadAllBytes($full)) $null
    }
    return
  }

  # API는 페이지가 받은 토큰이 있어야 함(다른 웹사이트가 이 PC 창구를 부르지 못하게)
  $tok = $req.Headers['x-jh-token']; if (-not $tok) { $tok = $req.Query['t'] }
  if ($tok -ne $Token) { Send-Error $stream 403 'token'; return }
  $script:LastSeen = Get-Date
  $q = $req.Query

  switch ($path) {
    '/api/update' {
      # 설정 → 정보 [지금 업데이트 확인]: 확인·내려받아 두고, 새 것이면 응답 뒤 다시 켬(켜면서 바꿔 끼움, 새 창이 열림)
      if (-not (Test-InstalledCopy)) { Send-Json $stream 200 @{ ok = $true; skipped = '설치된 프로그램에서만 업데이트합니다(압축 푼 폴더에서 바로 실행 중)' }; return }
      if (-not (Get-UpdateCfg)) { Send-Json $stream 200 @{ ok = $true; skipped = '공용 설정에 GitHub 업데이트 정보(update.repo·token)가 없습니다' }; return }
      try {
        $r = Save-UpdateStage 15
        $ready = $r.state -eq 'ready'
        Send-Json $stream 200 @{ ok = $true; updated = $ready; info = $r.info; state = $r.state }
        if ($ready) { Write-StartLog '[지금 업데이트] 받아 둠 → 다시 켬'; Restart-Self; $script:Quit = $true }
      } catch { Send-Error $stream 502 ("GitHub에서 받지 못했습니다: " + $_.Exception.Message) }
      return
    }
    '/api/share' {
      # 배운 서류 분류 규칙을 동료와 나눔: GitHub 저장소의 이슈 하나('[자동] 배운 규칙')에 댓글로 올리고(POST), 모두의 댓글을 읽음(GET)
      # 토큰에 '이슈 쓰기' 권한만 있으면 됨(프로그램 코드는 바꿀 수 없음). 권한이 없으면 skipped
      $u = Get-UpdateCfg
      if (-not $u) { Send-Json $stream 200 @{ ok = $true; skipped = '공용 설정에 GitHub 토큰이 없습니다' }; return }
      $hdr = @{ Authorization = "Bearer $($u.token)"; 'User-Agent' = 'JichulHelper'; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
      # kind=qa: 규정·질문의 저장한 질문답변(별도 이슈 '[자동] 규정 질문답변')
      $isQa = ([string]$q['kind']) -eq 'qa'
      $base = "https://api.github.com/repos/$($u.repo)"; $title = if ($isQa) { '[자동] 규정 질문답변' } else { '[자동] 배운 서류 분류 규칙' }
      $sf = Join-Path $AppRoot $(if ($isQa) { 'share-qa.json' } else { 'share.json' })
      try {
        $st = Read-JsonFile $sf; $num = if ($st -and $st.issue) { [int]$st.issue } else { 0 }
        if (-not $num) {
          $list = Invoke-RestMethod -UseBasicParsing -Uri "$base/issues?state=all&per_page=100" -Headers $hdr -TimeoutSec 15
          $hit = @($list | Where-Object { $_.title -eq $title -and -not $_.pull_request }) | Select-Object -First 1
          if (-not $hit -and $req.Method -eq 'POST') {
            $intro = if ($isQa) { "계약업무 도우미의 규정·질문 답변에서 PC마다 저장한 질문과 답을 자동으로 모으는 곳입니다. 다른 PC도 이 답을 받아 씁니다. 지우거나 닫지 마세요." } else { "계약업무 도우미가 PC마다 배운 서류 분류 규칙(서류 제목 → 서류 종류)을 자동으로 모으는 곳입니다. 다른 PC도 이 규칙을 받아 씁니다. 지우거나 닫지 마세요." }
            $b = @{ title = $title; body = $intro } | ConvertTo-Json
            $hit = Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$base/issues" -Headers $hdr -Body ([Text.Encoding]::UTF8.GetBytes($b)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
          }
          if ($hit) { $num = [int]$hit.number; [IO.File]::WriteAllText($sf, (@{ issue = $num } | ConvertTo-Json -Compress), $Utf8) }
        }
        if ($req.Method -eq 'POST') {
          $rules = $Utf8.GetString($req.Body)
          $b = @{ body = "자동 · $Version · $((Get-Date).ToString('yyyy-MM-dd HH:mm'))`n``````json`n$rules`n``````" } | ConvertTo-Json
          $null = Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$base/issues/$num/comments" -Headers $hdr -Body ([Text.Encoding]::UTF8.GetBytes($b)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
          Send-Json $stream 200 @{ ok = $true; issue = $num }; return
        }
        if (-not $num) { Send-Json $stream 200 @{ ok = $true; bodies = @() }; return }
        $bodies = New-Object System.Collections.ArrayList
        for ($pg = 1; $pg -le 10; $pg++) {
          $cs = @(Invoke-RestMethod -UseBasicParsing -Uri "$base/issues/$num/comments?per_page=100&page=$pg" -Headers $hdr -TimeoutSec 15)
          foreach ($c in $cs) { [void]$bodies.Add([string]$c.body) }
          if ($cs.Count -lt 100) { break }
        }
        Send-Json $stream 200 @{ ok = $true; issue = $num; bodies = @($bodies) }
      } catch {
        $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        if ($code -eq 403 -or $code -eq 404) { Send-Json $stream 200 @{ ok = $true; skipped = '토큰에 이슈 쓰기·읽기 권한이 없습니다(GitHub 토큰 설정에서 Issues: Read and write 추가)' }; return }
        Send-Error $stream 502 ("GitHub에 나누지 못했습니다: " + $_.Exception.Message)
      }
      return
    }
    '/api/restart' { Send-Json $stream 200 @{ ok = $true }; Restart-Self; $script:Quit = $true; return }
    '/api/ping' {
      # 열린 창 기록(창마다 id·역할): 창을 모두 닫으면(X) 몇 초 뒤 꺼짐, 공고문 전용 창이 열려 있으면 다른 창에 알림
      if ($q['w']) { $script:Wins[[string]$q['w']] = @{ at = Get-Date; role = [string]$q['role'] }; $script:ByeAt = $null }
      $now = Get-Date; foreach ($k in @($script:Wins.Keys)) { if (($now - $script:Wins[$k].at).TotalMinutes -gt 3) { $script:Wins.Remove($k) } }
      $roles = @($script:Wins.GetEnumerator() | ForEach-Object { @{ w = $_.Key; role = $_.Value.role } })
      Send-Json $stream 200 @{ ok = $true; version = $Version; wins = $roles; installed = (Read-Installed); staged = (Get-Staged); check = (Read-JsonFile (Join-Path $AppRoot 'update-check.json')); canUpdate = [bool]((Test-InstalledCopy) -and (Get-UpdateCfg)); dataDir = $script:DataDir; watchDirs = @($script:WatchDirs); relocated = $script:Relocated; lost = $script:Lost; oldDir = $script:OldDir; os = [Environment]::OSVersion.VersionString }; return
    }
    # 창을 닫음(X): 그 창을 지우고, 남은 창이 없으면 몇 초 기다렸다가(새로고침이면 바로 다시 들어옴) 끔
    '/api/bye' { if ($q['w']) { $script:Wins.Remove([string]$q['w']) }; if ($script:Wins.Count -eq 0) { $script:ByeAt = Get-Date }; Send-Json $stream 200 @{ ok = $true }; return }
    # 공고문 전용 창 열기(프로그램 창 모양으로)
    '/api/openwin' { Open-Browser "http://$BaseHost/?only=notice"; Send-Json $stream 200 @{ ok = $true }; return }

    '/api/file' {
      $full = Resolve-DataPath $q['path']
      if ($req.Method -eq 'GET') {
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Send-Error $stream 404 'not found'; return }
        Send-Bytes $stream 200 (Get-Mime $full) ([IO.File]::ReadAllBytes($full)) $null; return
      }
      if ($req.Method -eq 'PUT' -or $req.Method -eq 'POST') { Write-AllBytesSafe $full $req.Body; Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $full) }; return }
      Send-Error $stream 400 'method'; return
    }

    '/api/save' {
      # 새 파일 저장(같은 이름이 있으면 "이름 (2)"로)
      $dir = Resolve-DataPath $q['dir']
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      $name = [IO.Path]::GetFileName([string]$q['name']); if (-not $name) { $name = 'file' }
      $full = Get-UniquePath $dir $name
      [IO.File]::WriteAllBytes($full, $req.Body)
      Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $full) }; return
    }

    '/api/move' {
      $src = Resolve-DataPath $q['from']
      $dir = Resolve-DataPath $q['dir']
      if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { Send-Error $stream 404 'not found'; return }
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      $name = [IO.Path]::GetFileName([string]$q['name']); if (-not $name) { $name = [IO.Path]::GetFileName($src) }
      $dst = Join-Path $dir $name
      if (-not $dst.Equals($src, 'OrdinalIgnoreCase')) { $dst = Get-UniquePath $dir $name; Move-Item -LiteralPath $src -Destination $dst }
      Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $dst) }; return
    }

    '/api/delete' {
      # dir=: 빈 폴더(계약을 지운 뒤 남은 계약 폴더)만 지움 — 파일이 하나라도 있으면 그대로 둠
      if ($q['dir']) {
        $d = Resolve-DataPath $q['dir']
        if ((Test-Path -LiteralPath $d -PathType Container) -and -not (Get-ChildItem -LiteralPath $d -Recurse -File -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
          Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue
          Send-Json $stream 200 @{ ok = $true; removed = $true }; return
        }
        Send-Json $stream 200 @{ ok = $true; removed = $false }; return
      }
      # 바로 지우지 않고 데이터 폴더의 "_삭제됨"으로 옮김(되돌리기용). 30일 지나면 켤 때 완전히 지움
      $src = Resolve-DataPath $q['path']
      if (Test-Path -LiteralPath $src -PathType Leaf) {
        $trash = Resolve-DataPath '_삭제됨'
        if (-not (Test-Path -LiteralPath $trash)) { New-Item -ItemType Directory -Path $trash -Force | Out-Null }
        $dst = Get-UniquePath $trash ([IO.Path]::GetFileName($src))
        Move-Item -LiteralPath $src -Destination $dst
        try { (Get-Item -LiteralPath $dst).LastWriteTime = Get-Date } catch { }  # 버린 날(30일 세는 기준)
        Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $dst) }; return
      }
      Send-Json $stream 200 @{ ok = $true }; return
    }

    '/api/list' {
      # 파일 수천 개여도 빠르게: .NET으로 바로 훑고 JSON도 직접 만듦(ConvertTo-Json·배열 += 는 수천 개에서 몇 초 걸림)
      $dir = Resolve-DataPath $q['dir']
      $sb = New-Object System.Text.StringBuilder
      [void]$sb.Append('{"ok":true,"files":[')
      $first = $true
      if (Test-Path -LiteralPath $dir) {
        $opt = if ($q['recursive'] -eq '1') { [IO.SearchOption]::AllDirectories } else { [IO.SearchOption]::TopDirectoryOnly }
        $di = New-Object IO.DirectoryInfo($dir)
        $rootLen = [IO.Path]::GetFullPath($script:DataDir).TrimEnd('\', '/').Length
        foreach ($fi in $di.EnumerateFiles('*', $opt)) {
          if (($fi.Attributes -band [IO.FileAttributes]::Hidden) -ne 0) { continue }
          $rel = $fi.FullName.Substring($rootLen).TrimStart('\', '/').Replace('\', '/').Replace('"', '\"')
          if (-not $first) { [void]$sb.Append(',') }; $first = $false
          [void]$sb.Append('{"path":"').Append($rel).Append('","size":').Append($fi.Length).Append(',"mtime":"').Append($fi.LastWriteTime.ToString('s')).Append('","ctime":"').Append($fi.CreationTime.ToString('s')).Append('"}')
        }
      }
      [void]$sb.Append(']}')
      Send-Bytes $stream 200 'application/json; charset=utf-8' ($Utf8.GetBytes($sb.ToString())) $null; return
    }

    '/api/myip' {
      # 이 PC가 인터넷에 나가는 주소(공인 IP) — 국가법령정보센터에 등록할 값. 공개 IP 확인 서비스 두 곳 중 되는 곳
      foreach ($u in @('https://api.ipify.org', 'https://checkip.amazonaws.com')) {
        try { $wc = New-Object System.Net.WebClient; $ip = ($wc.DownloadString($u)).Trim(); if ($ip -match '^\d{1,3}(\.\d{1,3}){3}$') { Send-Json $stream 200 @{ ok = $true; ip = $ip }; return } } catch {}
      }
      Send-Error $stream 502 '공인 IP를 알아내지 못했습니다(인터넷 연결 확인)'; return
    }

    '/api/law' {
      # 국가법령정보센터(법령·행정규칙) 조회 중계 — www.law.go.kr의 /DRF/(조회)·/LSW/(예규 첨부파일 내려받기)만 허용(OC는 화면에서 받음)
      $u = [string]$q['u'] -replace '^http://', 'https://'; $uri = $null
      if (-not [Uri]::TryCreate($u, [UriKind]::Absolute, [ref]$uri) -or $uri.Host -notmatch '^(www\.)?law\.go\.kr$' -or $uri.Scheme -ne 'https' -or -not ($uri.AbsolutePath.StartsWith('/DRF/') -or $uri.AbsolutePath.StartsWith('/LSW/'))) { Send-Error $stream 400 'url'; return }
      try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JichulHelper')
        $wc.Headers.Add('Accept', 'application/json, */*')
        $bytes = $wc.DownloadData($uri)
        Send-Bytes $stream 200 'text/plain; charset=utf-8' $bytes $null
      } catch {
        $msg = $_.Exception.Message; $code = 0
        try { $code = [int]$_.Exception.InnerException.Response.StatusCode } catch {}
        if (-not $code) { try { $code = [int]$_.Exception.Response.StatusCode } catch {} }
        Send-Error $stream 502 ("국가법령정보센터 연결 실패" + $(if ($code) { " ($code)" } else { '' }) + ": $msg")
      }
      return
    }

    '/api/nara' {
      # 나라장터(공공데이터포털) 조회 중계 — apis.data.go.kr 주소만 허용
      $u = [string]$q['u']
      $uri = $null
      if (-not [Uri]::TryCreate($u, [UriKind]::Absolute, [ref]$uri) -or $uri.Host -ne 'apis.data.go.kr' -or $uri.Scheme -ne 'https') { Send-Error $stream 400 'url'; return }
      try {
        $wc = New-Object System.Net.WebClient
        $wc.Encoding = $Utf8
        $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JichulHelper')
        $wc.Headers.Add('Accept', 'application/json, text/xml, */*')
        $bytes = $wc.DownloadData($uri)
        Send-Bytes $stream 200 'text/plain; charset=utf-8' $bytes $null
      } catch {
        # 공공데이터포털이 HTTP 오류(403 권한 없음 등)로 답하면 상태 코드와 본문을 읽어 알기 쉬운 말로 돌려줌
        $ex = $_.Exception
        while ($ex -and -not ($ex -is [System.Net.WebException])) { $ex = $ex.InnerException }
        $code = 0; $body = ''
        if ($ex -and $ex.Response) {
          try { $code = [int]([System.Net.HttpWebResponse]$ex.Response).StatusCode } catch {}
          try { $sr = New-Object System.IO.StreamReader($ex.Response.GetResponseStream(), $Utf8); $body = $sr.ReadToEnd(); $sr.Close() } catch {}
        }
        $b = ([string]$body).Trim()
        if ($b.StartsWith('<') -or $b.StartsWith('{')) { Send-Bytes $stream 200 'text/plain; charset=utf-8' ($Utf8.GetBytes($b)) $null; return }
        $why = switch ($code) {
          401 { '인증키를 확인하세요(401). 공공데이터포털의 일반 인증키(Decoding)를 그대로 넣어 주세요.' }
          403 { '이 서비스를 쓸 권한이 없습니다(403). 공공데이터포털에서 같은 인증키로 이 서비스를 활용신청했는지 확인하세요(승인 직후면 1~2시간 뒤에 됩니다).' }
          404 { '서비스 주소를 찾지 못했습니다(404).' }
          429 { '조회 횟수를 넘었습니다(429). 잠시 뒤나 내일 다시 하세요.' }
          default { if ($code -ge 500) { "나라장터(공공데이터포털) 서버 오류($code). 잠시 뒤 다시 하세요." } elseif ($ex) { $ex.Message } else { $_.Exception.Message } }
        }
        Send-Error $stream 502 ('나라장터 연결 실패: ' + $why)
      }
      return
    }

    '/api/fetchfile' {
      # 나라장터 첨부파일(공고서 등) 내려받기 — g2b.go.kr 주소만 허용
      $u = [string]$q['u']
      $uri = $null
      if (-not [Uri]::TryCreate($u, [UriKind]::Absolute, [ref]$uri) -or -not ($uri.Host -eq 'g2b.go.kr' -or $uri.Host.EndsWith('.g2b.go.kr')) -or ($uri.Scheme -ne 'https' -and $uri.Scheme -ne 'http')) { Send-Error $stream 400 'url'; return }
      try {
        $wc = New-Object System.Net.WebClient
        $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        $bytes = $wc.DownloadData($uri)
        if ($bytes.Length -gt 41943040) { Send-Error $stream 400 '파일이 너무 큽니다'; return }
        Send-Bytes $stream 200 'application/octet-stream' $bytes $null
      } catch { Send-Error $stream 502 ("첨부파일을 받지 못했습니다: " + $_.Exception.Message) }
      return
    }

    '/api/hwp2pdf' {
      $src = Resolve-DataPath $q['path']
      $dst = [IO.Path]::ChangeExtension($src, '.pdf')
      if (Test-Path -LiteralPath $dst) { Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $dst) }; return }
      try { Convert-HwpToPdf $src $dst; Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $dst) } }
      catch { Send-Error $stream 500 $_.Exception.Message }
      return
    }

    '/api/office2pdf' {
      # 엑셀·워드 → PDF(설치된 MS 오피스로). 한 번에 인쇄에 같이 들어감
      $src = Resolve-DataPath $q['path']
      $dst = [IO.Path]::ChangeExtension($src, '.pdf')
      if (Test-Path -LiteralPath $dst) { Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $dst) }; return }
      try { Convert-OfficeToPdf $src $dst; Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $dst) } }
      catch { Send-Error $stream 500 $_.Exception.Message }
      return
    }

    '/api/hwpsec' {
      # 한글 보안모듈 상태. apply=1이면 지금 등록해 봄(한글을 띄움)
      $dir = Get-HwpSecDir; if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      $dll = Find-HwpSecDll
      if ($dll -and $q['apply'] -eq '1') { try { $null = Get-Hwp; Enable-HwpSec $script:Hwp } catch { $script:HwpSec = 'fail' } }
      $state = $script:HwpSec
      if (-not $dll) { $state = 'nodll' } elseif (-not $state -or $state -eq 'nodll') { $state = 'ready' }
      $dllName = ''; if ($dll) { $dllName = [IO.Path]::GetFileName($dll) }
      Send-Json $stream 200 @{ ok = $true; state = $state; dll = $dllName; folder = '한글보안모듈' }; return
    }

    '/api/hwpconvert' {
      $src = Resolve-DataPath $q['path']
      $fmt = ([string]$q['fmt']).ToUpperInvariant(); if ($fmt -ne 'HWPX' -and $fmt -ne 'PDF') { $fmt = 'PDF' }
      $dst = [IO.Path]::ChangeExtension($src, '.' + $fmt.ToLowerInvariant())
      try { if (-not (Test-Path -LiteralPath $dst)) { Convert-Hwp $src $dst $fmt }; Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $dst) } }
      catch { Send-Error $stream 500 $_.Exception.Message }
      return
    }

    '/api/ai' {
      # AI 중계 — Gemini(generativelanguage.googleapis.com) 또는 Claude(api.anthropic.com)만, 키는 요청마다 화면에서 받음(이 PC 설정에만 저장)
      if ($req.Method -ne 'POST') { Send-Error $stream 405 'method'; return }
      try {
        $j = $Utf8.GetString($req.Body) | ConvertFrom-Json
        if (-not [string]$j.key) { Send-Error $stream 400 'AI 키가 없습니다'; return }
        $wc = New-Object System.Net.WebClient
        $wc.Encoding = $Utf8
        $wc.Headers.Add('content-type', 'application/json')
        if ([string]$j.provider -eq 'claude') {
          $payload = @{ model = [string]$j.model; max_tokens = 4000; system = [string]$j.system; messages = @(@{ role = 'user'; content = [string]$j.prompt }) } | ConvertTo-Json -Depth 6 -Compress
          $wc.Headers.Add('x-api-key', [string]$j.key)
          $wc.Headers.Add('anthropic-version', '2023-06-01')
          $url = 'https://api.anthropic.com/v1/messages'
        } else {
          $model = ([string]$j.model) -replace '[^A-Za-z0-9.\-]', ''
          $payload = @{ systemInstruction = @{ parts = @(@{ text = [string]$j.system }) }; contents = @(@{ role = 'user'; parts = @(@{ text = [string]$j.prompt }) }); generationConfig = @{ responseMimeType = 'application/json'; temperature = 0.3 } } | ConvertTo-Json -Depth 8 -Compress
          $wc.Headers.Add('x-goog-api-key', [string]$j.key)
          $url = "https://generativelanguage.googleapis.com/v1beta/models/$($model):generateContent"
        }
        $resp = $wc.UploadData($url, 'POST', $Utf8.GetBytes($payload))
        Send-Bytes $stream 200 'application/json; charset=utf-8' $resp $null
      } catch [System.Net.WebException] {
        $msg = $_.Exception.Message
        $r = $_.Exception.Response
        if ($r) { try { $sr = New-Object System.IO.StreamReader($r.GetResponseStream(), $Utf8); $t = $sr.ReadToEnd(); if ($t) { $msg = $t } } catch {} }
        Send-Error $stream 502 ('AI 연결 실패: ' + $msg)
      } catch { Send-Error $stream 502 ('AI 연결 실패: ' + $_.Exception.Message) }
      return
    }

    '/api/ai/status' {
      # PC 안 AI(Ollama) 설치 상태 — 설치돼 있는데 꺼져 있으면 켬. AI 호출 자체는 화면이 127.0.0.1:11434로 바로 함
      $st = $null
      $sf = $AiStatusFile
      if (Test-Path -LiteralPath $sf) { try { $st = Get-Content -LiteralPath $sf -Raw -Encoding UTF8 | ConvertFrom-Json } catch {} }
      $exe = Find-Ollama
      if ($exe -and -not $script:OllamaStarted) {
        $script:OllamaStarted = $true
        try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 } catch { try { Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden | Out-Null } catch {} }
      }
      Send-Json $stream 200 @{ installed = [bool]$exe; status = $st }
      return
    }

    '/api/ai/setup' {
      $model = 'gemma3:4b'
      try { $b = $Utf8.GetString($req.Body) | ConvertFrom-Json; if ([string]$b.model -match '^[A-Za-z0-9._:\-/]{1,60}$') { $model = [string]$b.model } } catch {}
      Start-AiSetup $model
      Send-Json $stream 200 @{ ok = $true; model = $model }
      return
    }

    '/api/hwpfill' {
      try {
        $body = $Utf8.GetString($req.Body) | ConvertFrom-Json
        $src = Resolve-DataPath ([string]$body.template)
        $dir = Resolve-DataPath ([string]$body.dir)
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $dst = Get-UniquePath $dir ([IO.Path]::GetFileName([string]$body.name))
        $n = Fill-HwpTemplate $src $dst $body.values
        Send-Json $stream 200 @{ ok = $true; path = (Get-RelPath $dst); replaced = $n }
      } catch { Send-Error $stream 500 $_.Exception.Message }
      return
    }

    '/api/open' {
      $full = Resolve-DataPath $q['path']
      if ((Test-Path -LiteralPath $full -PathType Leaf) -and $q['launch'] -eq '1') { Start-Process -FilePath $full }
      elseif (Test-Path -LiteralPath $full -PathType Leaf) { Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$full`"" }
      else { if (-not (Test-Path -LiteralPath $full)) { New-Item -ItemType Directory -Path $full -Force | Out-Null }; Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$full`"" }
      Send-Json $stream 200 @{ ok = $true }; return
    }

    '/api/printfile' {
      # 합쳐 인쇄할 수 없는 파일(.hwx 등): 윈도우에 등록된 그 형식의 '인쇄' 동작으로 기본 프린터에 보냄. 인쇄 동작이 없으면 원래 프로그램으로 열기
      $full = Resolve-DataPath $q['path']
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Send-Error $stream 404 '파일이 없습니다'; return }
      $how = 'print'
      try { Start-Process -FilePath $full -Verb Print -ErrorAction Stop } catch { $how = 'open'; try { Start-Process -FilePath $full } catch { Send-Error $stream 500 ('열 수 있는 프로그램이 없습니다: ' + $_.Exception.Message); return } }
      Send-Json $stream 200 @{ ok = $true; how = $how }; return
    }

    '/api/pickfolder' {
      try {
        $sel = Show-FolderDialog '서류를 저장할 폴더를 고르세요' $script:DataDir
        if ($sel) {
          $script:DataDir = $sel; $script:DataId = Ensure-Marker $script:DataDir $null; Set-DataDir $script:DataDir $script:DataId; $script:Lost = $false
          Send-Json $stream 200 @{ ok = $true; dataDir = $script:DataDir }
        } else { Send-Json $stream 200 @{ ok = $false; cancelled = $true } }
      } catch { Send-Error $stream 500 $_.Exception.Message }
      return
    }

    '/api/watch' {
      # 자동으로 읽을 폴더(여러 개): GET 목록 · POST pick=1 폴더 더하기 · POST clear=번호 빼기
      $jesc = { param($t) ([string]$t).Replace('\', '\\').Replace('"', '\"') }
      if ($req.Method -eq 'POST' -and $q.ContainsKey('clear')) {
        $i = [int]$q['clear']; if ($i -ge 0 -and $i -lt $script:WatchDirs.Count) { $script:WatchDirs.RemoveAt($i) }
        Set-DataDir $script:DataDir $script:DataId; Send-Json $stream 200 @{ ok = $true; dirs = @($script:WatchDirs) }; return
      }
      if ($req.Method -eq 'POST' -and ($q['pick'] -eq '1' -or $q['dir'] -or $q['known'])) {
        # pick=1 고르기 창 · dir=붙여 넣은 경로 · known=downloads|desktop|documents 바로 더하기
        try {
          $sel = if ($q['dir']) { [string]$q['dir'] } elseif ($q['known']) { Get-KnownDir ([string]$q['known']) } else { Show-FolderDialog '계약 서류를 내려받는 폴더를 고르세요. 여기에 들어오는 파일을 자동으로 읽어 계약별로 정리합니다.' (Get-KnownDir 'downloads') }
          if (-not $sel) { Send-Json $stream 200 @{ ok = $false; cancelled = $true }; return }
          $pick = Add-WatchDir $sel
          Send-Json $stream 200 @{ ok = $true; dir = $pick; dirs = @($script:WatchDirs) }
        } catch { Send-Error $stream 400 $_.Exception.Message }
        return
      }
      $sb = New-Object System.Text.StringBuilder
      [void]$sb.Append('{"ok":true,"dirs":[')
      for ($k = 0; $k -lt $script:WatchDirs.Count; $k++) { if ($k) { [void]$sb.Append(',') }; [void]$sb.Append('{"dir":"').Append((& $jesc $script:WatchDirs[$k])).Append('","missing":').Append(([string](-not (Test-Path -LiteralPath $script:WatchDirs[$k]))).ToLower()).Append('}') }
      [void]$sb.Append('],"files":[')
      $first = $true
      for ($k = 0; $k -lt $script:WatchDirs.Count; $k++) {
        $wd = [IO.Path]::GetFullPath($script:WatchDirs[$k]).TrimEnd('\', '/')
        if (-not (Test-Path -LiteralPath $wd)) { continue }
        $di = New-Object IO.DirectoryInfo($wd)
        try { $items = $di.EnumerateFiles('*', [IO.SearchOption]::AllDirectories) } catch { continue }
        foreach ($fi in $items) {
          $rel = $fi.FullName.Substring($wd.Length).TrimStart('\', '/')
          if (($rel.Split([char[]]@('\', '/')).Length) -gt 12) { continue }  # 하위 폴더 안의 폴더까지(10단계)
          if (($fi.Attributes -band [IO.FileAttributes]::Hidden) -ne 0 -or $fi.Name.StartsWith('~$') -or $fi.Name -match '\.(crdownload|part|tmp)$') { continue }
          if (-not $first) { [void]$sb.Append(',') }; $first = $false
          [void]$sb.Append('{"name":"').Append($k).Append('|').Append((& $jesc $rel.Replace('\', '/'))).Append('","size":').Append($fi.Length).Append(',"mtime":"').Append($fi.LastWriteTime.ToString('s')).Append('"}')
        }
      }
      [void]$sb.Append(']}')
      Send-Bytes $stream 200 'application/json; charset=utf-8' ($Utf8.GetBytes($sb.ToString())) $null; return
    }

    '/api/watchfile' {
      # 자동으로 읽을 폴더 안 파일 하나 읽기("번호|폴더 안 경로", 그 폴더 밖은 안 됨)
      $nm = [string]$q['name']; $bar = $nm.IndexOf('|')
      if ($bar -lt 1) { Send-Error $stream 400 'name'; return }
      $k = [int]$nm.Substring(0, $bar); $rel = $nm.Substring($bar + 1)
      if ($k -lt 0 -or $k -ge $script:WatchDirs.Count) { Send-Error $stream 404 'no watch dir'; return }
      $wd = [IO.Path]::GetFullPath($script:WatchDirs[$k]).TrimEnd('\', '/')
      $full = [IO.Path]::GetFullPath([IO.Path]::Combine($wd, (Normalize-Rel $rel)))
      if (-not $full.StartsWith($wd + [IO.Path]::DirectorySeparatorChar, 'OrdinalIgnoreCase') -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { Send-Error $stream 404 'not found'; return }
      try { $bytes = [IO.File]::ReadAllBytes($full) } catch { Send-Error $stream 409 '파일이 아직 쓰이는 중입니다'; return }
      Send-Bytes $stream 200 'application/octet-stream' $bytes $null; return
    }

    '/api/quit' { Send-Json $stream 200 @{ ok = $true }; $script:Quit = $true; return }
  }
  Send-Error $stream 404 'unknown api'
}

# ---------- 실행 ----------
$script:LastSeen = Get-Date
$script:Quit = $false
$script:Wins = @{}; $script:ByeAt = $null
if (-not $SkipAi) { Resume-AiSetup }
Open-Browser "http://$BaseHost/"
Write-StartLog "켜짐 $Version (포트 $Port)"
# _삭제됨: 버린 지 30일 지난 파일은 완전히 지움(그 전에는 되돌리기·직접 꺼내기 가능)
try {
  $trash = Join-Path $script:DataDir '_삭제됨'
  if (Test-Path -LiteralPath $trash) {
    $old = @(Get-ChildItem -LiteralPath $trash -File -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) })
    foreach ($f in $old) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
    if ($old.Count) { Write-StartLog "_삭제됨에서 30일 지난 파일 $($old.Count)개 지움" }
  }
} catch { }
# 창을 띄운 뒤 뒤에서 새 버전 확인·내려받기(따로 실행 — 이 창구는 기다리지 않음)
if (-not $NoUpdate -and (Test-InstalledCopy) -and (Get-UpdateCfg)) { try { Start-Detached '-StageUpdate' } catch { Write-StartLog "업데이트 확인을 시작하지 못함: $($_.Exception.Message)" } }
try {
  while (-not $script:Quit) {
    if (-not $listener.Pending()) {
      Start-Sleep -Milliseconds 40
      if (((Get-Date) - $script:LastSeen).TotalMinutes -gt $IdleMinutes) { break }
      # 마지막 창을 닫은 뒤 6초 동안 아무 창도 다시 안 들어오면 끔
      if ($script:ByeAt -and $script:Wins.Count -eq 0 -and ((Get-Date) - $script:LastSeen).TotalSeconds -gt 6) { Write-StartLog '창을 모두 닫아 끔'; break }
      continue
    }
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 30000; $client.SendTimeout = 30000
      $stream = $client.GetStream()
      $req = Read-Request $stream
      if ($req) {
        try { Handle $stream $req }
        catch { try { Send-Error $stream 500 $_.Exception.Message } catch {} }
      }
      $stream.Flush()
    } catch {
    } finally { $client.Close() }
  }
} finally {
  $listener.Stop()
  if ($script:Hwp) { try { $script:Hwp.Quit() } catch {} }
  if ($script:Xl) { try { $script:Xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:Xl) } catch {} }
  if ($script:Wd) { try { $script:Wd.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($script:Wd) } catch {} }
  Remove-Item -LiteralPath $RunFile -Force -ErrorAction SilentlyContinue
}
