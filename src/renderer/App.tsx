/**
 * 조작 화면.
 *
 * 왼쪽에 프로필과 기기 상태, 가운데에 보드와 수집 현황, 오른쪽에 선택한 칸의
 * 설정이다. 마우스 없이 끝나야 한다. 이동은 방향키와 J/K, 명령은 ⌘K 다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Action, KeyInfo, Snapshot } from '../shared/types'
import { AppPicker } from './components/AppPicker'
import { NameDialog } from './components/NameDialog'
import { Palette, type PaletteCommand } from './components/Palette'
import { Select } from './components/Select'
import { IconGrid, IconLayers, IconPlus, IconPulse } from './icons'
import type { Meta } from '../preload/index'

const COLUMNS = 6
const LOADING_DELAY_MS = 200

const placedCount = (state: Snapshot) =>
  state.config.profiles
    .find((p) => p.name === state.config.active)!
    .slots.filter((s) => s.key).length

function relativeTime(at: number | null): string {
  if (!at) return ''
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 60) return `${seconds}초`
  if (seconds < 3600) return `${Math.round(seconds / 60)}분`
  return `${Math.round(seconds / 3600)}시간`
}

export function App() {
  const [state, setState] = useState<Snapshot | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [selected, setSelected] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [loginError, setLoginError] = useState('')
  const boardRef = useRef<HTMLDivElement>(null)

  // 개발 실행에서는 등록해도 소용이 없어 메인이 거절한다. 이유를 그대로 보인다
  const toggleLogin = useCallback(async () => {
    const current = await window.api.getState()
    const result = await window.api.setRunAtLogin(!current.runAtLogin)
    setLoginError(result.ok ? '' : result.message)
  }, [])

  // 200ms 미만이면 아무것도 보여주지 않는다
  useEffect(() => {
    const timer = setTimeout(() => setShowSkeleton(true), LOADING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    void window.api.getMeta().then(setMeta)
    void window.api.getState().then(setState)
    const offChanged = window.api.onChanged(setState)
    const offActive = window.api.onWindowActive((active) =>
      document.body.classList.toggle('window-inactive', !active),
    )
    const offNew = window.api.onMenu('menu:newProfile', () => setNaming('new'))
    const offRename = window.api.onMenu('menu:renameProfile', () => setNaming('rename'))
    const offRemove = window.api.onMenu('menu:removeProfile', () => void window.api.removeProfile())
    const offPalette = window.api.onMenu('menu:palette', () => setPaletteOpen(true))
    return () => {
      offChanged()
      offActive()
      offNew()
      offRename()
      offRemove()
      offPalette()
    }
  }, [])

  const profile = state?.config.profiles.find((p) => p.name === state.config.active) ?? null
  const slot = profile?.slots[selected] ?? null
  const keyInfo: KeyInfo | null =
    meta?.keys.find((entry) => entry.name === slot?.key) ?? null

  const move = useCallback(
    (dx: number, dy: number) => {
      setSelected((current) => {
        const column = (current % COLUMNS) + dx
        const row = Math.floor(current / COLUMNS) + dy
        if (column < 0 || column >= COLUMNS) return current
        const next = row * COLUMNS + column
        return next >= 0 && next < (meta?.keyCount ?? 18) ? next : current
      })
    },
    [meta],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (paletteOpen || naming) return
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.getAttribute('role') === 'combobox') return

      const map: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], h: [-1, 0],
        ArrowRight: [1, 0], l: [1, 0],
        ArrowUp: [0, -1], k: [0, -1],
        ArrowDown: [0, 1], j: [0, 1],
      }
      const delta = map[event.key]
      if (delta) {
        event.preventDefault()
        move(delta[0], delta[1])
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, paletteOpen, naming])

  const commands = useMemo<PaletteCommand[]>(() => {
    if (!state || !meta || !profile) return []
    const list: PaletteCommand[] = []
    list.push({
      id: 'clear-slot',
      group: '이 칸에 표시',
      label: '비우기',
      run: () => void window.api.setSlot(selected, { key: null }),
    })
    for (const entry of meta.keys) {
      list.push({
        id: `set-${entry.name}`,
        group: entry.group,
        groupColor: entry.groupColor,
        label: entry.label,
        detail: entry.summary,
        run: () => void window.api.setSlot(selected, { key: entry.name }),
      })
    }
    for (const item of state.config.profiles) {
      if (item.name === state.config.active) continue
      list.push({
        id: `profile-${item.name}`,
        group: '프로필',
        label: `${item.name} 으로 전환`,
        run: () => void window.api.switchProfile(item.name),
      })
    }
    list.push(
      { id: 'profile-new', group: '프로필', label: '새 프로필', shortcut: '⌘N', run: () => setNaming('new') },
      { id: 'profile-rename', group: '프로필', label: '이름 바꾸기', run: () => setNaming('rename') },
      { id: 'profile-remove', group: '프로필', label: '프로필 삭제', run: () => void window.api.removeProfile() },
      {
        id: 'login',
        group: '시스템',
        label: state.runAtLogin ? '로그인 시 자동 시작 끄기' : '로그인 시 자동 시작 켜기',
        run: () => void toggleLogin(),
      },
    )
    return list
  }, [state, meta, profile, selected, toggleLogin])

  if (!state || !meta) {
    return (
      <div className="window">
        <header className="titlebar drag-region" />
        <div className="body">
          <nav className="sidebar" />
          <main className="main">
            {showSkeleton ? (
              <div className="board">
                {Array.from({ length: 18 }, (_, index) => (
                  <div key={index} className="tile skeleton" />
                ))}
              </div>
            ) : null}
          </main>
          <aside className="panel" />
        </div>
      </div>
    )
  }

  const failed = state.sources.filter((source) => source.error)

  return (
    <div className="window">
      <header className="titlebar drag-region">
        <div className="crumb">
          <span>프로필</span>
          <span className="sep">/</span>
          <span>{state.config.active}</span>
          <span className="count">{placedCount(state)}</span>
        </div>
        <div className="spacer" />
        <button className="kbd-pill no-drag" onClick={() => setPaletteOpen(true)}>
          명령 <kbd>⌘K</kbd>
        </button>
      </header>

      <div className="body">
        <nav className="sidebar">
          <div className="section-label">프로필</div>
          {state.config.profiles.map((item) => (
            <button
              key={item.name}
              className="nav-item"
              aria-current={item.name === state.config.active}
              onClick={() => void window.api.switchProfile(item.name)}
            >
              <IconLayers />
              <span className="name">{item.name}</span>
              <span className="badge">{item.slots.filter((s) => s.key).length}</span>
            </button>
          ))}
          <button className="nav-item" onClick={() => setNaming('new')}>
            <IconPlus />
            <span className="name">새 프로필</span>
          </button>

          <div className="section-label">기기</div>
          <div className="status-line">
            <span
              className="dot"
              style={{
                color: state.device.connected ? 'var(--status-done)' : 'var(--status-blocked)',
              }}
            />
            <span className="detail">{state.device.message}</span>
          </div>
          <div className="slider-row">
            <span>밝기</span>
            <input
              type="range"
              min={10}
              max={100}
              value={state.config.brightness}
              onChange={(event) => void window.api.setBrightness(Number(event.target.value))}
            />
            <span className="value">{state.config.brightness}</span>
          </div>
        </nav>

        <main className="main">
          <div className="group-header">
            <IconGrid />
            보드 <span className="count">{placedCount(state)}/18</span>
          </div>

          <div className="board" ref={boardRef}>
            {state.tiles.map((tile, index) => (
              <button
                key={index}
                className="tile"
                aria-selected={index === selected}
                aria-label={`${Math.floor(index / COLUMNS) + 1}행 ${(index % COLUMNS) + 1}열`}
                data-empty={!profile?.slots[index].key}
                onClick={() => setSelected(index)}
              >
                {/* 빈 칸은 검은 그림 대신 표면을 보인다. 배치 가능한 자리로 읽혀야 한다. */}
                {profile?.slots[index].key ? <img src={tile} alt="" draggable={false} /> : null}
              </button>
            ))}
          </div>

          <div className="group-header">
            <IconPulse />
            수집 <span className="count">{state.sources.length - failed.length}/{state.sources.length}</span>
          </div>
          {state.sources.length === 0 ? (
            <p className="empty-note">
              아직 수집할 것이 없다. 칸에 항목을 올리면 그 항목에 필요한 것만 모으기 시작한다.
            </p>
          ) : (
            state.sources.map((source) => (
              <div className="row" key={source.name}>
                <span
                  className="dot"
                  style={{
                    color: source.error
                      ? 'var(--status-blocked)'
                      : source.ok
                        ? 'var(--status-done)'
                        : 'var(--status-todo)',
                  }}
                />
                <span className="name">{source.name}</span>
                <span className="detail">
                  {source.error ?? source.note ?? (source.ok ? '' : '아직 받지 못했다')}
                </span>
                <span className="time">{relativeTime(source.updatedAt)}</span>
              </div>
            ))
          )}
        </main>

        <aside className="panel">
          <h3>
            {Math.floor(selected / COLUMNS) + 1}행 {(selected % COLUMNS) + 1}열
          </h3>

          <div className="field">
            <label>표시</label>
            <Select
              ariaLabel="표시할 항목"
              value={slot?.key ?? ''}
              onChange={(value) => void window.api.setSlot(selected, { key: value || null })}
              options={[
                { value: '', label: '빈 칸' },
                ...meta.keys.map((entry) => ({
                  value: entry.name,
                  label: entry.summary,
                  tag: entry.label,
                  group: entry.group,
                  groupColor: entry.groupColor,
                })),
              ]}
            />
            {keyInfo ? <p className="hint">{keyInfo.summary}</p> : null}
          </div>

          {keyInfo?.options.map((option) => (
            <div className="field" key={option.name}>
              <label>{option.label}</label>
              {option.kind === 'app' ? (
                <AppPicker
                  ariaLabel={option.label}
                  value={slot?.options[option.name] ?? ''}
                  apps={state.apps}
                  onChange={(id) =>
                    void window.api.setSlot(selected, { options: { [option.name]: id } })
                  }
                />
              ) : option.kind === 'choice' ? (
                <Select
                  ariaLabel={option.label}
                  value={slot?.options[option.name] ?? option.choices?.[0]?.value ?? ''}
                  onChange={(value) =>
                    void window.api.setSlot(selected, { options: { [option.name]: value } })
                  }
                  options={option.choices ?? []}
                />
              ) : (
                <div className="field-row">
                  <input
                    className="input"
                    placeholder={option.placeholder}
                    defaultValue={slot?.options[option.name] ?? ''}
                    key={`${selected}-${slot?.key}-${option.name}`}
                    onBlur={(event) =>
                      void window.api.setSlot(selected, {
                        options: { [option.name]: event.target.value },
                      })
                    }
                  />
                  {option.kind === 'file' ? (
                    <button
                      className="button"
                      onClick={async () => {
                        const path = await window.api.pickFile()
                        if (path) {
                          void window.api.setSlot(selected, { options: { [option.name]: path } })
                        }
                      }}
                    >
                      고르기
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ))}

          <hr />

          <div className="field">
            <label>누를 때</label>
            <Select
              ariaLabel="누를 때 할 일"
              value={slot?.action.kind ?? 'none'}
              onChange={(kind) =>
                void window.api.setAction(selected, {
                  kind: kind as Action['kind'],
                  value: kind === 'media' ? meta.media[0]?.value ?? '' : '',
                })
              }
              options={Object.entries(meta.actionLabels).map(([value, label]) => ({ value, label }))}
            />
          </div>

          {slot && slot.action.kind === 'media' ? (
            <div className="field">
              <label>동작</label>
              <Select
                ariaLabel="미디어 동작"
                value={slot.action.value}
                onChange={(value) => void window.api.setAction(selected, { kind: 'media', value })}
                options={meta.media.map((choice) => ({ value: choice.value, label: choice.label }))}
              />
            </div>
          ) : null}

          {slot && slot.action.kind === 'app' ? (
            <div className="field">
              <label>실행할 앱</label>
              <AppPicker
                ariaLabel="실행할 앱"
                value={slot.action.value}
                apps={state.apps}
                onChange={(id) => void window.api.setAction(selected, { kind: 'app', value: id })}
              />
            </div>
          ) : null}

          {slot && ['url', 'shell'].includes(slot.action.kind) ? (
            <div className="field">
              <label>값</label>
              <input
                className="input"
                key={`${selected}-${slot.action.kind}`}
                defaultValue={slot.action.value}
                placeholder={slot.action.kind === 'url' ? 'https://example.com' : 'say hello'}
                onBlur={(event) =>
                  void window.api.setAction(selected, {
                    kind: slot.action.kind,
                    value: event.target.value,
                  })
                }
              />
            </div>
          ) : null}

          <hr />

          <div className="field">
            <label>이 프로필을 쓸 앱</label>
            <AppPicker
              ariaLabel="프로필에 연결할 앱"
              value={profile?.app ?? ''}
              apps={state.apps}
              emptyLabel="연결 안 함"
              onChange={(id) => void window.api.setProfileApp(id)}
            />
            <p className="hint">고른 앱이 앞으로 나오면 이 프로필로 자동 전환한다.</p>
          </div>

          <div className="toggle-row">
            <span id="run-at-login">로그인할 때 자동 시작</span>
            <button
              className="switch"
              role="switch"
              aria-checked={state.runAtLogin}
              aria-labelledby="run-at-login"
              onClick={toggleLogin}
            >
              <span className="knob" />
            </button>
          </div>
          {loginError ? <p className="hint error">{loginError}</p> : null}
        </aside>
      </div>

      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      <NameDialog
        open={naming !== null}
        title={naming === 'new' ? '새 프로필' : '이름 바꾸기'}
        initial={naming === 'rename' ? (profile?.name ?? '') : ''}
        confirmLabel={naming === 'new' ? '만들기' : '바꾸기'}
        onClose={() => setNaming(null)}
        onConfirm={(name) => {
          if (naming === 'new') void window.api.addProfile(name)
          else void window.api.renameProfile(name)
          setNaming(null)
        }}
      />
    </div>
  )
}
