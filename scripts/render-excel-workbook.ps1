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
  $printRange = $null
  $page = $null
  $calibrationA = $null
  $calibrationB = $null
  $coordinateItems = [Collections.ArrayList]::new()
  try {
    $sheetIndex = if ($entry.PSObject.Properties.Name -contains 'sheetIndex') { [int]$entry.sheetIndex } else { 0 }
    try {
      $sheet = if ($sheetIndex -gt 0) {
        $workbook.Worksheets.Item($sheetIndex)
      } else {
        $workbook.Worksheets.Item([string]$entry.sheetName)
      }
    } catch {
      throw "Excel 시트를 열 수 없습니다: $([string]$entry.sheetName) (index=$sheetIndex). $($_.Exception.Message)"
    }
    # UsedRange is intentionally not used: formatting-only cells can make it
    # span an entire sheet and used to create enormous blank tile pyramids.
    $cells = $sheet.Cells
    $anchor = $cells.Item(1, 1)
    $firstRowCell = $cells.Find('*', $anchor, -4123, 2, 1, 1, $false, $false, $false)
    $lastRowCell = $cells.Find('*', $anchor, -4123, 2, 1, 2, $false, $false, $false)
    $firstColumnCell = $cells.Find('*', $anchor, -4123, 2, 2, 1, $false, $false, $false)
    $lastColumnCell = $cells.Find('*', $anchor, -4123, 2, 2, 2, $false, $false, $false)
    $minRow = if ($firstRowCell) { [int]$firstRowCell.Row } else { 1048576 }
    $maxRow = if ($lastRowCell) { [int]$lastRowCell.Row } else { 1 }
    $minColumn = if ($firstColumnCell) { [int]$firstColumnCell.Column } else { 16384 }
    $maxColumn = if ($lastColumnCell) { [int]$lastColumnCell.Column } else { 1 }
    $dataLeft = if ($firstColumnCell) { [double]$firstColumnCell.Left } else { [double]::PositiveInfinity }
    $dataTop = if ($firstRowCell) { [double]$firstRowCell.Top } else { [double]::PositiveInfinity }
    $dataRight = if ($lastColumnCell) { [double]$lastColumnCell.Left + [double]$lastColumnCell.Width } else { 0.0 }
    $dataBottom = if ($lastRowCell) { [double]$lastRowCell.Top + [double]$lastRowCell.Height } else { 0.0 }
    $minShapeLeft = [double]::PositiveInfinity; $minShapeTop = [double]::PositiveInfinity
    $maxShapeRight = 0.0; $maxShapeBottom = 0.0
    foreach ($shape in $sheet.Shapes) {
      try {
        if ([int]$shape.Visible -eq 0) { continue }
        $minShapeLeft = [Math]::Min($minShapeLeft, [double]$shape.Left)
        $minShapeTop = [Math]::Min($minShapeTop, [double]$shape.Top)
        $maxShapeRight = [Math]::Max($maxShapeRight, [double]$shape.Left + [double]$shape.Width)
        $maxShapeBottom = [Math]::Max($maxShapeBottom, [double]$shape.Top + [double]$shape.Height)
        Add-TextShapeCoordinate $shape $coordinateItems
        $topLeft = $shape.TopLeftCell
        $bottomRight = $shape.BottomRightCell
        $minRow = [Math]::Min($minRow, $topLeft.Row)
        $minColumn = [Math]::Min($minColumn, $topLeft.Column)
        $maxRow = [Math]::Max($maxRow, $bottomRight.Row)
        $maxColumn = [Math]::Max($maxColumn, $bottomRight.Column)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($topLeft)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($bottomRight)
      } catch { }
    }
    if ($minRow -eq 1048576) { $minRow = 1 }
    if ($minColumn -eq 16384) { $minColumn = 1 }
    $contentLeft = [Math]::Min($dataLeft, $minShapeLeft)
    $contentTop = [Math]::Min($dataTop, $minShapeTop)
    $contentRight = [Math]::Max($dataRight, $maxShapeRight)
    $contentBottom = [Math]::Max($dataBottom, $maxShapeBottom)
    $paddingPoints = 18.0
    while ($minColumn -gt 1) {
      $edgeCell = $sheet.Cells.Item(1, $minColumn)
      $edgeLeft = [double]$edgeCell.Left
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($edgeCell)
      if ([double]::IsPositiveInfinity($contentLeft) -or $edgeLeft -le $contentLeft - $paddingPoints) { break }
      $minColumn -= 1
    }
    while ($minRow -gt 1) {
      $edgeCell = $sheet.Cells.Item($minRow, 1)
      $edgeTop = [double]$edgeCell.Top
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($edgeCell)
      if ([double]::IsPositiveInfinity($contentTop) -or $edgeTop -le $contentTop - $paddingPoints) { break }
      $minRow -= 1
    }
    while ($true) {
      $edgeCell = $sheet.Cells.Item(1, $maxColumn)
      $edgeRight = [double]$edgeCell.Left + [double]$edgeCell.Width
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($edgeCell)
      if ($edgeRight -ge $contentRight + $paddingPoints) { break }
      $maxColumn += 1
    }
    while ($true) {
      $edgeCell = $sheet.Cells.Item($maxRow, 1)
      $edgeBottom = [double]$edgeCell.Top + [double]$edgeCell.Height
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($edgeCell)
      if ($edgeBottom -ge $contentBottom + $paddingPoints) { break }
      $maxRow += 1
    }
    $printRange = $sheet.Range($sheet.Cells.Item($minRow, $minColumn), $sheet.Cells.Item($maxRow, $maxColumn))
    $sheet.ResetAllPageBreaks()
    $page = $sheet.PageSetup
    $page.PrintArea = $printRange.Address(); $page.PaperSize = 9
    $page.Orientation = if ([double]$printRange.Width -gt [double]$printRange.Height) { 2 } else { 1 }
    $page.Zoom = $false; $page.FitToPagesWide = 1; $page.FitToPagesTall = 1; $page.Order = 2
    $page.LeftMargin = 0; $page.RightMargin = 0; $page.TopMargin = 0; $page.BottomMargin = 0
    $page.HeaderMargin = 0; $page.FooterMargin = 0
    $page.CenterHorizontally = $false; $page.CenterVertically = $false
    $sheet.DisplayPageBreaks = $false
    $printLeft = [double]$printRange.Left; $printTop = [double]$printRange.Top
    # Invisible vector text anchors let the Agent recover Excel->PDF scale and
    # printer offset from the exported PDF instead of assuming zero hard margin.
    # Excel drops extremely small text from some heavily scaled PDF pages.
    # Keep the anchors visually invisible (white/no fill) but large enough to
    # remain extractable even when Excel reaches its minimum print scale.
    $calibrationWidth = 120.0; $calibrationHeight = 18.0
    $calibrationA = $sheet.Shapes.AddTextbox(1,
      $printLeft + [double]$printRange.Width * 0.1 - $calibrationWidth / 2,
      $printTop + [double]$printRange.Height * 0.1 - $calibrationHeight / 2,
      $calibrationWidth, $calibrationHeight)
    $calibrationB = $sheet.Shapes.AddTextbox(1,
      $printLeft + [double]$printRange.Width * 0.6 - $calibrationWidth / 2,
      $printTop + [double]$printRange.Height * 0.6 - $calibrationHeight / 2,
      $calibrationWidth, $calibrationHeight)
    $calibrationA.TextFrame2.TextRange.Text = '__CATV_CAL_A__'
    $calibrationB.TextFrame2.TextRange.Text = '__CATV_CAL_B__'
    foreach ($marker in @($calibrationA, $calibrationB)) {
      $marker.Line.Visible = 0; $marker.Fill.Visible = 0
      $marker.TextFrame2.MarginLeft = 0; $marker.TextFrame2.MarginRight = 0
      $marker.TextFrame2.MarginTop = 0; $marker.TextFrame2.MarginBottom = 0
      $marker.TextFrame2.TextRange.Font.Size = 10
      $marker.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = 16777215
    }
    $rangeA = $calibrationA.TextFrame2.TextRange; $rangeB = $calibrationB.TextFrame2.TextRange
    $calAX = [double]$rangeA.BoundLeft + [double]$rangeA.BoundWidth / 2
    $calAY = [double]$rangeA.BoundTop + [double]$rangeA.BoundHeight / 2
    $calBX = [double]$rangeB.BoundLeft + [double]$rangeB.BoundWidth / 2
    $calBY = [double]$rangeB.BoundTop + [double]$rangeB.BoundHeight / 2
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($rangeA)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($rangeB)
    [ordered]@{
      schemaVersion = 3; sheetName = [string]$entry.sheetName; printArea = [string]$page.PrintArea
      pageOrder = 2; paddingPoints = $paddingPoints
      printLeft = $printLeft; printTop = $printTop
      printWidth = [double]$printRange.Width; printHeight = [double]$printRange.Height
      calibration = @(
        [ordered]@{ label = '__CATV_CAL_A__'; x = $calAX; y = $calAY },
        [ordered]@{ label = '__CATV_CAL_B__'; x = $calBX; y = $calBY }
      )
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
    if ($calibrationA) { try { $calibrationA.Delete() } catch { }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($calibrationA) }
    if ($calibrationB) { try { $calibrationB.Delete() } catch { }; [void][Runtime.InteropServices.Marshal]::ReleaseComObject($calibrationB) }
    if ($page) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($page) }
    if ($printRange) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($printRange) }
    foreach ($com in @($firstRowCell, $lastRowCell, $firstColumnCell, $lastColumnCell, $anchor, $cells)) {
      if ($com) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($com) }
    }
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
