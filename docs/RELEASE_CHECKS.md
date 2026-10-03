# Release checks - 0.1.0

Executed locally on 2026-10-03 with Node.js 24.19.0, npm 11.9.0,
TypeScript 5.9.3, and the pinned Vite 8.2.2 application dependencies.

| Check | Result |
| --- | --- |
| Upstream source retrieval | All 101 source file Git blobs matched the pinned tree |
| Original reference-engine tests | Passed before migration |
| Original simulator session/probe tests | Passed before migration |
| Original Memory Weather tests | Five test files passed before migration |
| `npm run verify` | Passed |
| Numerical migration | 184 runs; 17,792 state steps matched exactly |
| Historical session adapter | Input preserved; numeric state preserved; changed frames/hashes rejected |
| Simulator tests | 12 session cases and 5 compact-probe cases passed |
| Memory Weather tests | All five test files passed |
| React Memory Weather tests | Compatibility test file passed |
| Wrapper synchronization | Generated engine factory wrappers match their source modules |
| TypeScript and production builds | Reference source and both Vite applications passed |
| `npm run build:site` | Six routes and 18 local links/assets verified |
| Source ASCII scan | Repository-owned source and standalone HTML passed |
| Memory Weather SHA-256 manifest | All 20 covered files passed |

Headless Chromium 133 browser checks loaded the launcher, full simulator,
compact probe, standalone Memory Weather, and React Memory Weather Lab.
There were no page exceptions or failed resource requests.

- Full simulator: step, queued input pulse, trace download, and all eight
  in-browser verification checks passed.
- Compact probe: 64-tick reference and current replay verification controls ran.
- Both Memory Weather interfaces: loaded the 96-tick demo, advanced to tick 97,
  exported valid v2 replay data, switched between terrain and regime views,
  enabled a second instance, advanced, and disabled it without browser errors.
- Visible page text contained no research glyphs.
- Screenshots were reviewed at 1440x1000 and at 390x844 for the full simulator.
  The mobile document had no horizontal overflow. Marker labels were given
  collision spacing to accommodate descriptive words.

These checks validate this migration and its declared fixtures. They do not
establish universal numerical equivalence or external-task performance.

GitHub repository creation, hosted Actions execution, and Pages deployment have
not been performed. A local `main` branch and `v0.1.0` tag are included in the
delivery bundle. The original remote repository remains unchanged.
