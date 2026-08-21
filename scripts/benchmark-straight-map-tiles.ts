import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const [pdfPath, outputRoot, dpiText = '1100', tileSizeText = '512'] = process.argv.slice(2);
if (!pdfPath || !outputRoot) throw new Error('usage: benchmark-straight-map-tiles <pdf> <output-directory> [dpi] [tile-size]');
const dpi = Number(dpiText);
const tileSize = Number(tileSizeText);
const { stdout } = await execFileAsync('pdfinfo.exe', [pdfPath], { windowsHide: true });
const pages = Number(/^Pages:\s+(\d+)/mi.exec(stdout)?.[1]);
const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts/mi.exec(stdout);
if (!pages || !size) throw new Error('PDF page metadata not found');

process.env.CATV_RENDERER_LIBRARY_MODE = '1';
process.env.CATV_RENDERER_API_URL ||= 'http://localhost:3000';
const { generateTiles } = await import('../renderer-agent/src/index');
const startedAt = Date.now();
const result = await generateTiles({
  pdfPath: path.resolve(pdfPath), outputRoot: path.resolve(outputRoot),
  pdf: { pages, widthPoints: Number(size[1]), heightPoints: Number(size[2]) },
  columns: 1, rows: pages, dpi, tileSize, quality: 94, effort: 2, concurrency: 2,
});
const filesBelow = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? filesBelow(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return groups.flat();
};
const files = await filesBelow(outputRoot);
let bytes = 0;
for (const file of files) bytes += (await stat(file)).size;
console.log(JSON.stringify({ ...result, elapsedMs: Date.now() - startedAt, files: files.length, bytes }, null, 2));
