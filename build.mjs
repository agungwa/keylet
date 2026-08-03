// Bundles src/entries/*.ts with esbuild and copies public/ → dist/.
// Usage: node build.mjs         (one-shot production build)
//        node build.mjs --watch (rebuild TS bundles on change)
import * as esbuild from "esbuild";
import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(root, "public");
const distDir = resolve(root, "dist");
const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/entries/popup.ts", "src/entries/scan.ts"],
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir: "dist",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});

// Clean + rebuild static assets (always, even in watch — assets aren't watched).
await rm(distDir, { recursive: true, force: true });
if (!existsSync(publicDir)) {
  throw new Error("public/ directory not found — nothing to copy");
}
await cp(publicDir, distDir, { recursive: true });

if (watch) {
  await ctx.watch();
  console.log("[keylet] watching src/**/*.ts — asset edits still need a re-run");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("[keylet] build complete → dist/");
}
