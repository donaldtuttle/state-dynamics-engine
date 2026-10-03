import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../../src/engine.ts', import.meta.url));
const actual = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
const session = readFileSync(new URL('../src/session.ts', import.meta.url), 'utf8');
const expected = session.match(/engineGitBlob: "([0-9a-f]{40})"/)?.[1];
if (actual !== expected) throw new Error(`Engine provenance drift: ${actual} != ${expected}`);
console.log(`PASS: reference engine Git blob ${actual}`);
