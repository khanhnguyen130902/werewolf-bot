$ErrorActionPreference = 'Continue'
$work = 'C:\Users\quock\OneDrive\Desktop\werewolf-bot'
$log = 'C:\Temp\werewolf-bot-runtime.log'

if (Test-Path $log) {
  Remove-Item -Force $log
}

$command = 'cd /d "' + $work + '" && npm run dev >> "' + $log + '" 2>&1'
$process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/s', '/c', $command) -WindowStyle Hidden -PassThru
Write-Output ('BOT_PID=' + $process.Id)

Start-Sleep -Seconds 8
Write-Output '==== HEALTH ===='
try {
  curl.exe -sS -i --max-time 5 'http://127.0.0.1:3001/health'
} catch {
  Write-Output 'HEALTH_UNAVAILABLE'
}
Write-Output '==== LOG TAIL ===='
if (Test-Path $log) {
  Get-Content $log -Tail 50
} else {
  Write-Output 'RUNTIME_LOG_NOT_CREATED'
}
