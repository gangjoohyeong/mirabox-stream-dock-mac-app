/** 메인과 렌더러가 함께 쓰는 타입. 여기에는 로직을 두지 않는다. */

export const ACTION_KINDS = ['none', 'app', 'url', 'shell', 'media'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export interface Action {
  kind: ActionKind
  value: string
}

export interface Slot {
  key: string | null
  options: Record<string, string>
  action: Action
}

export interface Profile {
  name: string
  slots: Slot[]
  /**
   * 이 앱이 앞으로 나오면 자동 전환한다. 빈 값이면 수동 전환만.
   *
   * 값은 번들 ID(`com.microsoft.VSCode`)다. 예전 설정에는 이름이 들어 있을 수
   * 있어 이름도 함께 맞춰 본다.
   */
  app: string
}

export interface Config {
  profiles: Profile[]
  active: string
  brightness: number
  refreshSeconds: number
}

/** 조작 화면이 입력란을 만들 때 쓰는 키별 개별 설정 정의 */
export interface KeyOption {
  name: string
  label: string
  kind: 'text' | 'file' | 'choice' | 'app'
  placeholder: string
  /** kind 가 choice 일 때 고를 수 있는 값 */
  choices?: MediaChoice[]
}

export interface KeyInfo {
  name: string
  label: string
  summary: string
  /** 묶어서 보여줄 이름. 'Claude', 'Google' 같은 출처다. */
  group: string
  /** 묶음을 알아볼 색. 기기 표식과 같은 값이다. */
  groupColor: string
  sources: string[]
  options: KeyOption[]
}

export interface SourceStatus {
  name: string
  ok: boolean
  error: string | null
  updatedAt: number | null
  /** 값 자체가 낡았을 때의 설명. 마지막으로 읽은 시각과는 다르다. */
  note: string | null
}

export interface DeviceStatus {
  connected: boolean
  message: string
}

/** 렌더러가 보드를 그리는 데 필요한 한 판의 상태 */
export interface Snapshot {
  config: Config
  device: DeviceStatus
  sources: SourceStatus[]
  /** 칸별 미리보기. data:image/png;base64 */
  tiles: string[]
  runAtLogin: boolean
  apps: AppInfo[]
}

/**
 * 고를 수 있는 앱 하나.
 *
 * 이름은 사람에게 보여줄 뿐이고, 붙잡는 것도 실행하는 것도 전부 id 로 한다.
 * 같은 앱이 파일명, Info.plist, 화면 표시에서 서로 다른 이름을 갖는다.
 */
export interface AppInfo {
  id: string
  name: string
  running: boolean
  /** 번들 경로. 아이콘을 뽑을 때 쓴다. */
  path: string
}

/** 로그인 자동 시작 결과. 실패하면 이유를 화면에 띄운다. */
export interface LoginResult {
  ok: boolean
  message: string
}

export interface MediaChoice {
  value: string
  label: string
}
