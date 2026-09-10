/**
 * 网易云扫码登录模块
 * 对接 NeteaseCloudMusicApi 的 QR 扫码登录 + Cookie 持久化
 *
 * 提供 authenticatedFetch(path) 供全模块共用，自动注入 Cookie。
 */
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

const API_BASE = 'http://127.0.0.1:3001'
const COOKIE_PATH = join(app.getPath('userData'), 'netease_cookie.txt')

/**
 * 休眠辅助
 */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 带重试的 fetch：后端 3001 未就绪时自动重试
 * @param {string} url
 * @param {object} [options]
 * @param {number} [retries=3]
 * @param {number} [delay=1000]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  retries = Math.max(1, retries)
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options)
      if (!res.ok && i < retries - 1) {
        console.log(`[重试] HTTP ${res.status} (${i + 1}/${retries}), ${delay}ms 后重试`)
        await sleep(delay)
        continue
      }
      return res
    } catch (err) {
      if (i === retries - 1) throw err
      console.log(`[重试] fetch 失败 (${i + 1}/${retries}), ${delay}ms 后重试: ${err.message}`)
      await sleep(delay)
    }
  }
}

/**
 * 读取本地保存的 cookie
 * @returns {string|null}
 */
export function loadSavedCookie() {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      const cookie = fs.readFileSync(COOKIE_PATH, 'utf-8').trim()
      if (cookie) {
        console.log(`[网易云登录] 已加载本地 Cookie`)
        return cookie
      }
    }
  } catch (e) {
    console.error('[网易云登录] 读取 Cookie 失败:', e.message)
  }
  return null
}

/**
 * 保存 cookie 到本地文件
 */
export function saveCookie(cookieStr) {
  try {
    fs.writeFileSync(COOKIE_PATH, cookieStr, 'utf-8')
    console.log(`[网易云登录] Cookie 已保存 (${cookieStr.length} chars)`)
    return true
  } catch (e) {
    console.error('[网易云登录] 保存 Cookie 失败:', e.message)
    return false
  }
}

/**
 * 统一认证请求：自动读取本地 cookie 并注入 URL 参数，带重试
 * @param {string} path - 如 "/user/account" 或 "/search?keywords=xxx"
 * @returns {Promise<Response>}
 */
export async function authenticatedFetch(path) {
  let url = `${API_BASE}${path}`
  const cookie = loadSavedCookie()
  if (cookie) {
    url += `${path.includes('?') ? '&' : '?'}cookie=${encodeURIComponent(cookie)}`
  }
  return fetchWithRetry(url)
}

/**
 * 步骤1: 获取登录二维码 key + base64 图片
 * @returns {{ unikey: string, qrimg: string }}
 */
export async function getLoginQr() {
  const ts = Date.now()
  const keyRes = await fetchWithRetry(`${API_BASE}/login/qr/key?timestamp=${ts}`)
  if (!keyRes.ok) throw new Error(`获取二维码 key 失败: ${keyRes.status}`)
  const keyData = await keyRes.json()
  const unikey = keyData?.data?.unikey
  if (!unikey) throw new Error('获取二维码 key 返回为空')

  const qrRes = await fetchWithRetry(`${API_BASE}/login/qr/create?key=${unikey}&qrimg=true&timestamp=${Date.now()}`)
  if (!qrRes.ok) throw new Error(`生成二维码失败: ${qrRes.status}`)
  const qrData = await qrRes.json()
  const qrimg = qrData?.data?.qrimg
  if (!qrimg) throw new Error('二维码图片为空')

  return { unikey, qrimg }
}

/**
 * 步骤2: 轮询检查扫码状态
 * @param {string} key - unikey
 * @returns {{ code: number, cookie?: string, message?: string }}
 *   code 800=过期 801=待扫码 802=待确认 803=授权成功
 */
export async function checkQrStatus(key) {
  const res = await fetch(`${API_BASE}/login/qr/check?key=${key}&timestamp=${Date.now()}`)
  if (!res.ok) throw new Error(`扫码状态查询失败: ${res.status}`)
  const data = await res.json()
  return { code: data.code, cookie: data.cookie, message: data.message }
}

/**
 * 步骤3: 获取登录用户信息
 * @returns {{ nickname: string, avatarUrl: string } | null}
 */
export async function getUserProfile() {
  const res = await authenticatedFetch('/user/account')
  if (!res.ok) return null
  const data = await res.json()
  if (data?.profile) {
    return {
      nickname: data.profile.nickname,
      avatarUrl: data.profile.avatarUrl
    }
  }
  // 兼容旧版返回值
  if (data?.account) {
    return {
      nickname: data.account.userName || '网易云用户',
      avatarUrl: ''
    }
  }
  return null
}

/**
 * 向 API 服务器注册 cookie（验证有效性 + 闭环更新新 cookie）
 * 注：/login/refresh 会消耗旧 cookie 并返回新 cookie（Set-Cookie 头）。
 * 本函数读取该新 cookie 并回写到文件，确保 cookie 闭环更新。
 * @param {string} cookieStr
 * @returns {Promise<boolean>}
 */
export async function registerCookie(cookieStr) {
  if (!cookieStr) return false
  try {
    const res = await fetchWithRetry(`${API_BASE}/login/refresh?cookie=${encodeURIComponent(cookieStr)}&timestamp=${Date.now()}`)
    if (res.ok) {
      console.log('[网易云登录] Cookie 已注册到 API 服务器')

      // 读取所有 Set-Cookie 响应头，逐个合并到本地 cookie
      const setCookieHeaders = res.headers.getSetCookie()
      if (setCookieHeaders.length) {
        let mergedStr = cookieStr
        for (const header of setCookieHeaders) {
          const newEntry = header.split(';')[0].trim()
          if (!newEntry) continue
          const [newKey] = newEntry.split('=')
          const saved = mergedStr.split(';').map(p => p.trim()).filter(Boolean)
          mergedStr = saved.filter(p => !p.startsWith(newKey + '=')).concat([newEntry]).join('; ')
        }
        saveCookie(mergedStr)
        console.log('[网易云登录] 已闭环更新 cookie（合并模式，' + setCookieHeaders.length + ' 条）')
      }
      return true
    }
    console.warn('[网易云登录] Cookie 注册失败, 可能已过期')
    // 过期则删除本地文件
    try { fs.unlinkSync(COOKIE_PATH) } catch { /* ignore */ }
    return false
  } catch (e) {
    console.error('[网易云登录] Cookie 注册异常:', e.message)
    return false
  }
}

/**
 * 清除本地 cookie
 */
export function clearCookie() {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      fs.unlinkSync(COOKIE_PATH)
      console.log('[网易云登录] 本地 Cookie 已清除')
    }
  } catch (e) {
    console.error('[网易云登录] 清除 Cookie 失败:', e.message)
  }
}