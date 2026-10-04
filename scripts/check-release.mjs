#!/usr/bin/env node
// Verifies that a release build carries none of the test hooks
// (window.__myterm, the main-process hooks, MYTERM_DEBUG), and that a
// packaged app has the Node-related Electron fuses off.
//
//   node scripts/check-release.mjs              production build into a temp dir, then check it
//   node scripts/check-release.mjs --dir out    check an existing build directory
//   node scripts/check-release.mjs --app <.app> check a packaged app (fuses and app.asar)
//
// Exits 1 and lists every problem when the check fails.

import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { findTestHookMarkers, fuseProblems } = require('./release-guard.cjs')

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}

function productionBuild() {
  // Inside the project, so Vite empties it before building; ignored by git.
  const outDir = path.join(projectRoot, 'node_modules', '.cache', 'myterm-release-check')
  fs.rmSync(outDir, { recursive: true, force: true })
  const env = { ...process.env, NODE_ENV: 'production' }
  delete env.MYTERM_TEST_HOOKS
  execFileSync(
    process.execPath,
    [path.join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build', '--outDir', outDir],
    { cwd: projectRoot, env, stdio: ['ignore', 'ignore', 'inherit'] }
  )
  return outDir
}

const problems = []
let scanned
let cleanup = null

const app = option('--app')
if (app) {
  const resources = path.join(app, 'Contents', 'Resources')
  scanned = ['app.asar', 'app.asar.unpacked', 'app']
    .map((name) => path.join(resources, name))
    .filter((p) => fs.existsSync(p))
  if (scanned.length === 0) problems.push(`no app code found in ${resources}`)
  problems.push(...fuseProblems(app))
} else {
  const dir = option('--dir') ? path.resolve(option('--dir')) : productionBuild()
  if (!option('--dir')) cleanup = dir
  if (!fs.existsSync(path.join(dir, 'main', 'index.js'))) problems.push(`no build in ${dir}`)
  scanned = [dir]
}

for (const { file, marker } of findTestHookMarkers(scanned)) {
  problems.push(`test hook "${marker}" in ${file}`)
}
if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true })

if (problems.length > 0) {
  console.error(`Release check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`Release check passed: ${scanned.join(', ')}`)
