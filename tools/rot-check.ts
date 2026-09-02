/**
 * 회전 방향을 확인한다.
 *
 * 기기가 요구하는 것은 반시계 90도다. 시계 방향으로 돌리면 화면이 뒤집혀
 * 나온다. 참고한 Rust 구현은 시계 방향 회전에 좌우 반전을 붙여 같은 결과를
 * 내므로 그대로 옮기면 틀린다. 픽셀을 찍어 방향만 본다.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { encodeKey } from '../src/main/render.js'

async function main() {
  const S = 96
  const src = createCanvas(S, S)
  const c = src.getContext('2d')
  c.fillStyle = '#000000'; c.fillRect(0, 0, S, S)
  c.fillStyle = '#ff0000'; c.fillRect(0, 0, 24, 24)        // 좌상단 빨강
  c.fillStyle = '#00ff00'; c.fillRect(S - 24, 0, 24, 24)   // 우상단 초록

  const img = await loadImage(encodeKey(src, 95))
  const out = createCanvas(S, S)
  const o = out.getContext('2d')
  o.drawImage(img, 0, 0)

  const at = (x: number, y: number) => {
    const [r, g] = o.getImageData(x, y, 1, 1).data
    if (r > 150 && g < 100) return '빨강'
    if (g > 150 && r < 100) return '초록'
    return '검정'
  }
  console.log('원본: 좌상단 빨강, 우상단 초록')
  console.log('  회전 후 좌상단:', at(12, 12))
  console.log('  회전 후 우상단:', at(S - 12, 12))
  console.log('  회전 후 좌하단:', at(12, S - 12))
  console.log('  회전 후 우하단:', at(S - 12, S - 12))
  const ok = at(12, S - 12) === '빨강' && at(12, 12) === '초록'
  console.log(ok ? '\n반시계 90도 확인' : '\n회전 방향이 다르다')
  process.exit(ok ? 0 : 1)
}
main()
