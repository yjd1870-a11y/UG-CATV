import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, openAsBlob, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../..');
const apiBase = (process.env.CATV_RENDERER_API_URL || '').replace(/\/$/, '');
const usesProductionApi = /^https:\/\//i.test(apiBase);
const localTokenPath = path.resolve(process.env.PRIVATE_STORAGE_PATH || path.join(projectRoot, 'backend', 'data'), 'straight-map-renderer.token');
const deviceToken = process.env.CATV_RENDERER_DEVICE_TOKEN || (/^http:\/\/localhost(?::\d+)?$/i.test(apiBase)
  ? (() => { try { return readFileSync(localTokenPath, 'utf8').trim(); } catch { return ''; } })()
  : '');
const rendererId = (process.env.CATV_RENDERER_ID || `${os.hostname()}-${os.userInfo().username}`).slice(0, 120);
const once = process.argv.includes('--once');

if (process.platform !== 'win32') throw new Error('직선도 렌더러 Agent는 Microsoft Excel이 설치된 Windows 사용자 세션에서만 실행할 수 있습니다.');
if (!apiBase || !/^https:\/\//i.test(apiBase) && !/^http:\/\/localhost(?::\d+)?$/i.test(apiBase)) throw new Error('CATV_RENDERER_API_URL에 HTTPS Render API 주소가 필요합니다.');
if (deviceToken.length < 32) throw new Error('Windows Credential Manager 또는 보안 프롬프트로 renderer device token을 제공해주세요.');

sharp.cache({ memory: 128, files: 8, items: 32 });
sharp.concurrency(1);

type Envelope<T> = { success: true; data: T } | { success: false; message: string; code?: string };
const api = async <T>(endpoint: string, body: Record<string, unknown> = {}) => {
  const response = await fetch(`${apiBase}/api/renderer${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rendererId, ...body }),
  });
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || !payload.success) {
    const failed = payload as Extract<Envelope<T>, { success: false }>;
    throw new Error(`${failed.code || response.status}: ${failed.message || '렌더러 API 요청 실패'}`);
  }
  return payload.data;
};

const rendererResource = (url: string) => {
  const resolved = new URL(url, `${apiBase}/`);
  const api = new URL(apiBase);
  return {
    url: resolved.toString(),
    headers: resolved.origin === api.origin && resolved.pathname.startsWith('/api/renderer/')
      ? { Authorization: `Bearer ${deviceToken}` }
      : {},
  };
};

const sha256File = async (filePath: string) => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(); } }));
  return hash.digest('hex');
};

const downloadFile = async (url: string, filePath: string, expectedSha256: string) => {
  const resource = rendererResource(url);
  const response = await fetch(resource.url, { headers: resource.headers });
  if (!response.ok || !response.body) throw new Error(`XLSX 다운로드 실패 (${response.status})`);
  const hash = createHash('sha256');
  await pipeline(
    Readable.fromWeb(response.body as never),
    new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } }),
    (await import('node:fs')).createWriteStream(filePath, { flags: 'wx' }),
  );
  if (hash.digest('hex') !== expectedSha256) throw new Error('다운로드한 XLSX SHA-256이 작업 원본과 다릅니다.');
};

const repairMissingProductionSource = async (jobId: string, job: Record<string, unknown>) => {
  const sourceSha256 = String(job.sourceSha256);
  const sourceDirectory = path.resolve(process.env.CATV_RENDERER_SOURCE_DIR
    || path.join(projectRoot, 'backend', 'data', 'straight-maps', 'sources'));
  const candidate = path.join(sourceDirectory, `${sourceSha256}.xlsx`);
  const candidateStat = await stat(candidate).catch(() => null);
  if (!candidateStat || await sha256File(candidate) !== sourceSha256) {
    throw new Error(`R2 원본이 없고 일치하는 로컬 복구 파일도 없습니다: ${sourceSha256}.xlsx`);
  }
  const prepared = await api<{
    uploadRequired: boolean;
    uploadUrl: string | null;
    requiredHeaders: Record<string, string>;
  }>(`/jobs/${jobId}/source-upload-url`);
  if (!prepared.uploadRequired) return;
  if (!prepared.uploadUrl) throw new Error('R2 원본 복구 업로드 URL을 발급받지 못했습니다.');
  const blob = await openAsBlob(candidate, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const response = await fetch(prepared.uploadUrl, { method: 'PUT', headers: prepared.requiredHeaders, body: blob });
  if (!response.ok) throw new Error(`R2 원본 복구 업로드 실패 (${response.status})`);
  console.log(`[SOURCE_REPAIRED] ${job.filename} (${sourceSha256})`);
};

const powershell = async (script: string, args: string[]) => {
  await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    windowsHide: true,
    timeout: 60 * 60_000,
    maxBuffer: 1024 * 1024,
  });
};

type ExcelAnalysis = { hasExternalLinks: boolean; sheets: Array<{ name: string; visible: boolean; empty: boolean }> };
type ExcelCoordinates = {
  printArea: string;
  printScale: number;
  printWidth: number;
  printHeight: number;
  verticalStarts: number[];
  horizontalStarts: number[];
  cropLeftPoints: number;
  cropTopPoints: number;
  coordinates: Array<{ shapeId: string; label: string; left: number; top: number; width: number; height: number }>;
};

const jsonFile = async <T>(filePath: string) => JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')) as T;

const inspectPdf = async (pdfPath: string) => {
  const { stdout } = await execFileAsync('pdfinfo.exe', [pdfPath], { windowsHide: true, maxBuffer: 1024 * 1024 });
  const pages = Number(/^Pages:\s+(\d+)/mi.exec(stdout)?.[1]);
  const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/mi.exec(stdout);
  if (!pages || !size) throw new Error('pdfinfo에서 PDF 페이지 정보를 확인할 수 없습니다. Poppler를 PATH에 설치해주세요.');
  return { pages, widthPoints: Number(size[1]), heightPoints: Number(size[2]) };
};

const findPageIndex = (starts: number[], value: number) => {
  for (let index = starts.length - 1; index >= 0; index -= 1) if (value >= starts[index]) return index;
  return 0;
};

const normalizedCoordinates = (excel: ExcelCoordinates, pdf: Awaited<ReturnType<typeof inspectPdf>>) => {
  const columns = excel.verticalStarts.length;
  const rows = excel.horizontalStarts.length;
  const canvasWidthPoints = pdf.widthPoints * columns;
  const canvasHeightPoints = pdf.heightPoints * rows;
  const coordinates = excel.coordinates.map((item) => {
    const centerX = item.left + item.width / 2;
    const centerY = item.top + item.height / 2;
    const column = findPageIndex(excel.verticalStarts, centerX);
    const row = findPageIndex(excel.horizontalStarts, centerY);
    const xPoints = column * pdf.widthPoints + (centerX - excel.verticalStarts[column]) * excel.printScale - excel.cropLeftPoints;
    const yPoints = row * pdf.heightPoints + (centerY - excel.horizontalStarts[row]) * excel.printScale - excel.cropTopPoints;
    return {
      shapeId: item.shapeId,
      label: item.label,
      xRatio: Math.min(1, Math.max(0, xPoints / canvasWidthPoints)),
      yRatio: Math.min(1, Math.max(0, yPoints / canvasHeightPoints)),
      width: item.width * excel.printScale,
      height: item.height * excel.printScale,
    };
  });
  return { coordinates, columns, rows, canvasWidthPoints, canvasHeightPoints };
};

const generateTiles = async (input: {
  pdfPath: string;
  outputRoot: string;
  pdf: Awaited<ReturnType<typeof inspectPdf>>;
  columns: number;
  rows: number;
  dpi: number;
  tileSize: number;
  quality: number;
  onProgress?: (fraction: number, level: number, maxLevel: number) => Promise<void>;
}) => {
  const renderedWidth = Math.ceil(input.pdf.widthPoints * input.columns * input.dpi / 72);
  const renderedHeight = Math.ceil(input.pdf.heightPoints * input.rows * input.dpi / 72);
  const maxLevel = Math.ceil(Math.log2(Math.max(renderedWidth, renderedHeight)));
  const levels: Array<{ level: number; columns: number; rows: number; tileCount: number }> = [];
  const expectedTiles = Array.from({ length: maxLevel + 1 }, (_, level) => {
    const divisor = 2 ** (maxLevel - level);
    return Math.ceil(Math.ceil(renderedWidth / divisor) / input.tileSize)
      * Math.ceil(Math.ceil(renderedHeight / divisor) / input.tileSize);
  });
  const expectedTileTotal = expectedTiles.reduce((sum, count) => sum + count, 0);
  let completedTiles = 0;
  await mkdir(input.outputRoot, { recursive: true });
  for (let level = 0; level <= maxLevel; level += 1) {
    const divisor = 2 ** (maxLevel - level);
    const levelWidth = Math.ceil(renderedWidth / divisor);
    const levelHeight = Math.ceil(renderedHeight / divisor);
    const pageWidth = Math.max(1, Math.round(input.pdf.widthPoints * input.dpi / 72 / divisor));
    const pageHeight = Math.max(1, Math.round(input.pdf.heightPoints * input.dpi / 72 / divisor));
    const levelColumns = Math.ceil(levelWidth / input.tileSize);
    const levelRows = Math.ceil(levelHeight / input.tileSize);
    const levelRoot = path.join(input.outputRoot, String(level));
    await mkdir(levelRoot, { recursive: true });
    for (let pageIndex = 0; pageIndex < input.pdf.pages; pageIndex += 1) {
      const pageNumber = pageIndex + 1;
      const pageBase = path.join(path.dirname(input.outputRoot), `page-${level}-${pageNumber}`);
      const renderDpi = Math.max(12, input.dpi / divisor);
      await execFileAsync('pdftoppm.exe', ['-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', '-r', String(renderDpi), '-png', input.pdfPath, pageBase], {
        windowsHide: true,
        timeout: 60 * 60_000,
        maxBuffer: 1024 * 1024,
      });
      const pagePath = `${pageBase}.png`;
      const pageImage = sharp(pagePath, { limitInputPixels: false, sequentialRead: true }).resize(pageWidth, pageHeight, { fit: 'fill' });
      const pageColumn = pageIndex % input.columns;
      const pageRow = Math.floor(pageIndex / input.columns);
      const originX = pageColumn * pageWidth;
      const originY = pageRow * pageHeight;
      const firstColumn = Math.floor(originX / input.tileSize);
      const lastColumn = Math.min(levelColumns - 1, Math.floor((originX + pageWidth - 1) / input.tileSize));
      const firstRow = Math.floor(originY / input.tileSize);
      const lastRow = Math.min(levelRows - 1, Math.floor((originY + pageHeight - 1) / input.tileSize));
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const tileLeft = column * input.tileSize;
          const tileTop = row * input.tileSize;
          const tileWidth = Math.min(input.tileSize, levelWidth - tileLeft);
          const tileHeight = Math.min(input.tileSize, levelHeight - tileTop);
          const sourceLeft = Math.max(0, tileLeft - originX);
          const sourceTop = Math.max(0, tileTop - originY);
          const pieceLeft = Math.max(0, originX - tileLeft);
          const pieceTop = Math.max(0, originY - tileTop);
          const pieceWidth = Math.min(pageWidth - sourceLeft, tileWidth - pieceLeft);
          const pieceHeight = Math.min(pageHeight - sourceTop, tileHeight - pieceTop);
          if (pieceWidth <= 0 || pieceHeight <= 0) continue;
          const piece = await pageImage.clone().extract({ left: sourceLeft, top: sourceTop, width: pieceWidth, height: pieceHeight }).png().toBuffer();
          const tilePath = path.join(levelRoot, `${column}_${row}.webp`);
          let canvas = sharp({ create: { width: tileWidth, height: tileHeight, channels: 3, background: '#ffffff' } });
          try {
            const existingTile = await readFile(tilePath);
            canvas = sharp(existingTile).flatten({ background: '#ffffff' });
          } catch { /* first page touching this tile */ }
          await canvas.composite([{ input: piece, left: pieceLeft, top: pieceTop }]).webp({ quality: input.quality, effort: 4 }).toFile(`${tilePath}.next`);
          canvas.destroy();
          await rm(tilePath, { force: true });
          await (await import('node:fs/promises')).rename(`${tilePath}.next`, tilePath);
        }
      }
      pageImage.destroy();
      await rm(pagePath, { force: true });
    }
    for (let row = 0; row < levelRows; row += 1) {
      for (let column = 0; column < levelColumns; column += 1) {
        const tilePath = path.join(levelRoot, `${column}_${row}.webp`);
        try { await stat(tilePath); }
        catch {
          const width = Math.min(input.tileSize, levelWidth - column * input.tileSize);
          const height = Math.min(input.tileSize, levelHeight - row * input.tileSize);
          await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
            .webp({ quality: input.quality, effort: 4 }).toFile(tilePath);
        }
      }
    }
    levels.push({ level, columns: levelColumns, rows: levelRows, tileCount: levelColumns * levelRows });
    completedTiles += levelColumns * levelRows;
    await input.onProgress?.(completedTiles / expectedTileTotal, level, maxLevel);
  }
  return { renderedWidth, renderedHeight, maxLevel, levels, tileCount: levels.reduce((sum, level) => sum + level.tileCount, 0) };
};

const filesBelow = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : Promise.resolve([target]);
  }));
  return nested.flat();
};

const contentType = (relative: string) => relative.endsWith('.webp') ? 'image/webp'
  : relative.endsWith('.pdf') ? 'application/pdf'
    : 'application/json';

const uploadArtifact = async (jobId: string, sheetName: string, artifactSetId: string, artifactRoot: string, manifestPath: string) => {
  const paths = await filesBelow(artifactRoot);
  const manifestAbsolute = path.resolve(manifestPath);
  const ordered = [...paths.filter((file) => path.resolve(file) !== manifestAbsolute), manifestPath];
  for (let start = 0; start < ordered.length; start += 200) {
    const batch = ordered.slice(start, start + 200);
    const files = await Promise.all(batch.map(async (filePath) => ({
      filePath,
      relativeKey: path.relative(artifactRoot, filePath).split(path.sep).join('/'),
      size: (await stat(filePath)).size,
      contentType: contentType(filePath),
      sha256: await sha256File(filePath),
    })));
    const prepared = await api<{
      artifactSetId: string;
      uploads: Array<{ relativeKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>;
    }>(`/jobs/${jobId}/artifacts/upload-urls`, { sheetName, artifactSetId, files: files.map(({ filePath: _filePath, ...file }) => file) });
    if (prepared.artifactSetId !== artifactSetId) throw new Error('서버가 다른 artifact set ID를 반환했습니다.');
    for (const upload of prepared.uploads) {
      const file = files.find((candidate) => candidate.relativeKey === upload.relativeKey);
      if (!file) throw new Error(`업로드 파일을 찾을 수 없습니다: ${upload.relativeKey}`);
      const blob = await openAsBlob(file.filePath, { type: file.contentType });
      const resource = rendererResource(upload.uploadUrl);
      const response = await fetch(resource.url, {
        method: 'PUT', headers: { ...upload.requiredHeaders, ...resource.headers }, body: blob,
      });
      if (!response.ok) throw new Error(`artifact 업로드 실패: ${upload.relativeKey} (${response.status})`);
    }
  }
  return artifactSetId;
};

const processJob = async (job: Record<string, unknown>, profile: Record<string, number>) => {
  const jobId = String(job.id);
  const temporaryRoot = path.join(os.tmpdir(), `catv-straight-map-${jobId}`);
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await mkdir(temporaryRoot, { recursive: true });
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    heartbeat = setInterval(() => void api(`/jobs/${jobId}/heartbeat`).catch((error) => console.error('[HEARTBEAT_FAILED]', error)), 30_000);
    await api(`/jobs/${jobId}/progress`, { status: 'DOWNLOADING', progress: 1, currentStep: '직선도 원본 다운로드 중' });
    const xlsxPath = path.join(temporaryRoot, 'source.xlsx');
    let source = await api<{ downloadUrl: string }>(`/jobs/${jobId}/source-url`);
    try {
      await downloadFile(source.downloadUrl, xlsxPath, String(job.sourceSha256));
    } catch (error) {
      if (!usesProductionApi || !(error instanceof Error) || !/\(404\)/.test(error.message)) throw error;
      await repairMissingProductionSource(jobId, job);
      source = await api<{ downloadUrl: string }>(`/jobs/${jobId}/source-url`);
      await downloadFile(source.downloadUrl, xlsxPath, String(job.sourceSha256));
    }
    await api(`/jobs/${jobId}/progress`, { status: 'ANALYZING', progress: 3, currentStep: 'Excel 통합 문서 분석 중' });
    const analysisPath = path.join(temporaryRoot, 'workbook.json');
    await powershell(path.join(projectRoot, 'scripts', 'inspect-excel-workbook.ps1'), ['-InputXlsx', xlsxPath, '-OutputJson', analysisPath]);
    const analysis = await jsonFile<ExcelAnalysis>(analysisPath);
    const sheetNames = analysis.sheets.filter((sheet) => sheet.visible && !sheet.empty && !sheet.name.includes('선번장')).map((sheet) => sheet.name);
    if (!sheetNames.length) throw new Error('표시 가능한 직선도 시트를 찾지 못했습니다. 숨김·빈 시트 및 선번장 시트는 제외됩니다.');
    const registered = await api<{ sheets: Array<{ sheetName: string; status: string; artifactSetId: string | null }> }>(`/jobs/${jobId}/sheets`, { sheetNames });
    const artifacts: Array<Record<string, unknown>> = [];
    for (let index = 0; index < registered.sheets.length; index += 1) {
      const sheet = registered.sheets[index];
      if (sheet.status === 'CACHE_HIT') continue;
      const progressBase = 5 + index / registered.sheets.length * 85;
      await api(`/jobs/${jobId}/progress`, { status: 'EXCEL_RENDERING', progress: progressBase, currentSheet: sheet.sheetName, currentStep: 'Excel PDF 생성 중' });
      const artifactRoot = path.join(temporaryRoot, `artifact-${index}`);
      const pdfPath = path.join(artifactRoot, 'map.pdf');
      const excelCoordinatesPath = path.join(artifactRoot, 'excel-coordinates.json');
      await mkdir(artifactRoot, { recursive: true });
      await powershell(path.join(projectRoot, 'scripts', 'render-excel-map.ps1'), [
        '-InputXlsx', xlsxPath, '-OutputPdf', pdfPath, '-SheetName', sheet.sheetName, '-OutputCoordinates', excelCoordinatesPath,
      ]);
      const excelCoordinates = await jsonFile<ExcelCoordinates>(excelCoordinatesPath);
      const pdf = await inspectPdf(pdfPath);
      const transformed = normalizedCoordinates(excelCoordinates, pdf);
      await api(`/jobs/${jobId}/progress`, { status: 'TILE_GENERATING', progress: progressBase + 2, currentSheet: sheet.sheetName, currentStep: 'PDF 페이지 기반 Deep Zoom 타일 생성 중' });
      const tiled = await generateTiles({
        pdfPath, outputRoot: path.join(artifactRoot, 'tiles'), pdf,
        columns: transformed.columns, rows: transformed.rows,
        dpi: profile.dpi, tileSize: profile.tileSize, quality: profile.webpQuality,
        onProgress: async (fraction, level, maxLevel) => {
          await api(`/jobs/${jobId}/progress`, {
            status: 'TILE_GENERATING', progress: progressBase + 2 + fraction * 5,
            currentSheet: sheet.sheetName, currentStep: `Deep Zoom level ${level}/${maxLevel} 생성 완료`,
          });
        },
      });
      const coordinateJson = JSON.stringify(transformed.coordinates);
      const coordinateHash = createHash('sha256').update(coordinateJson).digest('hex');
      const coordinatesPath = path.join(artifactRoot, 'coordinates.json');
      await writeFile(coordinatesPath, coordinateJson, 'utf8');
      const sourceInfo = {
        schemaVersion: 1, jobId, sourceSha256: job.sourceSha256, filename: job.filename,
        sheetName: sheet.sheetName, hasExternalLinks: analysis.hasExternalLinks,
      };
      await writeFile(path.join(artifactRoot, 'source-info.json'), JSON.stringify(sourceInfo), 'utf8');
      const artifactSetId = sheet.artifactSetId || randomUUID();
      const manifest = {
        schemaVersion: 1, complete: true, jobId, artifactSetId,
        sourceSha256: job.sourceSha256, sheetName: sheet.sheetName,
        rendererProfileHash: job.rendererProfileHash, rendererEngine: 'windows-excel-pdf',
        excelPrintArea: excelCoordinates.printArea,
        worksheetWidthPoints: excelCoordinates.printWidth, worksheetHeightPoints: excelCoordinates.printHeight,
        pageColumns: transformed.columns, pageRows: transformed.rows,
        pdfPageBox: { widthPoints: pdf.widthPoints, heightPoints: pdf.heightPoints },
        cropLeftPoints: excelCoordinates.cropLeftPoints, cropTopPoints: excelCoordinates.cropTopPoints,
        canvasWidthPoints: transformed.canvasWidthPoints, canvasHeightPoints: transformed.canvasHeightPoints,
        dpi: profile.dpi, renderedWidth: tiled.renderedWidth, renderedHeight: tiled.renderedHeight,
        coordinateScaleX: tiled.renderedWidth / transformed.canvasWidthPoints,
        coordinateScaleY: tiled.renderedHeight / transformed.canvasHeightPoints,
        tileSize: profile.tileSize, webpQuality: profile.webpQuality, maxLevel: tiled.maxLevel,
        tileCount: tiled.tileCount, coordinateCount: transformed.coordinates.length, coordinateHash, levels: tiled.levels,
      };
      const manifestJson = JSON.stringify(manifest);
      const manifestPath = path.join(artifactRoot, 'manifest.json');
      await writeFile(manifestPath, manifestJson, 'utf8');
      const checksumFiles = (await filesBelow(artifactRoot)).filter((file) => !file.endsWith('checksums.json'));
      const checksums: Record<string, string> = {};
      for (const file of checksumFiles) checksums[path.relative(artifactRoot, file).split(path.sep).join('/')] = await sha256File(file);
      await writeFile(path.join(artifactRoot, 'checksums.json'), JSON.stringify(checksums), 'utf8');
      await rm(excelCoordinatesPath, { force: true });
      await api(`/jobs/${jobId}/progress`, { status: 'PUBLISHING', progress: progressBase + 8, currentSheet: sheet.sheetName, currentStep: 'R2 immutable artifact 업로드 중' });
      const uploadedId = await uploadArtifact(jobId, sheet.sheetName, artifactSetId, artifactRoot, manifestPath);
      artifacts.push({
        artifactSetId, sheetName: sheet.sheetName,
        manifestSha256: createHash('sha256').update(manifestJson).digest('hex'),
        manifest, coordinates: transformed.coordinates,
      });
      await rm(artifactRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
    await api(`/jobs/${jobId}/progress`, { status: 'VERIFYING', progress: 95, currentStep: 'Manifest·타일·좌표 검증 요청 중' });
    await api(`/jobs/${jobId}/complete`, { artifacts });
    console.log(`[COMPLETED] ${job.filename} (${jobId})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAILED] ${job.filename} (${jobId})`, message);
    await api(`/jobs/${jobId}/fail`, { errorCode: 'RENDERER_AGENT_FAILED', errorMessage: message }).catch((reportError) => console.error('[FAIL_REPORT_FAILED]', reportError));
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
};

const session = await api<{ profile: Record<string, number>; rendererProfileHash: string }>('/session');
console.log(`[CATV] renderer=${rendererId} profile=${session.rendererProfileHash}`);
do {
  const claimed = await api<{ job: Record<string, unknown> | null }>('/jobs/claim');
  if (!claimed.job) {
    console.log('[CATV] 대기 작업이 없습니다.');
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    continue;
  }
  await processJob(claimed.job, session.profile);
} while (!once);
