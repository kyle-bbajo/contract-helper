# 계약업무 도우미 — 내 PC 전용 연결 창구
# - 127.0.0.1(이 PC)에서만 열림. 다른 PC나 인터넷에서는 접속할 수 없음
# - 페이지(app 폴더)를 보여주고, 데이터 폴더에 파일 저장, 나라장터 API 중계, 한글→PDF 변환을 맡음
# - Windows PowerShell 5.1 기준으로 작성(별도 설치 불필요)
param(
  [int]$Port = 17890,
  [switch]$NoBrowser,
  [switch]$SkipAi,
  [int]$IdleMinutes = 20
)

$ErrorActionPreference = 'Stop'
$Version = '1.4.0'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebRoot = Join-Path $AppRoot 'app'
$LocalCfg = Join-Path $AppRoot 'local.json'
$RunFile = Join-Path $AppRoot 'running.json'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
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
  [IO.File]::WriteAllText($LocalCfg, (@{ dataDir = $dir; dataId = $id } | ConvertTo-Json -Compress), $Utf8)
}

$script:Relocated = $false; $script:Lost = $false; $script:OldDir = ''
$cfg0 = Read-LocalCfg
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
      Send-Bytes $stream 200 'text/html; charset=utf-8' ($Utf8.GetBytes($html)) @{ 'Content-Security-Policy' = "default-src 'self' blob: data:; script-src 'self' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-ancestors 'none'" }
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
    '/api/ping' { Send-Json $stream 200 @{ ok = $true; version = $Version; dataDir = $script:DataDir; relocated = $script:Relocated; lost = $script:Lost; oldDir = $script:OldDir; os = [Environment]::OSVersion.VersionString }; return }

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
      # 바로 지우지 않고 데이터 폴더의 "_삭제됨"으로 옮김
      $src = Resolve-DataPath $q['path']
      if (Test-Path -LiteralPath $src -PathType Leaf) {
        $trash = Resolve-DataPath '_삭제됨'
        if (-not (Test-Path -LiteralPath $trash)) { New-Item -ItemType Directory -Path $trash -Force | Out-Null }
        Move-Item -LiteralPath $src -Destination (Get-UniquePath $trash ([IO.Path]::GetFileName($src)))
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
          [void]$sb.Append('{"path":"').Append($rel).Append('","size":').Append($fi.Length).Append(',"mtime":"').Append($fi.LastWriteTime.ToString('s')).Append('"}')
        }
      }
      [void]$sb.Append(']}')
      Send-Bytes $stream 200 'application/json; charset=utf-8' ($Utf8.GetBytes($sb.ToString())) $null; return
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

    '/api/pickfolder' {
      try {
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = '서류를 저장할 폴더를 고르세요'
        $dlg.SelectedPath = $script:DataDir
        $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
        $res = $dlg.ShowDialog($owner)
        if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
          $script:DataDir = $dlg.SelectedPath; $script:DataId = Ensure-Marker $script:DataDir $null; Set-DataDir $script:DataDir $script:DataId; $script:Lost = $false
          Send-Json $stream 200 @{ ok = $true; dataDir = $script:DataDir }
        } else { Send-Json $stream 200 @{ ok = $false; cancelled = $true } }
      } catch { Send-Error $stream 500 $_.Exception.Message }
      return
    }

    '/api/quit' { Send-Json $stream 200 @{ ok = $true }; $script:Quit = $true; return }
  }
  Send-Error $stream 404 'unknown api'
}

# ---------- 실행 ----------
$script:LastSeen = Get-Date
$script:Quit = $false
if (-not $SkipAi) { Resume-AiSetup }
Open-Browser "http://$BaseHost/"
try {
  while (-not $script:Quit) {
    if (-not $listener.Pending()) {
      Start-Sleep -Milliseconds 40
      if (((Get-Date) - $script:LastSeen).TotalMinutes -gt $IdleMinutes) { break }
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
  Remove-Item -LiteralPath $RunFile -Force -ErrorAction SilentlyContinue
}
