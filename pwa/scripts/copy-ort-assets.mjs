// Copies onnxruntime-web's WebAssembly files into public/ort.
//
// The runtime defaults to fetching these from a CDN. On a screen whose entire
// promise is that the person's words never leave their phone, a request to a
// third party is the wrong default even though it carries no text — so the
// files are served from this origin instead.
//
// Run after install: npm run ort:assets

import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "node_modules", "onnxruntime-web", "dist");
const to = join(here, "..", "public", "ort");

await mkdir(to, { recursive: true });

const files = (await readdir(from)).filter(
  // The .mjs loaders sit beside their .wasm and are fetched by name.
  (name) => name.endsWith(".wasm") || name.endsWith(".mjs"),
);

let copied = 0;
for (const name of files) {
  await copyFile(join(from, name), join(to, name));
  copied += 1;
}
console.log(`copied ${copied} runtime files into public/ort`);
