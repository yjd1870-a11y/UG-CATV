import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { projectRoot } from './env';
import { straightMapVersionRoot } from './straight-map-storage';

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
  const coordinates = await renderExcelToPng(xlsxPath, sheetName, sourcePath);
  const metadata = await createDeepZoomTiles(sourcePath, path.join(root, 'tiles'));
  return { ...metadata, sourcePath, coordinates };
};
