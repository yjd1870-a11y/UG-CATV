param(
  [Parameter(Mandatory = $true)][string]$InputXlsx,
  [Parameter(Mandatory = $true)][string]$OutputJson
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $workbook = $excel.Workbooks.Open($InputXlsx, 0, $true, 5, '', '', $true, 2, '', $false, $false, 0, $false, $true, 0)
  $sheets = [Collections.ArrayList]::new()
  foreach ($sheet in $workbook.Worksheets) {
    try {
      $used = $sheet.UsedRange
      $hasCells = [int]$used.Cells.Count -gt 1 -or -not [string]::IsNullOrWhiteSpace([string]$used.Value2)
      $hasShapes = [int]$sheet.Shapes.Count -gt 0
      [void]$sheets.Add([ordered]@{
        name = [string]$sheet.Name
        visible = [int]$sheet.Visible -eq -1
        empty = -not ($hasCells -or $hasShapes)
      })
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($used)
    } finally {
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sheet)
    }
  }
  $links = @($workbook.LinkSources(1))
  [ordered]@{
    schemaVersion = 1
    hasExternalLinks = $links.Count -gt 0
    sheets = @($sheets)
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputJson -Encoding UTF8
}
finally {
  if ($workbook) { $workbook.Close($false) }
  if ($excel) { $excel.Quit() }
  if ($workbook) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
  if ($excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
