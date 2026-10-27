#!/usr/bin/env node
// swf1file build.mjs -- one swf in, one html out.
//
// The trick: ruffle fetches its wasm core by URL, which does not
// resolve from file://. We embed the bytes as base64 and answer the
// fetch from a Blob. No ruffle.js patching. No network. No sidecars.
//
// Usage: node src/build.mjs game.swf [-o out.html] [--baseline]

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

const args = process.argv.slice(2)
let swfPath = null
let outFlag = -1
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "-o") { outFlag = i; i += 1; continue }
  if (args[i] === "--baseline") continue
  if (!args[i].startsWith("-") && !swfPath) swfPath = args[i]
}
const outPath = outFlag >= 0 && args[outFlag + 1] ? resolve(args[outFlag + 1]) : null
const baselineOnly = args.includes("--baseline")

if (!swfPath || !existsSync(resolve(swfPath))) {
  console.error("usage: node src/build.mjs game.swf [-o out.html] [--baseline]")
  process.exit(2)
}

const vendor = resolve(dirname(dirname(resolve(swfPath === "." ? "x" : swfPath))), "vendor", "ruffle")
const vendorDir = existsSync(vendor) ? vendor : resolve("vendor", "ruffle")

const ruffleJsPath = join(vendorDir, "ruffle.js")
if (!existsSync(ruffleJsPath)) {
  console.error(`no ruffle.js in ${vendorDir}\nrun: node scripts/get-ruffle.mjs`)
  process.exit(1)
}

// wasm names carry a build hash; find them instead of hardcoding
const wasms = readdirSync(vendorDir).filter((f) => f.endsWith(".wasm"))
const simd = wasms.find((f) => !f.includes("mvp"))
const mvp = wasms.find((f) => f.includes("mvp"))
if (!simd && !mvp) {
  console.error(`no wasm core in ${vendorDir} (found: ${wasms.join(", ") || "nothing"})`)
  process.exit(1)
}

const b64 = (p) => readFileSync(p).toString("base64")
const ruffleJs = readFileSync(ruffleJsPath, "utf8")
const swf = b64(resolve(swfPath))

const payloadLines = []
if (simd) payloadLines.push(`  wasm: ${JSON.stringify(b64(join(vendorDir, simd)))},`)
if (mvp && !baselineOnly) payloadLines.push(`  wasmMvp: ${JSON.stringify(b64(join(vendorDir, mvp)))},`)
payloadLines.push(`  swf: ${JSON.stringify(swf)}`)

const simdName = simd ? JSON.stringify(simd) : "null"
const mvpName = mvp ? JSON.stringify(mvp) : "null"

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${basename(swfPath, ".swf")} - single file</title>
<style>
  html,body{margin:0;height:100%;background:#111;color:#eee;font:14px/1.4 system-ui,sans-serif}
  #wrap{display:flex;align-items:center;justify-content:center;height:100%}
  ruffle-player{width:100%;height:100%;max-width:1200px;max-height:900px}
  #boot{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#111}
  #boot.hidden{display:none}
</style>
</head>
<body>
<div id="boot">Unpacking...</div>
<div id="wrap"></div>
<script>
const PAYLOADS = {
${payloadLines.join("\n")}
};
const WASM_NAMES = { simd: ${simdName}, mvp: ${mvpName} };
</script>
<script>
function b64ToBlob(s, type){
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
const wasmBlob = PAYLOADS.wasm ? b64ToBlob(PAYLOADS.wasm, "application/wasm") : null;
const wasmMvpBlob = PAYLOADS.wasmMvp ? b64ToBlob(PAYLOADS.wasmMvp, "application/wasm") : null;
const swfUrl = URL.createObjectURL(b64ToBlob(PAYLOADS.swf, "application/x-shockwave-flash"));

// ruffle fetches its core by URL; answer from the embedded blobs.
const realFetch = window.fetch.bind(window);
window.fetch = function(url, opts){
  const u = String(url);
  if (WASM_NAMES.mvp && u.includes(WASM_NAMES.mvp)) return Promise.resolve(new Response(wasmMvpBlob.slice(0), { status: 200, headers: { "Content-Type": "application/wasm" } }));
  if (WASM_NAMES.simd && u.includes(WASM_NAMES.simd)) return Promise.resolve(new Response(wasmBlob.slice(0), { status: 200, headers: { "Content-Type": "application/wasm" } }));
  if (u.endsWith(".wasm")) return Promise.resolve(new Response((wasmBlob || wasmMvpBlob).slice(0), { status: 200, headers: { "Content-Type": "application/wasm" } }));
  return realFetch(url, opts);
};
</script>
<script>${ruffleJs.replace(/<\/script>/gi, "<\\/script>")}</script>
<script>
(async () => {
  const RufflePlayer = window.RufflePlayer || {};
  let newest;
  try { newest = RufflePlayer.newest(); } catch (e) { newest = RufflePlayer; }
  const player = newest.createPlayer();
  document.getElementById("wrap").appendChild(player);
  await player.load({ url: swfUrl, allowScriptAccess: "sameDomain" });
  document.getElementById("boot").classList.add("hidden");
})().catch((err) => {
  document.getElementById("boot").textContent = "Failed to start: " + err;
});
</script>
</body>
</html>
`

const target = outPath || resolve(dirname(resolve(swfPath)), basename(swfPath).replace(/\.swf$/i, "") + ".html")
writeFileSync(target, html)
console.log(`${basename(swfPath)} -> ${basename(target)} (${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB, wasm: ${[simd, mvp].filter(Boolean).join(" + ")})`)
