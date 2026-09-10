import { OpenAI } from 'openai'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// 音源代理层 — 检测网易云 VIP/试听歌曲
import { isVipOrTrial } from './audioSourceProxy'
// 统一认证请求：自动注入本地 cookie
import { authenticatedFetch } from './neteaseLogin'

// ===== 第二阶段：闲聊话题池 =====
const CHAT_TOPICS = [
  '游戏', '电影', '科技', '美食', '旅行',
  '生活感悟', '深夜独白', '城市故事', '季节变化',
  '老物件回忆', '一本书的读后感', '最近看的一部电影'
]

// ★★★ DJ 系统提示词 — Depth 人设、语气、规则（注入所有 DeepSeek 调用） ★★★
const SYSTEM_PROMPT = `# Role:
你是 Depth，一个存在于赛博空间里的专属 AI 唱片骑士（DJ）和心灵捕手。你不是冰冷的机器，而是一个坐在副驾驶或屏幕对面，陪用户熬夜、懂他疲惫的老朋友。

# Tone & Personality (语气与性格):
1. **温柔且耐心**：说话语气像深夜 FM 的电台主理人，声音低沉、温暖、慵懒。像水流一样包容用户的所有情绪。
2. **极度亲近，没有距离感**：不用"您"，不客套，不发表情包堆砌。就像认识了多年的懂音乐的知己。
3. **留白与克制**：你深知"音乐本身才是主角"。你从不抢戏，喜欢用短句、停顿（...）来表达氛围。

# Music Expertise (音乐专业度):
1. 你拥有极其深厚的乐理、流派（如 Lo-Fi, Synthwave, City Pop, Jazz 等）和声音工程知识。
2. **绝对禁止掉书袋**：不要像教科书一样罗列音乐年份、和弦走向或维基百科式的科普。
3. **把专业化作情绪**：当用户问及音乐专业问题时，用"通感"来回答。比如把"低频下潜"描述为"心跳的共振"，把"合成器音色"描述为"霓虹灯在积水里的倒影"。

# STRICT RULE (内容限制):
每次回答不超过 150 个字。串场时多用回车分行营造呼吸感；聊天模式（用户主动说话时）可适当放至 200 字，允许展开对话。
避免啰嗦，但不要为了凑字而说废话。`

// ★ 多维兜底关键词生成器 — 动态组合 [年代/时间] + [情绪] + [流派]，每次随机抽一种组合策略
const FALLBACK_DIMENSIONS = {
  era: ['80年代', '90年代', '00年代', '10年代', '怀旧', '经典'],
  mood: ['深夜', '清晨', '雨天', '慵懒', '轻松', '沉思', '浪漫', '励志'],
  genre: ['爵士', '摇滚', '流行', 'R&B', 'Lo-fi', '电子', '民谣', 'Bossa Nova', '灵魂乐', '经典老歌', 'City Pop', 'Funk'],
  scene: ['咖啡馆', '读书', '开车', '编程', '睡前']
}

function generateFallbackKeyword() {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)]
  const r = Math.random()
  if (r < 0.35) return `${pick(FALLBACK_DIMENSIONS.mood)} ${pick(FALLBACK_DIMENSIONS.genre)}`
  if (r < 0.60) return `${pick(FALLBACK_DIMENSIONS.era)} ${pick(FALLBACK_DIMENSIONS.genre)}`
  if (r < 0.80) return `${pick(FALLBACK_DIMENSIONS.mood)} ${pick(FALLBACK_DIMENSIONS.era)}`
  if (r < 0.93) return pick(FALLBACK_DIMENSIONS.genre)
  return `${pick(FALLBACK_DIMENSIONS.mood)} ${pick(FALLBACK_DIMENSIONS.scene)}`
}

// 关键词调味器：偶尔给 AI 的搜索标签加个修饰词，避免同一关键词反复搜
function addKeywordVariation(tags) {
  if (!tags || tags.length === 0) return tags
  const modifiers = ['精选', '冷门', '经典', '纯音', '治愈', '氛围', '解压', '独立']
  const r = Math.random()
  if (r < 0.35) {
    // 随机替换最后一个标签的修饰部分
    const tag = tags[tags.length - 1]
    const mod = modifiers[Math.floor(Math.random() * modifiers.length)]
    if (!tag.startsWith(mod)) tags[tags.length - 1] = `${mod} ${tag}`
  }
  return tags
}

// ★★★ DJ 的防重小本本：滑动窗口记录最近播放过的歌曲 ID ★★★
const MAX_HISTORY = 15
const playHistory = []       // [{ id: 歌曲ID, name: 歌曲名, artist: 歌手 }, ...]

// ★★★ 聊天记忆：连续聊天时保留上下文，换歌/新 Phase 时自动清空 ★★★
const MAX_CHAT_ROUNDS = 5
const chatHistory = []       // [{ role: 'user'|'assistant', content: 文本 }, ...]

function isPlayedRecently(songId) {
  return playHistory.some(h => h.id === songId)
}

function recordPlayed(songId, name, artist) {
  const idx = playHistory.findIndex(h => h.id === songId)
  if (idx !== -1) playHistory.splice(idx, 1)
  playHistory.push({ id: songId, name, artist })
  if (playHistory.length > MAX_HISTORY) playHistory.shift()
  savePlayHistory()
}

function getRecentPlayedNames(count = 5) {
  // 返回最近 count 首的歌名列表（给 AI 台词使用，每条如 "《七里香》- 周杰伦"）
  return playHistory.slice(-count).map(h => `《${h.name}》- ${h.artist}`)
}

// ===== 播放历史持久化 =====
const HISTORY_PATH = path.join(app.getPath('userData'), 'play_history.json')

function loadPlayHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'))
      if (Array.isArray(data)) {
        const valid = data.filter(h => h && typeof h.id === 'number' && typeof h.name === 'string')
        valid.forEach(h => playHistory.push(h))
        console.log(`📂 [记忆] 已恢复 ${valid.length} 条播放记录${valid.length < data.length ? `（过滤 ${data.length - valid.length} 条异常）` : ''}`)
      }
    }
  } catch (_) {}
}

async function savePlayHistory() {
  try {
    await fs.promises.writeFile(HISTORY_PATH, JSON.stringify(playHistory.slice(-MAX_HISTORY)), 'utf-8')
  } catch (_) {}
}

// 模块加载时恢复历史
loadPlayHistory()

// ===== 统一上下文拼装 =====
function buildContext(systemStatus, recentContext, lockedVibe, lastTrack) {
  const recentAppsText = recentContext?.recent_apps?.length
    ? `近期使用的应用：${recentContext.recent_apps.join('、')}`
    : ''
  const recentTitlesText = recentContext?.recent_titles?.length
    ? `[${recentContext.recent_titles.join(' | ')}]`
    : ''
  const recentPlays = getRecentPlayedNames(5)
  const recentPlaysText = recentPlays.length ? `最近还放过：${recentPlays.join('、')}` : ''
  const vibeStr = lockedVibe?.length ? lockedVibe.join('、') : '随机'
  const lastTrackStr = lastTrack ? `《${lastTrack.name}》- ${lastTrack.artist}` : '上一首'
  const topics = CHAT_TOPICS.length ? CHAT_TOPICS : ['生活感悟']
  const randomTopic = topics[Math.floor(Math.random() * topics.length)]
  return { time: systemStatus.time, app: systemStatus.app, title: systemStatus.title, recentAppsText, recentTitlesText, recentPlaysText, vibeStr, lastTrackStr, randomTopic }
}

/**
 * 从网易云搜索歌单并取一首未播过的歌（用于曲风流派模糊搜索，带防重）
 */
async function fetchTrackFromPlaylist(keywords) {
  try {
    for (const keyword of keywords) {
      console.log(`🎵 [歌单搜索] 检索曲风流派: "${keyword}"...`)

      // 随机 offset 打散歌单池，避免每次都搜到前几名
      const offset = Math.floor(Math.random() * 30)
      console.log(`🎯 [歌单搜索-offset] 使用 offset=${offset}，limit=20 → 跳过前 ${offset} 个歌单从随机位置开始`) 
      let searchRes = await authenticatedFetch(`/search?keywords=${encodeURIComponent(keyword)}&type=1000&limit=20&offset=${offset}`)
      if (!searchRes.ok) continue
      let searchData = await searchRes.json()
      let playlists = searchData.result?.playlists
      // offset 返回空结果时回退到 offset=0
      if ((!playlists || playlists.length === 0) && offset !== 0) {
        searchRes = await authenticatedFetch(`/search?keywords=${encodeURIComponent(keyword)}&type=1000&limit=20&offset=0`)
        if (!searchRes.ok) continue
        searchData = await searchRes.json()
        playlists = searchData.result?.playlists
      }
      if (!playlists || playlists.length === 0) continue

      const playlist = playlists[Math.floor(Math.random() * Math.min(playlists.length, 5))]
      console.log(`📀 [歌单命中] ${playlist.name} (ID: ${playlist.id})`)

      const detailRes = await authenticatedFetch(`/playlist/track/all?id=${playlist.id}&limit=30`)
      if (!detailRes.ok) continue
      const detailData = await detailRes.json()
      const songs = detailData.songs
      if (!songs || songs.length === 0) continue

      // 打乱歌单顺序，然后逐首检查：可播放 + 不在历史中
      const shuffled = [...songs].sort(() => Math.random() - 0.5)
      let vipSkipCount = 0
      for (const song of shuffled) {
        // ★ 跳过已播放过的
        if (isPlayedRecently(song.id)) {
          console.log(`⏭️ [防重] 跳过已播: ${song.name} (ID: ${song.id})`)
          continue
        }
        const urlRes = await authenticatedFetch(`/song/url/v1?id=${song.id}&level=standard`)
        if (!urlRes.ok) continue
        const urlData = await urlRes.json()
        const songData = urlData.data?.[0]

        // VIP 歌曲跳过（无可信备选源）
        if (isVipOrTrial(songData)) {
          vipSkipCount++
          console.log(`⏭️ [VIP跳过] ${song.name} - ${song.ar?.[0]?.name || '未知'} 跳过VIP歌曲`)
          if (vipSkipCount >= 8) {
            console.log(`⚠️ [歌单] 连续 ${vipSkipCount} 首 VIP，提前放弃该歌单`)
            break
          }
          continue
        }

        const trackUrl = songData?.url
        if (trackUrl) {
          console.log(`✅ [取歌成功] ${song.name} - ${song.ar?.[0]?.name || '未知'} (免费)`)
          recordPlayed(song.id, song.name, song.ar?.[0]?.name || '未知艺术家')
          return {
            track_name: song.name,
            artist: song.ar?.[0]?.name || '未知艺术家',
            track_url: trackUrl
          }
        }
      }
      // 这首歌单里的歌都播过了或不可播放 → 试下一个歌单
      console.log(`⚠️ [歌单] "${playlist.name}" 内的歌曲都已播过，换下一个`)
    }
    return null
  } catch (err) {
    console.error('❔ [歌单取歌] 该流派无匹配歌单:', err.message)
    return null
  }
}

/**
 * 精确搜歌手/歌名：直接用关键词搜单曲（带防重）
 */
async function fetchTrackByArtist(keywords) {
  for (const keyword of keywords) {
    console.log(`🎯 [精确搜索] 检索歌手/歌名: "${keyword}"...`)
    const track = await fetchTrackFallback(keyword)
    if (track) {
      console.log(`✅ [精确搜索] 命中: ${track.track_name} - ${track.artist}`)
      return track
    }
    console.log(`⚠️ [精确搜索] "${keyword}" 无可用结果，试下一个关键词`)
  }
  return null
}

/**
 * 兜底方案：用关键词搜单曲（limit=30，全量打乱遍历，带防重智能兜底）
 */
async function fetchTrackFallback(keyword) {
  try {
    console.log(`🎵 [单曲搜索] 兜底检索: "${keyword}"...`)
    const searchRes = await authenticatedFetch(`/search?keywords=${encodeURIComponent(keyword)}&limit=30`)
    if (!searchRes.ok) throw new Error(`搜索请求失败: ${searchRes.status}`)
    const searchData = await searchRes.json()
    const songs = searchData.result?.songs
    if (!songs || songs.length === 0) return null

    // 全量打乱搜索池，避免只取前部固定结果
    const shuffled = [...songs].sort(() => Math.random() - 0.5)
    for (const song of shuffled) {
      // ★★★ 智能兜底：跳过已播放过的歌 ★★★
      if (isPlayedRecently(song.id)) {
        console.log(`⏭️ [防重] 跳过已播: ${song.name} (ID: ${song.id})`)
        continue
      }
      const urlRes = await authenticatedFetch(`/song/url/v1?id=${song.id}&level=standard`)
      if (!urlRes.ok) continue
      const urlData = await urlRes.json()
      const songData = urlData.data?.[0]

      // 检查是否是 VIP/试听 → 跳过
      if (isVipOrTrial(songData)) {
        console.log(`⏭️ [VIP跳过] ${song.name} - ${song.artists?.[0]?.name || '未知'} 跳过VIP歌曲`)
        continue
      }

      const trackUrl = songData?.url
      if (trackUrl) {
        console.log(`✅ [兜底] ${song.name} - ${song.artists?.[0]?.name || '未知'} (免费)`)
        recordPlayed(song.id, song.name, song.artists?.[0]?.name || '未知艺术家')
        return {
          track_name: song.name,
          artist: song.artists[0].name,
          track_url: trackUrl
        }
      }
    }
    console.log(`⚠️ [兜底] "${keyword}" 的所有结果都已播过或无版权`)
    return null
  } catch (err) {
    console.error('❌ [兜底取歌] 异常:', err.message)
    throw err
  }
}

/**
 * 后台异步生成台词 + TTS 语音（pushTTS 模式用）
 */
async function generateScriptAndTTS(keys, trackInfo, analysis, genreTags, cyclePhase, lastTrack, userMood, recentPlaysText, randomTopic) {
  const deepseek = new OpenAI({ baseURL: 'https://api.deepseek.com/v1', apiKey: keys.deepseekKey })

  // ===== 写台词 =====
  let scriptPrompt
  const lastTrackStr = lastTrack ? `《${lastTrack.name}》` : '上一首'

  if (cyclePhase === 0) {
    scriptPrompt = `
刚才你观察到：
- 用户状态：${analysis.reasoning || ''}
- 心情：${analysis.mood_tag || ''}
- 你为他选了：${trackInfo.track_name} - ${trackInfo.artist}
- 曲风标签：${genreTags?.join('、') || '多元'}
${userMood ? `- 用户还说了："${userMood}"，在台词里顺便回应一下` : ''}
${recentPlaysText}

现在写一段 120~160 字的中文串场词，像一个真正懂音乐的朋友在介绍今晚的曲目：
1. 两三句话描述这首歌给你的感觉——它的节奏是推进的还是在飘荡的？人声是贴着耳朵还是飘在天花板上？乐器色彩是冷的是暖的？
2. 如果你知道这个歌手/制作人的风格，用一两句轻松的口吻点出来（"这位制作人特别擅长用采样拼出雨天傍晚的感觉"），但不要背资料
3. 把这首歌放进用户现在的状态里——它如何接住他的情绪
4. 多用短句和分行，温暖但有呼吸感

必须返回 JSON: {"dj_script": "台词"}
    `
  } else if (cyclePhase === 1) {
    scriptPrompt = `
这轮是音乐联想环节。

上一首放了 ${lastTrackStr}，现在你接着放了 ${trackInfo.track_name} - ${trackInfo.artist}。
曲风标签：${genreTags?.join('、') || '多元'}
${recentPlaysText}

写一段 120~160 字的中文串场词：
1. 像一个懂音乐的朋友，随口说出这两首歌在听感上的延续感——是情绪的延续还是节奏的反转？音色是暖色过渡还是冷暖切换？
2. 给这首歌一个具体的时刻或场景——"适合一个人走在深夜的街道""像周末醒来窗帘还没拉开的房间"
3. 如果你了解这位音乐人的背景，用一两句话自然地带出来，但不要掉书袋
4. 不要列歌名、不要说"接下来我要放……"、不要提用户的电脑

必须返回 JSON: {"dj_script": "台词"}
    `
  } else {
    const topic = randomTopic || CHAT_TOPICS[Math.floor(Math.random() * CHAT_TOPICS.length)]
    console.log(`💬 [闲聊台词] Phase 2 话题="${topic}"，歌曲="${trackInfo.track_name}" → 让 AI 从歌曲出发引向话题`)
    scriptPrompt = `
现在是闲聊时间，话题是：${topic}。
当前播放的是：${trackInfo.track_name} - ${trackInfo.artist}
${recentPlaysText}

写一段 120~180 字的中文串场词：
1. 从这首歌的某个感觉出发——一个意象、一段回忆、一种情绪——自然地带出关于"${topic}"的话题，像朋友在安静地聊天
2. 不要在开头就说"今天我们聊聊${topic}"，让话题像流水一样淌进来
3. 可以稍微延伸、发一点感慨，但千万不要说教
4. 不要提代码、电脑、进程或任何技术术语

必须返回 JSON: {"dj_script": "台词"}
    `
  }

  const scriptRes = await deepseek.chat.completions.create({
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: scriptPrompt }
    ],
    response_format: { type: 'json_object' }
  })
  const { dj_script } = JSON.parse(scriptRes.choices[0].message.content)

  // ===== Mimo TTS =====
  const ttsResponse = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'api-key': keys.mimoKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: '用温暖有磁性的电台DJ语气。' },
        { role: 'assistant', content: dj_script }
      ],
      audio: { format: 'wav', voice: '茉莉' }
    })
  })

  if (!ttsResponse.ok) {
    const errorText = await ttsResponse.text()
    throw new Error(`小米接口报错: ${ttsResponse.status} ${errorText}`)
  }

  const responseData = await ttsResponse.json()
  const audioBase64 = responseData.choices?.[0]?.message?.audio?.data
  if (!audioBase64) throw new Error('未获取到音频数据字段')

  // 缓存到临时文件（沿用现有逻辑）
  try {
    const audioPath = path.join(app.getPath('temp'), 'vibe_audio_cache.wav')
    fs.writeFileSync(audioPath, Buffer.from(audioBase64, 'base64'))
  } catch (_) {}

  return { dj_script, audioData: audioBase64 }
}

/**
 * 核心大脑：三段式循环逻辑
 * 阶段 0：深度洞察 — 全量扫描，锁定 vibe
 * 阶段 1：音乐联想 — 基于 lockedVibe 找相似
 * 阶段 2：世界连接 — 聊生活/话题，不谈进程
 */
export async function askDJ(keys, systemStatus, recentContext, userMood = '', cyclePhase = 0, lockedVibe = null, lastTrack = null, options = {}) {

  console.log(`🧠 [大脑] Phase ${cyclePhase} 请求到达${userMood ? ` (用户消息: "${userMood}")` : ''}`)
  try {
    const deepseek = new OpenAI({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: keys.deepseekKey
    })

    const ctx = buildContext(systemStatus, recentContext, lockedVibe, lastTrack)
    console.log(`📋 [上下文] buildContext 组装完成: app=${ctx.app}, time=${ctx.time}, 播放记录=${playHistory.length}条, Phase=${cyclePhase}`)

    // ============================================================
    // 用户发送了消息 → 先做意图识别
    // ============================================================
    if (userMood) {
      console.log(`🧠 [意图识别] 用户说: "${userMood}"`)

      const intentRes = await deepseek.chat.completions.create({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...chatHistory.slice(-MAX_CHAT_ROUNDS * 2),
          { role: 'user', content: `
${ctx.lastTrackStr && ctx.lastTrackStr !== '上一首' ? `当前正在播放：${ctx.lastTrackStr}` : '电台刚启动，尚未播放歌曲。'}
用户刚对你说了一句话："""${userMood}"""

请判断用户的真实意图，只允许以下两种：

A. "chat" — 用户想和你聊天、倾诉、问候，或者问了与音乐无关的问题（比如技术问题、知识问答）。
   你需要：温暖回应，绕过无关问题引向情绪，不要换歌。

B. "change_track" — 用户想换歌、改变氛围、指定风格、或者讨论与当前音乐相关的内容。
   你需要：回应后换一首符合要求的歌。

⚡ 重要人设规则：
- 你是一个深夜电台 DJ，但也是一个有温度的朋友。任何话题都可以聊——人生、理想、孤独、热恋、遗憾、热爱，什么都可以。
- 你的回答切入点永远是情绪和共鸣，像一个深夜不打烊的便利店老板、一个懂你沉默的老友。
- 如果用户问到复杂或专业的问题，用你的直觉和感受来回应，不要像搜索引擎。你不是在回答问题，你是在陪一个人聊天。
- 我问你 "如何写 Python 代码" → "写过代码的人都知道，那种进入心流的感觉比写什么语言重要多了。不过现在的你不该写代码——让耳朵带着你去散个步。" → 意图选 A
- 我问你 "今天雨好大" → 共情回应 → 意图选 A
- 我说 "放点爵士乐" → 回应 + 换歌 → 意图选 B
- 我说 "这歌好难听" → 换一首 → 意图选 B
- 我说 "Depth 你累吗" → 温暖回应 → 意图选 A

先写一段回复。如果是 chat（纯聊天），回复 150~200 字，可以展开对话、抒发感受。如果是 change_track（换歌），回复 100 字以内，简洁回应后切歌。

必须返回 JSON：
{
  "intent": "chat" 或 "change_track",
  "reply": "你的回复"
}
          ` }
        ],
        response_format: { type: 'json_object' }
      })

      const { intent, reply } = JSON.parse(intentRes.choices[0].message.content)
      console.log(`🎯 [意图识别] ${intent} — "${reply}"`)

      if (intent === 'chat') {
        // 记录对话上下文（连续聊天时保持话题连贯）
        chatHistory.push({ role: 'user', content: userMood })
        chatHistory.push({ role: 'assistant', content: reply })
        while (chatHistory.length > MAX_CHAT_ROUNDS * 2) chatHistory.shift()
        console.log(`💬 [聊天记忆] 当前对话轮数: ${chatHistory.length / 2}`)
        // 只想聊天：只生成 TTS 语音回复，不切歌
        console.log('💬 [聊天模式] 生成纯语音回复...')
        const ttsResponse = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'api-key': keys.mimoKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'mimo-v2.5-tts',
            messages: [
              { role: 'user', content: '用温柔、有磁性的深夜电台口吻，像老朋友在安静地聊天。可以稍长一些，语气松弛。' },
              { role: 'assistant', content: reply }
            ],
            audio: { format: 'wav', voice: '茉莉' }
          })
        })

        if (!ttsResponse.ok) throw new Error(`TTS 报错: ${ttsResponse.status}`)
        const ttsData = await ttsResponse.json()
        const audioBase64 = ttsData.choices?.[0]?.message?.audio?.data

        return {
          success: true,
          should_change_track: false,  // ← 不换歌！
          dj_script: reply,
          audioData: audioBase64 || ''
        }
      }

      // intent === 'change_track' → 继续走换歌流程，但台词改用回复
      chatHistory.length = 0
      console.log('🎵 [换歌模式] 用户要求换歌，检索新音乐...（对话记忆已重置）')
    }

    let scenePrompt;

    // ============================================================
    // 阶段 0：深度洞察 — 全量扫描，锁定 vibe 基调
    // ============================================================
    if (cyclePhase === 0) {
      scenePrompt = `
这是三段式循环的第一次轮次，你需要做一次完整的"系统扫描"来决定今天的主基调。

当前环境：
- 时间：${ctx.time}
- 前台应用：${ctx.app}
- 窗口标题：${ctx.title}
- ${ctx.recentAppsText}
- 最近文档：${ctx.recentTitlesText || '无'}
${ctx.recentPlaysText ? `- ${ctx.recentPlaysText}` : ''}
${userMood ? `- 用户说了：${userMood}（据此调整选曲方向）` : ''}

【你的任务】
根据用户的状态和需求，输出搜索策略。

【关键规则 — 区分"精确点歌"和"模糊推荐"】
- 如果用户明确提到了歌手名（如：周杰伦、Taylor Swift、盆栽哥）或具体的歌名（如：七里香、Blinding Lights），那么 search_mode 必须为 "artist"，并且 genre_tags 里**直接放歌手名或歌名关键词**（如 "周杰伦 热门"、"盆栽哥"、"Blinding Lights"），**绝对不要转换成"PBR&B"等流派标签！**
- 如果用户只是描述了心情或场景（如：我在写代码、想放松、深夜emo），没有提到具体歌手/歌名，那么 search_mode 为 "genre"，genre_tags 使用专业音乐流派标签。
${userMood ? `\n⚠️ 用户说了："${userMood}"——请按上面的规则判断是精确点歌还是模糊心情。` : `\n（没有用户消息，按默认场景推荐合适的流派）`}

之后的两首歌会沿用这个 vibe 基调来找相似音乐，所以请选准。

必须返回 JSON（不要多余文字）：
{
  "reasoning": "你对用户状态的推理（30~50字，输出情绪画面而非干瘪总结）",
  "scene": "focus/relax/chill/party/energetic/sad/nostalgic",
  "mood_tag": "情绪关键词",
  "search_mode": "artist 或 genre",
  "genre_tags": ["关键词1", "关键词2", "关键词3"]
}

search_mode 为 "artist" 时 genre_tags 示例：["周杰伦 热门", "The Weeknd 热门", "Taylor Swift 流行"]
search_mode 为 "genre" 时 genre_tags 示例：["Neo-Soul", "Lo-fi Hip Hop", "City Pop"]
      `

    // ============================================================
    // 阶段 1：音乐联想 — 基于锁定 vibe 找相似，不扫描进程
    // ============================================================
    } else if (cyclePhase === 1) {
      scenePrompt = `
这轮是音乐联想环节——但你也要注意用户最新说的话。
${userMood ? `\n⚠️ 用户刚刚说了："${userMood}"——请优先响应用户的要求，不要死板延续之前的 vibe。` : ''}

刚才你放了 ${ctx.lastTrackStr}，当前锁定 vibe 是：${ctx.vibeStr}。
${userMood ? `\n★ 优先按用户的意思找风格，而不是延续 ${ctx.vibeStr}。` : `\n请联想上一首的氛围，给出 2~3 个相近但不要完全重复的曲风流派标签。`}
要有延续感，让听众感觉整个音乐旅程是在同一个 vibe 里流动。

【关键规则 — 区分"精确点歌"和"模糊联想"】
${userMood ? `\n⚠️ 用户说了："${userMood}"——如果用户提到了具体歌手/歌名，search_mode 必须为 "artist"，genre_tags 直接放歌手/歌名；否则 search_mode 为 "genre"，用流派标签。` : ''}

必须返回 JSON（不要多余文字）：
{
  "reasoning": "对这轮联想的一句简短说明",
  "scene": "沿用上一轮的场景标签",
  "mood_tag": "沿用上一轮的情绪关键词",
  "search_mode": "artist 或 genre",
  "genre_tags": ["联想的新流派标签1", "标签2", "标签3"]
}
      `

    // ============================================================
    // 阶段 2：世界连接 — 聊生活聊话题，不谈屏幕
    // ============================================================
    } else {
      scenePrompt = `
这轮是生活闲聊时间——但你也要注意用户最新说的话。
${userMood ? `\n⚠️ 用户刚刚说了："${userMood}"——请优先响应用户的要求，不要死板延续之前的 vibe。` : ''}

${userMood ? `\n★ 优先按用户的意思找风格。` : `当前锁定 vibe：${ctx.vibeStr}`}
上一首：${ctx.lastTrackStr}

请你推荐一首歌曲（流派标签搜歌），让音乐自己说话。

【关键规则 — 区分"精确点歌"和"模糊推荐"】
${userMood ? `\n⚠️ 用户说了："${userMood}"——如果用户提到了具体歌手/歌名，search_mode 必须为 "artist"，genre_tags 直接放歌手/歌名；否则 search_mode 为 "genre"，用流派标签。` : ''}

必须返回 JSON（不要多余文字）：
{
  "reasoning": "一句随想",
  "scene": "relax",
  "mood_tag": "松弛",
  "search_mode": "artist 或 genre",
  "genre_tags": ["与 ${userMood ? '用户要求的' : ctx.vibeStr} 匹配的流派标签或歌手名"]
}
      `
    }

    // ===== 调用 DeepSeek 得出搜索策略 =====
    const sceneRes = await deepseek.chat.completions.create({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: scenePrompt }
      ],
      response_format: { type: 'json_object' }
    })

    const analysis = JSON.parse(sceneRes.choices[0].message.content)
    const genreTags = analysis.genre_tags || []
    const searchMode = analysis.search_mode || 'genre'
    console.log(`🎯 [Phase ${cyclePhase}] ${analysis.reasoning || '无推理'} (${analysis.reasoning?.length || 0}字)`)
    // 调味：35%概率随机修饰最后一个标签，打破同一关键词反复搜的死循环
    const searchTags = genreTags.length ? addKeywordVariation([...genreTags]) : genreTags
    console.log(`🎵 搜索模式: ${searchMode}, 关键词: ${searchTags.join(', ')}`)

    // ===== 找歌：根据 search_mode 选择搜索路径 =====
    let trackInfo = null

    if (searchMode === 'artist') {
      // ★ 精确点歌模式：直接搜单曲，不走歌单 ★
      trackInfo = await fetchTrackByArtist(searchTags)
      if (!trackInfo) {
        const fb = generateFallbackKeyword()
        console.log(`⚠️ [精确搜索] 无结果，降级为流派搜单曲兜底: "${fb}"`)
        trackInfo = await fetchTrackFallback(fb)
      }
    } else {
      // ★ 模糊推荐模式：先搜歌单，降级单曲 ★
      trackInfo = await fetchTrackFromPlaylist(searchTags)
      if (!trackInfo) {
        const fallbackKeyword = analysis.mood_tag || analysis.scene || '热门歌曲'
        console.log(`⚠️ [降级] 歌单无果，切换到单曲搜索: "${fallbackKeyword}"`)
        trackInfo = await fetchTrackFallback(fallbackKeyword)
        if (!trackInfo) {
          const fb = generateFallbackKeyword()
          console.log(`⚠️ [降级] 单曲也无结果，随机兜底: "${fb}"`)
          trackInfo = await fetchTrackFallback(fb)
        }
      }
    }

    if (!trackInfo) throw new Error('所有渠道都未能找到可播放的歌曲')

    // ★★★ 双阶段模式：先返回歌曲，后台异步生成台词 + TTS ★★★
    if (options?.pushTTS) {
      const { taskId, sender } = options.pushTTS
      // 后台异步触发生成语音（不等待结果）
      console.log(`📡 [TTS 推送] taskId=${taskId} 开始后台生成台词 (Phase=${cyclePhase}${ctx.randomTopic ? ', 话题=' + ctx.randomTopic : ''})`)
      generateScriptAndTTS(keys, trackInfo, analysis, genreTags, cyclePhase, lastTrack, userMood, ctx.recentPlaysText, ctx.randomTopic)
        .then(voice => {
          sender.send('tts-ready', { taskId, dj_script: voice.dj_script, audioData: voice.audioData })
          console.log(`📡 [TTS 推送] taskId=${taskId} 语音已送达前端`)
        })
        .catch(err => {
          console.error(`❌ [TTS 推送] taskId=${taskId} 失败:`, err.message)
          sender.send('tts-ready', { taskId, error: err.message })
        })
      return {
        success: true,
        phase: 'track',
        taskId,
        track_name: trackInfo.track_name,
        artist: trackInfo.artist,
        track_url: trackInfo.track_url,
        genre_tags: genreTags,
        reasoning: analysis.reasoning || '',
        mood_tag: analysis.mood_tag || ''
      }
    }

    // 注：旧同步台词+TTS 流程已移除——pushTTS 模式始终启用，generateScriptAndTTS() 负责后台异步生成
  } catch (error) {
    console.error('❌ [大脑] 发生故障:', error)
    return { success: false, error: error.message }
  }
}