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
import { sheetContentHashes } from './sheet-fingerprint';
export { sheetContentHashes } from './sheet-fingerprint';

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

if (process.env.CATV_RENDERER_LIBRARY_MODE !== '1') {
  if (process.platform !== 'win32') throw new Error('직선도 렌더러 Agent는 Microsoft Excel이 설치된 Windows 사용자 세션에서만 실행할 수 있습니다.');
  if (!apiBase || !/^https:\/\//i.test(apiBase) && !/^http:\/\/localhost(?::\d+)?$/i.test(apiBase)) throw new Error('CATV_RENDERER_API_URL에 HTTPS Render API 주소가 필요합니다.');
  if (deviceToken.length < 32) throw new Error('Windows Credential Manager 또는 보안 프롬프트로 renderer device token을 제공해주세요.');
}

sharp.cache({ memory: 192, files: 16, items: 64 });

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

export const mapLimit = async <T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

export const generateTiles = async (input: {
  pdfPath: string;
  outputRoot: string;
  pdf: Awaited<ReturnType<typeof inspectPdf>>;
  columns: number;
  rows: number;
  dpi: number;
  tileSize: number;
  quality: number;
  effort: number;
  concurrency: number;
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
  let pdfRasterMs = 0;
  let webpEncodeMs = 0;
  const encodeWebp = async (action: () => Promise<unknown>) => {
    const startedAt = Date.now();
    try { await action(); }
    finally { webpEncodeMs += Date.now() - startedAt; }
  };
  await mkdir(input.outputRoot, { recursive: true });
  const topRoot = path.join(input.outputRoot, String(maxLevel));
  await mkdir(topRoot, { recursive: true });
  const topColumns = Math.ceil(renderedWidth / input.tileSize);
  const topRows = Math.ceil(renderedHeight / input.tileSize);
  const pageWidth = Math.max(1, Math.round(input.pdf.widthPoints * input.dpi / 72));
  const pageHeight = Math.max(1, Math.round(input.pdf.heightPoints * input.dpi / 72));

  // Rasterize every PDF page exactly once at the target DPI.  Tiles are built
  // page-by-page so a multi-gigapixel worksheet is never assembled in memory.
  for (let pageIndex = 0; pageIndex < input.pdf.pages; pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const pageBase = path.join(path.dirname(input.outputRoot), `page-top-${pageNumber}`);
    const rasterStartedAt = Date.now();
    try {
      await execFileAsync('pdftoppm.exe', ['-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', '-r', String(input.dpi), '-png', input.pdfPath, pageBase], {
          windowsHide: true,
          timeout: 60 * 60_000,
          maxBuffer: 1024 * 1024,
      });
    } finally { pdfRasterMs += Date.now() - rasterStartedAt; }
    const pagePath = `${pageBase}.png`;
    const pageImage = sharp(pagePath, { limitInputPixels: false, sequentialRead: true }).resize(pageWidth, pageHeight, { fit: 'fill' });
    const pageColumn = pageIndex % input.columns;
    const pageRow = Math.floor(pageIndex / input.columns);
    const originX = pageColumn * pageWidth;
    const originY = pageRow * pageHeight;
    const firstColumn = Math.floor(originX / input.tileSize);
    const lastColumn = Math.min(topColumns - 1, Math.floor((originX + pageWidth - 1) / input.tileSize));
    const firstRow = Math.floor(originY / input.tileSize);
    const lastRow = Math.min(topRows - 1, Math.floor((originY + pageHeight - 1) / input.tileSize));
    const tasks: Array<{ row: number; column: number }> = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) tasks.push({ row, column });
    }
    await mapLimit(tasks, input.concurrency, async ({ row, column }) => {
          const tileLeft = column * input.tileSize;
          const tileTop = row * input.tileSize;
          const tileWidth = Math.min(input.tileSize, renderedWidth - tileLeft);
          const tileHeight = Math.min(input.tileSize, renderedHeight - tileTop);
          const sourceLeft = Math.max(0, tileLeft - originX);
          const sourceTop = Math.max(0, tileTop - originY);
          const pieceLeft = Math.max(0, originX - tileLeft);
          const pieceTop = Math.max(0, originY - tileTop);
          const pieceWidth = Math.min(pageWidth - sourceLeft, tileWidth - pieceLeft);
          const pieceHeight = Math.min(pageHeight - sourceTop, tileHeight - pieceTop);
          if (pieceWidth <= 0 || pieceHeight <= 0) return;
          const piece = await pageImage.clone().extract({ left: sourceLeft, top: sourceTop, width: pieceWidth, height: pieceHeight }).png().toBuffer();
          const tilePath = path.join(topRoot, `${column}_${row}.webp`);
          let canvas = sharp({ create: { width: tileWidth, height: tileHeight, channels: 3, background: '#ffffff' } });
          try {
            const existingTile = await readFile(tilePath);
            canvas = sharp(existingTile).flatten({ background: '#ffffff' });
          } catch { /* first page touching this tile */ }
          await encodeWebp(() => canvas.composite([{ input: piece, left: pieceLeft, top: pieceTop }])
            .webp({ quality: input.quality, effort: input.effort }).toFile(`${tilePath}.next`));
          canvas.destroy();
          await rm(tilePath, { force: true });
          await (await import('node:fs/promises')).rename(`${tilePath}.next`, tilePath);
    });
    pageImage.destroy();
    await rm(pagePath, { force: true });
  }

  const topTasks = Array.from({ length: topRows * topColumns }, (_, index) => ({
    row: Math.floor(index / topColumns), column: index % topColumns,
  }));
  await mapLimit(topTasks, input.concurrency, async ({ row, column }) => {
        const tilePath = path.join(topRoot, `${column}_${row}.webp`);
        try { await stat(tilePath); }
        catch {
          const width = Math.min(input.tileSize, renderedWidth - column * input.tileSize);
          const height = Math.min(input.tileSize, renderedHeight - row * input.tileSize);
          await encodeWebp(() => sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
            .webp({ quality: input.quality, effort: input.effort }).toFile(tilePath));
        }
  });
  levels.push({ level: maxLevel, columns: topColumns, rows: topRows, tileCount: topColumns * topRows });
  completedTiles += topColumns * topRows;
  await input.onProgress?.(completedTiles / expectedTileTotal, maxLevel, maxLevel);

  // Build each parent from at most four child tiles. Memory is bounded by a
  // 2*tileSize square regardless of worksheet dimensions.
  for (let level = maxLevel - 1; level >= 0; level -= 1) {
    const divisor = 2 ** (maxLevel - level);
    const levelWidth = Math.ceil(renderedWidth / divisor);
    const levelHeight = Math.ceil(renderedHeight / divisor);
    const childWidth = Math.ceil(renderedWidth / (divisor / 2));
    const childHeight = Math.ceil(renderedHeight / (divisor / 2));
    const levelColumns = Math.ceil(levelWidth / input.tileSize);
    const levelRows = Math.ceil(levelHeight / input.tileSize);
    const levelRoot = path.join(input.outputRoot, String(level));
    const childRoot = path.join(input.outputRoot, String(level + 1));
    await mkdir(levelRoot, { recursive: true });
    const tasks = Array.from({ length: levelRows * levelColumns }, (_, index) => ({
      row: Math.floor(index / levelColumns), column: index % levelColumns,
    }));
    await mapLimit(tasks, input.concurrency, async ({ row, column }) => {
      const childOriginX = column * input.tileSize * 2;
      const childOriginY = row * input.tileSize * 2;
      const sourceWidth = Math.min(input.tileSize * 2, childWidth - childOriginX);
      const sourceHeight = Math.min(input.tileSize * 2, childHeight - childOriginY);
      const composites: Array<{ input: Buffer; left: number; top: number }> = [];
      for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
        const childColumn = column * 2 + dx;
        const childRow = row * 2 + dy;
        const childPath = path.join(childRoot, `${childColumn}_${childRow}.webp`);
        try {
          const left = dx * input.tileSize;
          const top = dy * input.tileSize;
          if (left >= sourceWidth || top >= sourceHeight) continue;
          const child = await readFile(childPath);
          const metadata = await sharp(child).metadata();
          const cropWidth = Math.min(metadata.width || input.tileSize, sourceWidth - left);
          const cropHeight = Math.min(metadata.height || input.tileSize, sourceHeight - top);
          const cropped = cropWidth === metadata.width && cropHeight === metadata.height
            ? child
            : await sharp(child).extract({ left: 0, top: 0, width: cropWidth, height: cropHeight }).toBuffer();
          composites.push({ input: cropped, left, top });
        } catch { /* an odd edge can have fewer than four children */ }
      }
      const width = Math.min(input.tileSize, levelWidth - column * input.tileSize);
      const height = Math.min(input.tileSize, levelHeight - row * input.tileSize);
      const parentSource = await sharp({ create: { width: sourceWidth, height: sourceHeight, channels: 3, background: '#ffffff' } })
        .composite(composites).png().toBuffer();
      await encodeWebp(() => sharp(parentSource).resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
        .webp({ quality: input.quality, effort: input.effort })
        .toFile(path.join(levelRoot, `${column}_${row}.webp`)));
    });
    levels.push({ level, columns: levelColumns, rows: levelRows, tileCount: levelColumns * levelRows });
    completedTiles += levelColumns * levelRows;
    await input.onProgress?.(completedTiles / expectedTileTotal, level, maxLevel);
  }
  levels.sort((left, right) => left.level - right.level);
  return {
    renderedWidth, renderedHeight, maxLevel, levels,
    tileCount: levels.reduce((sum, level) => sum + level.tileCount, 0),
    pdfRasterMs, webpEncodeMs,
  };
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

type ArtifactFile = { filePath: string; relativeKey: string; size: number; contentType: string; sha256: string };
export const retryUpload = async (label: string, action: () => Promise<Response>, onRetry?: () => void) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await action();
      if (response.ok) return;
      lastError = new Error(`${label} (${response.status})`);
    } catch (error) { lastError = error; }
    if (attempt < 3) {
      onRetry?.();
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} 업로드 실패`);
};

const uploadArtifact = async (jobId: string, sheetName: string, artifactSetId: string, files: ArtifactFile[], manifestPath: string, concurrency: number, onRetry?: () => void) => {
  const manifestAbsolute = path.resolve(manifestPath);
  const manifestFile = files.find((file) => path.resolve(file.filePath) === manifestAbsolute);
  if (!manifestFile) throw new Error('업로드할 manifest.json을 찾을 수 없습니다.');
  const uploadBatch = async (batch: ArtifactFile[]) => {
    const prepared = await api<{
      artifactSetId: string;
      uploads: Array<{ relativeKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>;
    }>(`/jobs/${jobId}/artifacts/upload-urls`, { sheetName, artifactSetId, files: batch.map(({ filePath: _filePath, ...file }) => file) });
    if (prepared.artifactSetId !== artifactSetId) throw new Error('서버가 다른 artifact set ID를 반환했습니다.');
    await mapLimit(prepared.uploads, concurrency, async (upload) => {
      const file = batch.find((candidate) => candidate.relativeKey === upload.relativeKey);
      if (!file) throw new Error(`업로드 파일을 찾을 수 없습니다: ${upload.relativeKey}`);
      const resource = rendererResource(upload.uploadUrl);
      await retryUpload(`artifact ${upload.relativeKey}`, async () => fetch(resource.url, {
        method: 'PUT', headers: { ...upload.requiredHeaders, ...resource.headers },
        body: await openAsBlob(file.filePath, { type: file.contentType }),
      }), onRetry);
    });
  };
  const ordinary = files.filter((file) => path.resolve(file.filePath) !== manifestAbsolute);
  for (let start = 0; start < ordinary.length; start += 200) {
    await uploadBatch(ordinary.slice(start, start + 200));
  }
  // This separate request is intentional: verification requires manifest.json
  // to be newer than every other immutable artifact.
  await uploadBatch([manifestFile]);
  return artifactSetId;
};

const processJob = async (job: Record<string, unknown>, profile: Record<string, number>) => {
  const jobId = String(job.id);
  const temporaryRoot = path.join(os.tmpdir(), `catv-straight-map-${jobId}`);
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await mkdir(temporaryRoot, { recursive: true });
  let heartbeat: NodeJS.Timeout | undefined;
  const jobStartedAt = Date.now();
  const stageMetrics: Record<string, number> = {};
  let totalTileCount = 0;
  let totalArtifactBytes = 0;
  let uploadRetryCount = 0;
  const measure = async <T>(name: string, action: () => Promise<T>) => {
    const startedAt = Date.now();
    try { return await action(); }
    finally { stageMetrics[name] = (stageMetrics[name] || 0) + Date.now() - startedAt; }
  };
  try {
    sharp.concurrency(Math.max(1, Math.min(4, Math.round(profile.tileConcurrency || 2))));
    heartbeat = setInterval(() => void api(`/jobs/${jobId}/heartbeat`).catch((error) => console.error('[HEARTBEAT_FAILED]', error)), 30_000);
    await api(`/jobs/${jobId}/progress`, { status: 'DOWNLOADING', progress: 1, currentStep: '직선도 원본 다운로드 중' });
    const xlsxPath = path.join(temporaryRoot, 'source.xlsx');
    let source = await api<{ downloadUrl: string }>(`/jobs/${jobId}/source-url`);
    try {
      await measure('downloadMs', () => downloadFile(source.downloadUrl, xlsxPath, String(job.sourceSha256)));
    } catch (error) {
      if (!usesProductionApi || !(error instanceof Error) || !/\(404\)/.test(error.message)) throw error;
      await repairMissingProductionSource(jobId, job);
      source = await api<{ downloadUrl: string }>(`/jobs/${jobId}/source-url`);
      await measure('downloadMs', () => downloadFile(source.downloadUrl, xlsxPath, String(job.sourceSha256)));
    }
    await api(`/jobs/${jobId}/progress`, { status: 'ANALYZING', progress: 3, currentStep: 'Excel 통합 문서 분석 중', metrics: stageMetrics });
    const analysisPath = path.join(temporaryRoot, 'workbook.json');
    await powershell(path.join(projectRoot, 'scripts', 'inspect-excel-workbook.ps1'), ['-InputXlsx', xlsxPath, '-OutputJson', analysisPath]);
    const analysis = await jsonFile<ExcelAnalysis>(analysisPath);
    const sheetNames = analysis.sheets.filter((sheet) => sheet.visible && !sheet.empty && !sheet.name.includes('선번장')).map((sheet) => sheet.name);
    if (!sheetNames.length) throw new Error('표시 가능한 직선도 시트를 찾지 못했습니다. 숨김·빈 시트 및 선번장 시트는 제외됩니다.');
    const sheetHashes = await measure('sheetHashMs', () => sheetContentHashes(xlsxPath, sheetNames));
    const registered = await api<{ sheets: Array<{ sheetName: string; status: string; artifactSetId: string | null; checkpointJson?: string | null }> }>(`/jobs/${jobId}/sheets`, { sheetNames, sheetHashes });
    const artifacts: Array<Record<string, unknown>> = [];
    const renderPlan = [] as Array<{ sheetName: string; outputPdf: string; outputCoordinates: string }>;
    for (let index = 0; index < registered.sheets.length; index += 1) {
      const sheet = registered.sheets[index];
      if (sheet.status === 'CACHE_HIT') continue;
      if (sheet.status === 'CHECKPOINT' && sheet.checkpointJson) {
        artifacts.push(JSON.parse(sheet.checkpointJson) as Record<string, unknown>);
        continue;
      }
      const artifactRoot = path.join(temporaryRoot, `artifact-${index}`);
      await mkdir(artifactRoot, { recursive: true });
      renderPlan.push({
        sheetName: sheet.sheetName,
        outputPdf: path.join(artifactRoot, 'map.pdf'),
        outputCoordinates: path.join(artifactRoot, 'excel-coordinates.json'),
      });
    }
    if (renderPlan.length) {
      const renderPlanPath = path.join(temporaryRoot, 'render-plan.json');
      const excelMetricsPath = path.join(temporaryRoot, 'excel-metrics.json');
      await writeFile(renderPlanPath, JSON.stringify(renderPlan), 'utf8');
      await api(`/jobs/${jobId}/progress`, { status: 'EXCEL_RENDERING', progress: 5, currentStep: 'Excel 단일 세션 PDF 일괄 생성 중' });
      await measure('excelRenderMs', () => powershell(path.join(projectRoot, 'scripts', 'render-excel-workbook.ps1'), [
        '-InputXlsx', xlsxPath, '-PlanJson', renderPlanPath, '-MetricsJson', excelMetricsPath,
      ]));
      const excelMetrics = await jsonFile<{ excelStartMs: number; workbookOpenMs: number; pdfMs: number; sheets: Record<string, { pdfMs: number }> }>(excelMetricsPath);
      stageMetrics.excelStartMs = excelMetrics.excelStartMs;
      stageMetrics.workbookOpenMs = excelMetrics.workbookOpenMs;
      stageMetrics.pdfGenerationMs = excelMetrics.pdfMs;
      for (const [sheetName, sheetMetrics] of Object.entries(excelMetrics.sheets || {})) {
        stageMetrics[`sheetPdfMs:${sheetName}`] = sheetMetrics.pdfMs;
      }
    }
    for (let index = 0; index < registered.sheets.length; index += 1) {
      const sheet = registered.sheets[index];
      if (sheet.status === 'CACHE_HIT' || sheet.status === 'CHECKPOINT') continue;
      const progressBase = 5 + index / registered.sheets.length * 85;
      await api(`/jobs/${jobId}/progress`, { status: 'EXCEL_RENDERING', progress: progressBase, currentSheet: sheet.sheetName, currentStep: 'Excel PDF 생성 중' });
      const artifactRoot = path.join(temporaryRoot, `artifact-${index}`);
      const pdfPath = path.join(artifactRoot, 'map.pdf');
      const excelCoordinatesPath = path.join(artifactRoot, 'excel-coordinates.json');
      const excelCoordinates = await jsonFile<ExcelCoordinates>(excelCoordinatesPath);
      const pdf = await inspectPdf(pdfPath);
      const transformed = normalizedCoordinates(excelCoordinates, pdf);
      await api(`/jobs/${jobId}/progress`, { status: 'TILE_GENERATING', progress: progressBase + 2, currentSheet: sheet.sheetName, currentStep: 'PDF 페이지 기반 Deep Zoom 타일 생성 중' });
      const tiled = await measure('tileGenerationMs', () => generateTiles({
        pdfPath, outputRoot: path.join(artifactRoot, 'tiles'), pdf,
        columns: transformed.columns, rows: transformed.rows,
        dpi: profile.dpi, tileSize: profile.tileSize, quality: profile.webpQuality,
        effort: profile.webpEffort || 2, concurrency: profile.tileConcurrency || 2,
        onProgress: async (fraction, level, maxLevel) => {
          await api(`/jobs/${jobId}/progress`, {
            status: 'TILE_GENERATING', progress: progressBase + 2 + fraction * 5,
            currentSheet: sheet.sheetName, currentStep: `Deep Zoom level ${level}/${maxLevel} 생성 완료`,
          });
        },
      }));
      stageMetrics.pdfRasterMs = (stageMetrics.pdfRasterMs || 0) + tiled.pdfRasterMs;
      stageMetrics.webpEncodeMs = (stageMetrics.webpEncodeMs || 0) + tiled.webpEncodeMs;
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
        tileSize: profile.tileSize, webpQuality: profile.webpQuality, webpEffort: profile.webpEffort || 2, maxLevel: tiled.maxLevel,
        tileCount: tiled.tileCount, coordinateCount: transformed.coordinates.length, coordinateHash, levels: tiled.levels,
      };
      const manifestJson = JSON.stringify(manifest);
      const manifestPath = path.join(artifactRoot, 'manifest.json');
      await writeFile(manifestPath, manifestJson, 'utf8');
      await rm(excelCoordinatesPath, { force: true });
      const artifactFiles = await measure('checksumMs', async () => {
        const paths = (await filesBelow(artifactRoot)).filter((file) => !file.endsWith('checksums.json'));
        const descriptors = await mapLimit(paths, Math.max(1, Math.min(4, profile.tileConcurrency || 2)), async (filePath) => ({
          filePath,
          relativeKey: path.relative(artifactRoot, filePath).split(path.sep).join('/'),
          size: (await stat(filePath)).size,
          contentType: contentType(filePath),
          sha256: await sha256File(filePath),
        }));
        const checksums = Object.fromEntries(descriptors.map((file) => [file.relativeKey, file.sha256]));
        const checksumPath = path.join(artifactRoot, 'checksums.json');
        await writeFile(checksumPath, JSON.stringify(checksums), 'utf8');
        descriptors.push({
          filePath: checksumPath,
          relativeKey: 'checksums.json',
          size: (await stat(checksumPath)).size,
          contentType: 'application/json',
          sha256: await sha256File(checksumPath),
        });
        return descriptors;
      });
      const artifactBytes = artifactFiles.reduce((sum, file) => sum + file.size, 0);
      totalTileCount += tiled.tileCount;
      totalArtifactBytes += artifactBytes;
      await api(`/jobs/${jobId}/progress`, {
        status: 'PUBLISHING', progress: progressBase + 8, currentSheet: sheet.sheetName,
        currentStep: 'R2 immutable artifact 업로드 중', metrics: stageMetrics,
        tileCount: totalTileCount, artifactBytes: totalArtifactBytes,
      });
      await measure('uploadMs', () => uploadArtifact(
        jobId, sheet.sheetName, artifactSetId, artifactFiles, manifestPath, profile.uploadConcurrency || 6,
        () => { uploadRetryCount += 1; stageMetrics.uploadRetryCount = uploadRetryCount; },
      ));
      const completedArtifact = {
        artifactSetId, sheetName: sheet.sheetName,
        manifestSha256: createHash('sha256').update(manifestJson).digest('hex'),
        manifest, coordinates: transformed.coordinates,
      };
      await api(`/jobs/${jobId}/sheets/checkpoint`, { artifact: completedArtifact });
      artifacts.push(completedArtifact);
      await rm(artifactRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
    await api(`/jobs/${jobId}/progress`, { status: 'VERIFYING', progress: 95, currentStep: 'Manifest·타일·좌표 검증 요청 중', metrics: stageMetrics });
    await api(`/jobs/${jobId}/complete`, { artifacts });
    stageMetrics.totalMs = Date.now() - jobStartedAt;
    console.log(`[COMPLETED] ${job.filename} (${jobId}) metrics=${JSON.stringify(stageMetrics)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAILED] ${job.filename} (${jobId})`, message);
    await api(`/jobs/${jobId}/fail`, { errorCode: 'RENDERER_AGENT_FAILED', errorMessage: message }).catch((reportError) => console.error('[FAIL_REPORT_FAILED]', reportError));
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
};

if (process.env.CATV_RENDERER_LIBRARY_MODE !== '1') {
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
}
