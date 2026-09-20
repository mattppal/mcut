import { cp, rm } from 'node:fs/promises'
import path from 'node:path'

const appRoot = process.cwd()
const registrySource = path.join(appRoot, '../studio/public/r')
const registryTarget = path.join(appRoot, 'public/r')

await rm(registryTarget, { recursive: true, force: true })
await cp(registrySource, registryTarget, { recursive: true })
