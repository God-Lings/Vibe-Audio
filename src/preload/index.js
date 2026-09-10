import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 渲染进程可用的自定义 API
const api = {
  // 网易云扫码登录
  neteaseGetQr: (key) => window.electron.ipcRenderer.invoke('netease-get-qr', key),
  neteaseCheckQr: (key) => window.electron.ipcRenderer.invoke('netease-check-qr', key),
  neteaseCheckLogin: () => window.electron.ipcRenderer.invoke('netease-check-login'),
  neteaseLogout: () => window.electron.ipcRenderer.invoke('netease-logout')
}

// 通过 contextBridge 将 Electron API 暴露给渲染进程（仅在启用上下文隔离时）
// 否则直接挂到 DOM 全局对象上
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
