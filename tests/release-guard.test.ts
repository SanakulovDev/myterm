import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createRequire } from 'module'

// The release guard edits the fuse wire inside the Electron binary and scans
// build output for test hooks. Exercised here on a fake app bundle; the real
// build and package are checked by tests/e2e/release-build.e2e.ts.

const require = createRequire(import.meta.url)
const guard = require('../scripts/release-guard.cjs') as {
  readFuses(app: string): Record<string, string>
  disableFuses(app: string): void
  fuseProblems(app: string): string[]
  findTestHookMarkers(paths: string[]): Array<{ file: string; marker: string }>
}

const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
let root: string
let app: string
let binary: string

function writeBinary(wire: Buffer | string): void {
  fs.writeFileSync(binary, Buffer.concat([Buffer.from('\0junk'), Buffer.from(wire), Buffer.from('tail\0')]))
}
const wire = (fuses: string, version = 1): Buffer =>
  Buffer.concat([Buffer.from(SENTINEL), Buffer.from([version, fuses.length]), Buffer.from(fuses)])

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-guard-'))
  app = path.join(root, 'Test.app')
  const framework = path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework')
  fs.mkdirSync(path.join(framework, 'Versions', 'A'), { recursive: true })
  binary = path.join(framework, 'Versions', 'A', 'Electron Framework')
  // Like the real framework: the top-level name is a symlink.
  fs.symlinkSync('Versions/A/Electron Framework', path.join(framework, 'Electron Framework'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('fuses', () => {
  it('turns RunAsNode, NODE_OPTIONS and --inspect off and leaves the rest alone', () => {
    // Electron 34's defaults.
    writeBinary(wire('10110001'))
    expect(guard.fuseProblems(app)).toHaveLength(3)

    guard.disableFuses(app)
    expect(guard.readFuses(app)).toEqual({
      RunAsNode: '0',
      EnableCookieEncryption: '0',
      EnableNodeOptionsEnvironmentVariable: '0',
      EnableNodeCliInspectArguments: '0'
    })
    expect(guard.fuseProblems(app)).toEqual([])
    const content = fs.readFileSync(binary)
    expect(content.subarray(content.indexOf(SENTINEL) + SENTINEL.length + 2, -5).toString()).toBe('00000001')
    expect(fs.lstatSync(path.join(path.dirname(path.dirname(path.dirname(binary))), 'Electron Framework')).isSymbolicLink()).toBe(true)
  })

  it('keeps removed fuses removed', () => {
    writeBinary(wire('r1r10001'))
    guard.disableFuses(app)
    expect(guard.readFuses(app).RunAsNode).toBe('r')
    expect(guard.readFuses(app).EnableNodeCliInspectArguments).toBe('0')
  })

  it('refuses binaries it does not understand', () => {
    writeBinary('no fuses here')
    expect(() => guard.disableFuses(app)).toThrow(/sentinel not found/)
    writeBinary(Buffer.concat([wire('1011'), wire('1011')]))
    expect(() => guard.disableFuses(app)).toThrow(/found twice/)
    writeBinary(wire('1011', 2))
    expect(() => guard.disableFuses(app)).toThrow(/wire version 2/)
    writeBinary(wire('10'))
    expect(() => guard.disableFuses(app)).toThrow(/no EnableNodeOptionsEnvironmentVariable fuse/)
  })
})

describe('test hook scan', () => {
  it('finds each marker in nested files and in a raw archive', () => {
    fs.mkdirSync(path.join(root, 'build', 'renderer'), { recursive: true })
    fs.writeFileSync(path.join(root, 'build', 'renderer', 'a.js'), 'window.__myterm = {}')
    fs.writeFileSync(path.join(root, 'build', 'b.js'), 'process.env.MYTERM_DEBUG')
    fs.writeFileSync(path.join(root, 'build', 'clean.js'), 'console.log("ok")')
    fs.writeFileSync(path.join(root, 'app.asar'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('x__myterm')]))

    const found = guard.findTestHookMarkers([path.join(root, 'build'), path.join(root, 'app.asar')])
    expect(found.map((f) => [path.relative(root, f.file), f.marker]).sort()).toEqual([
      ['app.asar', '__myterm'],
      [path.join('build', 'b.js'), 'MYTERM_DEBUG'],
      [path.join('build', 'renderer', 'a.js'), '__myterm']
    ])
  })
})
