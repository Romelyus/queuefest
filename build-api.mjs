import * as esbuild from 'esbuild';
import { writeFileSync, statSync } from 'fs';

// Bundle all local imports into a single file
// This resolves ERR_MODULE_NOT_FOUND on Vercel's serverless runtime
// where @vercel/node can't trace relative TypeScript imports
const result = await esbuild.build({
  entryPoints: ['api/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  write: false,
  packages: 'external',
});

// Overwrite the .ts file with bundled JS
// Vercel pre-registers api/index.ts before build, so it must still exist
// Prepend @ts-nocheck so Vercel's TS compiler doesn't fail on untyped params
const bundled = '// @ts-nocheck\n' + result.outputFiles[0].text;
writeFileSync('api/index.ts', bundled);

const size = Math.round(result.outputFiles[0].text.length / 1024);
console.log(`\u2713 api/index.ts bundled (${size}kb)`);
