import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { projectRoot } from './env';
import { straightMapVersionRoot } from './straight-map-storage';
import {
  extractStraightMapSheets,
  type StraightMapDrawingPrimitive,
  type StraightMapExtraction,
} from './straight-map-ooxml';

// Render runs this service on a memory-constrained Starter instance. Keep
// libvips from caching several large map pyramids between queued sheets.
sharp.cache({ memory: 16, files: 4, items: 8 });
sharp.concurrency(1);

const execFileAsync = promisify(execFile);
const TILE_SIZE = 256;
// Keep the map slightly sharper without making the already-large tile
// pyramids disproportionately heavier: 1100 is exactly 10% above 1000 DPI.
const RENDER_DPI = Math.min(1200, Math.max(300, Number(process.env.STRAIGHT_MAP_DPI || 1100)));
export type StraightMapRenderedCoordinate = { shapeId: string; label: string; xRatio: number; yRatio: number };
type ExcelCoordinate = { shapeId: string; label: string; left: number; top: number; width: number; height: number };
type ExcelRenderManifest = {
  printScale: number;
  pageOrder: number;
  printWidth: number;
  printHeight: number;
  verticalStarts: number[];
  horizontalStarts: number[];
  coordinates: ExcelCoordinate[];
};
type PdfTextCoordinate = { text: string; compactText: string; x: number; y: number };

const compactText = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

const xmlEscape = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const portableCanvasSize = (extraction: StraightMapExtraction) => {
  const sourceWidth = Math.max(1, extraction.mapWidth);
  const sourceHeight = Math.max(1, extraction.mapHeight);
  // 2400px keeps labels readable in Deep Zoom while leaving enough headroom
  // for SVG rasterization and tile generation on Render Starter (512 MB).
  const requested = Number(process.env.STRAIGHT_MAP_PORTABLE_SIZE || 2400);
  const longestSide = Math.min(4096, Math.max(2400, Number.isFinite(requested) ? requested : 3200));
  const ratio = sourceWidth / sourceHeight;
  if (ratio >= 1) return { width: longestSide, height: Math.max(1200, Math.round(longestSide / ratio)) };
  return { width: Math.max(1200, Math.round(longestSide * ratio)), height: longestSide };
};

const connectorPath = (
  primitive: StraightMapDrawingPrimitive,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const startX = primitive.flipH ? x + width : x;
  const endX = primitive.flipH ? x : x + width;
  const startY = primitive.flipV ? y + height : y;
  const endY = primitive.flipV ? y : y + height;
  const middleX = (startX + endX) / 2;
  const middleY = (startY + endY) / 2;
  if (primitive.geometry === 'bentConnector2') return `M ${startX} ${startY} L ${endX} ${startY} L ${endX} ${endY}`;
  if (primitive.geometry === 'bentConnector3') return `M ${startX} ${startY} L ${middleX} ${startY} L ${middleX} ${endY} L ${endX} ${endY}`;
  if (primitive.geometry === 'bentConnector4') {
    return `M ${startX} ${startY} L ${startX} ${middleY} L ${middleX} ${middleY} L ${middleX} ${endY} L ${endX} ${endY}`;
  }
  return `M ${startX} ${startY} L ${endX} ${endY}`;
};

const portablePrimitiveSvg = (
  primitive: StraightMapDrawingPrimitive,
  extraction: StraightMapExtraction,
  width: number,
  height: number,
) => {
  const scaleX = width / Math.max(1, extraction.mapWidth);
  const scaleY = height / Math.max(1, extraction.mapHeight);
  const x = primitive.x * scaleX;
  const y = primitive.y * scaleY;
  const objectWidth = Math.max(0.75, primitive.width * scaleX);
  const objectHeight = Math.max(0.75, primitive.height * scaleY);
  const centerX = x + objectWidth / 2;
  const centerY = y + objectHeight / 2;
  const strokeWidth = Math.max(0.7, primitive.lineWidth * (scaleX + scaleY) / 2);
  const stroke = primitive.lineColor || 'none';
  const fill = primitive.fillColor || 'none';
  const geometry = primitive.geometry;
  const isConnector = primitive.kind === 'connector' || geometry === 'line' || /connector/i.test(geometry);
  let drawing: string;
  if (isConnector) {
    drawing = `<path d="${connectorPath(primitive, x, y, objectWidth, objectHeight)}" fill="none" stroke="${stroke}" `
      + `stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (geometry === 'ellipse') {
    drawing = `<ellipse cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" rx="${(objectWidth / 2).toFixed(2)}" `
      + `ry="${(objectHeight / 2).toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}"/>`;
  } else if (geometry === 'triangle') {
    drawing = `<polygon points="${centerX.toFixed(2)},${y.toFixed(2)} ${(x + objectWidth).toFixed(2)},${(y + objectHeight).toFixed(2)} `
      + `${x.toFixed(2)},${(y + objectHeight).toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}"/>`;
  } else {
    const radius = geometry === 'roundRect' ? Math.max(1, Math.min(objectWidth, objectHeight) * 0.12) : 0;
    drawing = `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${objectWidth.toFixed(2)}" height="${objectHeight.toFixed(2)}" `
      + `rx="${radius.toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}"/>`;
  }

  const lines = primitive.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8);
  let text = '';
  if (lines.length) {
    const requestedFontSize = primitive.fontSize * scaleY;
    const fontSize = Math.max(3, Math.min(26, requestedFontSize, objectHeight * 0.72));
    const lineHeight = fontSize * 1.08;
    const textAnchor = primitive.textAlign === 'left' ? 'start' : primitive.textAlign === 'right' ? 'end' : 'middle';
    const textX = primitive.textAlign === 'left' ? x + Math.max(2, fontSize * 0.25)
      : primitive.textAlign === 'right' ? x + objectWidth - Math.max(2, fontSize * 0.25) : centerX;
    text = lines.map((line, index) => (
      `<text x="${textX.toFixed(2)}" y="${(centerY + (index - (lines.length - 1) / 2) * lineHeight).toFixed(2)}" `
      + `font-family="Malgun Gothic, Noto Sans KR, Arial, sans-serif" font-size="${fontSize.toFixed(2)}" `
      + `font-weight="${primitive.bold ? '700' : '400'}" text-anchor="${textAnchor}" dominant-baseline="middle" `
      + `fill="${primitive.textColor}">${xmlEscape(line.slice(0, 240))}</text>`
    )).join('');
  }
  const rotation = primitive.rotation
    ? ` transform="rotate(${primitive.rotation.toFixed(3)} ${centerX.toFixed(2)} ${centerY.toFixed(2)})"`
    : '';
  return `<g${rotation}>${drawing}${text}</g>`;
};

const fallbackPortableObjects = (extraction: StraightMapExtraction, width: number, height: number) => extraction.objects.map((item) => {
  const centerX = item.xRatio * width;
  const centerY = item.yRatio * height;
  const objectWidth = Math.max(24, Math.min(width * 0.45, item.width / extraction.mapWidth * width));
  const objectHeight = Math.max(18, Math.min(height * 0.25, item.height / extraction.mapHeight * height));
  const x = Math.max(0, centerX - objectWidth / 2);
  const y = Math.max(0, centerY - objectHeight / 2);
  const fontSize = Math.max(8, Math.min(22, objectHeight * 0.42));
  const lines = item.originalText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4);
  const fill = item.objectType === 'cell-text' ? '#ffffff' : '#eef6fb';
  const stroke = item.objectType === 'connector' ? '#6b879b' : '#8bb8d5';
  const text = lines.map((line, index) => (
    `<text x="${centerX.toFixed(2)}" y="${(centerY + (index - (lines.length - 1) / 2) * fontSize * 1.15).toFixed(2)}" `
    + `font-family="Arial, Noto Sans KR, sans-serif" font-size="${fontSize.toFixed(2)}" font-weight="600" `
    + `text-anchor="middle" dominant-baseline="middle" fill="#173b57">${xmlEscape(line.slice(0, 180))}</text>`
  )).join('');
  return `<g><rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${objectWidth.toFixed(2)}" height="${objectHeight.toFixed(2)}" `
    + `rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1"/>${text}</g>`;
}).join('');

/** Render an XLSX drawing without desktop Excel for Linux production hosts. */
export const renderPortableStraightMap = async (extraction: StraightMapExtraction, outputPng: string) => {
  const { width, height } = portableCanvasSize(extraction);
  // Raster pictures and chart graphic frames require their related parts;
  // do not paint placeholder rectangles that could cover the line diagram.
  const primitives = (extraction.drawingPrimitives || []).filter((primitive) => (
    primitive.kind === 'shape' || primitive.kind === 'connector'
  ));
  const sortedPrimitives = [...primitives].sort((left, right) => {
    const leftConnector = left.kind === 'connector' || left.geometry === 'line' || /connector/i.test(left.geometry);
    const rightConnector = right.kind === 'connector' || right.geometry === 'line' || /connector/i.test(right.geometry);
    return Number(rightConnector) - Number(leftConnector) || left.zIndex - right.zIndex;
  });
  const shapes = sortedPrimitives.length
    ? sortedPrimitives.map((primitive) => portablePrimitiveSvg(primitive, extraction, width, height)).join('')
    : fallbackPortableObjects(extraction, width, height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/>${shapes}</svg>`;
  fs.mkdirSync(path.dirname(outputPng), { recursive: true });
  // SVG width/height are already expressed in output pixels. 144 DPI doubled
  // both axes (and quadrupled tile memory) on Render, so keep the 72 DPI pixel mapping.
  await sharp(Buffer.from(svg), { limitInputPixels: false, density: 72 })
    .png({ compressionLevel: 8 })
    .toFile(outputPng);
  return extraction.objects.map((item) => ({
    shapeId: item.shapeId,
    label: item.originalText,
    xRatio: item.xRatio,
    yRatio: item.yRatio,
  }));
};

const executable = async (name: string) => {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const { stdout } = await execFileAsync(command, [name]);
  const first = stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  if (!first) throw new Error(`${name} 실행 파일을 찾을 수 없습니다.`);
  return first;
};

export const stitchStraightMapPages = async (pagePaths: string[], pageColumns: number, stitchedPath: string) => {
  if (!pagePaths.length) throw new Error('결합할 직선도 페이지가 없습니다.');
  if (pagePaths.length === 1) {
    // sharp's multi-image join requires at least two inputs. Small Excel
    // maps often print to a single PDF page, so pass that page through.
    await sharp(pagePaths[0], { limitInputPixels: false })
      .png({ compressionLevel: 6 })
      .toFile(stitchedPath);
    return;
  }
  await sharp(pagePaths, {
    limitInputPixels: false,
    join: { across: pageColumns, shim: 0, background: '#ffffff' },
  })
    .png({ compressionLevel: 6 })
    .toFile(stitchedPath);
};

const renderExcelToPng = async (xlsxPath: string, sheetName: string, outputPng: string) => {
  const workDirectory = path.dirname(outputPng);
  const pdfPath = path.join(workDirectory, 'rendered.pdf');
  const pngBase = path.join(workDirectory, 'rendered-raw');
  const stitchedPath = path.join(workDirectory, 'rendered-stitched.png');
  const coordinatePath = path.join(workDirectory, 'coordinates.json');
  fs.mkdirSync(workDirectory, { recursive: true });
  if (process.platform !== 'win32') throw new Error('현재 Excel 원본 렌더러는 Windows Excel이 설치된 서버에서 동작합니다.');
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(projectRoot, 'scripts', 'render-excel-map.ps1'),
    '-InputXlsx', xlsxPath, '-OutputPdf', pdfPath, '-SheetName', sheetName, '-OutputCoordinates', coordinatePath,
  ], { timeout: 5 * 60_000, windowsHide: true });
  let pdftoppm = await executable('pdftoppm');
  if (/\.(cmd|bat)$/i.test(pdftoppm)) {
    const bundledExecutable = path.resolve(path.dirname(pdftoppm), '..', '..', 'native', 'poppler', 'Library', 'bin', 'pdftoppm.exe');
    if (fs.existsSync(bundledExecutable)) pdftoppm = bundledExecutable;
  }
  const renderArguments = ['-png', '-r', String(RENDER_DPI), pdfPath, pngBase];
  if (/\.(cmd|bat)$/i.test(pdftoppm)) {
    const commandLine = `call ${[pdftoppm, ...renderArguments].map((value) => `"${value.replace(/"/g, '""')}"`).join(' ')}`;
    await execFileAsync('cmd.exe', ['/d', '/s', '/c', commandLine], { timeout: 5 * 60_000, windowsHide: true });
  } else {
    await execFileAsync(pdftoppm, renderArguments, { timeout: 5 * 60_000, windowsHide: true });
  }
  const manifest = JSON.parse(fs.readFileSync(coordinatePath, 'utf8').replace(/^\uFEFF/, '')) as ExcelRenderManifest;
  const pagePaths = fs.readdirSync(workDirectory)
    .map((name) => ({ name, match: name.match(/^rendered-raw-(\d+)\.png$/) }))
    .filter((item): item is { name: string; match: RegExpMatchArray } => Boolean(item.match))
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map((item) => path.join(workDirectory, item.name));
  const pageMetadata = await Promise.all(pagePaths.map((pagePath) => sharp(pagePath).metadata()));
  const pageWidth = Math.max(...pageMetadata.map((metadata) => metadata.width || 0));
  const pageHeight = Math.max(...pageMetadata.map((metadata) => metadata.height || 0));
  if (!pageWidth || !pageHeight) throw new Error('직선도 PDF 페이지 크기를 확인할 수 없습니다.');
  const pixelsPerPoint = RENDER_DPI / 72;
  const pageSheetWidth = pageWidth / pixelsPerPoint / manifest.printScale;
  const pageSheetHeight = pageHeight / pixelsPerPoint / manifest.printScale;
  const pageColumns = Math.max(1, Math.ceil((manifest.printWidth - 0.5) / pageSheetWidth));
  const pageRows = Math.max(1, Math.ceil((manifest.printHeight - 0.5) / pageSheetHeight));
  if (!pagePaths.length || pagePaths.length !== pageColumns * pageRows) {
    throw new Error(`직선도 PDF 페이지 구성 오류: ${pagePaths.length}장, 예상 ${pageColumns}x${pageRows}`);
  }
  const verticalStarts = Array.from({ length: pageColumns }, (_, index) => index * pageSheetWidth);
  const horizontalStarts = Array.from({ length: pageRows }, (_, index) => index * pageSheetHeight);
  const pdfTextCoordinates: PdfTextCoordinate[] = [];
  const pdfLoadingTask = getDocument({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
    disableFontFace: true,
  });
  const pdfDocument = await pdfLoadingTask.promise;
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const pageIndex = pageNumber - 1;
    const column = pageIndex % pageColumns;
    const row = Math.floor(pageIndex / pageColumns);
    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      const textItem = item;
      const normalized = compactText(textItem.str).replace(/^[:：]+/, '');
      if (normalized.length < 5) continue;
      pdfTextCoordinates.push({
        text: textItem.str,
        compactText: normalized,
        x: column * pageWidth + (textItem.transform[4] + textItem.width / 2) * pixelsPerPoint,
        // Convert the PDF baseline to the center of the painted glyph using
        // the actual text height. Fixed point offsets drift at high DPI.
        y: row * pageHeight + (viewport.height - textItem.transform[5] - textItem.height / 2) * pixelsPerPoint,
      });
    }
    page.cleanup();
  }
  await pdfLoadingTask.destroy();
  await stitchStraightMapPages(pagePaths, pageColumns, stitchedPath);
  const trimInfo = await sharp(stitchedPath, { limitInputPixels: false })
    .trim({ background: '#ffffff', threshold: 8 })
    .png({ compressionLevel: 9 })
    .toFile(outputPng);
  // Sharp reports the crop displacement as negative offsets. Convert these
  // to the positive number of pixels removed from the left/top before
  // mapping PDF coordinates into the trimmed map image.
  const trimLeft = Math.max(0, -(trimInfo.trimOffsetLeft || 0));
  const trimTop = Math.max(0, -(trimInfo.trimOffsetTop || 0));
  const findPage = (starts: number[], value: number) => {
    for (let index = starts.length - 1; index >= 0; index -= 1) {
      if (value >= starts[index]) return index;
    }
    return 0;
  };
  const coordinates: StraightMapRenderedCoordinate[] = manifest.coordinates.map((coordinate) => {
    const centerX = coordinate.left + coordinate.width / 2;
    const centerY = coordinate.top + coordinate.height / 2;
    const column = findPage(verticalStarts, centerX);
    const row = findPage(horizontalStarts, centerY);
    const predictedX = column * pageWidth
      + (centerX - verticalStarts[column]) * manifest.printScale * pixelsPerPoint;
    const predictedY = row * pageHeight
      + (centerY - horizontalStarts[row]) * manifest.printScale * pixelsPerPoint;
    const labelText = compactText(coordinate.label);
    const identifierTokens = Array.from(coordinate.label.matchAll(/[a-z0-9-]{6,}/gi))
      .map((match) => compactText(match[0]))
      .filter((value) => /[a-z]/.test(value) && /\d/.test(value));
    const textMatches = pdfTextCoordinates
      .filter((item) => labelText.includes(item.compactText))
      .map((item) => ({
        ...item,
        distance: Math.hypot(item.x - predictedX, item.y - predictedY),
      }));
    const identifierMatch = textMatches
      .filter((item) => identifierTokens.some((token) => item.compactText.includes(token) || token.includes(item.compactText)))
      .sort((a, b) => a.distance - b.distance)[0];
    const descriptiveMatch = textMatches
      .sort((a, b) => b.compactText.length - a.compactText.length || a.distance - b.distance)[0];
    const matchedText = identifierMatch ?? descriptiveMatch;
    const imageX = (matchedText?.x ?? predictedX) - trimLeft;
    const imageY = (matchedText?.y ?? predictedY) - trimTop;
    return {
      shapeId: coordinate.shapeId,
      label: coordinate.label,
      xRatio: Math.min(1, Math.max(0, imageX / trimInfo.width)),
      yRatio: Math.min(1, Math.max(0, imageY / trimInfo.height)),
    };
  });
  fs.rmSync(pdfPath, { force: true });
  for (const pagePath of pagePaths) fs.rmSync(pagePath, { force: true });
  fs.rmSync(stitchedPath, { force: true });
  fs.rmSync(coordinatePath, { force: true });
  return coordinates;
};

const createDeepZoomTiles = async (sourcePath: string, tileRoot: string) => {
  const metadata = await sharp(sourcePath, { limitInputPixels: false }).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) throw new Error('렌더링된 직선도 이미지 크기를 확인할 수 없습니다.');
  const maxZoom = Math.ceil(Math.log2(Math.max(width, height)));
  const tileParent = path.dirname(tileRoot);
  const outputBase = path.join(tileParent, 'pyramid');
  const descriptorPath = `${outputBase}.dzi`;
  const generatedTiles = `${outputBase}_files`;
  fs.rmSync(tileRoot, { recursive: true, force: true });
  fs.rmSync(generatedTiles, { recursive: true, force: true });
  fs.rmSync(descriptorPath, { force: true });
  fs.rmSync(path.join(tileParent, 'pyramid.dzi_files'), { recursive: true, force: true });
  fs.rmSync(path.join(tileParent, 'pyramid.dzi.dzi'), { force: true });
  await sharp(sourcePath, { limitInputPixels: false })
    .webp({ quality: 92, effort: 4 })
    .tile({ size: TILE_SIZE, overlap: 0, container: 'fs', layout: 'dz' })
    .toFile(outputBase);
  fs.renameSync(generatedTiles, tileRoot);
  fs.rmSync(descriptorPath, { force: true });
  return { width, height, maxZoom, tileSize: TILE_SIZE };
};

export const renderStraightMap = async (mapId: string, version: number, xlsxPath: string, sheetName: string) => {
  const root = straightMapVersionRoot(mapId, version);
  const renderedDirectory = path.join(root, 'rendered');
  const sourcePath = path.join(renderedDirectory, 'map.png');
  let coordinates: StraightMapRenderedCoordinate[];
  if (process.platform === 'win32' && process.env.STRAIGHT_MAP_RENDERER !== 'portable') {
    coordinates = await renderExcelToPng(xlsxPath, sheetName, sourcePath);
  } else {
    const extraction = extractStraightMapSheets(fs.readFileSync(xlsxPath), { sheetName })[0];
    if (!extraction) throw new Error(`직선도 시트를 찾을 수 없습니다: ${sheetName}`);
    coordinates = await renderPortableStraightMap(extraction, sourcePath);
  }
  const metadata = await createDeepZoomTiles(sourcePath, path.join(root, 'tiles'));
  return { ...metadata, sourcePath, coordinates };
};
