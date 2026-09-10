# VIBE AUDIO — 软件说明文档

## 一、项目简介

**Vibe Audio** 是一款基于 Electron 构建的桌面 AI 电台应用。它不像传统音乐播放器那样需要你手动选歌、建歌单——你只需要打开它、做你的事，Depth（AI DJ 的名字）会通过感知你的电脑使用状态，自动挑选符合当下氛围的音乐，并用温暖的语音和你聊天。

> 一句话：一个会观察你、会说话、会自己放歌的 AI 电台。

---

## 二、核心功能一览

| 功能 | 说明 |
|------|------|
| 🧠 **AI 自动选歌** | DeepSeek 驱动，根据你在做什么、什么心情推荐合适的音乐 |
| 🎙️ **AI 语音串场** | 每首歌之间，Depth 会像真人 DJ 一样说话（Mimo TTS 语音合成，茉莉声线） |
| 👀 **环境感知** | 每 15 秒扫描一次你的前台窗口，了解你在写代码、打游戏还是摸鱼 |
| 🎵 **网易云音乐音源** | 接入网易云音乐 API，可扫码登录获取 VIP 无损音质 |
| 🔄 **三段式播放循环** | 洞察→联想→闲聊，三个 Phase 循环播放，不单调 |
| 🎚️ **AB 轨交叉淡入淡出** | 双 Audio 对象无缝切换，200ms 渐入渐出，无留白 |
| ⏭️ **预加载系统** | 当前歌曲快结束时提前加载下一首，减少等待 |
| 🗣️ **音量闪避 (Ducking)** | DJ 说话时背景音乐自动降到 30%，说完恢复 |
| 🎹 **频谱可视化** | 3 弦 × 4 层 SVG 物理堆叠可视化 + 独立辉光滤镜 |
| 🌅 **蒸汽波背景** | Three.js 实时渲染的复古日落 + 粉色网格 + 雾化氛围 |
| ⏭️ **VIP 歌曲跳过** | 网易云 VIP 歌曲直接跳过（无可信备选源），寻找免费歌曲 |
| 💬 **聊天模式** | 用户可打字和 Depth 聊天，AI 会判断是想聊天还是想换歌 |
| 🔁 **Roll 换歌** | 一键重置循环，重新扫描你的状态，话题倒置从歌曲引出闲聊 |
| 📡 **主进程日志转发** | 所有后台日志自动推送到 F12 控制台，方便排障 |
| 🎚️ **音量统一控制** | 一个旋钮同时控制 BGM 和 DJ 语音，Ducking 自动保留比例 |

---

## 三、技术架构

```
┌─────────────────────────────────────────────────────────┐
│                     Electron 主进程                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐    │
│  │ index.js │  │  ai.js   │  │ audioSourceProxy.js│    │
│  │ IPC 处理  │  │ AI 大脑  │  │ VIP 检测（已精简） │    │
│  │ 环境感知  │  │ 三段式   │  │ （原咪咕逻辑已删）│    │
│  │ 端口管理  │  │ 意图识别 │  │                    │    │
│  │ 扫码登录  │  │ buildCtx │  │                    │    │
│  │ 日志转发  │  │ offset   │  │                    │    │
│  │ cookie合并│  │ 持久历史 │  │                    │    │
│  └──────────┘  └──────────┘  └────────────────────┘    │
│          │              │               │               │
│          ▼              ▼               ▼               │
│  ┌─────────────────────────────────────────────────┐   │
│  │          NeteaseCloudMusicApi (port 3001)        │   │
│  │        网易云音乐本地 API 代理                    │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                    preload / Bridge                      │
│         contextBridge: window.electron + window.api      │
├─────────────────────────────────────────────────────────┤
│                   渲染进程 (React)                        │
│  ┌──────────────────────────────────────────────┐       │
│  │              App.jsx (核心逻辑)               │       │
│  │  • AB 轨播放引擎 (bgmRef / bgmNextRef)       │       │
│  │  • 预加载系统 (preloadNextTrack)             │       │
│  │  • 3弦×4层 SVG 物理堆叠可视化                 │       │
│  │  • 垫乐循环 (padLoop)                        │       │
│  │  • 亡羊补牢 TTS 延迟补救                     │       │
│  │  • 音量统一控制 + Ducking                     │       │
│  │  • 3D TiltCard 交互                           │       │
│  └──────────────────────────────────────────────┘       │
│  ┌──────────────────────────────────────────────┐       │
│  │  components/（独立组件）                      │       │
│  │  • TypewriterText     — 打字机逐字效果        │       │
│  │  • TiltCard           — 3D 磁性悬浮卡片      │       │
│  │  • ScrambleText       — 乱码入场动画         │       │
│  │  • RetroFutureBack... — Three.js 蒸汽波背景   │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

### 3.1 主进程 (src/main/)

#### index.js — 主进程入口

**职责：** IPC 处理、窗口管理、系统感知、网易云登录、端口清理、日志转发

**关键机制：**

- **近时记忆系统**：每 15 秒用 `active-win` 抓取前台窗口，记录应用名和标题，保留最近 5 分钟。自动过滤 Vibe Audio 自身进程，如果前台是自身，则回退到上一次感知的非自身应用。
- **IPC 通道**：
  - `get-system-status` — 返回当前前台应用、时间、窗口标题
  - `ask-dj` — 核心 AI 请求通道，接收 mood/phase/lockedVibe 参数，返回歌曲 + 语音数据
  - `netease-get-qr` / `netease-check-qr` / `netease-check-login` / `netease-logout` — 网易云扫码登录全套流程
- **日志转发**：`console.log` 被劫持，所有主进程日志通过 `main-log` IPC 推送到渲染进程，F12 控制台可见
- **端口管理**：启动时自动释放 3001 端口，启动 NeteaseCloudMusicApi 本地代理
- **启动时 cookie 恢复**：窗口创建前主动用持久化 cookie 注册到 API 服务
- **Cookie 合并模式**：refresh 响应中的 Set-Cookie 仅更新对应 key，不覆写完整 cookie

#### ai.js — AI 大脑

**职责：** 三段式循环决策、意图识别、搜索策略（含 offset 打散）、TTS 语音生成、播放历史持久化

**三段式循环（Phase 0/1/2）：**

| Phase | 名称 | 行为 |
|-------|------|------|
| 0 | 深度洞察 | 全量扫描用户状态，决定 vibe 基调，输出 search_mode + genre_tags（reasoning 30~50字） |
| 1 | 音乐联想 | 基于 Phase 0 锁定的 vibe 找相似音乐，保持旅程流动感 |
| 2 | 世界连接 | 选歌后由 generateScriptAndTTS 在台词阶段自然引出随机话题，搜索阶段不再强绑话题 |

**统一上下文拼装 (buildContext)：**
- 系统状态、近时应用、播放历史、当前 Phase、用户输入、锁定 vibe 等数据统一由 `buildContext()` 函数组装
- Phase 0/1/2 三个阶段的场景提示词全部走 ctx，一处改处处生效

**搜索策略三级（从上到下兜底）：**

1. **精确点歌 (fetchTrackByArtist)** — 当 search_mode = "artist"，直接用关键词搜单曲
2. **歌单搜索 (fetchTrackFromPlaylist)** — search_mode = "genre" 时，先搜匹配流派的歌单，从歌单里取歌（随机 offset 0~29，limit=20）
3. **兜底搜索 (fetchTrackFallback)** — 前两者都失败时，用关键词搜单曲（limit=30，全量打乱）

**关键词调味器 (addKeywordVariation)：**
- 35% 概率随机给最后一个搜索标签加修饰词（"冷门"、"治愈"、"氛围"等）
- 避免同一关键词反复搜索导致结果重复

**多维兜底词库 (generateFallbackKeyword)：**
- 从年代（6）× 情绪（8）× 流派（12）× 场景（5）动态组合，576+ 种组合

**意图识别：**
- 用户发送消息时，先调用 DeepSeek 判断意图是 `chat`（聊天）还是 `change_track`（换歌）
- chat → 仅生成 TTS 语音回复（150~200字），不换歌
- change_track → 回复后进入换歌流程，指定新的搜索方向

**双阶段推流（pushTTS）：**
- 先返回歌曲信息（track_name, track_url 等），渲染进程立刻开始播放
- 后台异步生成台词 + Mimo 语音（`generateScriptAndTTS()`）
- 语音准备好后通过 `tts-ready` IPC 通道推送到前端
- 前端收到后缓存，在合适时机播放

**防重小本本 (playHistory)：**
- 滑动窗口记录最近 15 首播放过的歌曲 ID
- **持久化存储**：写入 `userData/play_history.json`，app 重启后恢复
- 在所有搜索路径中跳过已播歌曲

**死代码移除：**
- 旧同步台词 + TTS 流程（约 107 行）已删除，pushTTS 是唯一路径

#### audioSourceProxy.js — 音源代理层（已精简）

**职责：** 仅保留 VIP 歌曲检测

**流程：**
1. 网易云返回歌曲后，检查 fee / freeTrialInfo 是否为 VIP
2. 若是 VIP → 直接跳过，返回 null，ai.js 继续试下一首
3. ~~原咪咕搜索 + 照妖镜逻辑已全部删除~~

### 3.2 渲染进程 (src/renderer/)

#### 播放引擎

**双 Audio 对象（AB 轨）：**
- `bgmRef`（Audio 实例 A）— 当前播放
- `bgmNextRef`（Audio 实例 B）— 预加载下一首

**交叉淡入淡出：**
- 新轨从 0→1 渐入、旧轨从 1→0 渐出，目标音量始终跟随 `volumeRef.current`
- 使用 `setInterval` 20 步 × 25ms = 500ms 过渡

**音量统一控制：**
- 滚轮和音量旋钮同时控制 BGM + DJ 语音，`volumeRef.current` 为唯一基准
- 所有硬编码 `volume = 1.0` 已清除（共 4 处 + 交叉淡入淡出目标值）
- Ducking：DJ 说话时 `bgm = volumeRef.current * 0.3`，DJ 语音不受影响
- DJ 说话期间调节音量：BGM 立即跳到 `volumeRef.current * 0.3`，无延迟

**组件结构（components/）：**
| 组件 | 文件 | 功能 |
|------|------|------|
| TypewriterText | `components/TypewriterText.jsx` | 逐字显示，50ms 间隔，闪烁光标 |
| TiltCard | `components/TiltCard.jsx` | 3D 磁性倾斜，Y 轴底部阻尼归零 |
| ScrambleText | `components/ScrambleText.jsx` | 文字变化时乱码重组动画 |
| RetroFutureBackground | `components/RetroFutureBackground.jsx` | Three.js 蒸汽波背景（自适应竖屏） |

#### 蒸汽波背景（RetroFutureBackground）

- **技术**：Three.js + `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing`
- **落日**：Canvas 2D 绘制切片渐变太阳，平稳呼吸缩放
- **网格**：`GridHelper` 纯正方形粉色网格，向相机方向无限滚动
- **雾化**：远处网格自然融入深紫色夜空
- **辉光**：`EffectComposer` + `Bloom` 后处理
- **性能**：`max-h-[900px]` 限制卡片高度，适配竖屏副屏

#### 音量闪避 (Ducking)

- `isSpeaking` 为 true 时：BGM 体积渐降到 `volumeRef.current × 0.3`
- `isSpeaking` 为 false 时：BGM 体积渐恢复到 `volumeRef.current`
- DJ 语音始终等于 `volumeRef.current`，不受 Ducking 影响

---

## 四、完整播放流程

### 4.1 正常播放流程（三段式循环）

```
用户打开播放页
  │
  ▼
buildContext() 统一组装上下文
  │
  ▼
Phase 0 开始
  → 主进程 active-win 扫描前台窗口
  → IPC ask-dj (Phase=0, mood='')
  → DeepSeek 分析用户状态 → 输出 search_mode + genre_tags（reasoning 30~50字）
  → addKeywordVariation() 35% 概率修饰标签
  → 搜索歌曲（offset 随机分页 / 扩大 limit / 多维兜底）
  → 返回歌曲信息 + 后台异步 generateScriptAndTTS()
  → 渲染进程立即播放歌曲，recordPlayed() 落盘持久化
  ↓
歌曲播放到剩余 18s
  → preloadNextTrack() 触发
  → IPC ask-dj (Phase=1, lockedVibe=上一轮的genre_tags)
  → 返回下一首歌信息 → blob 缓存 → bgmNextRef.load()
  ↓
歌曲播放结束
  → handleSongEnd()
  → 检查 TTS 是否就绪？
    ├─ 是 → 播放 DJ 语音 → ttsRef.onended → 切换到 bgmNextRef
    └─ 否 → waitingForDelayedTTSRef = true
          → TTS 到达时补播 → 切换到 bgmNextRef
  ↓
Phase 1 歌曲开始播放
  → 重复上述预加载 + 结束流程（Phase=2）
  ↓
Phase 2 歌曲开始播放
  → generateScriptAndTTS 从歌曲引出随机话题，话题不干扰选歌
  → 重复上述预加载 + 结束流程（Phase=0）
  ↓
循环回到 Phase 0（重新扫描用户状态）
```

### 4.2 用户发消息流程

```
用户输入文字 → 点击发送
  │
  ▼
callAIBackend(mood)
  → IPC ask-dj (Phase=0, mood=mood)
  → DeepSeek 意图识别
    ├─ intent = "chat"
    │   → 生成150~200字回复 → playResponse(TTS)
    │   → 不换歌，人设从"旧朋友"增强为"深夜不打烊便利店老板"
    │
    └─ intent = "change_track"
        → DeepSeek 重新分析搜索方向
        → 找新歌（精确点歌优先）
        → 返回歌曲 + 后台 TTS
        → 渲染进程切歌
```

### 4.3 Roll 换歌流程

```
用户点击 Roll 按钮
  │
  ▼
handleRoll()
  → songCycleIndex = 0（重置到 Phase 0）
  → lockedVibeRef = null（清除锁定）
  → preloadedResponse = null（清除缓存）
  → 所有状态 flag 重置
  → bgmRef.volume = volumeRef.current（跟随用户音量旋钮）
  → IPC ask-dj (Phase=0, mood='')
  → 重新扫描 + 重新选歌
```

---

## 五、VIP 歌曲处理流程

```
网易云返回歌曲 URL
  │
  ▼
isVipOrTrial(songData)?
  ├─ 否 (免费) → 直接播放
  │
  └─ 是 (VIP/试听)
      → 跳过该歌曲，试下一首（无可信备选源）
```

> 原咪咕音乐备选 + 照妖镜校验已于 2026-05 移除

---

## 六、技术栈

| 层面 | 技术 |
|------|------|
| 框架 | Electron + electron-vite |
| 渲染 | React 18 + Tailwind CSS |
| 3D 背景 | Three.js + @react-three/fiber + @react-three/drei + @react-three/postprocessing |
| AI | DeepSeek API (deepseek-v4-flash) |
| TTS | 小米 Mimo API (mimo-v2.5-tts, 茉莉声线) |
| 音源 | NeteaseCloudMusicApi (本地代理 port 3001) |
| 系统感知 | active-win (npm) |
| 构建 | electron-builder |

---

## 七、配置要求

- **DeepSeek API Key** — AI 决策和台词生成（首次启动自动持久化到 localStorage）
- **Mimo TTS API Key** — 语音合成（小米开放平台，茉莉声线）
- **网易云音乐** — 扫码登录获取 VIP 音质（Cookie 合并模式，多层校验）

---

## 八、目录结构

```
vibe-audio/
├── src/
│   ├── main/
│   │   ├── index.js              # 主进程入口：IPC、窗口、感知、登录、日志转发
│   │   ├── ai.js                 # AI 大脑：三段式循环、buildContext、offset搜索、持久历史
│   │   ├── audioSourceProxy.js   # VIP 歌曲检测（已精简，原咪咕逻辑已删）
│   │   └── neteaseLogin.js       # 网易云扫码登录（合并模式 Cookie 持久化）
│   ├── preload/
│   │   └── index.js              # contextBridge 注册
│   └── renderer/
│       ├── index.html            # HTML 模板
│       ├── src/
│       │   ├── App.jsx           # 播放引擎 + 音量控制 + 可视化 + UI
│       │   ├── main.jsx          # React 入口
│       │   ├── assets/
│       │   │   ├── main.css      # Tailwind + 自定义 CSS（流星、网格、滚动条等）
│       │   │   └── base.css      # CSS 变量基座
│       │   └── components/
│       │       ├── TypewriterText.jsx       # 打字机逐字效果
│       │       ├── TiltCard.jsx             # 3D 磁性悬浮卡片
│       │       ├── ScrambleText.jsx         # 乱码入场动画
│       │       └── RetroFutureBackground.jsx# Three.js 蒸汽波背景
│   └── ...vite/ 构建配置
├── package.json
├── tailwind.config.js            # 自定义动画 keyframes
├── electron-builder.yml
└── electron.vite.config.mjs
```

---

## 九、关键修复历史

| 问题 | 修复方案 |
|------|----------|
| 咪咕搜索不可靠、货不对版 | 删除整个咪咕备选源逻辑，VIP 歌曲直接跳过 |
| ai.js 旧同步台词+TTS 流程（107 行死代码） | 删除，pushTTS 是唯一路径 |
| 内联 @keyframes 在 JSX 中（dangerouslySetInnerHTML） | 全部迁移到 tailwind.config.js 和 main.css |
| TypewriterText/TiltCard/ScrambleText 在 App.jsx 内联 | 抽取到 components/ 独立文件 |
| API Key 硬编码在源代码中 | 首次启动自动迁移到 localStorage，删除硬编码默认值 |
| 网易云 API 启动崩溃（anonymous_token 不存在） | 加载模块前检查并创建 anonymous_token 文件 |
| 歌曲选择不够随机 | offset 随机分页 + limit 20/30 + 关键词调味器 + 多维兜底词库 |
| 播放历史重启清零 | 持久化到 userData/play_history.json |
| reasoning 仅 15 字信息量不足 | 放宽到 30~50 字，要求输出情绪画面 |
| Phase 2 话题与歌曲强行绑定 | 话题倒置：搜索阶段不提话题，台词阶段从歌曲引出 |
| Cookie 刷新覆写完整 cookie | 合并模式：仅替换 MUSIC_U 单 key |
| Roll 时音量突增 | 所有 `bgmRef.volume = 1.0` → `volumeRef.current`（共 4 处 + 交叉淡入淡出） |
| DJ 音量不受旋钮控制 | 滚轮和 handleVolChange 同时设置 bgmRef 和 ttsRef 音量 |
| 竖屏窗口卡片被拉长 | 卡片容器加 `max-h-[900px]` |
| Spotify 客户端凭证明文存储 | 统一走 localStorage（与 AI key 一致） |
| 主进程日志看不到 | console.log 劫持 → IPC main-log → 渲染进程 F12 显示 |
| TTS 声线出戏 | 白桦 → 茉莉 |

---

## 十、UI 设计理念

- **暗色主题**：深紫黑底色 (#14002e) + 粉(#ff007f) + 橙(#ff7700) + 青(#00ffff) 霓虹辅色
- **蒸汽波背景**：Three.js 实时渲染落日 + 粉色网格 + 雾化氛围，替代旧星空粒子
- **3D 交互**：TiltCard 磁性悬浮效果，鼠标跟随倾斜
- **视觉反馈**：isSpeaking 时 Depth 头像呼吸发光 + 弹跳 + 流光边缘亮度提升
- **频谱可视化**：3 弦 × 4 层 SVG 物理堆叠，独立辉光滤镜，播放时活跃、静默时淡出
- **扫码弹窗**：毛玻璃 + 赛博感呼吸边框 + 扫描线动画
- **竖屏适配**：卡片 `max-h-[900px]`，超出部分用背景填充

---

> 文档版本：2026-05-16
