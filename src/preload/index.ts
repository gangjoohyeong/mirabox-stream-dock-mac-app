/** 렌더러가 쓸 수 있는 것만 노출한다. 노드 접근은 열지 않는다. */

import { contextBridge, ipcRenderer } from 'electron'
import type { Action, MediaChoice, KeyInfo, Slot, Snapshot } from '../shared/types.js'

export interface Meta {
  keys: KeyInfo[]
  media: MediaChoice[]
  actionLabels: Record<string, string>
  keyCount: number
}

const api = {
  getState: (): Promise<Snapshot> => ipcRenderer.invoke('state:get'),
  getMeta: (): Promise<Meta> => ipcRenderer.invoke('meta:get'),

  setSlot: (index: number, patch: Partial<Slot>): Promise<void> =>
    ipcRenderer.invoke('slot:set', index, patch),
  setAction: (index: number, action: Action): Promise<void> =>
    ipcRenderer.invoke('slot:set', index, { action }),
  setBrightness: (value: number): Promise<void> => ipcRenderer.invoke('brightness:set', value),

  switchProfile: (name: string): Promise<void> => ipcRenderer.invoke('profile:switch', name),
  addProfile: (name: string): Promise<boolean> => ipcRenderer.invoke('profile:add', name),
  renameProfile: (name: string): Promise<void> => ipcRenderer.invoke('profile:rename', name),
  removeProfile: (): Promise<boolean> => ipcRenderer.invoke('profile:remove'),
  setProfileApp: (app: string): Promise<void> => ipcRenderer.invoke('profile:setApp', app),

  setRunAtLogin: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('login:set', enabled),
  pickFile: (): Promise<string | null> => ipcRenderer.invoke('file:pick'),

  onChanged: (handler: (state: Snapshot) => void) => {
    const listener = (_event: unknown, state: Snapshot) => handler(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.off('state:changed', listener)
  },
  onWindowActive: (handler: (active: boolean) => void) => {
    const listener = (_event: unknown, active: boolean) => handler(active)
    ipcRenderer.on('window:active', listener)
    return () => ipcRenderer.off('window:active', listener)
  },
  onMenu: (channel: string, handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  },
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
