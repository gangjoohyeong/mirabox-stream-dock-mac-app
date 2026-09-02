/**
 * 로그인 시 자동 실행 (launchd).
 *
 * 앱이 데몬을 품고 있으므로 앱 자신을 등록한다. 개발 중에는 electron 이
 * 프로젝트를 여는 형태라 등록해도 의미가 없으니 그때는 막는다.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const run = promisify(execFile)

export const LABEL = 'com.jkang.mirabox'
export const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
export const LOG_DIR = join(homedir(), 'Library', 'Logs', 'mirabox')

const domain = () => `gui/${userInfo().uid}`

async function launchctl(...args: string[]): Promise<boolean> {
  try {
    await run('launchctl', args)
    return true
  } catch {
    return false
  }
}

export const isPackaged = () => app.isPackaged
export const isInstalled = () => existsSync(PLIST_PATH)
export const isRunning = () => launchctl('print', `${domain()}/${LABEL}`)

function plist(): string {
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const args = [app.getPath('exe')].map((a) => `      <string>${escape(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>RunAtLoad</key><true/>
    <key>ProcessType</key><string>Interactive</string>
    <key>StandardOutPath</key><string>${escape(join(LOG_DIR, 'agent.log'))}</string>
    <key>StandardErrorPath</key><string>${escape(join(LOG_DIR, 'agent.err'))}</string>
  </dict>
</plist>
`
}

export async function install(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true })
  mkdirSync(dirname(PLIST_PATH), { recursive: true })
  writeFileSync(PLIST_PATH, plist(), 'utf8')
  await launchctl('bootout', domain(), PLIST_PATH)
  await launchctl('bootstrap', domain(), PLIST_PATH)
}

export async function uninstall(): Promise<void> {
  await launchctl('bootout', domain(), PLIST_PATH)
  rmSync(PLIST_PATH, { force: true })
}
