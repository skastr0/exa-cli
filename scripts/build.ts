#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { chmod, mkdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "..")
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  readonly version?: string
}
const version = packageJson.version ?? "0.0.0"
const distDir = join(repoRoot, "dist")
const binaryName = "exa-cli"

const targets = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
] as const

console.log("Cleaning dist directory...")
await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })

console.log(`\nBuilding ${binaryName} v${version}...\n`)

for (const { platform, arch } of targets) {
  const outfile = join(distDir, `${binaryName}-${platform}-${arch}`)

  console.log(`Building ${platform}-${arch}...`)

  try {
    const buildResult = await Bun.build({
      target: "bun",
      compile: {
        target: `bun-${platform}-${arch}`,
        outfile,
      },
      entrypoints: [join(repoRoot, "src", "cli.ts")],
      define: {
        APP_VERSION: `'${version}'`,
      },
      minify: true,
    })

    if (!buildResult.success) {
      console.error(`  ✗ Failed to build ${platform}-${arch}`)
      for (const log of buildResult.logs) {
        console.error(log)
      }
      process.exit(1)
    }

    await chmod(outfile, 0o755)
    console.log(`  ✓ ${outfile}`)
  } catch (error) {
    console.error(`  ✗ Error building ${platform}-${arch}:`, error)
    process.exit(1)
  }
}

console.log(`
Build complete! Binaries in ${distDir}/

To install locally:
  bun run install:local
`)
