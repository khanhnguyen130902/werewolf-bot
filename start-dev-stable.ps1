$dir = 'C:\Users\quock\OneDrive\Desktop\werewolf-bot'
$log = Join-Path $dir 'live.log'
if (Test-Path $log) { Remove-Item -Force $log }
$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev > live.log 2>&1' -WorkingDirectory $dir -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 5
Write-Output ("LauncherPID=" + $p.Id)
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, ProcessName
if (Test-Path $log) { Get-Content $log -Tail 30 }
netstat -ano | findstr ':3000'
