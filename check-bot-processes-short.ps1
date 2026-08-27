$items = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'werewolf-bot|ts-node-dev|src\\index.ts|npm run dev'
}
Write-Output 'PID,PARENT,NAME'
$items | Sort-Object ProcessId | ForEach-Object {
  Write-Output ($_.ProcessId.ToString() + ',' + $_.ParentProcessId.ToString() + ',' + $_.Name)
}
Write-Output 'LISTENERS'
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Output ($_.OwningProcess.ToString() + ',' + $_.LocalAddress + ',' + $_.LocalPort) }
