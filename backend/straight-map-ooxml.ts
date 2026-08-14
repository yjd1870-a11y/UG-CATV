import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const EMU_PER_PIXEL = 9525;
const DEFAULT_COLUMN_EMU = 64 * EMU_PER_PIXEL;
const DEFAULT_ROW_EMU = 20 * EMU_PER_PIXEL;

// Stored with every rendered map version. Bump this whenever the portable
// renderer output changes in a way that requires existing tiles to be rebuilt.
export const STRAIGHT_MAP_RENDERER_REVISION = 'drawingml-v2';

type XmlNode = Record<string, any>;

export type StraightMapObject = {
  shapeId: string;
  shapeName: string;
  objectType: string;
  originalText: string;
  normalizedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  xRatio: number;
  yRatio: number;
  groupId: string | null;
  rotation: number;
  shapeHash: string;
};

export type StraightMapDrawingPrimitive = {
  shapeId: string;
  kind: 'shape' | 'connector' | 'picture' | 'graphic';
  geometry: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  fillColor: string | null;
  lineColor: string | null;
  lineWidth: number;
  textColor: string;
  fontSize: number;
  bold: boolean;
  textAlign: 'left' | 'center' | 'right';
  zIndex: number;
};

export type StraightMapExtraction = {
  mapWidth: number;
  mapHeight: number;
  sheetName: string;
  objects: StraightMapObject[];
  drawingPrimitives?: StraightMapDrawingPrimitive[];
};

export type StraightMapSheetSelection = {
  sheetName?: string;
  excludeSheetNamesContaining?: string[];
};

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  isArray: (name: string) => ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor', 'sp', 'grpSp', 'cxnSp', 'pic', 'graphicFrame', 'c', 'row', 'col', 'si', 't'].includes(name),
};
const parser = new XMLParser(parserOptions);
const sheetParser = new XMLParser({ ...parserOptions, stopNodes: ['*.sheetData'] });
const drawingParser = new XMLParser({
  ...parserOptions,
  stopNodes: ['*.twoCellAnchor', '*.oneCellAnchor', '*.absoluteAnchor'],
});

const array = <T>(value: T | T[] | undefined | null): T[] => value == null ? [] : Array.isArray(value) ? value : [value];
const numberValue = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const nodeText = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  const record = node as XmlNode;
  if (typeof record['#text'] === 'string') return record['#text'];
  return Object.entries(record).filter(([key]) => !key.startsWith('@_')).map(([, value]) => array(value).map(nodeText).join('')).join('');
};

export const normalizeStraightMapText = (value: string) => value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');

const xml = (files: Record<string, Uint8Array>, name: string) => {
  const file = files[name.replace(/^\//, '')];
  return file ? parser.parse(strFromU8(file)) as XmlNode : null;
};

const sparseXml = (files: Record<string, Uint8Array>, name: string, sparseParser: XMLParser) => {
  const file = files[name.replace(/^\//, '')];
  return file ? sparseParser.parse(strFromU8(file)) as XmlNode : null;
};

const relationshipTargets = (document: XmlNode | null) => new Map(
  array(document?.Relationships?.Relationship).map((rel: XmlNode) => [String(rel['@_Id'] || ''), String(rel['@_Target'] || '')])
);

const resolveZipPath = (base: string, target: string) => {
  const parts = `${base}/${target}`.replace(/\\/g, '/').split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop(); else resolved.push(part);
  }
  return resolved.join('/');
};

const columnName = (reference: string) => {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference);
  if (!match) return null;
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(match[2]) - 1 };
};

const columnWidthToEmu = (width: number) => Math.max(1, Math.floor(((256 * width + Math.floor(128 / 7)) / 256 * 7) * EMU_PER_PIXEL));

const sheetMetrics = (sheet: XmlNode) => {
  const worksheet = sheet.worksheet || {};
  const sheetDataXml = typeof worksheet.sheetData === 'string' ? worksheet.sheetData : '';
  const columnWidths = new Map<number, number>();
  for (const col of array<XmlNode>(worksheet.cols?.col)) {
    const min = numberValue(col['@_min'], 1) - 1;
    const max = numberValue(col['@_max'], min + 1) - 1;
    const width = columnWidthToEmu(numberValue(col['@_width'], 8.43));
    for (let index = min; index <= max; index += 1) columnWidths.set(index, width);
  }
  const rowHeights = new Map<number, number>();
  if (sheetDataXml) {
    for (const match of sheetDataXml.matchAll(/<(?:[a-z0-9_]+:)?row\b([^>]*)>/gi)) {
      const rowNumber = /\br\s*=\s*(["'])(.*?)\1/i.exec(match[1])?.[2];
      const height = /\bht\s*=\s*(["'])(.*?)\1/i.exec(match[1])?.[2];
      if (height != null) rowHeights.set(numberValue(rowNumber, 1) - 1, numberValue(height) / 72 * 96 * EMU_PER_PIXEL);
    }
  } else {
    for (const row of array<XmlNode>(worksheet.sheetData?.row)) {
      if (row['@_ht'] != null) rowHeights.set(numberValue(row['@_r'], 1) - 1, numberValue(row['@_ht']) / 72 * 96 * EMU_PER_PIXEL);
    }
  }
  const columnOffset = (index: number) => {
    let total = 0;
    for (let current = 0; current < index; current += 1) total += columnWidths.get(current) || DEFAULT_COLUMN_EMU;
    return total;
  };
  const rowOffset = (index: number) => {
    let total = 0;
    for (let current = 0; current < index; current += 1) total += rowHeights.get(current) || DEFAULT_ROW_EMU;
    return total;
  };
  const marker = (value: XmlNode | undefined) => ({
    x: columnOffset(numberValue(value?.col)) + numberValue(value?.colOff),
    y: rowOffset(numberValue(value?.row)) + numberValue(value?.rowOff),
  });
  return { worksheet, sheetDataXml, columnWidths, rowHeights, columnOffset, rowOffset, marker };
};

type Bounds = { x: number; y: number; width: number; height: number };

const anchorBounds = (anchor: XmlNode, metrics: ReturnType<typeof sheetMetrics>): Bounds => {
  if (anchor.from && anchor.to) {
    const start = metrics.marker(anchor.from);
    const end = metrics.marker(anchor.to);
    return { x: start.x, y: start.y, width: Math.max(1, end.x - start.x), height: Math.max(1, end.y - start.y) };
  }
  if (anchor.from && anchor.ext) {
    const start = metrics.marker(anchor.from);
    return { x: start.x, y: start.y, width: Math.max(1, numberValue(anchor.ext['@_cx'])), height: Math.max(1, numberValue(anchor.ext['@_cy'])) };
  }
  return {
    x: numberValue(anchor.pos?.['@_x']), y: numberValue(anchor.pos?.['@_y']),
    width: Math.max(1, numberValue(anchor.ext?.['@_cx'])), height: Math.max(1, numberValue(anchor.ext?.['@_cy'])),
  };
};

const shapeIdentity = (shape: XmlNode) => shape.nvSpPr?.cNvPr || shape.nvCxnSpPr?.cNvPr || shape.nvPicPr?.cNvPr || shape.nvGraphicFramePr?.cNvPr || {};
const shapeTransform = (shape: XmlNode) => shape.spPr?.xfrm || shape.grpSpPr?.xfrm || shape.xfrm || {};

const hasOwn = (value: XmlNode | undefined, key: string) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

const normalizeHexColor = (value: unknown, fallback: string | null = null) => {
  const hex = String(value || '').replace(/^#/, '').trim();
  return /^[a-f\d]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : fallback;
};

const workbookThemeColors = (files: Record<string, Uint8Array>) => {
  const scheme = xml(files, 'xl/theme/theme1.xml')?.theme?.themeElements?.clrScheme || {};
  const colors = new Map<string, string>([
    ['dk1', '#000000'], ['tx1', '#000000'], ['lt1', '#FFFFFF'], ['bg1', '#FFFFFF'],
  ]);
  for (const [name, value] of Object.entries(scheme)) {
    if (name.startsWith('@_')) continue;
    const colorNode = array<XmlNode>(value)[0] || {};
    const color = normalizeHexColor(colorNode.srgbClr?.['@_val'])
      || normalizeHexColor(colorNode.sysClr?.['@_lastClr']);
    if (color) colors.set(name, color);
  }
  return colors;
};

const drawingColor = (value: XmlNode | undefined, themeColors: Map<string, string>, fallback: string | null = null) => {
  if (!value) return fallback;
  return normalizeHexColor(value.srgbClr?.['@_val'])
    || normalizeHexColor(value.sysClr?.['@_lastClr'])
    || themeColors.get(String(value.schemeClr?.['@_val'] || ''))
    || fallback;
};

const firstTextProperties = (shape: XmlNode) => {
  for (const paragraph of array<XmlNode>(shape.txBody?.p)) {
    for (const run of array<XmlNode>(paragraph.r)) if (run.rPr) return run.rPr as XmlNode;
    if (paragraph.pPr?.defRPr) return paragraph.pPr.defRPr as XmlNode;
    if (paragraph.endParaRPr) return paragraph.endParaRPr as XmlNode;
  }
  return {} as XmlNode;
};

const primitiveStyle = (shape: XmlNode, objectType: StraightMapDrawingPrimitive['kind'], themeColors: Map<string, string>) => {
  const properties = shape.spPr || {};
  const line = properties.ln || {};
  const style = shape.style || {};
  const geometry = String(properties.prstGeom?.['@_prst'] || (objectType === 'connector' ? 'straightConnector1' : 'rect'));
  const lineGeometry = objectType === 'connector' || geometry === 'line' || /connector/i.test(geometry);
  const fillColor = lineGeometry || hasOwn(properties, 'noFill')
    ? null
    : drawingColor(properties.solidFill, themeColors, drawingColor(style.fillRef, themeColors, '#FFFFFF'));
  const lineColor = hasOwn(line, 'noFill')
    ? null
    : drawingColor(line.solidFill, themeColors, drawingColor(style.lnRef, themeColors, '#000000'));
  const textProperties = firstTextProperties(shape);
  const paragraph = array<XmlNode>(shape.txBody?.p)[0] || {};
  const alignment = String(paragraph.pPr?.['@_algn'] || 'ctr');
  return {
    geometry,
    fillColor,
    lineColor,
    lineWidth: Math.max(1, numberValue(line['@_w'], 12_700)),
    textColor: drawingColor(textProperties.solidFill, themeColors, drawingColor(style.fontRef, themeColors, '#000000')) || '#000000',
    fontSize: Math.max(1, numberValue(textProperties['@_sz'], 1_000) / 100 * 96 / 72 * EMU_PER_PIXEL),
    bold: String(textProperties['@_b'] || '') === '1' || String(textProperties['@_b'] || '').toLowerCase() === 'true',
    textAlign: (alignment === 'l' ? 'left' : alignment === 'r' ? 'right' : 'center') as 'left' | 'center' | 'right',
  };
};

const transformedBounds = (shape: XmlNode, parent: Bounds, groupTransform?: XmlNode): Bounds => {
  const transform = shapeTransform(shape);
  if (!transform.off || !transform.ext) return parent;
  if (!groupTransform?.chOff || !groupTransform?.chExt) {
    return { x: numberValue(transform.off['@_x'], parent.x), y: numberValue(transform.off['@_y'], parent.y), width: Math.max(1, numberValue(transform.ext['@_cx'], parent.width)), height: Math.max(1, numberValue(transform.ext['@_cy'], parent.height)) };
  }
  const sx = parent.width / Math.max(1, numberValue(groupTransform.chExt['@_cx']));
  const sy = parent.height / Math.max(1, numberValue(groupTransform.chExt['@_cy']));
  return {
    x: parent.x + (numberValue(transform.off['@_x']) - numberValue(groupTransform.chOff['@_x'])) * sx,
    y: parent.y + (numberValue(transform.off['@_y']) - numberValue(groupTransform.chOff['@_y'])) * sy,
    width: Math.max(1, numberValue(transform.ext['@_cx']) * sx),
    height: Math.max(1, numberValue(transform.ext['@_cy']) * sy),
  };
};

type RawObject = Omit<StraightMapObject, 'xRatio' | 'yRatio' | 'shapeHash'>;
type RawDrawingPrimitive = Omit<StraightMapDrawingPrimitive, 'x' | 'y'> & { x: number; y: number };

const collectShapes = (
  container: XmlNode,
  bounds: Bounds,
  output: RawObject[],
  primitives: RawDrawingPrimitive[],
  themeColors: Map<string, string>,
  groupId: string | null = null,
  groupTransform?: XmlNode,
) => {
  const types = [['sp', 'shape'], ['cxnSp', 'connector'], ['pic', 'picture'], ['graphicFrame', 'graphic']] as const satisfies ReadonlyArray<readonly [string, StraightMapDrawingPrimitive['kind']]>;
  for (const [key, objectType] of types) {
    for (const shape of array<XmlNode>(container[key])) {
      const identity = shapeIdentity(shape);
      const current = transformedBounds(shape, bounds, groupTransform);
      const originalText = array(shape.txBody?.p).map(nodeText).join('\n').trim();
      const shapeId = String(identity['@_id'] || `${objectType}-${output.length + 1}`);
      const transform = shapeTransform(shape);
      const style = primitiveStyle(shape, objectType, themeColors);
      primitives.push({
        shapeId,
        kind: objectType,
        ...style,
        text: originalText,
        x: Math.round(current.x),
        y: Math.round(current.y),
        width: Math.round(current.width),
        height: Math.round(current.height),
        rotation: numberValue(transform['@_rot']) / 60000,
        flipH: String(transform['@_flipH'] || '') === '1' || String(transform['@_flipH'] || '').toLowerCase() === 'true',
        flipV: String(transform['@_flipV'] || '') === '1' || String(transform['@_flipV'] || '').toLowerCase() === 'true',
        zIndex: primitives.length,
      });
      if (originalText) {
        output.push({
          shapeId,
          shapeName: String(identity['@_name'] || ''),
          objectType,
          originalText,
          normalizedText: normalizeStraightMapText(originalText),
          x: Math.round(current.x), y: Math.round(current.y), width: Math.round(current.width), height: Math.round(current.height),
          centerX: Math.round(current.x + current.width / 2), centerY: Math.round(current.y + current.height / 2),
          groupId,
          rotation: numberValue(transform['@_rot']) / 60000,
        });
      }
    }
  }
  for (const group of array<XmlNode>(container.grpSp)) {
    const identity = group.nvGrpSpPr?.cNvPr || {};
    const id = String(identity['@_id'] || `group-${output.length + 1}`);
    const current = transformedBounds(group, bounds, groupTransform);
    collectShapes(group, current, output, primitives, themeColors, id, shapeTransform(group));
  }
};

const sharedStrings = (files: Record<string, Uint8Array>) => array<XmlNode>(xml(files, 'xl/sharedStrings.xml')?.sst?.si).map(nodeText);

function* sheetCells(metrics: ReturnType<typeof sheetMetrics>): Generator<XmlNode> {
  if (!metrics.sheetDataXml) {
    for (const row of array<XmlNode>(metrics.worksheet.sheetData?.row)) yield* array<XmlNode>(row.c);
    return;
  }
  for (const match of metrics.sheetDataXml.matchAll(/<(?:[a-z0-9_]+:)?row\b[^>]*>[\s\S]*?<\/(?:[a-z0-9_]+:)?row>/gi)) {
    const parsed = parser.parse(match[0]) as XmlNode;
    const row = array<XmlNode>(parsed.row)[0];
    yield* array<XmlNode>(row?.c);
  }
}

const decodeXmlAttribute = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const workbookSheetNodes = (files: Record<string, Uint8Array>) => {
  const workbook = files['xl/workbook.xml'];
  if (!workbook) throw new Error('유효한 XLSX workbook.xml을 찾을 수 없습니다.');
  const source = strFromU8(workbook);
  const sheets: XmlNode[] = [];
  for (const match of source.matchAll(/<(?:[a-z0-9_]+:)?sheet\b([^>]*)\/?\s*>/gi)) {
    const attributes = match[1];
    const name = /\bname\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
    const relationshipId = /\b(?:r|[a-z0-9_]+):id\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
    if (name && relationshipId) sheets.push({ '@_name': decodeXmlAttribute(name), '@_id': decodeXmlAttribute(relationshipId) });
  }
  return sheets;
};

const compactSheetName = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');

const selectSheetNodes = (sheets: XmlNode[], selection: StraightMapSheetSelection) => {
  const requestedName = selection.sheetName ? compactSheetName(selection.sheetName) : '';
  const excludedTerms = (selection.excludeSheetNamesContaining || []).map(compactSheetName).filter(Boolean);
  return sheets.filter((sheet) => {
    const name = compactSheetName(String(sheet['@_name'] || ''));
    if (requestedName && name !== requestedName) return false;
    return !excludedTerms.some((term) => name.includes(term));
  });
};

const unzipOnly = (buffer: Buffer, names: Set<string>) => unzipSync(new Uint8Array(buffer), {
  filter: (file) => names.has(file.name.replace(/^\//, '')),
});

export const listStraightMapSheetNames = (
  buffer: Buffer,
  selection: StraightMapSheetSelection = {},
) => {
  const files = unzipOnly(buffer, new Set(['xl/workbook.xml']));
  const sheets = workbookSheetNodes(files);
  if (!sheets.length) throw new Error('직선도 워크시트를 찾을 수 없습니다.');
  const selected = selectSheetNodes(sheets, selection);
  if (!selected.length) throw new Error('조건에 맞는 직선도 워크시트를 찾을 수 없습니다.');
  return selected.map((sheet) => String(sheet['@_name'] || 'Sheet1'));
};

const extractSheet = (
  files: Record<string, Uint8Array>,
  workbookRels: Map<string, string>,
  sheetNode: XmlNode,
  strings: string[]
): StraightMapExtraction => {
  const sheetPath = resolveZipPath('xl', workbookRels.get(String(sheetNode['@_id'] || '')) || 'worksheets/sheet1.xml');
  const sheet = sparseXml(files, sheetPath, sheetParser);
  if (!sheet) throw new Error('직선도 워크시트 XML을 읽을 수 없습니다.');
  const metrics = sheetMetrics(sheet);
  const sheetDirectory = sheetPath.slice(0, sheetPath.lastIndexOf('/'));
  const sheetFile = sheetPath.slice(sheetPath.lastIndexOf('/') + 1);
  const sheetRels = relationshipTargets(xml(files, `${sheetDirectory}/_rels/${sheetFile}.rels`));
  const drawingRelationId = metrics.worksheet.drawing?.['@_id'];
  const drawingTarget = drawingRelationId ? sheetRels.get(String(drawingRelationId)) : undefined;
  const drawing = drawingTarget ? sparseXml(files, resolveZipPath(sheetDirectory, drawingTarget), drawingParser) : null;
  const raw: RawObject[] = [];
  const rawPrimitives: RawDrawingPrimitive[] = [];
  const themeColors = workbookThemeColors(files);
  const drawingExtents: Bounds[] = [];
  for (const anchorType of ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor']) {
    for (const anchor of array<XmlNode>(drawing?.wsDr?.[anchorType])) {
      const anchorSource = typeof anchor === 'string' ? anchor : typeof anchor?.['#text'] === 'string' ? anchor['#text'] : null;
      const parsedAnchor = anchorSource
        ? array<XmlNode>((parser.parse(`<${anchorType}>${anchorSource}</${anchorType}>`) as XmlNode)[anchorType])[0]
        : anchor;
      const bounds = anchorBounds(parsedAnchor, metrics);
      drawingExtents.push(bounds);
      collectShapes(parsedAnchor, bounds, raw, rawPrimitives, themeColors);
    }
  }

  for (const cell of sheetCells(metrics)) {
    const reference = columnName(String(cell['@_r'] || ''));
    if (!reference) continue;
    const rawValue = nodeText(cell.v);
    const originalText = (cell['@_t'] === 's' ? strings[numberValue(rawValue)] : cell['@_t'] === 'inlineStr' ? nodeText(cell.is) : rawValue).trim();
    if (!originalText) continue;
    const x = metrics.columnOffset(reference.column);
    const y = metrics.rowOffset(reference.row);
    const width = metrics.columnWidths.get(reference.column) || DEFAULT_COLUMN_EMU;
    const height = metrics.rowHeights.get(reference.row) || DEFAULT_ROW_EMU;
    raw.push({ shapeId: `cell-${cell['@_r']}`, shapeName: String(cell['@_r']), objectType: 'cell-text', originalText, normalizedText: normalizeStraightMapText(originalText), x, y, width, height, centerX: x + width / 2, centerY: y + height / 2, groupId: null, rotation: 0 });
  }

  // Group children can legally extend beyond their worksheet anchor (several
  // customer sheets use a compact anchor with a much larger child coordinate
  // space). Include the resolved children themselves so those drawings are not
  // clipped outside the portable canvas or clamped to a zero search ratio.
  const contentBounds = [...drawingExtents, ...rawPrimitives, ...raw];
  const mapLeft = contentBounds.length ? Math.min(...contentBounds.map((item) => item.x)) : 0;
  const mapTop = contentBounds.length ? Math.min(...contentBounds.map((item) => item.y)) : 0;
  const mapRight = Math.max(mapLeft + DEFAULT_COLUMN_EMU, ...contentBounds.map((item) => item.x + item.width));
  const mapBottom = Math.max(mapTop + DEFAULT_ROW_EMU, ...contentBounds.map((item) => item.y + item.height));
  const mapWidth = mapRight - mapLeft;
  const mapHeight = mapBottom - mapTop;
  const objects = raw.map((item) => ({
    ...item,
    xRatio: Math.min(1, Math.max(0, (item.centerX - mapLeft) / mapWidth)),
    yRatio: Math.min(1, Math.max(0, (item.centerY - mapTop) / mapHeight)),
    shapeHash: createHash('sha256').update([item.shapeId, item.originalText, item.x, item.y, item.width, item.height].join('|')).digest('hex'),
  }));
  const drawingPrimitives = rawPrimitives.map((item) => ({
    ...item,
    x: Math.round(item.x - mapLeft),
    y: Math.round(item.y - mapTop),
  }));
  return {
    mapWidth: Math.round(mapWidth),
    mapHeight: Math.round(mapHeight),
    sheetName: String(sheetNode['@_name'] || 'Sheet1'),
    objects,
    drawingPrimitives,
  };
};

export const extractStraightMapSheets = (
  buffer: Buffer,
  selection: StraightMapSheetSelection = {},
): StraightMapExtraction[] => {
  const files = unzipOnly(buffer, new Set([
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/sharedStrings.xml',
    'xl/theme/theme1.xml',
  ]));
  const sheets = workbookSheetNodes(files);
  if (!sheets.length) throw new Error('직선도 워크시트를 찾을 수 없습니다.');
  const workbookRels = relationshipTargets(xml(files, 'xl/_rels/workbook.xml.rels'));
  const selectedSheets = selectSheetNodes(sheets, selection);
  if (!selectedSheets.length) throw new Error('조건에 맞는 직선도 워크시트를 찾을 수 없습니다.');
  const selectedPaths = selectedSheets.map((sheet) => resolveZipPath(
    'xl',
    workbookRels.get(String(sheet['@_id'] || '')) || 'worksheets/sheet1.xml',
  ));
  const sheetFiles = new Set<string>();
  for (const sheetPath of selectedPaths) {
    const sheetDirectory = sheetPath.slice(0, sheetPath.lastIndexOf('/'));
    const sheetFile = sheetPath.slice(sheetPath.lastIndexOf('/') + 1);
    sheetFiles.add(sheetPath);
    sheetFiles.add(`${sheetDirectory}/_rels/${sheetFile}.rels`);
  }
  Object.assign(files, unzipOnly(buffer, sheetFiles));
  const drawingFiles = new Set<string>();
  for (const sheetPath of selectedPaths) {
    const sheet = xml(files, sheetPath);
    const sheetDirectory = sheetPath.slice(0, sheetPath.lastIndexOf('/'));
    const sheetFile = sheetPath.slice(sheetPath.lastIndexOf('/') + 1);
    const sheetRels = relationshipTargets(xml(files, `${sheetDirectory}/_rels/${sheetFile}.rels`));
    const drawingRelationId = sheet?.worksheet?.drawing?.['@_id'];
    const drawingTarget = drawingRelationId ? sheetRels.get(String(drawingRelationId)) : undefined;
    if (drawingTarget) drawingFiles.add(resolveZipPath(sheetDirectory, drawingTarget));
  }
  if (drawingFiles.size) Object.assign(files, unzipOnly(buffer, drawingFiles));
  const strings = sharedStrings(files);
  return selectedSheets.map((sheet) => extractSheet(files, workbookRels, sheet, strings));
};

export const extractStraightMapObjects = (buffer: Buffer): StraightMapExtraction => {
  const extraction = extractStraightMapSheets(buffer)[0];
  if (!extraction) throw new Error('직선도 워크시트를 찾을 수 없습니다.');
  return extraction;
};
