#!/usr/bin/env node
// swf1file verify -- no network, no ruffle download. Builds against a
// fake vendor dir and checks the packed html is self-contained.
// Run: node tests/verify.mjs

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tmp = join(root, "tests", ".tmp")
rmSync(tmp, { recursive: true, force: true })
mkdirSync(join(tmp, "vendor", "ruffle"), { recursive: true })
mkdirSync(join(tmp, "game"), { recursive: true })

const failures = []
const check = (name, ok) => { console.log(`${ok ? "[OK]  " : "[FAIL]"} ${name}`); if (!ok) failures.push(name) }

// fake vendor: names carry build hashes, mimic the real pattern
writeFileSync(join(tmp, "vendor", "ruffle", "ruffle.js"), "/* ruffle stub */ window.RufflePlayer={newest:()=>({createPlayer:()=>({})})};")
writeFileSync(join(tmp, "vendor", "ruffle", "ruffle_web_bg.ABC123XY.wasm"), new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 2, 3]))
writeFileSync(join(tmp, "vendor", "ruffle", "ruffle_web-wasm_mvp_bg.QQQ999ZZ.wasm"), new Uint8Array([0, 0x61, 0x73, 0x6d, 4, 5, 6]))

// toy swf: FWS header + junk, the packer never parses it
const swfBytes = Buffer.concat([Buffer.from("FWS\x08"), Buffer.alloc(1024, 0xaa)])
const swfPath = join(tmp, "game", "toy.swf")
writeFileSync(swfPath, swfBytes)

execFileSync(process.execPath, [join(root, "src", "build.mjs"), swfPath], { cwd: tmp })

const out = join(tmp, "game", "toy.html")
check("output exists", existsSync(out))
const html = readFileSync(out, "utf8")

check("embeds simd wasm name", html.includes("ABC123XY"))
check("embeds mvp wasm name", html.includes("QQQ999ZZ"))
check("embeds ruffle stub", html.includes("ruffle stub"))
check("fetch shim present", html.includes("window.fetch = function"))
check("no external http(s) resource refs", !/(src|href)\s*=\s*["']https?:/i.test(html))

// base64 swf round-trip
const m = html.match(/swf: "([^"]+)"/)
check("swf payload present", !!m)
if (m) {
  const back = Buffer.from(m[1], "base64")
  check("swf round-trips byte-exact", back.equals(swfBytes))
}

// shipped files clean of personal paths / secrets
const banned = [/C:\\Users\\[A-Za-z0-9_.-]+/i, /\/home\/[a-z]+\/[a-z]/i, /sk-[A-Za-z0-9]{16,}/, /ses_[A-Za-z0-9]+/]
for (const f of ["README", "INSTALL", "NEWS", "ChangeLog", "AUTHORS", "src/build.mjs", "scripts/get-ruffle.mjs"]) {
  const text = readFileSync(join(root, f), "utf8")
  for (const p of banned) check(`${f} clean of ${p.source.slice(0, 14)}`, !p.test(text))
}

rmSync(tmp, { recursive: true, force: true })
if (failures.length) { console.error(`\n${failures.length} failed`); process.exit(1) }
console.log("\nall checks passed")
