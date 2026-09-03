/**
 * 앱 아이콘을 PNG 로 뽑아 둔다.
 *
 * 번들 안의 .icns 를 직접 읽는 방법은 요즘 앱에 잘 안 먹는다. 아이콘이
 * Assets.car 에만 들어 있고 Info.plist 에 파일 이름이 없는 앱이 많다.
 * 그래서 시스템에 물어본다. NSWorkspace 는 무엇이 들었든 그려 준다.
 *
 * Electron 의 app.getFileIcon 은 32px 밖에 안 주고 size:'large' 는 이
 * 버전에서 SIGTRAP 으로 죽는다. 95px 키에 쓰기엔 모자라서 쓰지 않는다.
 *
 * 심볼릭 링크는 먼저 풀어야 한다. /Applications/Safari.app 은 링크라서
 * 그대로 물어보면 별칭 화살표가 박힌 아이콘이 나온다.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ENV } from './shell.js'

const run = promisify(execFile)

const CACHE_DIR = join(homedir(), '.config', 'mirabox', 'icons')
const SIZE = 256
const TIMEOUT_MS = 8000

/**
 * 경로와 저장 위치는 환경변수로 넘긴다.
 *
 * 스크립트 안에 끼워 넣으면 따옴표가 들어간 앱 이름 하나에 깨진다.
 */
const SCRIPT = `
ObjC.import('AppKit');
ObjC.import('Foundation');
const env = $.NSProcessInfo.processInfo.environment;
const get = (k) => ObjC.unwrap(env.objectForKey(k));
const size = parseInt(get('MIRABOX_ICON_SIZE'), 10);
const icon = $.NSWorkspace.sharedWorkspace.iconForFile(get('MIRABOX_ICON_APP'));
if (!icon) throw new Error('아이콘 없음');
const canvas = $.NSImage.alloc.initWithSize($.NSMakeSize(size, size));
canvas.lockFocus;
icon.drawInRect($.NSMakeRect(0, 0, size, size));
canvas.unlockFocus;
const bitmap = $.NSBitmapImageRep.imageRepWithData(canvas.TIFFRepresentation);
const png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
png.writeToFileAtomically(get('MIRABOX_ICON_OUT'), true);
`

/** 번들 ID 는 파일 이름으로 그대로 쓰기엔 위험하다. */
const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_')

/** 뽑기에 실패한 앱을 매번 다시 시도하지 않는다. */
const failed = new Set<string>()

function cachedPath(id: string, bundlePath: string): string | null {
  const file = join(CACHE_DIR, `${safeName(id)}.png`)
  if (!existsSync(file)) return null
  try {
    // 앱을 업데이트하면 아이콘이 바뀔 수 있다
    return statSync(file).mtimeMs >= statSync(bundlePath).mtimeMs ? file : null
  } catch {
    return file
  }
}

/**
 * 아이콘 PNG 경로. 없으면 뽑아서 만든다.
 *
 * 뽑는 데 0.15 초쯤 걸리므로 그릴 때마다 부르면 안 된다. 데몬이 그리기 전에
 * 미리 데워 두고, 여기서는 캐시가 있으면 바로 돌려준다.
 */
export async function iconFile(id: string, bundlePath: string): Promise<string | null> {
  if (!id || !bundlePath) return null
  const hit = cachedPath(id, bundlePath)
  if (hit) return hit
  if (failed.has(id)) return null

  const out = join(CACHE_DIR, `${safeName(id)}.png`)
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    await run('osascript', ['-l', 'JavaScript', '-e', SCRIPT], {
      timeout: TIMEOUT_MS,
      env: {
        ...ENV,
        MIRABOX_ICON_APP: realpathSync(bundlePath),
        MIRABOX_ICON_OUT: out,
        MIRABOX_ICON_SIZE: String(SIZE),
      },
    })
    return existsSync(out) ? out : null
  } catch {
    // 지워진 앱이나 권한 문제. 한 번 실패하면 다시 시도하지 않는다
    failed.add(id)
    return null
  }
}

/** 앱을 다시 훑었으면 실패 기록을 지운다. 새로 설치했을 수 있다. */
export function forgetFailures(): void {
  failed.clear()
}
