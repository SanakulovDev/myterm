'use strict'
// Checks shared by scripts/check-release.mjs and scripts/after-pack.cjs: a
// release must carry none of the test hooks, and the packaged Electron binary
// must refuse to run as plain Node or to open the Node inspector.

const fs = require('fs')
const path = require('path')

// Strings that only test builds contain: the renderer and main-process test
// hooks and the switch that turns the renderer hook on.
const TEST_HOOK_MARKERS = ['__myterm', 'MYTERM_DEBUG']

// The fuse wire in the Electron Framework binary (format of @electron/fuses):
// the sentinel, a version byte, a length byte, then one byte per fuse:
// '0' off, '1' on, 'r' removed.
const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')
const FUSE_WIRE_VERSION = 1
const FUSE_INDEX = {
  RunAsNode: 0,
  EnableCookieEncryption: 1,
  EnableNodeOptionsEnvironmentVariable: 2,
  EnableNodeCliInspectArguments: 3
}
// ELECTRON_RUN_AS_NODE, NODE_OPTIONS and --inspect would each let anyone run
// code inside the signed app.
const FUSES_OFF = ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']

function listFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/** Every test-hook marker found in `paths` (files or directories, recursively). */
function findTestHookMarkers(paths) {
  const found = []
  for (const p of paths) {
    const files = fs.statSync(p).isDirectory() ? listFiles(p) : [p]
    for (const file of files) {
      // app.asar stores files uncompressed, so a byte search covers it too.
      const content = fs.readFileSync(file)
      for (const marker of TEST_HOOK_MARKERS) {
        if (content.includes(marker)) found.push({ file, marker })
      }
    }
  }
  return found
}

function frameworkBinary(appBundle) {
  return fs.realpathSync(
    path.join(appBundle, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')
  )
}

function locateFuses(binary) {
  const offset = binary.indexOf(FUSE_SENTINEL)
  if (offset === -1) throw new Error('Electron fuse sentinel not found')
  if (binary.indexOf(FUSE_SENTINEL, offset + 1) !== -1) throw new Error('Electron fuse sentinel found twice')
  const version = binary[offset + FUSE_SENTINEL.length]
  if (version !== FUSE_WIRE_VERSION) throw new Error(`Unknown Electron fuse wire version ${version}`)
  const length = binary[offset + FUSE_SENTINEL.length + 1]
  return { start: offset + FUSE_SENTINEL.length + 2, length }
}

/** Fuse name -> '0' | '1' | 'r' for the fuses this script knows. */
function readFuses(appBundle) {
  const binary = fs.readFileSync(frameworkBinary(appBundle))
  const { start, length } = locateFuses(binary)
  const fuses = {}
  for (const [name, index] of Object.entries(FUSE_INDEX)) {
    if (index < length) fuses[name] = String.fromCharCode(binary[start + index])
  }
  return fuses
}

function disableFuses(appBundle, names = FUSES_OFF) {
  const file = frameworkBinary(appBundle)
  const binary = fs.readFileSync(file)
  const { start, length } = locateFuses(binary)
  for (const name of names) {
    const index = FUSE_INDEX[name]
    if (index >= length) throw new Error(`This Electron has no ${name} fuse`)
    if (binary[start + index] === 'r'.charCodeAt(0)) continue
    binary[start + index] = '0'.charCodeAt(0)
  }
  fs.writeFileSync(file, binary)
}

/** Problems with the fuses of a packaged app, or an empty list. */
function fuseProblems(appBundle) {
  const fuses = readFuses(appBundle)
  return FUSES_OFF.filter((name) => fuses[name] === '1').map((name) => `fuse ${name} is on`)
}

module.exports = {
  TEST_HOOK_MARKERS,
  FUSES_OFF,
  findTestHookMarkers,
  readFuses,
  disableFuses,
  fuseProblems
}
