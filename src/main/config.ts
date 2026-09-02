/**
 * 설정.
 *
 * 프로필 여러 개를 두고 그중 하나가 활성이다. 프로필에 앱을 지정해 두면 그
 * 앱이 앞으로 나올 때 자동으로 전환된다.
 *
 * 칸 하나는 무엇을 보여줄지(key), 그 키의 개별 설정(options), 누를 때 할
 * 일(action)을 가진다.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { KEY_COUNT } from './device.js'
import { normalizeAction } from './actions.js'
import type { Config, Profile, Slot } from '../shared/types.js'

export const CONFIG_PATH = join(homedir(), '.config', 'mirabox', 'config.json')
export const DEFAULT_PROFILE = '기본'

const DEFAULT_KEYS: (string | null)[] = [
  'five', 'seven', 'ctx', 'cost', 'cache', null,
  'today', 'burn', 'mail', 'cal', 'jira', null,
  'mr', 'build', null, null, null, null,
]

const emptySlot = (): Slot => ({ key: null, options: {}, action: { kind: 'none', value: '' } })

function parseSlot(raw: unknown): Slot {
  if (raw == null || typeof raw === 'string') return { ...emptySlot(), key: (raw as string) || null }
  const value = raw as Partial<Slot> & { action?: unknown }
  return {
    key: value.key || null,
    options: { ...(value.options ?? {}) },
    action: normalizeAction(value.action),
  }
}

function defaultSlots(): Slot[] {
  return DEFAULT_KEYS.map((name) => ({ ...emptySlot(), key: name }))
}

export function defaultProfile(name = DEFAULT_PROFILE): Profile {
  return { name, slots: defaultSlots(), app: '' }
}

function normalizeProfile(profile: Profile): Profile {
  const slots = [...profile.slots]
  while (slots.length < KEY_COUNT) slots.push(emptySlot())
  return { name: profile.name || DEFAULT_PROFILE, slots: slots.slice(0, KEY_COUNT), app: profile.app || '' }
}

export function normalize(config: Config): Config {
  const profiles = config.profiles.map(normalizeProfile)
  if (profiles.length === 0) profiles.push(defaultProfile())
  const names = new Set(profiles.map((p) => p.name))
  return {
    profiles,
    active: names.has(config.active) ? config.active : profiles[0].name,
    brightness: Math.max(0, Math.min(100, Math.round(config.brightness))),
    refreshSeconds: Math.max(2, config.refreshSeconds),
  }
}

export function profileOf(config: Config, name?: string): Profile {
  const target = name ?? config.active
  return config.profiles.find((p) => p.name === target) ?? config.profiles[0]
}

/** 앞으로 나온 앱에 묶인 프로필. 없으면 null. */
export function profileForApp(config: Config, app: string): Profile | null {
  if (!app) return null
  const lower = app.toLowerCase()
  return config.profiles.find((p) => p.app && p.app.toLowerCase() === lower) ?? null
}

export function keysInUse(profile: Profile): Set<string> {
  return new Set(profile.slots.map((s) => s.key).filter((k): k is string => Boolean(k)))
}

export function load(path = CONFIG_PATH): Config {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return normalize({ profiles: [defaultProfile()], active: DEFAULT_PROFILE, brightness: 80, refreshSeconds: 15 })
  }

  const profilesRaw = raw.profiles as Array<Record<string, unknown>> | undefined
  const profiles: Profile[] = (profilesRaw ?? []).map((entry) => ({
    name: String(entry.name ?? DEFAULT_PROFILE),
    slots: ((entry.slots as unknown[]) ?? []).map(parseSlot),
    app: String(entry.app ?? ''),
  }))

  return normalize({
    profiles: profiles.length ? profiles : [defaultProfile()],
    active: String(raw.active ?? DEFAULT_PROFILE),
    brightness: Number(raw.brightness ?? 80),
    refreshSeconds: Number(raw.refreshSeconds ?? 15),
  })
}

export function save(config: Config, path = CONFIG_PATH): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(normalize(config), null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}
