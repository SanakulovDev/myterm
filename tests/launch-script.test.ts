import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import {
  LAUNCH_SCRIPT,
  buildLaunchSpawn,
  isPosixShell,
  resolveDefaultShell
} from '../src/main/launch-script'

const NONCE = '0123456789abcdef0123456789abcdef'

describe('buildLaunchSpawn', () => {
  it('spawns a plain login shell when there is nothing to launch', () => {
    expect(buildLaunchSpawn('/bin/zsh', undefined, NONCE)).toEqual({
      kind: 'plain',
      args: ['-l'],
      env: {}
    })
    expect(buildLaunchSpawn('/bin/zsh', { command: '   ' }, NONCE).kind).toBe('plain')
  })

  it('runs the fixed script in an interactive login shell', () => {
    const plan = buildLaunchSpawn('/bin/zsh', { command: 'claude', args: '--verbose' }, NONCE)
    expect(plan.kind).toBe('launch')
    expect(plan.args).toEqual(['-l', '-i', '-c', LAUNCH_SCRIPT])
  })

  it('passes user values only through env, never into the script', () => {
    const command = `/tmp/it's a "dir"/$(touch pwned); rm -rf ~`
    const args = `--name 'x' $(id) ; echo`
    const shell = "/opt/my shells/zsh"
    const plan = buildLaunchSpawn(shell, { command, args: `  ${args}  ` }, NONCE)

    expect(plan.args[3]).toBe(LAUNCH_SCRIPT)
    expect(plan.env).toEqual({
      MYTERM_AGENT_CMD: command,
      MYTERM_AGENT_ARGS: args,
      MYTERM_SHELL: shell,
      MYTERM_LAUNCH_NONCE: NONCE
    })
    expect(LAUNCH_SCRIPT).not.toContain(command)
  })

  it('treats args as optional', () => {
    const plan = buildLaunchSpawn('/bin/bash', { command: 'codex' }, NONCE)
    expect(plan.env.MYTERM_AGENT_ARGS).toBe('')
  })

  it('does not auto-launch in non-POSIX shells', () => {
    for (const shell of ['/opt/homebrew/bin/fish', '/usr/local/bin/nu']) {
      expect(buildLaunchSpawn(shell, { command: 'claude' }, NONCE)).toEqual({
        kind: 'unsupported-shell',
        args: ['-l'],
        env: {}
      })
    }
  })
})

describe('isPosixShell', () => {
  it('recognises POSIX shells by basename', () => {
    for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/dash', '/opt/homebrew/bin/bash']) {
      expect(isPosixShell(shell)).toBe(true)
    }
    for (const shell of ['/opt/homebrew/bin/fish', '/usr/local/bin/nu', '/usr/bin/xonsh']) {
      expect(isPosixShell(shell)).toBe(false)
    }
  })
})

describe('resolveDefaultShell', () => {
  it('returns an existing shell', () => {
    const shell = resolveDefaultShell()
    expect(shell.startsWith('/')).toBe(true)
    expect(fs.existsSync(shell)).toBe(true)
  })
})

describe('LAUNCH_SCRIPT', () => {
  it.each(['/bin/sh', '/bin/bash', '/bin/zsh'])('parses in %s', (shell) => {
    const result = spawnSync(shell, ['-n', '-c', LAUNCH_SCRIPT], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('unsets its env vars (including the nonce) before running the agent', () => {
    const unsetAt = LAUNCH_SCRIPT.indexOf(
      'unset MYTERM_AGENT_CMD MYTERM_AGENT_ARGS MYTERM_SHELL MYTERM_LAUNCH_NONCE'
    )
    expect(unsetAt).toBeGreaterThan(-1)
    expect(unsetAt).toBeLessThan(LAUNCH_SCRIPT.indexOf('"$__mt_cmd" $__mt_args'))
  })

  it('checks the command with command -v in the same shell', () => {
    expect(LAUNCH_SCRIPT).toContain('command -v -- "$__mt_cmd"')
  })

  it('catches SIGINT with a handler (reset on exec) rather than ignoring it', () => {
    expect(LAUNCH_SCRIPT).toContain(`trap ':' INT`)
    expect(LAUNCH_SCRIPT).not.toContain(`trap '' INT`)
  })

  it('emits the marker and then execs the panel shell as a login shell', () => {
    expect(LAUNCH_SCRIPT).toContain(`printf '\\033]6973;myterm;%s;exit;%d\\007'`)
    expect(LAUNCH_SCRIPT).toContain(`printf '\\033]6973;myterm;%s;missing\\007'`)
    expect(LAUNCH_SCRIPT.trimEnd().endsWith('exec "$__mt_shell" -l')).toBe(true)
  })
})
