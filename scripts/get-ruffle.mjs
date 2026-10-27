#!/usr/bin/env node
// Vendor the ruffle selfhosted web release into vendor/ruffle/.
// Ruffle is MIT OR Apache-2.0; we take it unmodified. No npm deps:
// download the release zip, unpack with the platform tool that exists
// (bsdtar ships with Windows 10+, unzip with macOS/Linux).

import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"

const out = resolve("vendor", "ruffle")

const rel = await (await fetch("https://api.github.com/repos/ruffle-rs/ruffle/releases?per_page=1", { headers: { accept: "application/vnd.github+json" } })).json()
if (!Array.isArray(rel) || !rel.length) {
  console.error("could not list ruffle releases")
  process.exit(1)
}
const asset = rel[0].assets.find((a) => a.name.includes("web-selfhosted"))
if (!asset) {
  console.error("no web-selfhosted asset in", rel[0].tag_name)
  process.exit(1)
}

const zip = join(dirname(out), "ruffle.zip")
mkdirSync(out, { recursive: true })
console.log(`fetching ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)`)
const buf = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer())
writeFileSync(zip, buf)

try {
  if (process.platform === "win32") {
    execSync(`tar -xf "${zip}" -C "${out}"`, { stdio: "inherit" })
  } else {
    execSync(`unzip -o -q "${zip}" -d "${out}"`, { stdio: "inherit" })
  }
} catch {
  console.error("unpack failed; extract", zip, "into", out, "by hand")
  process.exit(1)
}
console.log("ruffle", rel[0].tag_name, "in", out)
