import assert from 'node:assert/strict';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { extractStraightMapObjects, extractStraightMapSheets, normalizeStraightMapText } from '../straight-map-ooxml';
import { normalizeStraightMapCompactText, straightMapContinuousTerms } from '../straight-map-search';

const files: Record<string, Uint8Array> = {
  'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="직선도" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
  'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="12"/></cols><sheetData><row r="1" ht="30"><c r="A1" t="inlineStr"><is><t> CELL-001 </t></is></c></row></sheetData><drawing r:id="rIdDrawing"/></worksheet>`),
  'xl/worksheets/_rels/sheet1.xml.rels': strToU8(`<?xml version="1.0"?><Relationships><Relationship Id="rIdDrawing" Target="../drawings/drawing1.xml"/></Relationships>`),
  'xl/drawings/drawing1.xml': strToU8(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="42" name="검색 도형"/></xdr:nvSpPr><xdr:spPr><a:xfrm rot="5400000"/></xdr:spPr><xdr:txBody><a:p><a:r><a:t> G330630 </a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`),
};

files['xl/drawings/drawing1.xml'] = strToU8(strFromU8(files['xl/drawings/drawing1.xml']).replace(
  '</xdr:wsDr>',
  '<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:cxnSp><xdr:nvCxnSpPr><xdr:cNvPr id="43" name="Network line"/></xdr:nvCxnSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="bentConnector3"/><a:ln w="12700"><a:solidFill><a:srgbClr val="002060"/></a:solidFill></a:ln></xdr:spPr></xdr:cxnSp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>',
));

const workbookBuffer = Buffer.from(zipSync(files));
const result = extractStraightMapObjects(workbookBuffer);
assert.equal(extractStraightMapSheets(workbookBuffer, { sheetName: result.sheetName }).length, 1);
assert.throws(() => extractStraightMapSheets(workbookBuffer, { excludeSheetNamesContaining: [result.sheetName] }));
assert.equal(result.sheetName, '직선도');
assert.equal(normalizeStraightMapText('  G330630   TEST '), 'g330630 test');
assert.equal(normalizeStraightMapCompactText('  G330630   TEST '), 'g330630test');
const cellTerms = straightMapContinuousTerms('#G210010', 6);
assert.ok(cellTerms.terms.includes('g21001'));
assert.ok(cellTerms.terms.some((term) => normalizeStraightMapCompactText('G210010').includes(term)));
const b2cTerms = straightMapContinuousTerms('고덕 여염6길', 5);
assert.ok(b2cTerms.terms.includes('고덕여염6'));
assert.deepEqual(straightMapContinuousTerms('송탄', 5).terms, []);
const shape = result.objects.find((item) => item.shapeId === '42');
assert.ok(shape);
assert.equal(shape.originalText, 'G330630');
assert.equal(shape.rotation, 90);
assert.ok(shape.width > 0 && shape.height > 0);
assert.ok(shape.centerX === shape.x + shape.width / 2);
assert.ok(shape.xRatio >= 0 && shape.xRatio <= 1);
assert.ok(shape.yRatio >= 0 && shape.yRatio <= 1);
assert.ok(result.objects.some((item) => item.shapeId === 'cell-A1' && item.normalizedText === 'cell-001'));
assert.ok(result.drawingPrimitives?.some((item) => item.shapeId === '43' && item.kind === 'connector' && item.text === ''));
assert.ok(result.drawingPrimitives?.every((item) => item.x >= 0 && item.y >= 0));
console.log(`Straight-map OOXML test passed: ${result.objects.length} searchable objects, normalized center ratios preserved.`);
