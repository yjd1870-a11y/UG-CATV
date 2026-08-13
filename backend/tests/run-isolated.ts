import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testsDirectory, '../..');
const requestedTest = process.argv[2];

if (!requestedTest) throw new Error('실행할 테스트 파일 경로가 필요합니다.');

const testPath = path.resolve(projectRoot, requestedTest);
if (!testPath.startsWith(testsDirectory + path.sep) || path.extname(testPath) !== '.ts') {
  throw new Error('backend/tests 폴더의 TypeScript 테스트만 실행할 수 있습니다.');
}

const runName = path.basename(testPath, '.ts').replace(/[^A-Za-z0-9._-]/g, '_');
const runtimeRoot = path.join(projectRoot, '.tmp', 'test-runs', runName);
const databasePath = path.join(runtimeRoot, 'catv-test.sqlite');
const storagePath = path.join(runtimeRoot, 'storage');

// 실제 로컬 DB와 로그인 세션을 건드리지 않는 테스트 전용 저장소입니다.
fs.rmSync(runtimeRoot, { recursive: true, force: true });
fs.mkdirSync(storagePath, { recursive: true });
process.env.DATABASE_PATH = databasePath;
process.env.PRIVATE_STORAGE_PATH = storagePath;

await import(pathToFileURL(testPath).href);
