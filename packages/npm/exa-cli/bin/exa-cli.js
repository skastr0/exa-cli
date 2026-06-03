#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const platformKey = `${process.platform}-${process.arch}`

const packageMap = {
  "darwin-arm64": "@skastr0/exa-cli-darwin-arm64",
  "darwin-x64": "@skastr0/exa-cli-darwin-x64",
  "linux-arm64": "@skastr0/exa-cli-linux-arm64",
  "linux-x64": "@skastr0/exa-cli-linux-x64",
}

const packageName = packageMap[platformKey]

if (packageName === undefined) {
  console.error(`exa-cli: unsupported platform ${platformKey}`)
  process.exit(1)
}

let packageJsonPath
try {
  packageJsonPath = require.resolve(`${packageName}/package.json`)
} catch {
  console.error(`exa-cli: missing platform package ${packageName}`)
  console.error("Reinstall @skastr0/exa-cli with optional dependencies enabled.")
  process.exit(1)
}

const binaryPath = join(dirname(packageJsonPath), "bin", "exa-cli")

if (!existsSync(binaryPath)) {
  console.error(`exa-cli: platform binary not found at ${binaryPath}`)
  process.exit(1)
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

if (result.signal) {
  process.kill(process.pid, result.signal)
}

process.exit(result.status ?? 1)
