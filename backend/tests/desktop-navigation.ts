import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const header = fs.readFileSync(path.join(root, 'src/components/common/Header.tsx'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src/components/common/DesktopSidebar.tsx'), 'utf8');
const bottomNav = fs.readFileSync(path.join(root, 'src/components/common/BottomNav.tsx'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'src/components/common/primary-navigation.ts'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

assert.match(app, /<DesktopSidebar \/>/);
assert.match(app, /lg:pl-\[210px\]/);
assert.match(header, /sticky top-0/);
assert.match(header, /lg:h-\[60px\]/);
assert.match(sidebar, /fixed bottom-0 left-0 top-\[60px\]/);
assert.match(sidebar, /hidden w-\[210px\][\s\S]*lg:flex/);
assert.match(sidebar, /aria-current=\{active \? 'page'/);
assert.match(bottomNav, /lg:hidden/);
assert.match(bottomNav, /primaryNavigationItems\(notificationCount\)/);
for (const label of ['홈', 'CELL', '업무이관', '일일업무', '자재']) assert.match(navigation, new RegExp(`label: '${label}'`));
assert.match(styles, /padding-bottom: calc\(6\.25rem \+ env\(safe-area-inset-bottom\)\)/);
assert.match(styles, /@media \(min-width: 1024px\)[\s\S]*padding-bottom: 2rem/);

console.log('Desktop navigation test passed: fixed desktop sidebar and unchanged mobile bottom navigation');
