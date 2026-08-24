import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, openAsBlob, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { promisify } from 'node:util';
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

type Envelope<T> = { success: true; data: T } | { success: false; message: string; code?: string };
const api = async <T>(endpoint: string, body: Record<string, unknown> = {}) => {
  const response = await fetch(`${apiBase}/api/renderer${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rendererId, ...body }),
  });
  const responseText = await response.text();
  let payload: Envelope<T>;
  try { payload = JSON.parse(responseText) as Envelope<T>; }
  catch {
    throw new Error(`Renderer API가 JSON이 아닌 응답을 반환했습니다 (${response.status}, ${endpoint}). 잠시 후 재시도합니다.`);
  }
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
    || path.join(projectRoot, 'backend', 'data', 'straight-maps', 'v3', 'sources'));
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
  schemaVersion?: number;
  printArea: string;
  printScale?: number;
  pageOrder?: number;
  printLeft?: number;
  printTop?: number;
  printWidth: number;
  printHeight: number;
  verticalStarts?: number[];
  horizontalStarts?: number[];
  cropLeftPoints?: number;
  cropTopPoints?: number;
  calibration?: Array<{ label: string; x: number; y: number }>;
  coordinates: Array<{ shapeId: string; label: string; left: number; top: number; width: number; height: number }>;
};

const jsonFile = async <T>(filePath: string) => JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')) as T;

type PdfInfo = { pages: number; widthPoints: number; heightPoints: number;
  pageBoxes?: Array<{ pageIndex: number; widthPoints: number; heightPoints: number }>;
  textAnchors?: Array<{ label: string; pageIndex: number; xPoints: number; yPoints: number }> };
const inspectPdf = async (pdfPath: string): Promise<PdfInfo> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await readFile(pdfPath)) });
  const document = await loadingTask.promise;
  const pageBoxes: Array<{ pageIndex: number; widthPoints: number; heightPoints: number }> = [];
  const textAnchors: Array<{ label: string; pageIndex: number; xPoints: number; yPoints: number }> = [];
  try {
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      pageBoxes.push({ pageIndex, widthPoints: viewport.width, heightPoints: viewport.height });
      const text = await page.getTextContent();
      for (const item of text.items) {
        if (!('str' in item) || !item.str.startsWith('__CATV_CAL_')) continue;
        const [x, baselineY] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        textAnchors.push({ label: item.str, pageIndex, xPoints: x + item.width / 2, yPoints: baselineY - item.height / 2 });
      }
      page.cleanup();
    }
  } finally { await loadingTask.destroy(); }
  if (!pageBoxes.length) throw new Error('생성된 PDF에 페이지가 없습니다.');
  return { pages: pageBoxes.length, widthPoints: pageBoxes[0].widthPoints, heightPoints: pageBoxes[0].heightPoints, pageBoxes, textAnchors };
};

const findPageIndex = (starts: number[], value: number) => {
  for (let index = starts.length - 1; index >= 0; index -= 1) if (value >= starts[index]) return index;
  return 0;
};
const clampIndex = (value: number, length: number) => Math.min(length - 1, Math.max(0, value));

export const inferPdfPageGrid = (excel: ExcelCoordinates, pdf: Awaited<ReturnType<typeof inspectPdf>>) => {
  const scaledWidth = Math.max(1, excel.printWidth);
  const scaledHeight = Math.max(1, excel.printHeight);
  const estimatedColumns = Math.max(1, Math.ceil((scaledWidth - 0.01) / pdf.widthPoints));
  const estimatedRows = Math.max(1, Math.ceil((scaledHeight - 0.01) / pdf.heightPoints));
  if (estimatedColumns * estimatedRows === pdf.pages) return { columns: estimatedColumns, rows: estimatedRows };

  // Excel does not reliably expose automatic page breaks through COM after
  // ResetAllPageBreaks. Infer the exact factor pair from the exported PDF and
  // choose the grid whose stitched aspect ratio best matches the print area.
  const targetAspect = scaledWidth / scaledHeight;
  let best = { columns: 1, rows: pdf.pages, score: Number.POSITIVE_INFINITY };
  for (let columns = 1; columns <= pdf.pages; columns += 1) {
    if (pdf.pages % columns !== 0) continue;
    const rows = pdf.pages / columns;
    const stitchedAspect = pdf.widthPoints * columns / (pdf.heightPoints * rows);
    const score = Math.abs(Math.log(stitchedAspect / targetAspect));
    if (score < best.score) best = { columns, rows, score };
  }
  return { columns: best.columns, rows: best.rows };
};

export const normalizedCoordinates = (excel: ExcelCoordinates, pdf: Awaited<ReturnType<typeof inspectPdf>>) => {
  if (excel.schemaVersion !== 3) {
    const { columns, rows } = inferPdfPageGrid(excel, pdf);
    const scale = excel.printScale || 1;
    const verticalStarts = excel.verticalStarts?.length === columns ? excel.verticalStarts : Array.from({ length: columns }, (_, index) => index * pdf.widthPoints / scale);
    const horizontalStarts = excel.horizontalStarts?.length === rows ? excel.horizontalStarts : Array.from({ length: rows }, (_, index) => index * pdf.heightPoints / scale);
    const canvasWidthPoints = pdf.widthPoints * columns;
    const canvasHeightPoints = pdf.heightPoints * rows;
    const coordinates = excel.coordinates.map((item) => {
      const centerX = item.left + item.width / 2;
      const centerY = item.top + item.height / 2;
      const column = findPageIndex(verticalStarts, centerX);
      const row = findPageIndex(horizontalStarts, centerY);
      const worldXPoints = column * pdf.widthPoints + (centerX - verticalStarts[column]) * scale - (excel.cropLeftPoints || 0);
      const worldYPoints = row * pdf.heightPoints + (centerY - horizontalStarts[row]) * scale - (excel.cropTopPoints || 0);
      return { shapeId: item.shapeId, label: item.label, pageIndex: row * columns + column,
        pageXPoints: worldXPoints - column * pdf.widthPoints, pageYPoints: worldYPoints - row * pdf.heightPoints,
        worldXPoints, worldYPoints, xRatio: Math.min(1, Math.max(0, worldXPoints / canvasWidthPoints)),
        yRatio: Math.min(1, Math.max(0, worldYPoints / canvasHeightPoints)), widthPoints: item.width * scale, heightPoints: item.height * scale };
    });
    const pagePlacements = Array.from({ length: pdf.pages }, (_, pageIndex) => ({ pageIndex,
      xPoints: pageIndex % columns * pdf.widthPoints, yPoints: Math.floor(pageIndex / columns) * pdf.heightPoints,
      widthPoints: pdf.widthPoints, heightPoints: pdf.heightPoints }));
    return { coordinates, columns, rows, canvasWidthPoints, canvasHeightPoints, pagePlacements,
      contentBounds: { xPoints: 0, yPoints: 0, widthPoints: canvasWidthPoints, heightPoints: canvasHeightPoints }, printScale: scale };
  }
  const grid = pdf.pages === 1 ? { columns: 1, rows: 1 } : inferPdfPageGrid(excel, pdf);
  const { columns, rows } = grid;
  const pageBoxes = pdf.pageBoxes || Array.from({ length: pdf.pages }, (_, pageIndex) => ({ pageIndex, widthPoints: pdf.widthPoints, heightPoints: pdf.heightPoints }));
  const pagePlacements = pageBoxes.map((box, pageIndex) => {
    const column = excel.pageOrder === 1 ? Math.floor(pageIndex / rows) : pageIndex % columns;
    const row = excel.pageOrder === 1 ? pageIndex % rows : Math.floor(pageIndex / columns);
    return { pageIndex, xPoints: column * pdf.widthPoints, yPoints: row * pdf.heightPoints,
      widthPoints: box.widthPoints, heightPoints: box.heightPoints };
  });
  const canvasWidthPoints = Math.max(...pagePlacements.map((page) => page.xPoints + page.widthPoints));
  const canvasHeightPoints = Math.max(...pagePlacements.map((page) => page.yPoints + page.heightPoints));
  const fallbackScale = Math.min(canvasWidthPoints / excel.printWidth, canvasHeightPoints / excel.printHeight);
  const fallbackScaleX = fallbackScale;
  const fallbackScaleY = fallbackScale;
  const sourceA = excel.calibration?.find((item) => item.label === '__CATV_CAL_A__');
  const sourceB = excel.calibration?.find((item) => item.label === '__CATV_CAL_B__');
  const pdfA = pdf.textAnchors?.find((item) => item.label === '__CATV_CAL_A__');
  const pdfB = pdf.textAnchors?.find((item) => item.label === '__CATV_CAL_B__');
  const pdfAPlacement = pdfA ? pagePlacements[pdfA.pageIndex] : undefined;
  const pdfBPlacement = pdfB ? pagePlacements[pdfB.pageIndex] : undefined;
  const pdfAWorld = pdfA && pdfAPlacement ? { x: pdfAPlacement.xPoints + pdfA.xPoints, y: pdfAPlacement.yPoints + pdfA.yPoints } : undefined;
  const pdfBWorld = pdfB && pdfBPlacement ? { x: pdfBPlacement.xPoints + pdfB.xPoints, y: pdfBPlacement.yPoints + pdfB.yPoints } : undefined;
  const validCalibration = sourceA && sourceB && pdfAWorld && pdfBWorld
    && Math.abs(sourceB.x - sourceA.x) > 1 && Math.abs(sourceB.y - sourceA.y) > 1;
  const scaleX = validCalibration ? (pdfBWorld.x - pdfAWorld.x) / (sourceB.x - sourceA.x) : fallbackScaleX;
  const scaleY = validCalibration ? (pdfBWorld.y - pdfAWorld.y) / (sourceB.y - sourceA.y) : fallbackScaleY;
  const contentX = validCalibration ? pdfAWorld.x - (sourceA.x - (excel.printLeft || 0)) * scaleX : 0;
  const contentY = validCalibration ? pdfAWorld.y - (sourceA.y - (excel.printTop || 0)) * scaleY : 0;
  const contentWidthPoints = excel.printWidth * scaleX;
  const contentHeightPoints = excel.printHeight * scaleY;
  const contentBounds = { xPoints: contentX, yPoints: contentY, widthPoints: contentWidthPoints, heightPoints: contentHeightPoints };
  const coordinates = excel.coordinates.map((item) => {
    const centerX = item.left + item.width / 2;
    const centerY = item.top + item.height / 2;
    const xPoints = contentX + (centerX - (excel.printLeft || 0)) * scaleX;
    const yPoints = contentY + (centerY - (excel.printTop || 0)) * scaleY;
    const column = clampIndex(Math.floor(xPoints / pdf.widthPoints), columns);
    const row = clampIndex(Math.floor(yPoints / pdf.heightPoints), rows);
    const pageIndex = excel.pageOrder === 1 ? column * rows + row : row * columns + column;
    const placement = pagePlacements[Math.min(pagePlacements.length - 1, pageIndex)];
    return {
      shapeId: item.shapeId,
      label: item.label,
      pageIndex: placement.pageIndex,
      pageXPoints: xPoints - placement.xPoints,
      pageYPoints: yPoints - placement.yPoints,
      worldXPoints: xPoints,
      worldYPoints: yPoints,
      xRatio: Math.min(1, Math.max(0, xPoints / canvasWidthPoints)),
      yRatio: Math.min(1, Math.max(0, yPoints / canvasHeightPoints)),
      widthPoints: item.width * scaleX,
      heightPoints: item.height * scaleY,
    };
  });
  return { coordinates, columns, rows, canvasWidthPoints, canvasHeightPoints, pagePlacements, contentBounds,
    printScale: (scaleX + scaleY) / 2, calibrationMode: validCalibration ? 'pdf-text-anchors' : 'page-fit-fallback' };
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

const contentType = (relative: string) => relative.endsWith('.pdf') ? 'application/pdf' : 'application/json';

type ArtifactFile = { filePath: string; relativeKey: string; size: number; contentType: string; sha256: string };
class UploadHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export const retryUpload = async (label: string, action: () => Promise<Response>, onRetry?: () => void) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await action();
      if (response.ok) return;
      const details = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240);
      lastError = new UploadHttpError(response.status, `${label} (${response.status})${details ? `: ${details}` : ''}`);
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
      uploads: Array<{
        relativeKey: string;
        uploadUrl: string;
        requiredHeaders: Record<string, string>;
        fallbackUploadUrl?: string;
        fallbackRequiredHeaders?: Record<string, string>;
      }>;
    }>(`/jobs/${jobId}/artifacts/upload-urls`, { sheetName, artifactSetId, files: batch.map(({ filePath: _filePath, ...file }) => file) });
    if (prepared.artifactSetId !== artifactSetId) throw new Error('서버가 다른 artifact set ID를 반환했습니다.');
    await mapLimit(prepared.uploads, concurrency, async (upload) => {
      const file = batch.find((candidate) => candidate.relativeKey === upload.relativeKey);
      if (!file) throw new Error(`업로드 파일을 찾을 수 없습니다: ${upload.relativeKey}`);
      const resource = rendererResource(upload.uploadUrl);
      try {
        await retryUpload(`artifact ${upload.relativeKey}`, async () => fetch(resource.url, {
          method: 'PUT', headers: { ...upload.requiredHeaders, ...resource.headers },
          body: await openAsBlob(file.filePath, { type: file.contentType }),
        }), onRetry);
      } catch (error) {
        if (!(error instanceof UploadHttpError) || ![401, 403].includes(error.status) || !upload.fallbackUploadUrl) throw error;
        console.warn(`[R2_DIRECT_FALLBACK] ${upload.relativeKey}: ${error.message}`);
        const fallback = rendererResource(upload.fallbackUploadUrl);
        await retryUpload(`artifact API fallback ${upload.relativeKey}`, async () => fetch(fallback.url, {
          method: 'PUT', headers: { ...(upload.fallbackRequiredHeaders || {}), ...fallback.headers },
          body: await openAsBlob(file.filePath, { type: 'application/octet-stream' }),
        }), onRetry);
      }
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
  let totalArtifactBytes = 0;
  let uploadRetryCount = 0;
  const measure = async <T>(name: string, action: () => Promise<T>) => {
    const startedAt = Date.now();
    try { return await action(); }
    finally { stageMetrics[name] = (stageMetrics[name] || 0) + Date.now() - startedAt; }
  };
  try {
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
      await api(`/jobs/${jobId}/progress`, { status: 'PUBLISHING', progress: progressBase + 4, currentSheet: sheet.sheetName, currentStep: '벡터 PDF·좌표 metadata 준비 중' });
      const coordinateJson = JSON.stringify(transformed.coordinates);
      const coordinateHash = createHash('sha256').update(coordinateJson).digest('hex');
      const coordinatesPath = path.join(artifactRoot, 'coordinates.json');
      await writeFile(coordinatesPath, coordinateJson, 'utf8');
      const artifactSetId = sheet.artifactSetId || randomUUID();
      const pdfSha256 = await sha256File(pdfPath);
      const manifest = {
        schemaVersion: 3, complete: true, renderMode: 'pdf-viewport-v3', jobId, artifactSetId,
        sourceSha256: job.sourceSha256, sheetName: sheet.sheetName,
        rendererProfileHash: job.rendererProfileHash, rendererEngine: 'windows-excel-pdf',
        filename: job.filename, hasExternalLinks: analysis.hasExternalLinks,
        excelPrintArea: excelCoordinates.printArea,
        worksheetWidthPoints: excelCoordinates.printWidth, worksheetHeightPoints: excelCoordinates.printHeight,
        pageCount: pdf.pages, pagePlacements: transformed.pagePlacements,
        contentBounds: transformed.contentBounds,
        coordinateCalibration: transformed.calibrationMode,
        worldWidthPoints: transformed.canvasWidthPoints, worldHeightPoints: transformed.canvasHeightPoints,
        coordinateSystem: { unit: 'pdf-point', origin: 'top-left', pointsPerInch: 72 },
        coordinateCount: transformed.coordinates.length, coordinateHash,
        files: {
          'map.pdf': { sha256: pdfSha256, size: (await stat(pdfPath)).size, contentType: 'application/pdf' },
          'coordinates.json': { sha256: coordinateHash, size: (await stat(coordinatesPath)).size, contentType: 'application/json' },
        },
      };
      const manifestJson = JSON.stringify(manifest);
      const manifestPath = path.join(artifactRoot, 'manifest.json');
      await writeFile(manifestPath, manifestJson, 'utf8');
      await rm(excelCoordinatesPath, { force: true });
      const artifactFiles = await measure('checksumMs', async () => Promise.all(
        [pdfPath, coordinatesPath, manifestPath].map(async (filePath) => ({
          filePath,
          relativeKey: path.relative(artifactRoot, filePath).split(path.sep).join('/'),
          size: (await stat(filePath)).size,
          contentType: contentType(filePath),
          sha256: await sha256File(filePath),
        })),
      ));
      const artifactBytes = artifactFiles.reduce((sum, file) => sum + file.size, 0);
      totalArtifactBytes += artifactBytes;
      await api(`/jobs/${jobId}/progress`, {
        status: 'PUBLISHING', progress: progressBase + 8, currentSheet: sheet.sheetName,
        currentStep: 'R2 PDF v3 산출물 3개 업로드 중', metrics: stageMetrics,
        artifactBytes: totalArtifactBytes,
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
    await api(`/jobs/${jobId}/progress`, { status: 'VERIFYING', progress: 95, currentStep: 'Manifest·PDF·좌표 검증 요청 중', metrics: stageMetrics });
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
    try {
      const claimed = await api<{ job: Record<string, unknown> | null }>('/jobs/claim');
      if (!claimed.job) {
        console.log('[CATV] 대기 작업이 없습니다.');
        if (once) break;
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        continue;
      }
      await processJob(claimed.job, session.profile);
    } catch (error) {
      console.error('[CLAIM_RETRY]', error instanceof Error ? error.message : String(error));
      if (once) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  } while (!once);
}
