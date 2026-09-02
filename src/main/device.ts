/**
 * Mirabox Stream Dock 293S HID 전송 계층.
 *
 * 프로토콜은 선행 리버스 엔지니어링 작업에서 확인한 규격을 따른다. 구현은
 * 직접 작성했다. 참고한 곳은 README 의 "참고 구현" 절에 적어 두었다.
 *
 * 프레임 구조
 *   바이트 0      HID 리포트 ID (항상 0x00)
 *   바이트 1..5   ASCII "CRT" + 0x00 0x00
 *   바이트 6..    명령과 인자
 *   나머지        0x00 으로 512 바이트까지 채운다
 *
 * 기기는 키를 누를 때가 아니라 뗄 때 한 번만 보고한다.
 */

import HID from 'node-hid'

export const VENDOR_ID = 0x5548
export const PRODUCT_ID = 0x6670

export const PACKET = 512
const HEADER = Buffer.from('CRT\x00\x00', 'latin1')

export const COLUMNS = 6
export const ROWS = 3
export const KEY_COUNT = COLUMNS * ROWS

/** 논리 키 번호(좌상단부터 행 우선) -> 기기 내부 키 ID */
export const KEY_IDS = [
  0x0d, 0x0a, 0x07, 0x04, 0x01, 0x10,
  0x0e, 0x0b, 0x08, 0x05, 0x02, 0x11,
  0x0f, 0x0c, 0x09, 0x06, 0x03, 0x12,
]
const DEVICE_ID_TO_KEY = new Map(KEY_IDS.map((deviceId, index) => [deviceId, index]))

/** 오른쪽 끝 열(논리 키 5, 11, 17)은 본체 키가 아니라 사이드 디스플레이다 */
const SIDE_KEY_IDS = new Set([0x10, 0x11, 0x12])

/** 펌웨어 V2.293S 는 프로토콜 v2 다. v1 은 전부 85x85 였다. */
export const KEY_SIZE = 95
export const SIDE_SIZE = 82

export function keySize(key: number): number {
  return SIDE_KEY_IDS.has(KEY_IDS[key]) ? SIDE_SIZE : KEY_SIZE
}

export class DeviceError extends Error {}

export interface KeyEvent {
  key: number
  pressed: boolean
}

/**
 * 매핑에 없는 입력 보고를 남겨 둔다. 사이드 3키(0x10~0x12)가 실제로 무엇을
 * 보내는지 아직 확인하지 못했다. 눌러 본 뒤 이 목록을 보면 알 수 있다.
 */
export const unknownReports: string[] = []
const UNKNOWN_CAP = 40

export function listDevices(): HID.Device[] {
  // 이 기기는 제품명 문자열이 비어 있다. 반드시 VID 로 찾는다.
  return HID.devices().filter(
    (d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID,
  )
}

export class StreamDock {
  private hid: HID.HID | null = null

  open(): void {
    const found = listDevices()
    if (found.length === 0) {
      throw new DeviceError(
        `기기를 찾지 못했다 (VID 0x${VENDOR_ID.toString(16)} PID 0x${PRODUCT_ID.toString(16)}). USB 연결을 확인한다.`,
      )
    }
    const path = found[0].path
    if (!path) throw new DeviceError('기기 경로를 읽지 못했다')
    try {
      this.hid = new HID.HID(path)
    } catch (cause) {
      throw new DeviceError(
        ' 기기를 열지 못했다. StreamDock.app 이 떠 있으면 점유하므로 먼저 종료한다.'.trim(),
        { cause },
      )
    }
  }

  close(): void {
    if (!this.hid) return
    try {
      this.hid.close()
    } finally {
      this.hid = null
    }
  }

  get isOpen(): boolean {
    return this.hid !== null
  }

  private require(): HID.HID {
    if (!this.hid) throw new DeviceError('열려 있지 않다. open() 을 먼저 부른다.')
    return this.hid
  }

  /** 리포트 ID 를 붙이고 한 패킷 길이로 맞춰 보낸다. */
  private writeFrame(payload: Buffer): void {
    if (payload.length > PACKET) {
      throw new DeviceError(`패킷이 너무 길다: ${payload.length} > ${PACKET}`)
    }
    const frame = Buffer.alloc(PACKET + 1)
    payload.copy(frame, 1)
    this.require().write(Array.from(frame))
  }

  private command(...parts: (Buffer | number[])[]): void {
    const chunks = parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))
    this.writeFrame(Buffer.concat([HEADER, ...chunks]))
  }

  connect(): void {
    this.command(Buffer.from('CONNECT', 'latin1'))
  }

  disconnect(): void {
    this.command(Buffer.from('DIS', 'latin1'))
  }

  /** 모든 키를 지운다. 다만 부팅 로딩 화면은 이걸로 사라지지 않는다. */
  clear(): void {
    this.command(Buffer.from('CLE', 'latin1'), [0x00, 0x00, 0x00, 0xff])
  }

  setBrightness(percent: number): void {
    const value = Math.max(0, Math.min(100, Math.round(percent)))
    this.command(Buffer.from('LIG', 'latin1'), [0x00, 0x00, value, 0x00])
  }

  /** 보낸 이미지를 화면에 반영한다. */
  refresh(): void {
    this.command(Buffer.from('STP', 'latin1'))
  }

  /** 키 하나에 JPEG 를 올린다. */
  setKeyImage(key: number, jpeg: Buffer): void {
    if (key < 0 || key >= KEY_COUNT) throw new DeviceError(`키 번호 범위를 벗어났다: ${key}`)
    if (jpeg.length > 0xffff) throw new DeviceError(`이미지가 너무 크다: ${jpeg.length} 바이트`)

    const size = Buffer.alloc(2)
    size.writeUInt16BE(jpeg.length, 0)
    this.command(Buffer.from('BAT', 'latin1'), [0x00, 0x00], size, [KEY_IDS[key]])
    for (let offset = 0; offset < jpeg.length; offset += PACKET) {
      this.writeFrame(jpeg.subarray(offset, offset + PACKET))
    }
    this.command(Buffer.from('STP', 'latin1'))
  }

  /**
   * 입력 보고는 ACK\0\0OK\0 뒤에 기기 키 ID 와 상태가 붙는다.
   * 기기는 뗄 때만 보고하므로 누름과 뗌을 한 쌍으로 만들어 돌려준다.
   */
  readEvents(timeoutMs = 0): KeyEvent[] {
    const events: KeyEvent[] = []
    const hid = this.require()
    let wait = timeoutMs
    for (;;) {
      const data = hid.readTimeout(wait)
      if (!data || data.length === 0) return events
      wait = 1 // 첫 패킷 이후로는 사실상 대기하지 않는다
      if (data.length < 11) continue
      if (data[0] !== 0x41 || data[1] !== 0x43 || data[2] !== 0x4b) continue // "ACK"
      const key = DEVICE_ID_TO_KEY.get(data[9])
      if (key === undefined) {
        if (unknownReports.length < UNKNOWN_CAP) {
          unknownReports.push(Buffer.from(data.slice(0, 16)).toString('hex'))
        }
        continue
      }
      events.push({ key, pressed: true }, { key, pressed: false })
    }
  }

  /** 묵은 입력 보고를 버린다. */
  drain(): void {
    const hid = this.require()
    while (hid.readTimeout(1)?.length) {
      /* 버린다 */
    }
  }
}
