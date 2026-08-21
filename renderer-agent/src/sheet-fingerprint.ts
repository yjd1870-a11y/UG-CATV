import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

const relationships = (xml: string) => [...xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/gi)].flatMap((match) => {
  const id = /\bId=["']([^"']+)["']/i.exec(match[1])?.[1];
  const target = /\bTarget=["']([^"']+)["']/i.exec(match[1])?.[1];
  return id && target ? [{ id, target }] : [];
});
const zipTarget = (base: string, target: string) => path.posix.normalize(path.posix.join(path.posix.dirname(base), target)).replace(/^\//, '');
const decodeAttribute = (value: string) => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Conservative sheet-scoped hash for safe rendering artifact reuse. */
export const sheetContentHashes = async (xlsxPath: string, requested: string[]) => {
  const files = unzipSync(new Uint8Array(await readFile(xlsxPath)));
  const text = (name: string) => files[name] ? strFromU8(files[name]) : '';
  const workbookRels = new Map(relationships(text('xl/_rels/workbook.xml.rels')).map((item) => [item.id, item.target]));
  const sheetPaths = new Map<string, string>();
  for (const match of text('xl/workbook.xml').matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?\s*>/gi)) {
    const name = /\bname=["']([^"']+)["']/i.exec(match[1])?.[1];
    const id = /\b(?:r:)?id=["']([^"']+)["']/i.exec(match[1])?.[1];
    const target = id ? workbookRels.get(id) : undefined;
    if (name && target) sheetPaths.set(decodeAttribute(name), path.posix.normalize(path.posix.join('xl', target)));
  }
  const sharedItems = [...text('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si\b[\s\S]*?<\/(?:\w+:)?si>/gi)].map((match) => match[0]);
  const result: Record<string, string> = {};
  for (const sheetName of requested) {
    const sheetPath = sheetPaths.get(sheetName);
    if (!sheetPath || !files[sheetPath]) continue;
    const included = new Map<string, Uint8Array>();
    const include = (name: string) => { if (files[name]) included.set(name, files[name]); };
    include(sheetPath); include('xl/styles.xml'); include('xl/theme/theme1.xml');
    const sheetXml = text(sheetPath);
    const sharedIndexes = new Set<number>();
    for (const cell of sheetXml.matchAll(/<(?:\w+:)?c\b[^>]*\bt=["']s["'][^>]*>[\s\S]*?<\/(?:\w+:)?c>/gi)) {
      const index = /<(?:\w+:)?v>(\d+)<\/(?:\w+:)?v>/i.exec(cell[0])?.[1];
      if (index !== undefined) sharedIndexes.add(Number(index));
    }
    const sheetRelPath = path.posix.join(path.posix.dirname(sheetPath), '_rels', `${path.posix.basename(sheetPath)}.rels`);
    include(sheetRelPath);
    for (const relation of relationships(text(sheetRelPath))) {
      const related = zipTarget(sheetPath, relation.target); include(related);
      const relatedRelPath = path.posix.join(path.posix.dirname(related), '_rels', `${path.posix.basename(related)}.rels`);
      include(relatedRelPath);
      for (const nested of relationships(text(relatedRelPath))) include(zipTarget(related, nested.target));
    }
    const hash = createHash('sha256').update(`sheet:${sheetName}\n`);
    for (const [name, bytes] of [...included].sort(([left], [right]) => left.localeCompare(right))) {
      hash.update(`${name}:${bytes.length}\n`).update(bytes);
    }
    for (const index of [...sharedIndexes].sort((left, right) => left - right)) hash.update(`shared:${index}:${sharedItems[index] || ''}\n`);
    result[sheetName] = hash.digest('hex');
  }
  return result;
};
