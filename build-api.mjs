import * as esbuild from 'esbuild';
import { unlinkSync, statSync } from 'fs';

// Bundle all local imports into a single JS file
// This resolves ERR_MODULE_NOT_FOUND on Vercel's serverless runtime
// where @vercel/node can't trace TypeScript relative imports
await esbuild.build({
  entryPoints: ['api/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'api/index.js',
  packages: 'external',
});

// Remove TS source so Vercel uses the bundled .js instead
unlinkSync('api/index.ts');

const size = Math.round(statSync('api/index.js').size / 1024);
console.log(`\u2713 api/index.js bundled (${size}kb, replaced api/index.ts)`);
