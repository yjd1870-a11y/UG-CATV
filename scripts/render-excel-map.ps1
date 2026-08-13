param(
  [Parameter(Mandatory = $true)][string]$InputXlsx,
  [Parameter(Mandatory = $true)][string]$OutputPdf,
  [Parameter(Mandatory = $true)][string]$SheetName,
  [Parameter(Mandatory = $true)][string]$OutputCoordinates
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$sheet = $null
$printRange = $null
$script:coordinateItems = [Collections.ArrayList]::new()

function Add-TextShapeCoordinate($shape) {
  try {
    $text = [string]$shape.TextFrame2.TextRange.Text
    if (-not [string]::IsNullOrWhiteSpace($text)) {
      [void]$script:coordinateItems.Add([ordered]@{
        shapeId = [string]$shape.Id
        label = $text.Trim()
        left = [double]$shape.Left
        top = [double]$shape.Top
        width = [double]$shape.Width
        height = [double]$shape.Height
      })
    }
  } catch { }
  try {
    if ([int]$shape.Type -eq 6) {
      $groupItems = $shape.GroupItems
      for ($index = 1; $index -le $groupItems.Count; $index += 1) {
        $child = $groupItems.Item($index)
        Add-TextShapeCoordinate $child
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($child)
      }
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($groupItems)
    }
  } catch { }
}

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false
  $workbook = $excel.Workbooks.Open($InputXlsx, 0, $true)
  $sheet = $workbook.Worksheets.Item($SheetName)
  $maxRow = [Math]::Max(1, $sheet.UsedRange.Row + $sheet.UsedRange.Rows.Count - 1)
  $maxColumn = [Math]::Max(1, $sheet.UsedRange.Column + $sheet.UsedRange.Columns.Count - 1)
  $maxShapeRight = 0.0
  $maxShapeBottom = 0.0
  $minShapeLeft = [double]::PositiveInfinity
  $minShapeTop = [double]::PositiveInfinity
  foreach ($shape in $sheet.Shapes) {
    try {
      $shapeRight = [double]$shape.Left + [double]$shape.Width
      $shapeBottom = [double]$shape.Top + [double]$shape.Height
      $minShapeLeft = [Math]::Min($minShapeLeft, [double]$shape.Left)
      $minShapeTop = [Math]::Min($minShapeTop, [double]$shape.Top)
      $maxShapeRight = [Math]::Max($maxShapeRight, $shapeRight)
      $maxShapeBottom = [Math]::Max($maxShapeBottom, $shapeBottom)
      Add-TextShapeCoordinate $shape
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
  $maxColumn += 2
  $maxRow += 2
  if ([double]::IsPositiveInfinity($minShapeLeft)) { $minShapeLeft = 0.0 }
  if ([double]::IsPositiveInfinity($minShapeTop)) { $minShapeTop = 0.0 }
  $printRange = $sheet.Range($sheet.Cells.Item(1, 1), $sheet.Cells.Item($maxRow, $maxColumn))
  $sheet.ResetAllPageBreaks()
  $page = $sheet.PageSetup
  $page.PrintArea = $printRange.Address()
  $page.PaperSize = 9
  $page.Orientation = if ([double]$printRange.Width -gt [double]$printRange.Height) { 2 } else { 1 }
  # Excel cannot fit very large drawings below 10%. Fixing the scale at its
  # real minimum makes every PDF page and every marker use the same geometry.
  $page.Zoom = 10
  $page.Order = 2
  $page.LeftMargin = 0
  $page.RightMargin = 0
  $page.TopMargin = 0
  $page.BottomMargin = 0
  $page.HeaderMargin = 0
  $page.FooterMargin = 0
  $page.CenterHorizontally = $false
  $page.CenterVertically = $false
  $sheet.DisplayPageBreaks = $true

  $verticalStarts = [Collections.ArrayList]::new()
  $horizontalStarts = [Collections.ArrayList]::new()
  [void]$verticalStarts.Add(0.0)
  [void]$horizontalStarts.Add(0.0)
  foreach ($pageBreak in $sheet.VPageBreaks) {
    $location = $pageBreak.Location
    [void]$verticalStarts.Add([double]$location.Left)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($location)
  }
  foreach ($pageBreak in $sheet.HPageBreaks) {
    $location = $pageBreak.Location
    [void]$horizontalStarts.Add([double]$location.Top)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($location)
  }
  $manifest = [ordered]@{
    printScale = 0.1
    pageOrder = 2
    printWidth = [double]$printRange.Width
    printHeight = [double]$printRange.Height
    verticalStarts = @($verticalStarts | Sort-Object -Unique)
    horizontalStarts = @($horizontalStarts | Sort-Object -Unique)
    coordinates = @($script:coordinateItems | ForEach-Object {
      [ordered]@{
        shapeId = $_.shapeId
        label = $_.label
        left = $_.left
        top = $_.top
        width = $_.width
        height = $_.height
      }
    })
  }
  ConvertTo-Json -InputObject $manifest -Depth 5 | Set-Content -LiteralPath $OutputCoordinates -Encoding UTF8
  $sheet.ExportAsFixedFormat(0, $OutputPdf, 0, $true, $false)
}
finally {
  if ($workbook) { $workbook.Close($false) }
  if ($excel) { $excel.Quit() }
  if ($printRange) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($printRange) }
  if ($sheet) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sheet) }
  if ($workbook) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
  if ($excel) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
