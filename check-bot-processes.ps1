$items = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'werewolf-bot|ts-node-dev|src\\index.ts|npm run dev'
}
Write-Output '==== BOT PROCESS TREE ===='
$items | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-List
Write-Output '==== PORT OWNER ===='
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
