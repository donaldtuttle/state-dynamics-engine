// Exploratory diagnostic only. Production engine bytes and historical fixtures stay fixed.
// Run: node --experimental-strip-types scripts/memory-policy-probe-v3.ts --json /tmp/memory-policy.json
import { main } from './lib/memory-policy-cli.mjs';
main();
