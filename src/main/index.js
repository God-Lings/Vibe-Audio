import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { askDJ } from './ai'
import {
  getLoginQr,
  checkQrStatus,
  getUserProfile,
  saveCookie,
  loadSavedCookie,
  registerCookie,
  clearCookie
} from './neteaseLogin'
import activeWindow from 'active-win'

// ===== 主进程日志转发到渲染进程 DevTools 控制台 =====
// 这样你在 F12 里就能看到 ai.js 搜索歌曲、VIP 跳过等全部后台日志
const _origLog = console.log
console.log = (...args) => {
  _origLog.apply(console, args)
  try {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      wins[0].webContents.send('main-log', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '))
    }
  } catch (_) {}
}

// ===== 近时记忆系统（近期上下文记忆） =====
// 后台静默扫描，记录用户近期在做什么，避免"灯下黑"问题
const MAX_MEMORY_DURATION = 5 * 60 * 1000  // 保留最近 5 分钟
const POLL_INTERVAL = 15000                 // 每 15 秒扫描一次
// 需要过滤的自身进程名单（active-win 在 Windows 上可能返回各种变体）
const SELF_NAMES = [
  'vibe', 'vibe-audio', 'vibe audio',   // 产品名
  'electron', 'electron.exe',            // Electron 壳
  'node', 'node.exe'                     // 子进程
]

const recentWindowLog = []  // { app: 应用名, title: 标题, timestamp: 时间戳 }

function recordActiveWindow(winInfo) {
  const now = Date.now()
  // 清理过期记录
  while (recentWindowLog.length > 0 && recentWindowLog[0].timestamp < now - MAX_MEMORY_DURATION) {
    recentWindowLog.shift()
  }
  if (winInfo) {
    recentWindowLog.push({
      app: winInfo.owner.name,
      title: winInfo.title,
      timestamp: now
    })
  }
}

function getRecentContext() {
  const now = Date.now()
  // 只取最近 5 分钟内的记录
  const recent = recentWindowLog.filter(e => e.timestamp > now - MAX_MEMORY_DURATION)

  // 过滤掉电台自身进程，统计各应用出现次数
  const appCounts = {}
  for (const entry of recent) {
    const appName = entry.app.toLowerCase()
    // 跳过自身
    if (SELF_NAMES.some(name => appName.includes(name))) continue
    appCounts[entry.app] = (appCounts[entry.app] || 0) + 1
  }

  // 按出现频率排序取前 5
  const sortedApps = Object.entries(appCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([app, count]) => `${app}`)

  // 最近 3 条非自身记录的窗口标题（用于标题感知）
  const recentTitles = recent
    .filter(e => !SELF_NAMES.some(name => e.app.toLowerCase().includes(name)))
    .slice(-3)
    .map(e => e.title)
    .filter(Boolean)

  return {
    recent_apps: sortedApps,
    recent_titles: [...new Set(recentTitles)] // 去重
  }
}

function killPort(port) {
  try {
    const cmd = 'netstat -ano | findstr ":' + port + '" | findstr LISTENING'
    const output = execSync(cmd, { shell: true, timeout: 3000, encoding: 'utf8' })
    const lines = output.trim().split('\n')
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && pid !== '0') {
        try {
          execSync('taskkill /f /pid ' + pid, { shell: true, timeout: 2000 })
          console.log('[端口清理] 已释放端口 ' + port + ' (PID: ' + pid + ')')
        } catch (_) {}
      }
    }
  } catch (_) {
    console.log('[端口检查] 端口 ' + port + ' 空闲')
  }
}

/**
 * 判断某个应用名是否属于 Vibe Audio 自身进程
 */
function isSelfProcess(appName) {
  if (!appName) return false
  return SELF_NAMES.some(name => appName.toLowerCase().includes(name))
}

/**
 * 从近时记忆中翻出最近一个非自身的应用窗口
 */
function findLastNonSelfWindow() {
  // 从最新记录往前翻
  for (let i = recentWindowLog.length - 1; i >= 0; i--) {
    if (!isSelfProcess(recentWindowLog[i].app)) {
      return recentWindowLog[i]
    }
  }
  return null
}

async function getFullSystemStatus() {
  try {
    const now = new Date()
    const timeString = now.toLocaleTimeString('zh-CN', { hour12: false })
    const activeWin = await activeWindow()
    let activeApp = '系统桌面'
    let activeTitle = ''
    if (activeWin && !isSelfProcess(activeWin.owner.name)) {
      // 正常情况：前台应用不是自身，直接上报
      activeApp = activeWin.owner.name
      activeTitle = activeWin.title
    } else if (activeWin) {
      // 前台是 Vibe Audio 自身 → 从近时记忆翻上一个非自身应用
      const lastNonSelf = findLastNonSelfWindow()
      if (lastNonSelf) {
        activeApp = lastNonSelf.app
        activeTitle = lastNonSelf.title
        console.log(`[自身过滤] 前台是 Vibe Audio，回退到上次感知: ${activeApp}`)
      }
      // 如果也没找到非自身记录，就留默认的"系统桌面"
    }
    return { time: timeString, app: activeApp, title: activeTitle }
  } catch (error) {
    console.error('读取系统状态失败:', error)
    return { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), app: '未知应用', title: '' }
  }
}

ipcMain.handle('ask-dj', async (event, keys, userMood, cyclePhase = 0, lockedVibe = null, lastTrack = null, taskId) => {
  try {
    const tid = taskId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const isPreload = tid.startsWith('preload-')
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0')
    console.log(`[${ts}][主进程] ${isPreload ? '⏭️ 预加载' : '🎵 正常'} DJ 请求 (Phase ${cyclePhase}, taskId=${tid.slice(0, 14)}…)`)
    if (isPreload) {
      console.log(`[${ts}][预加载] lockedVibe=${lockedVibe ? lockedVibe.join(',') : 'null'}, lastTrack=${lastTrack?.name || 'null'}`)
    }
    const systemStatus = await getFullSystemStatus()
    const recentContext = getRecentContext()
    const result = await askDJ(keys, systemStatus, recentContext, userMood, cyclePhase, lockedVibe, lastTrack, {
      pushTTS: { taskId: tid, sender: event.sender }
    })
    const t2 = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0')
    if (result.success) {
      console.log(`[${t2}][主进程] ${isPreload ? '⏭️ 预加载' : '🎵 正常'} 返回: track=${result.track_name || '无'} - ${result.artist || ''}, hasAudio=${!!result.audioData}`)
    } else {
      console.log(`[${t2}][主进程] ${isPreload ? '⏭️ 预加载' : '🎵 正常'} 失败: ${result.error}`)
    }
    return { ...result, activeApp: systemStatus.app, taskId: tid }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}][主进程] 呼叫 DJ 失败:`, err)
    return { success: false, error: err.message }
  }
})

// ===== 网易云扫码登录 IPC =====

/**
 * 获取登录二维码（unikey + base64 qrimg）
 */
ipcMain.handle('netease-get-qr', async () => {
  try {
    const result = await getLoginQr()
    return { success: true, ...result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

/**
 * 轮询检查扫码状态
 * @param {Event} event
 * @param {string} key - unikey
 */
ipcMain.handle('netease-check-qr', async (event, key) => {
  try {
    const result = await checkQrStatus(key)
    if (result.code === 803 && result.cookie) {
      // 授权成功 → 保存 cookie
      saveCookie(result.cookie)
      // 获取用户信息
      const profile = await getUserProfile()
      return { success: true, code: 803, profile, message: '授权成功' }
    }
    return { success: true, code: result.code, message: result.message || getQrMessage(result.code) }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

/**
 * 检查本地是否有持久化的登录态
 */
ipcMain.handle('netease-check-login', async () => {
  try {
    const cookie = loadSavedCookie()
    if (!cookie) return { success: true, loggedIn: false }
    // 尝试用 cookie 恢复登录态
    const registered = await registerCookie(cookie)
    if (!registered) return { success: true, loggedIn: false }
    const profile = await getUserProfile()
    if (profile) {
      return { success: true, loggedIn: true, profile }
    }
    return { success: true, loggedIn: false }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

/**
 * 退出登录（清除本地 cookie）
 */
ipcMain.handle('netease-logout', async () => {
  try {
    clearCookie()
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

function getQrMessage(code) {
  const map = {
    800: '二维码已过期，请重新获取',
    801: '等待扫码',
    802: '请在手机上确认登录',
    803: '授权成功'
  }
  return map[code] || '未知状态'
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 580,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => { mainWindow.show() })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  killPort(3001)

  try {
    // NeteaseCloudMusicApi 的 util/request.js 在模块加载时会同步读取 anonymous_token
    // 但 app.js 中创建该文件的逻辑并未执行（我们走 server.js 的 serveNcmApi），
    // 因此需要提前创建，否则模块加载直接抛 ENOENT 异常
    const tokenPath = join(require('os').tmpdir(), 'anonymous_token')
    if (!fs.existsSync(tokenPath)) {
      fs.writeFileSync(tokenPath, '', 'utf-8')
    }
    // 使用 eval('require') 完美绕过 Vite/Rollup 打包静态分析
    // 直接利用主进程原生 require 触发 asar 内部的文件读取
    const ncmServer = eval('require')('NeteaseCloudMusicApi/server')
    ncmServer.serveNcmApi({ port: 3001 }).then(() => {
      console.log('[网易云] 🧠 内嵌 API 服务已启动 (port: 3001)')
    })
  } catch (e) {
    console.error('❌ [网易云] 内嵌代理启动失败:', e.message)
  }

  // ★ 在创建窗口前，主动用已保存的 cookie 注册到 API 服务
  //   确保窗口出现时 API 已持有登录态，不依赖渲染进程 IPC
  setTimeout(async () => {
    try {
      const savedCookie = loadSavedCookie()
      if (savedCookie) {
        await registerCookie(savedCookie)
        console.log('[网易云登录] 启动时 cookie 已注册到 API 服务器')
      }
    } catch { /* 静默失败，渲染进程会再次尝试 */ }
  }, 2000)

  // 启动近时记忆后台轮询（每 15 秒抓一次活跃窗口）
  const pollTimer = setInterval(async () => {
    try {
      const win = await activeWindow()
      if (win) recordActiveWindow(win)
    } catch { /* 静默 */ }
  }, POLL_INTERVAL)

  app.on('will-quit', () => {
    clearInterval(pollTimer)
  })

  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => { optimizer.watchWindowShortcuts(window) })
  createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { app.quit() }
})
