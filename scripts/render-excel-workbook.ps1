param(
  [Parameter(Mandatory = $true)][string]$InputXlsx,
  [Parameter(Mandatory = $true)][string]$PlanJson,
  [string]$MetricsJson = ''
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$plan = Get-Content -LiteralPath $PlanJson -Raw -Encoding UTF8 | ConvertFrom-Json
$metrics = [ordered]@{ excelStartMs = 0; workbookOpenMs = 0; pdfMs = 0; sheets = [ordered]@{} }

function Add-TextShapeCoordinate($shape, [Collections.ArrayList]$items) {
  try {
    $text = [string]$shape.TextFrame2.TextRange.Text
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      [void]$items.Add([ordered]@{
        shapeId = [string]$shape.Id; label = $text.Trim()
        left = [double]$shape.Left; top = [double]$shape.Top
        width = [double]$shape.Width; height = [double]$shape.Height
      })
    }
  } catch { }
  try {
    if ([int]$shape.Type -eq 6) {
      $groupItems = $shape.GroupItems
      for ($index = 1; $index -le $groupItems.Count; $index += 1) {
        $child = $groupItems.Item($index)
        Add-TextShapeCoordinate $child $items
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($child)
      }
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($groupItems)
    }
  } catch { }
}

function Export-Sheet($workbook, $entry) {
  $sheet = $null
  $usedRange = $null
  $printRange = $null
  $page = $null
  $coordinateItems = [Collections.ArrayList]::new()
  try {
    $sheet = $workbook.Worksheets.Item([string]$entry.sheetName)
    $usedRange = $sheet.UsedRange
    $maxRow = [Math]::Max(1, $usedRange.Row + $usedRange.Rows.Count - 1)
    $maxColumn = [Math]::Max(1, $usedRange.Column + $usedRange.Columns.Count - 1)
    $maxShapeRight = 0.0; $maxShapeBottom = 0.0
    foreach ($shape in $sheet.Shapes) {
      try {
        $maxShapeRight = [Math]::Max($maxShapeRight, [double]$shape.Left + [double]$shape.Width)
        $maxShapeBottom = [Math]::Max($maxShapeBottom, [double]$shape.Top + [double]$shape.Height)
        Add-TextShapeCoordinate $shape $coordinateItems
        $bottomRight = $shape.BottomRightCell
        $maxRow = [Math]::Max($maxRow, $bottomRight.Row)
        $maxColumn = [Math]::Max($maxColumn, $bottomRight.Column)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($bottomRight)
      } catch { }
    }
    while ($true) {
      $edgeCell = $sheet.Cells.Item(1, $maxColumn)
      $edgeRight = [double]$edgeCell.Left + [double]$edgeCell.Width
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($edgeCell)
      if ($edgeRight -ge $maxShapeRight) { break }
      $maxColumn += 1
    }
    while ($true) {
      $edgeCell = $sheet.Cells.Item($maxRow, 1)
      $edgeBottom = [double]$edgeCell.Top + [double]$edgeCell.Height
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($edgeCell)
      if ($edgeBottom -ge $maxShapeBottom) { break }
      $maxRow += 1
    }
    $maxColumn += 2; $maxRow += 2
    $printRange = $sheet.Range($sheet.Cells.Item(1, 1), $sheet.Cells.Item($maxRow, $maxColumn))
    $sheet.ResetAllPageBreaks()
    $page = $sheet.PageSetup
    $page.PrintArea = $printRange.Address(); $page.PaperSize = 9
    $page.Orientation = if ([double]$printRange.Width -gt [double]$printRange.Height) { 2 } else { 1 }
    $page.Zoom = 10; $page.Order = 2
    $page.LeftMargin = 0; $page.RightMargin = 0; $page.TopMargin = 0; $page.BottomMargin = 0
    $page.HeaderMargin = 0; $page.FooterMargin = 0
    $page.CenterHorizontally = $false; $page.CenterVertically = $false
    $sheet.DisplayPageBreaks = $true

    $verticalStarts = [Collections.ArrayList]::new(); [void]$verticalStarts.Add(0.0)
    $horizontalStarts = [Collections.ArrayList]::new(); [void]$horizontalStarts.Add(0.0)
    foreach ($pageBreak in $sheet.VPageBreaks) {
      $location = $pageBreak.Location; [void]$verticalStarts.Add([double]$location.Left)
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($location)
    }
    foreach ($pageBreak in $sheet.HPageBreaks) {
      $location = $pageBreak.Location; [void]$horizontalStarts.Add([double]$location.Top)
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($location)
    }
    [ordered]@{
      schemaVersion = 2; sheetName = [string]$sheet.Name; printArea = [string]$page.PrintArea
      printScale = 0.1; pageOrder = 2
      printWidth = [double]$printRange.Width; printHeight = [double]$printRange.Height
      cropLeftPoints = 0.0; cropTopPoints = 0.0
      verticalStarts = @($verticalStarts | Sort-Object -Unique)
      horizontalStarts = @($horizontalStarts | Sort-Object -Unique)
      coordinates = @($coordinateItems)
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ([string]$entry.outputCoordinates) -Encoding UTF8
    $pdfTimer = [Diagnostics.Stopwatch]::StartNew()
    try { $sheet.ExportAsFixedFormat(0, [string]$entry.outputPdf, 0, $true, $false) }
    finally {
      $pdfTimer.Stop()
      $metrics.pdfMs += [int64]$pdfTimer.ElapsedMilliseconds
      $metrics.sheets[[string]$entry.sheetName] = [ordered]@{ pdfMs = [int64]$pdfTimer.ElapsedMilliseconds }
    }
  } finally {
    if ($page) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($page) }
    if ($printRange) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($printRange) }
    if ($usedRange) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($usedRange) }
    if ($sheet) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) }
  }
}

try {
  $excelTimer = [Diagnostics.Stopwatch]::StartNew()
  try { $excel = New-Object -ComObject Excel.Application }
  finally { $excelTimer.Stop(); $metrics.excelStartMs = [int64]$excelTimer.ElapsedMilliseconds }
  $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.ScreenUpdating = $false
  $excel.EnableEvents = $false; $excel.AskToUpdateLinks = $false; $excel.AutomationSecurity = 3
  $openTimer = [Diagnostics.Stopwatch]::StartNew()
  try { $workbook = $excel.Workbooks.Open($InputXlsx, 0, $true, 5, '', '', $true, 2, '', $false, $false, 0, $false, $true, 0) }
  finally { $openTimer.Stop(); $metrics.workbookOpenMs = [int64]$openTimer.ElapsedMilliseconds }
  foreach ($entry in @($plan)) { Export-Sheet $workbook $entry }
} finally {
  if ($workbook) { $workbook.Close($false) }
  if ($excel) { $excel.Quit() }
  if ($workbook) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
  if ($excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  if (-not [string]::IsNullOrWhiteSpace($MetricsJson)) {
    $metrics | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $MetricsJson -Encoding UTF8
  }
}
