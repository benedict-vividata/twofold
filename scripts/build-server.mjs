// Bundles the server into a single ESM file so the runtime image needs no
// node_modules at all.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  legalComments: "none",
  // A native module: installed next to the bundle, not inlined into it.
  external: ["node-pty"],
  // Some bundled CommonJS dependencies call require(); give them one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
