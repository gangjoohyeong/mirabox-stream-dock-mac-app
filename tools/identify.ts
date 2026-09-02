/**
 * 꽂혀 있는 기기의 정체만 읽는다. 열지도 쓰지도 않는다.
 *
 * 다른 모델을 쓰는 사람이 자기 값을 확인하고 이 저장소의 값과 견줘 볼 수
 * 있게 두는 도구다. 앱이 돌고 있어도 안전하다. 열지 않으므로 점유를 뺏지
 * 않는다.
 *
 *   npx tsx tools/identify.ts
 */

import HID from 'node-hid'
import { PRODUCT_ID, VENDOR_ID } from '../src/main/device.js'

const all = HID.devices()
const mine = all.filter((d) => d.vendorId === VENDOR_ID)

if (mine.length === 0) {
  console.log(`Vendor ID 0x${VENDOR_ID.toString(16)} 인 기기가 없다. USB 연결을 확인할 것.`)
  console.log(`꽂혀 있는 HID 기기 ${all.length}개 중 벤더가 같은 것이 없다.`)
  process.exit(1)
}

console.log(`인터페이스 ${mine.length}개를 찾았다.\n`)
for (const d of mine) {
  console.log([
    `  Vendor ID      0x${d.vendorId.toString(16).padStart(4, '0')}`,
    `  Product ID     0x${d.productId.toString(16).padStart(4, '0')}`,
    `  usage page     0x${(d.usagePage ?? 0).toString(16)} / usage 0x${(d.usage ?? 0).toString(16)}`,
    `  제조사          ${d.manufacturer || '(비어 있음)'}`,
    `  제품명          ${d.product || '(비어 있음)'}`,
    `  일련번호        ${d.serialNumber || '(없음)'}`,
    `  bcdDevice      0x${(d.release ?? 0).toString(16).padStart(4, '0')}`,
    '',
  ].join('\n'))
}

const known = mine.some((d) => d.productId === PRODUCT_ID)
console.log(
  known
    ? '이 저장소가 검증한 Product ID 와 같다. 그대로 동작할 것이다.'
    : `이 저장소가 검증한 것은 0x${PRODUCT_ID.toString(16)} 뿐이다. 동작은 해 볼 만하지만 보장하지 않는다.`,
)
