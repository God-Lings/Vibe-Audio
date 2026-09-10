/**
 * 音源代理层 — VIP 歌曲检测
 * 判断网易云返回的歌曲是否为 VIP/试听，供上层直接跳过
 */

/**
 * 判断网易云返回的歌曲数据是否为 VIP/试听
 */
function isVipOrTrial(songData) {
  if (!songData) return true
  if (!songData.url) return true
  if (songData.freeTrialInfo) return true
  if (songData.fee && songData.fee !== 0) return true
  return false
}

export { isVipOrTrial }
