'use strict'
// electron-builder afterPack hook (macOS): turn off the Electron fuses that
// let anyone run code inside the app (ELECTRON_RUN_AS_NODE, NODE_OPTIONS,
// --inspect), re-sign ad hoc because that edits the Electron binary, then
// refuse the package if any fuse is still on or a test hook got in.

const { execFileSync } = require('child_process')
const path = require('path')
const { disableFuses, findTestHookMarkers, fuseProblems } = require('./release-guard.cjs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    throw new Error(`after-pack: ${context.electronPlatformName} is not supported`)
  }
  const appBundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  disableFuses(appBundle)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appBundle], { stdio: 'inherit' })

  const resources = path.join(appBundle, 'Contents', 'Resources')
  const problems = [
    ...fuseProblems(appBundle),
    ...findTestHookMarkers([path.join(resources, 'app.asar')]).map(
      ({ file, marker }) => `test hook "${marker}" in ${file}`
    )
  ]
  if (problems.length > 0) throw new Error(`after-pack: release check failed:\n${problems.join('\n')}`)
  console.log(`after-pack: fuses off and no test hooks in ${appBundle}`)
}
