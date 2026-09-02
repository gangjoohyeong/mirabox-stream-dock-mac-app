/**
 * 외부 명령 실행.
 *
 * 연동 대부분이 바깥 CLI 를 부른다. 자격증명은 그 도구들이 들고 있으므로 이
 * 저장소에 비밀정보가 없다. launchd 나 .app 으로 띄우면 PATH 가 빈약해서
 * 직접 채운다.
 */

import { execFile, spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

function buildPath(): string {
  const dirs = [join(homedir(), '.local', 'bin')]
  try {
    const nvm = join(homedir(), '.nvm', 'versions', 'node')
    for (const version of readdirSync(nvm).sort().reverse()) dirs.push(join(nvm, version, 'bin'))
  } catch {
    /* nvm 이 없으면 그만 */
  }
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin')
  return dirs.join(':')
}

export const ENV = { ...process.env, PATH: buildPath(), LC_ALL: 'C' }

/** 셸 한 줄을 돌리고 stdout 을 돌려준다. */
export async function sh(script: string, timeoutMs: number): Promise<string> {
  const { stdout } = await run('/bin/sh', ['-c', script], {
    timeout: timeoutMs,
    env: ENV,
    maxBuffer: 8 << 20,
    encoding: 'utf8',
  })
  return stdout
}

/** 키 액션처럼 결과를 기다리지 않는 실행. */
export function spawnDetached(script: string): void {
  spawn('/bin/sh', ['-c', script], { env: ENV, detached: true, stdio: 'ignore' }).unref()
}

/** 일부 CLI 는 stdout 앞에 안내 문구를 한 줄 붙인다. */
export function jsonAfterNoise(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) return null
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}
