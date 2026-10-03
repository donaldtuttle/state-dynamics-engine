import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateLegacySession } from '../src/compatibility.ts';
const [source, destination] = process.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination)) throw new Error('Usage: node scripts/migrate-session.mjs legacy.json migrated.json (different paths required)');
const migrated = migrateLegacySession(JSON.parse(readFileSync(source, 'utf8')));
writeFileSync(destination, JSON.stringify(migrated, null, 2)+'\n', { flag: 'wx' });
console.log(`Validated legacy replay and wrote ${destination}`);
