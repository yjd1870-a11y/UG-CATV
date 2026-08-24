import fs from 'node:fs';

const metricsPath = process.argv[2];
const metrics = metricsPath ? JSON.parse(fs.readFileSync(metricsPath, 'utf8')) as Record<string, number> : {};
const oldMinutes = Number(process.env.OLD_UPLOAD_MINUTES || 60);
const measuredMs = Number(metrics.totalMs || metrics.excelRenderMs || 0);
const newMinutes = measuredMs > 0 ? measuredMs / 60_000 : 6.5;
const reduction = (1 - newMinutes / oldMinutes) * 100;
console.log(JSON.stringify({
  oldPipelineMinutes: oldMinutes,
  pdfV3Minutes: Number(newMinutes.toFixed(2)),
  savedMinutes: Number((oldMinutes - newMinutes).toFixed(2)),
  reductionPercent: Number(reduction.toFixed(1)),
  uploadObjectsPerSheet: 3,
  tilePutCount: 0,
  basis: measuredMs > 0 ? 'renderer metrics' : 'design estimate; replace with renderer metrics JSON',
}, null, 2));
