#!/usr/bin/env bun

import { resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")

const publishPackageDirs = [
  "packages/npm/exa-cli-darwin-arm64",
  "packages/npm/exa-cli-darwin-x64",
  "packages/npm/exa-cli-linux-arm64",
  "packages/npm/exa-cli-linux-x64",
  "packages/npm/exa-cli",
] as const

const run = async (label: string, command: ReadonlyArray<string>): Promise<void> => {
  console.log(`\n${label}`)
  const proc = Bun.spawn(command, {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    console.error(`${label} failed with exit code ${exitCode}`)
    process.exit(exitCode)
  }
}

await run("Building npm CLI packages", ["bun", "run", "build:npm-cli"])

for (const packageDir of publishPackageDirs) {
  await run(`Dry-running npm publish for ${packageDir}`, [
    "npm",
    "publish",
    `./${packageDir}`,
    "--dry-run",
    "--access",
    "public",
  ])
}
