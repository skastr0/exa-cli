import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { ARTIFACT_DIR_ENV, CLI_DATA_DIR_NAME, CLI_HOME_ENV } from "./constants"

const readNonEmptyEnv = (name: string) => {
  const value = Bun.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

export const getCliHomeDirectory = () =>
  resolve(readNonEmptyEnv(CLI_HOME_ENV) ?? join(homedir(), ".config", CLI_DATA_DIR_NAME))

export const getArtifactDirectory = () =>
  resolve(readNonEmptyEnv(ARTIFACT_DIR_ENV) ?? join(getCliHomeDirectory(), "artifacts"))
