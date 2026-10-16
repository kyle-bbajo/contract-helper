# 계약업무 도우미 설치 — 관리자 권한 없이 내 사용자 폴더에 설치
$ErrorActionPreference = 'Stop'
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $env:LOCALAPPDATA 'JichulHelper'
$Name = '계약업무 도우미'

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
Say ''
Say "  $Name 설치" 'Cyan'
Say '  ----------------------------------------'

try {
  # 1) 실행 중이면 끄기
  $run = Join-Path $Dest 'running.json'
  if (Test-Path -LiteralPath $run) {
    try {
      $r = Get-Content -LiteralPath $run -Raw -Encoding UTF8 | ConvertFrom-Json
      $wc = New-Object System.Net.WebClient; $wc.Headers.Add('X-JH-Token', $r.token)
      $null = $wc.UploadString("http://127.0.0.1:$($r.port)/api/quit", '')
      Start-Sleep -Milliseconds 800
    } catch {}
  }

  # 2) 파일 복사 (기존 설정 local.json은 보존)
  Say '  · 프로그램 파일 복사'
  if (-not (Test-Path -LiteralPath $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }
  $appDest = Join-Path $Dest 'app'
  if (Test-Path -LiteralPath $appDest) { Remove-Item -LiteralPath $appDest -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $Src 'app') -Destination $appDest -Recurse -Force
  foreach ($f in @('server.ps1', 'uninstall.ps1', 'icon.ico', 'version.txt')) {
    $p = Join-Path $Src $f
    if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $Dest $f) -Force }
  }
  # 인터넷에서 받은 파일 표시(차단) 해제
  Get-ChildItem -LiteralPath $Dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

  # 3) 데이터 폴더(문서\지출서류도우미)
  $docs = [Environment]::GetFolderPath('MyDocuments')
  $data = Join-Path $docs '계약업무도우미'
  $old = Join-Path $docs '지출서류도우미'
  if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $data)) { $data = $old }
  if (-not (Test-Path -LiteralPath $data)) { New-Item -ItemType Directory -Path $data -Force | Out-Null }
  Say "  · 서류 저장 폴더: $data"

  # 4) 바로가기(바탕화면, 시작 메뉴)
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $launchArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Dest 'server.ps1')`""
  $shell = New-Object -ComObject WScript.Shell
  $targets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$Name.lnk")
  )
  foreach ($lnkPath in $targets) {
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = $ps
    $lnk.Arguments = $launchArgs
    $lnk.WorkingDirectory = $Dest
    $lnk.WindowStyle = 7
    $lnk.Description = '지출서류 정리·점검·인쇄, 입찰 공고문 작성'
    $ico = Join-Path $Dest 'icon.ico'
    if (Test-Path -LiteralPath $ico) { $lnk.IconLocation = "$ico,0" }
    $lnk.Save()
  }
  # 이전 이름(지출서류 도우미) 바로가기 정리
  foreach ($oldLnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) '지출서류 도우미.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) '지출서류 도우미.lnk'))) {
    Remove-Item -LiteralPath $oldLnk -Force -ErrorAction SilentlyContinue
  }
  Say '  · 바탕화면과 시작 메뉴에 바로가기 만듦'

  Say ''
  Say '  설치가 끝났습니다. 지금 프로그램을 엽니다.' 'Green'
  Say '  다음부터는 바탕화면의 "계약업무 도우미"를 누르세요.' 'Green'
  Say ''
  Start-Process -FilePath $ps -ArgumentList $launchArgs -WorkingDirectory $Dest -WindowStyle Hidden
  exit 0
} catch {
  Say ''
  Say ('  설치하지 못했습니다: ' + $_.Exception.Message) 'Red'
  Say '  이 창의 내용을 캡처해서 담당자에게 보내 주세요.' 'Red'
  exit 1
}
