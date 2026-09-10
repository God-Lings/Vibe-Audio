import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Play, Pause, RefreshCw, Music, Radio, ChevronLeft, Settings, Bot, Send, MessageSquare } from 'lucide-react'
import TypewriterText from './components/TypewriterText'
import TiltCard from './components/TiltCard'
import ScrambleText from './components/ScrambleText'
import RetroFutureBackground from './components/RetroFutureBackground'

export default function VibeAudioApp() {
  const [currentView, setCurrentView] = useState('platform');
  const [platform, setPlatform] = useState('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [userMood, setUserMood] = useState('');
  const [currentTime, setCurrentTime] = useState('--:--');
  const [songProgress, setSongProgress] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const volumeRef = useRef(0.8);
  const [showVolRing, setShowVolRing] = useState(false);
  const volRingRef = useRef(null);

  // ★ 原生非被动滚轮监听，响应式挂载到 volRingRef（随 currentView 切换重新绑定） ★
  useEffect(() => {
    const el = volRingRef.current;
    // 只有在 el 存在且当前是 player 视图时才挂载
    if (!el || currentView !== 'player') return;
    const handleWheel = (e) => {
      e.preventDefault();
      const newVol = Math.max(0, Math.min(1, volumeRef.current - e.deltaY * 0.001));
      volumeRef.current = newVol;
      setVolume(newVol);
      if (bgmRef.current) bgmRef.current.volume = isSpeakingRef.current ? Math.max(0.1, newVol * 0.3) : newVol
      if (ttsRef.current) ttsRef.current.volume = newVol
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [currentView]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      const h = String(now.getHours()).padStart(2, '0')
      const m = String(now.getMinutes()).padStart(2, '0')
      setCurrentTime(h + ':' + m)
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  const WELCOME_MESSAGES = [
    "系统已就绪，唱片机转起来了。我是 Depth，你的 AI 电台朋友。说句话就能开始——或者按那个 Roll 键，让我猜猜你现在适合听什么。",
    "Depth 已上线... 两条路给你选：打字告诉我想听什么，或者按 Roll 让我来猜。交给音乐就好。",
    "Hey，我是 Depth。你的像素 DJ 朋友连上线了。想听歌的话，发条消息或者直接 Roll 一下，剩下的交给我。",
    "Depth 正在待命… 你说话，或者我猜。按 Roll 让我看看你的世界此刻需要什么氛围。",
    "欢迎来到 Vibe Audio。我是 Depth，你的人工智能唱片骑士。说句话开始，或者让我自由发挥——Roll 一下试试？",
    "系统自检完毕，Depth 已就位。两种模式：你来点歌，或者让我感受你。按 Roll 开始观察吧。",
    "Depth 醒过来了，唱片机也热好了。告诉我你想听什么，或者让我用音乐给你一个惊喜。Roll 一下？"
  ];

  const pickWelcome = () => WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];

  const AFTER_DJ = [
    "音乐还在继续，闭上眼睛沉浸就好。",
    "Depth 退到唱片机后面，让旋律自己说话。",
    "耳机里的世界，比外面安静多了。",
    "让音符接管接下来的时间吧。",
    "这张唱片在接管空间，你只需要呼吸。",
    "旋律正在编织你的夜晚...",
    "放松——音乐已经找到你了。",
    "Depth 安静下来，让 BGM 继续讲故事。"
  ];

  const [songInfo, setSongInfo] = useState({ title: "等待指令...", artist: "Depth AI Radio" });
  const [djSubtitle, setDjSubtitle] = useState(pickWelcome());

  const [spotifyConfig, setSpotifyConfig] = useState({
    clientId: localStorage.getItem('vibe_spotify_client_id') || '',
    clientSecret: localStorage.getItem('vibe_spotify_client_secret') || ''
  });

  const [aiConfig, setAiConfig] = useState(() => ({
    deepseekKey: localStorage.getItem('vibe_deepseek_key') || '',
    mimoKey: localStorage.getItem('vibe_mimo_key') || ''
  }))

  // ★ 网易云登录状态
  const [neteaseUser, setNeteaseUser] = useState(null);  // { nickname, avatarUrl } or null
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrImg, setQrImg] = useState('');
  const [qrKey, setQrKey] = useState('');
  const [qrStatusText, setQrStatusText] = useState('');

  // 启动时轮询检查登录态（解决 3001 端口未就绪的问题）
  useEffect(() => {
    let attempts = 0
    const maxAttempts = 6
    const timer = setInterval(async () => {
      attempts++
      try {
        const res = await window.electron.ipcRenderer.invoke('netease-check-login')
        if (res?.loggedIn && res.profile) {
          setNeteaseUser(res.profile)
          console.log('[网易云登录] 已恢复登录态:', res.profile.nickname)
          clearInterval(timer)
          return
        }
      } catch (e) {
        console.warn(`[网易云登录] 检查失败 (${attempts}/${maxAttempts}):`, e)
      }
      if (attempts >= maxAttempts) {
        console.warn('[网易云登录] 超过最大尝试次数，停止轮询')
        clearInterval(timer)
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [])

  // ★ 扫描二维码模态逻辑
  const handleOpenQr = async () => {
    try {
      setQrStatusText('正在获取二维码...')
      setQrImg('')
      setShowQrModal(true)
      const res = await window.electron.ipcRenderer.invoke('netease-get-qr')
      if (!res.success) throw new Error(res.error)
      setQrImg(res.qrimg)
      setQrKey(res.unikey)
      setQrStatusText('请使用网易云音乐 App 扫码')
      // 开始轮询
      pollQrStatus(res.unikey)
    } catch (e) {
      setQrStatusText('获取二维码失败: ' + e.message)
    }
  }

  const pollQrStatusRef = useRef(null)
  const pollQrStatus = async (key) => {
    if (pollQrStatusRef.current) clearInterval(pollQrStatusRef.current)
    pollQrStatusRef.current = setInterval(async () => {
      try {
        const res = await window.electron.ipcRenderer.invoke('netease-check-qr', key)
        if (!res.success) {
          setQrStatusText('查询失败: ' + res.error)
          return
        }
        if (res.code === 803) {
          // 登录成功
          clearInterval(pollQrStatusRef.current)
          setQrStatusText('登录成功!')
          setNeteaseUser(res.profile)
          setTimeout(() => {
            setShowQrModal(false);
            handleSelectPlatform('netease');
          }, 1000)
        } else if (res.code === 800) {
          clearInterval(pollQrStatusRef.current)
          setQrStatusText('二维码已过期，请关闭重试')
        } else if (res.code === 802) {
          setQrStatusText('请在手机上确认登录')
        } else {
          setQrStatusText('等待扫码...')
        }
      } catch (e) {
        setQrStatusText('轮询异常: ' + e.message)
      }
    }, 2000)
  }

  const handleLogout = async () => {
    await window.electron.ipcRenderer.invoke('netease-logout')
    setNeteaseUser(null)
  }

  // ★★★ AB 轨 + TTS 唱片机 ★★★
  const bgmRef = useRef(null);       
  const bgmNextRef = useRef(null);   
  const ttsRef = useRef(null);

  // 星空粒子
  const starParticlesRef = useRef(null);
  if (!starParticlesRef.current) {
    starParticlesRef.current = Array.from({ length: 60 }).map(() => ({
      angle: Math.random() * 360,
      delay: Math.random() * -15,
      duration: Math.random() * 12 + 10,
      size: Math.random() * 2 + 1,
      brightness: Math.random() * 0.6 + 0.1
    }));
  }

  // ---- 可视化 ----
  const visHeights = useRef(new Float32Array(32).fill(0.02));
  const [, setVisTicker] = useState(0);

  // ★ 物理路径堆叠：3根弦 × 4层，彻底消灭 SVG 滤镜颗粒感
  const layers = useMemo(() => {
    const l = [
      { id: 'v1', color: '#e9d5ff', widths: [8, 4, 1.5, 0.8], opacities: [0.1, 0.2, 0.6, 1], refs: [React.createRef(), React.createRef(), React.createRef(), React.createRef()] },
      { id: 'v2', color: '#a855f7', widths: [12, 6, 2.5, 1.2], opacities: [0.08, 0.15, 0.5, 0.8], refs: [React.createRef(), React.createRef(), React.createRef(), React.createRef()] },
      { id: 'v3', color: '#ec4899', widths: [10, 5, 2.0, 1.0], opacities: [0.05, 0.12, 0.4, 0.6], refs: [React.createRef(), React.createRef(), React.createRef(), React.createRef()] }
    ];
    window.vibeRefs = l;
    return l;
  }, []);
  // 物理能量平滑值（Lerp 因子 0.12，增加粘滞感）
  const smoothedBass = useRef(0);
  const smoothedMid = useRef(0);
  const smoothedTre = useRef(0);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const audioGraphBuilt = useRef(false);

  // 纯 CSS 硬件加速流星雨数据
  const meteorsRef = useRef(null);
  if (!meteorsRef.current) {
    meteorsRef.current = Array.from({ length: 15 }).map(() => ({
      id: Math.random().toString(36).substr(2, 9),
      x: `${Math.random() * 120 - 40}%`,      
      y: `${-Math.random() * 30 - 10}%`,      
      angle: 30 + Math.random() * 15,         
      length: 60 + Math.random() * 60,        
      thickness: 1 + Math.random() * 1.5,     
      opacity: 0.2 + Math.random() * 0.6,     
      duration: 6 + Math.random() * 6,        
      delay: Math.random() * 20,              
      distance: 400 + Math.random() * 300     
    }));
  }

  const buildAudioGraph = () => {
    if (audioGraphBuilt.current) return;
    const bgm = bgmRef.current;
    const bgmNext = bgmNextRef.current;
    const tts = ttsRef.current;
    if (!bgm || !bgmNext || !tts) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      // 扩大动态范围，防止低频能量轻易爆表
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      const sourceBgm = ctx.createMediaElementSource(bgm);
      sourceBgm.connect(analyser);
      const sourceBgmNext = ctx.createMediaElementSource(bgmNext);
      sourceBgmNext.connect(analyser);
      const sourceTts = ctx.createMediaElementSource(tts);
      sourceTts.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      audioGraphBuilt.current = true;
    } catch (e) {
      console.error("❌ Web Audio 图构建失败:", e.message);
    }
  };

  useEffect(() => {
    if (bgmRef.current && bgmNextRef.current && ttsRef.current && !audioGraphBuilt.current) {
      buildAudioGraph();
    }
  }, []);

  // ---- 可视化 raf 循环 ----
  useEffect(() => {
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    let rafId;
    const heights = visHeights.current;
    const analyser = analyserRef.current;
    
    const loop = () => {
      if (analyser && (isPlayingRef.current || isSpeakingRef.current)) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        for (let i = 0; i < 32; i++) {
          // 非线性频段映射：截断到 64 个 bin（约 11kHz）
          const ratio = i / 31;
          const startBin = Math.floor(Math.pow(ratio, 2) * 64);
          const endBin = Math.floor(Math.pow((i + 1) / 31, 2) * 64);
          const count = Math.max(1, endBin - startBin);

          let sum = 0;
          for (let j = 0; j < count; j++) {
            sum += dataArray[startBin + j] || 0;
          }
          let avg = sum / count;

          // 高频视觉补偿：右侧小幅放大 1~1.8 倍
          const boost = 1 + (i / 31) * 0.8;
          avg = Math.min(255, avg * boost);

          // 提高平滑指数 + 压制最高点，给呼吸空间
          const norm = Math.pow(avg / 255, 1.4);
          const target = 0.02 + norm * 0.80;
          heights[i] = heights[i] * 0.6 + target * 0.4;
        }
        setVisTicker(n => (n % 1000) + 1);
      } else {
        let anyActive = false;
        for (let i = 0; i < 32; i++) {
          heights[i] = heights[i] * 0.88 + 0.02 * 0.12;
          if (heights[i] > 0.025) anyActive = true;
        }
        setVisTicker(prev => (anyActive ? (prev % 1000) + 1 : 0));
      }

      // ★★★ 物理堆叠光弦引擎 v4：120 点采样 + 600 坐标系 + 4 层堆叠共享路径 ★★★
      if (analyser) {
        // 1. 直接从分析器读取当前帧最真实的原始数据
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        // 2. 提取低中高频的即时能量 (0-1 范围)
        const getEnergy = (start, end) => {
          let sum = 0;
          for (let i = start; i < end; i++) sum += dataArray[i];
          return Math.pow(sum / (end - start) / 255, 1.3);
        };

        const rawBass = getEnergy(0, 5);
        const rawMid = getEnergy(5, 20);
        const rawTre = getEnergy(20, 50);

        // 3. 物理能量平滑（Lerp 因子 0.12，增加粘滞感）
        smoothedBass.current += (rawBass - smoothedBass.current) * 0.12;
        smoothedMid.current += (rawMid - smoothedMid.current) * 0.12;
        smoothedTre.current += (rawTre - smoothedTre.current) * 0.12;

        const time = Date.now() / 1000;

        // 4. 绘制每一根弦的 4 层堆叠（共享同一条路径）
        const configs = [
          { refs: layers[0].refs, amp: smoothedBass.current * 32, freq: 0.012, speed: 2.0, phase: 0 },
          { refs: layers[1].refs, amp: smoothedMid.current * 38, freq: 0.018, speed: 2.6, phase: Math.PI / 3 },
          { refs: layers[2].refs, amp: smoothedTre.current * 42, freq: 0.022, speed: 3.2, phase: Math.PI / 1.5 }
        ];

        configs.forEach(cfg => {
          const points = [];
          // 120 点超高采样，配合 600 单位，实现真正的物理像素对齐
          for (let i = 0; i <= 120; i++) {
            const x = (i / 120) * 600;
            const edgeDamping = Math.sin((i / 120) * Math.PI);
            const wave = Math.sin(x * cfg.freq - time * cfg.speed + cfg.phase);
            const y = 50 + wave * (1.5 + cfg.amp) * edgeDamping;
            points.push({ x, y });
          }

          let d = `M 0 50 `;
          for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const cpX = p0.x + (p1.x - p0.x) / 2;
            d += `C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y} `;
          }

          // 核心：一根弦的所有堆叠层共享同一条极致顺滑的路径
          cfg.refs.forEach(r => r.current?.setAttribute('d', d));
        });
      }

      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // --- 三段式循环状态机 ---
  const [songCycleIndex, setSongCycleIndex] = useState(0);
  const lockedVibeRef = useRef(null);
  const lastTrackRef = useRef(null);
  const songCycleIndexRef = useRef(0);
  useEffect(() => { songCycleIndexRef.current = songCycleIndex; }, [songCycleIndex]);

  // --- 元数据 ---
  const [currentReasoning, setCurrentReasoning] = useState('');
  const [currentGenreTag, setCurrentGenreTag] = useState('');
  const [activeAppName, setActiveAppName] = useState('');

  // --- taskId 防幽灵电波 ---
  const [currentTaskId, setCurrentTaskId] = useState('');
  const currentTaskIdRef = useRef('');
  useEffect(() => { currentTaskIdRef.current = currentTaskId; }, [currentTaskId]);

  // --- 垫乐循环 & 交叉淡入淡出 状态 ---
  const padLoopActiveRef = useRef(false);
  const pendingSwitchRef = useRef(false);
  const crossfadeActiveRef = useRef(false);
  const waitingForDelayedTTSRef = useRef(false);
  const delayedTTS_RescueTimer = useRef(null);

  // 低频共振阴影 ref
  const mainCardRef = useRef(null);
  const currentBassRef = useRef(0);

  // ---- 低频共振：RAf 提取 bass → 直接操作 mainCardRef DOM boxShadow ----
  const bassResonanceRaf = useRef(null);
  const bassResonanceEffect = () => {
    const card = mainCardRef.current;
    const analyser = analyserRef.current;
    if (!card || !analyser) { bassResonanceRaf.current = requestAnimationFrame(bassResonanceEffect); return; }
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    // 提取前 2 个 bin 的平均 bass 能量
    let bass = 0, count = Math.min(2, data.length);
    for (let i = 0; i < count; i++) bass += data[i];
    bass = bass / count / 255;
    // lerp 平滑
    currentBassRef.current = currentBassRef.current * 0.8 + bass * 0.2;
    const b = currentBassRef.current;
    const intensity = Math.min(1, b * 2.5);
    // 直接修改 DOM 阴影（不走 React state）
    card.style.boxShadow = intensity > 0.01
      ? `0 0 ${12 + intensity * 20}px rgba(29,185,84,${intensity * 0.35}), 0 0 ${30 + intensity * 40}px rgba(139,92,246,${intensity * 0.2})`
      : '0 0 0 transparent';
    bassResonanceRaf.current = requestAnimationFrame(bassResonanceEffect);
  };
  useEffect(() => {
    bassResonanceRaf.current = requestAnimationFrame(bassResonanceEffect);
    return () => cancelAnimationFrame(bassResonanceRaf.current);
  }, []);

  // --- 预加载系统 ref ---
  const preloadedResponse = useRef(null);
  const isPreloading = useRef(false);
  const isPlayingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const callAIBackendRef = useRef(null);
  const preloadNextTrackRef = useRef(null);
  const aiConfigRef = useRef(null);
  const switchToNextTrackRef = useRef(null);
  const preloadTaskIdRef = useRef('');

  // ★═══ 时间戳日志辅助函数 ═══★
  // 基准时间在 useEffect 中初始化
  const logT0Ref = useRef(0);
  const logTReady = useRef(false);
  const logT = (label, extra = '') => {
    if (!logTReady.current) return;
    const elapsed = (Date.now() - logT0Ref.current).toFixed(0);
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0');
    console.log(`[${ts}][+${elapsed}ms] ${label}${extra ? ' | ' + extra : ''}`);
  };
  useEffect(() => {
    logT0Ref.current = Date.now();
    logTReady.current = true;
    logT('🎬 [App] 组件挂载，基准时间已设定');
  }, []);

  // ★═══ 神级交叉淡入淡出（Promise绝对握手交接） ═══★
  const switchToNextTrack = async (cached) => {
    if (!bgmNextRef.current || !bgmRef.current) return;
    if (crossfadeActiveRef.current) return;
    logT('⚡ [交叉淡入淡出] 开始，B轨就绪，准备载入声卡');

    bgmNextRef.current.currentTime = 0;
    bgmNextRef.current.volume = 0;

    try {
      await bgmNextRef.current.play();
      setIsPlaying(true);
      logT('⚡ [交叉淡入淡出] B轨已发声，开始20步×25ms音量交接');

      crossfadeActiveRef.current = true;
      const FADE_STEPS = 20; 
      let step = 0;
      
      const targetVolume = isSpeakingRef.current ? volumeRef.current * 0.3 : volumeRef.current;
      const startVolumeA = bgmRef.current.volume;

      const fadeInterval = setInterval(() => {
        try {
          step++;
          const progress = step / FADE_STEPS;
          
          if (bgmRef.current) {
            bgmRef.current.volume = Math.max(0, startVolumeA * (1 - Math.pow(progress, 2)));
          }
          if (bgmNextRef.current) {
            bgmNextRef.current.volume = Math.min(targetVolume, targetVolume * Math.sqrt(progress));
          }
          
          if (step >= FADE_STEPS) {
            clearInterval(fadeInterval);
            crossfadeActiveRef.current = false;
            
            if (bgmRef.current) {
              bgmRef.current.pause();
              bgmRef.current.removeAttribute('src');
              bgmRef.current.currentTime = 0;
              bgmRef.current.volume = volumeRef.current;
              bgmRef.current.loop = false; 
            }
            
            [bgmRef.current, bgmNextRef.current] = [bgmNextRef.current, bgmRef.current];
            
            lastTrackRef.current = { name: cached.track_name, artist: cached.artist, genre_tags: cached.genre_tags || [] };
            if (songCycleIndexRef.current === 0 && cached.genre_tags?.length) {
              lockedVibeRef.current = cached.genre_tags;
            }
            setSongInfo({ title: cached.track_name, artist: cached.artist });
            setCurrentReasoning(cached.reasoning || '');
            setCurrentGenreTag(cached.genre_tags?.[0] || cached.mood_tag || '');
            setActiveAppName(cached.activeApp || '');
            logT(`✅ [交叉淡入淡出] 完成！已切换到: ${cached.track_name} - ${cached.artist}`);
          }
        } catch (e) {
          clearInterval(fadeInterval);
          crossfadeActiveRef.current = false;
          console.error("交叉淡入淡出步骤出错", e);
        }
      }, 25);
    } catch (e) {
      console.error("AB轨切换播放失败", e);
    }
  };

  const advanceCycleAfterTTSCleanup = () => {
    logT('🔄 [advanceCycleAfterTTSCleanup] 垫乐场景TTS播完，推进Phase');
    const afterDJ = AFTER_DJ;
    setDjSubtitle(afterDJ[Math.floor(Math.random() * afterDJ.length)]);
    setSongCycleIndex(prev => (prev + 1) % 3);
    preloadedResponse.current = null;
    isPreloading.current = false;
    logT(`🔄 [advanceCycleAfterTTSCleanup] Phase → ${(songCycleIndexRef.current + 1) % 3}，预加载缓存已清空`);
  };

  // --- TTS 监听 ---
  useEffect(() => {
    const handler = (_event, data) => {
      // ★ [预加载驿站] 识别 preload- 开头的 taskId → 缓存语音，不播放
      if (data.taskId && data.taskId.startsWith('preload-')) {
        if (data.error) {
          logT(`⏭️ [预加载驿站] taskId=${data.taskId} TTS生成失败: ${data.error}，跳过缓存`);
          return;
        }
        if (preloadedResponse.current) {
          preloadedResponse.current.dj_script = data.dj_script;
          preloadedResponse.current.audioData = data.audioData;
          logT(`📥 [预加载驿站] taskId=${data.taskId} 语音已缓存 → 预加载响应中含${data.audioData?.length || 0}字节音频数据`);
          // 亡羊补牢：如果歌已切但DJ还没说话，立即补播
          if (waitingForDelayedTTSRef.current) {
            waitingForDelayedTTSRef.current = false;
            clearTimeout(delayedTTS_RescueTimer.current);
            const cached = preloadedResponse.current;
            setDjSubtitle(cached.dj_script);
            ttsRef.current.src = `data:audio/wav;base64,${cached.audioData}`;
            ttsRef.current.play().then(() => setIsSpeaking(true)).catch(() => {});
            ttsRef.current.onended = () => {
              setIsSpeaking(false);
              setDjSubtitle(AFTER_DJ[Math.floor(Math.random() * AFTER_DJ.length)]);
              setSongCycleIndex(prev => (prev + 1) % 3);
              preloadedResponse.current = null;
              isPreloading.current = false;
            };
          }
        } else {
          logT(`⚠️ [预加载驿站] taskId=${data.taskId} 语音到达但 preloadedResponse 已被清空，丢弃`);
        }
        return;
      }
      const activeTaskId = currentTaskIdRef.current;
      if (data.error) {
        setDjSubtitle("( DJ 麦克风出了点小问题，但音乐还在继续~ )");
        return;
      }
      if (data.taskId !== activeTaskId) return;
      
      setDjSubtitle(data.dj_script);
      ttsRef.current.src = `data:audio/wav;base64,${data.audioData}`;
      ttsRef.current.play().then(() => setIsSpeaking(true)).catch(() => {});
      
      ttsRef.current.onended = () => {
        if (currentTaskIdRef.current !== data.taskId) return;
        setIsSpeaking(false);

        if (padLoopActiveRef.current) {
          console.log("⚡ [垫乐释放] DJ说完，开始向新歌进行平滑过渡...");
          padLoopActiveRef.current = false;
          pendingSwitchRef.current = false;
          
          if (bgmRef.current) {
            bgmRef.current.loop = false;
          }
          
          if (preloadedResponse.current && bgmNextRef.current?.src && switchToNextTrackRef.current) {
            switchToNextTrackRef.current(preloadedResponse.current);
            const cached = preloadedResponse.current;
            if (cached.dj_script && cached.audioData) {
              setDjSubtitle(cached.dj_script);
              ttsRef.current.src = `data:audio/wav;base64,${cached.audioData}`;
              setTimeout(() => {
                setIsSpeaking(true);
                ttsRef.current.play().catch(() => setIsSpeaking(false));
                ttsRef.current.onended = () => {
                  setIsSpeaking(false);
                  advanceCycleAfterTTSCleanup();
                };
              }, 800);
            } else {
              advanceCycleAfterTTSCleanup();
            }
          } else {
            const cb = callAIBackendRef.current;
            if (cb) cb('');
          }
          return;
        }

        setDjSubtitle(AFTER_DJ[Math.floor(Math.random() * AFTER_DJ.length)]);
        setSongCycleIndex(prev => (prev + 1) % 3);
        isPreloading.current = false;
        preloadedResponse.current = null;
      };
    };
    window.electron.ipcRenderer.on('tts-ready', handler);
    return () => { window.electron.ipcRenderer.removeListener('tts-ready', handler) };
  }, []);

  // 监听主进程转发过来的日志，输出到 F12 控制台，方便排障
  useEffect(() => {
    const handler = (_event, message) => {
      console.log(`%c[主进程] ${message}`, 'color: #8B5CF6')
    }
    window.electron.ipcRenderer.on('main-log', handler)
    return () => { window.electron.ipcRenderer.removeListener('main-log', handler) }
  }, [])

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { callAIBackendRef.current = callAIBackend; });
  useEffect(() => { preloadNextTrackRef.current = preloadNextTrack; });
  useEffect(() => { aiConfigRef.current = aiConfig; }, [aiConfig]);

  // --- BGM 事件核心：【提前截胡】物理级无缝垫乐 ---
  useEffect(() => {
    if (!bgmRef.current) { bgmRef.current = new Audio(); bgmRef.current.crossOrigin = "anonymous"; }
    if (!bgmNextRef.current) { bgmNextRef.current = new Audio(); bgmNextRef.current.crossOrigin = "anonymous"; }
    if (!ttsRef.current) { ttsRef.current = new Audio(); ttsRef.current.crossOrigin = "anonymous"; ttsRef.current.volume = volumeRef.current; }

    switchToNextTrackRef.current = switchToNextTrack;

    const PRELOAD_THRESHOLD = 25;
    const getActivePlayer = () => bgmRef.current;

    const handleTimeUpdate = () => {
      const player = getActivePlayer();
      if (!player || !player.duration) return;
      const remaining = player.duration - player.currentTime;
      const progressPct = (player.currentTime / player.duration) * 100;
      setSongProgress(progressPct);
      
      // 仅在剩余 18s 边界触发一次日志
      if (remaining <= PRELOAD_THRESHOLD && remaining > 0 && !isPreloading.current) {
        logT(`⏰ [timeupdate] 歌曲剩余 ${remaining.toFixed(1)}s，触发预加载 (threshold=${PRELOAD_THRESHOLD}s, progress=${progressPct.toFixed(1)}%)`);
        isPreloading.current = true;
        const cb = preloadNextTrackRef.current;
        if (cb) cb();
      }

      if (remaining <= 1.0 && remaining > 0) {
        if (isSpeakingRef.current && !padLoopActiveRef.current) {
          logT(`⏰ [timeupdate] 歌曲剩余 ${remaining.toFixed(1)}s + DJ在说话 → 垫乐截胡！loop=on`);
          player.loop = true;
          padLoopActiveRef.current = true;
          pendingSwitchRef.current = true;
        } else if (remaining <= 0.5 && !isSpeakingRef.current && !isPreloading.current && !preloadedResponse.current) {
          logT(`⏰ [timeupdate] 歌曲剩余 ${remaining.toFixed(1)}s，DJ没说话但无预加载 → 危险信号`);
        }
      }
    };

    const advanceCycleAfterTTS = () => {
      logT('🔄 [advanceCycleAfterTTS] 正常场景：TTS播完，推进Phase，清空预加载');
      setDjSubtitle(AFTER_DJ[Math.floor(Math.random() * AFTER_DJ.length)]);
      setSongCycleIndex(prev => (prev + 1) % 3);
      preloadedResponse.current = null;
      isPreloading.current = false;
      logT(`🔄 [advanceCycleAfterTTS] Phase → ${(songCycleIndexRef.current + 1) % 3}，完成`);
    };

    const handleSongEnd = () => {
      const endedTs = Date.now();
      logT('🎵 [handleSongEnd] ★★★ 歌曲 ended 事件触发 ★★★');
      
      // 检查当前播放的是什么歌
      const currentInfo = lastTrackRef.current;
      logT(`🎵 [handleSongEnd] 当前曲目: ${currentInfo?.name || '未知'} - ${currentInfo?.artist || '未知'}`);

      const isSpeakingNow = isSpeakingRef.current;
      const hasPreload = !!preloadedResponse.current;
      const nextHasSrc = !!bgmNextRef.current?.src;
      const isPreloadingNow = isPreloading.current;

      logT(`🎵 [handleSongEnd] 状态: isSpeaking=${isSpeakingNow}, hasPreload=${hasPreload}, bgmNext.src=${nextHasSrc}, isPreloading=${isPreloadingNow}`);

      if (isSpeakingNow) {
        logT('🎵 [handleSongEnd] → 分支A: DJ正在说话，执行垫乐兜底');
        setIsPlaying(true);
        const player = getActivePlayer();
        if (player) {
          player.loop = true;
          player.currentTime = 0;
          player.play().catch(() => {});
          logT(`🎵 [handleSongEnd] 垫乐已重启循环 (currentTime=0, loop=true), 耗时: ${Date.now() - endedTs}ms`);
        }
        padLoopActiveRef.current = true;
        pendingSwitchRef.current = true;
        isPreloading.current = false;
        logT('🎵 [handleSongEnd] 垫乐兜底完成，等待DJ说完后释放');
        return;
      }

      setIsPlaying(false);
      logT(`🎵 [handleSongEnd] DJ不说话，走切歌路径，当前耗时: ${Date.now() - endedTs}ms`);

      if (hasPreload && nextHasSrc) {
        logT(`🎵 [handleSongEnd] → 分支B: 预加载已就绪，直接交叉淡入淡出`);
        const cached = preloadedResponse.current;
        const fadeStart = Date.now();
        switchToNextTrackRef.current(cached);
        if (cached.dj_script && cached.audioData) {
          setDjSubtitle(cached.dj_script);
          ttsRef.current.src = `data:audio/wav;base64,${cached.audioData}`;
          setTimeout(() => {
            logT(`🎵 [handleSongEnd] 800ms延迟后开始播放TTS (ended后${(Date.now() - endedTs).toFixed(0)}ms)`);
            setIsSpeaking(true);
            ttsRef.current.play().catch(() => setIsSpeaking(false));
            ttsRef.current.onended = () => {
              logT(`🎵 [handleSongEnd] TTS播完，触发advanceCycle (总耗时: ${(Date.now() - endedTs).toFixed(0)}ms)`);
              setIsSpeaking(false);
              advanceCycleAfterTTS();
            };
          }, 800);
        } else {
          logT(`🎵 [handleSongEnd] 预加载无TTS数据，等待异步TTS到达`);
          waitingForDelayedTTSRef.current = true;
          // 30s 极限兜底：TTS 超时未到达则自动推进，避免卡死
          delayedTTS_RescueTimer.current = setTimeout(() => {
            if (waitingForDelayedTTSRef.current) {
              waitingForDelayedTTSRef.current = false;
              setSongCycleIndex(prev => (prev + 1) % 3);
              preloadedResponse.current = null;
              isPreloading.current = false;
              logT(`⏰ [亡羊补牢超时] 30s内TTS未到达，自动推进`);
            }
          }, 30000);
        }
        logT(`🎵 [handleSongEnd] 切歌+TTS总耗时: ${Date.now() - fadeStart}ms`);
        return;
      }

      if (isPreloadingNow) {
        let warned = false;
        const hardDeadline = Date.now() + 30000;
        logT(`🎵 [handleSongEnd] → 分支C: 预加载进行中，轮询等待(6s后静默等待，30s极限超时)`);
        const waitInterval = setInterval(() => {
          if (preloadedResponse.current && bgmNextRef.current?.src) {
            logT(`🎵 [handleSongEnd] 轮询成功！等待${(Date.now() - endedTs).toFixed(0)}ms后预加载完成`);
            clearInterval(waitInterval);
            handleSongEnd();
          } else if (Date.now() >= hardDeadline) {
            logT(`🎵 [handleSongEnd] 💀 30s极限超时，放弃等待，走冷启动兜底`);
            clearInterval(waitInterval);
            isPreloading.current = false;
            const cb = callAIBackendRef.current;
            if (cb) cb('');
          } else if (Date.now() >= endedTs + 6000 && !warned) {
            warned = true;
            logT(`🎵 [handleSongEnd] ⚠ 轮询6s超时，不开启新任务，静默等待原始预加载返回...`);
          }
        }, 500);
        return;
      }

      logT(`🎵 [handleSongEnd] → 分支D: 无预加载，直接callAIBackend兜底 (总耗时: ${(Date.now() - endedTs).toFixed(0)}ms)`);
      const cb = callAIBackendRef.current;
      if (cb) cb('');
    };

    const _bgm = bgmRef.current;
    const _bgmNext = bgmNextRef.current;
    _bgm.addEventListener('timeupdate', handleTimeUpdate);
    _bgm.addEventListener('ended', handleSongEnd);
    _bgmNext.addEventListener('timeupdate', handleTimeUpdate);
    _bgmNext.addEventListener('ended', handleSongEnd);
    return () => {
      _bgm.removeEventListener('timeupdate', handleTimeUpdate);
      _bgm.removeEventListener('ended', handleSongEnd);
      _bgmNext.removeEventListener('timeupdate', handleTimeUpdate);
      _bgmNext.removeEventListener('ended', handleSongEnd);
    };
  }, []);

  // --- 智能音量避让（动态基准：说话时降到用户音量的 30%，说完恢复） ---
  useEffect(() => {
    let fadeInterval;
    if (isSpeaking) {
      fadeInterval = setInterval(() => {
        if (crossfadeActiveRef.current) return;
        const targetDuck = Math.max(0.1, volumeRef.current * 0.3);
        if (bgmRef.current && bgmRef.current.volume > targetDuck) {
          bgmRef.current.volume = Math.max(targetDuck, bgmRef.current.volume - 0.05);
        } else { clearInterval(fadeInterval); }
      }, 100);
    } else {
      fadeInterval = setInterval(() => {
        if (crossfadeActiveRef.current) return;
        if (bgmRef.current && bgmRef.current.volume < volumeRef.current) {
          bgmRef.current.volume = Math.min(volumeRef.current, bgmRef.current.volume + 0.05);
        } else { clearInterval(fadeInterval); }
      }, 100);
    }
    return () => clearInterval(fadeInterval);
  }, [isSpeaking]);

  const handleVolChange = (val) => {
    const newVol = Math.max(0, Math.min(1, val));
    setVolume(newVol);
    volumeRef.current = newVol;
    if (bgmRef.current) bgmRef.current.volume = isSpeakingRef.current ? Math.max(0.1, newVol * 0.3) : newVol
    if (ttsRef.current) ttsRef.current.volume = newVol
  };

  const handleRingMouseDown = (e) => {
    const updateVol = (event) => {
      if (!volRingRef.current) return;
      const rect = volRingRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
      let norm = (angle + Math.PI / 2) / (Math.PI * 2);
      if (norm < 0) norm += 1;
      handleVolChange(norm);
    };
    updateVol(e);
    const onMouseMove = (ev) => updateVol(ev);
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleSelectPlatform = (selected) => {
    setPlatform(selected);
    if (selected === 'spotify') {
      if (spotifyConfig.clientId && spotifyConfig.clientSecret) setCurrentView('player');
      else setCurrentView('config');
    } else {
      setCurrentView('player');
    }
  };

  const handleSaveSpotifyConfig = () => {
    if (spotifyConfig.clientId && spotifyConfig.clientSecret) {
      localStorage.setItem('vibe_spotify_client_id', spotifyConfig.clientId);
      localStorage.setItem('vibe_spotify_client_secret', spotifyConfig.clientSecret);
      setCurrentView('player');
    } else alert("请填写完整的 Spotify 凭证");
  };

  const handleSaveAiConfig = () => {
    if (aiConfig.deepseekKey && aiConfig.mimoKey) {
      localStorage.setItem('vibe_deepseek_key', aiConfig.deepseekKey);
      localStorage.setItem('vibe_mimo_key', aiConfig.mimoKey);
      setCurrentView('platform');
    } else alert("建议填写完整双端 API 以获得最佳体验");
  };

  const pauseFadeTimer = useRef(null);

  const togglePlay = () => {
    if (!bgmRef.current.src) return;
    if (isPlaying) {
      // 暂停：渐出 → 停止
      clearInterval(pauseFadeTimer.current);
      const startVol = bgmRef.current.volume;
      const steps = 10; let s = 0;
      pauseFadeTimer.current = setInterval(() => {
        s++;
        if (bgmRef.current) bgmRef.current.volume = startVol * (1 - s / steps);
        if (s >= steps) {
          clearInterval(pauseFadeTimer.current);
          bgmRef.current.pause();
          setIsPlaying(false);
        }
      }, 30);
    } else {
      // 播放：渐入
      clearInterval(pauseFadeTimer.current);
      bgmRef.current.volume = 0;
      bgmRef.current.play().catch(() => {});
      setIsPlaying(true);
      const target = isSpeakingRef.current ? volumeRef.current * 0.3 : volumeRef.current;
      const steps = 10; let s = 0;
      pauseFadeTimer.current = setInterval(() => {
        s++;
        if (bgmRef.current) bgmRef.current.volume = target * (s / steps);
        if (s >= steps) clearInterval(pauseFadeTimer.current);
      }, 30);
    }
  };

  const preloadAudioBlob = async (trackUrl) => {
    try {
      const res = await fetch(trackUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      if (bgmNextRef.current) {
        bgmNextRef.current.src = blobUrl;
        bgmNextRef.current.load();
      }
      return blobUrl;
    } catch (e) {
      return trackUrl;
    }
  };

  const preloadNextTrack = async () => {
    isPreloading.current = true;
    const config = aiConfigRef.current;
    if (!config) {
      logT('⚠️ [预加载] aiConfig 为空，取消预加载');
      isPreloading.current = false;
      return;
    }
    const nextPhase = (songCycleIndexRef.current + 1) % 3;
    const taskId = 'preload-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    preloadTaskIdRef.current = taskId;
    logT(`📡 [预加载] 开始请求 (Phase=${nextPhase}, taskId=${taskId})`);
    try {
      const response = await window.electron.ipcRenderer.invoke(
        'ask-dj', config, '', nextPhase,
        lockedVibeRef.current, lastTrackRef.current, taskId
      );
      logT(`📡 [预加载] IPC 返回: success=${response.success}, track=${response.track_name || '无'} - ${response.artist || ''}`);
      if (response.success) {
        const blobUrl = await preloadAudioBlob(response.track_url);
        preloadedResponse.current = { ...response, track_url: blobUrl };
        logT(`📦 [预加载] blob URL 已生成: ${blobUrl.slice(0, 40)}...`);
        logT(`📦 [预加载] preloadedResponse 内容: track=${preloadedResponse.current.track_name}, audioData=${preloadedResponse.current.audioData ? '有(等待TTS填充)' : '无'}, dj_script=${preloadedResponse.current.dj_script ? '有(等待TTS填充)' : '无'}`);
        isPreloading.current = false;
      } else {
        logT(`❌ [预加载] 请求失败: ${response.error || '未知错误'}`);
        isPreloading.current = false;
      }
    } catch (err) {
      logT(`💥 [预加载] 异常: ${err.message}`);
      isPreloading.current = false;
    }
  };

  const playResponse = (response) => {
    const shouldChange = response.should_change_track !== false;

    setCurrentReasoning(response.reasoning || '');
    setCurrentGenreTag(response.genre_tags?.[0] || response.mood_tag || '');
    setActiveAppName(response.activeApp || '');

    if (shouldChange) {
      lastTrackRef.current = {
        name: response.track_name,
        artist: response.artist,
        genre_tags: response.genre_tags || []
      };
      if (songCycleIndexRef.current === 0 && response.genre_tags?.length) {
        lockedVibeRef.current = response.genre_tags;
      }
      setSongInfo({ title: response.track_name, artist: response.artist });
      bgmRef.current.src = response.track_url;
      bgmRef.current.play().catch(e => console.error("BGM播放失败", e));
      setIsPlaying(true);
    }

    setDjSubtitle(response.dj_script);
    ttsRef.current.src = `data:audio/wav;base64,${response.audioData}`;

    setTimeout(() => {
      const playTTS = async () => {
        try {
          setIsSpeaking(true);
          await ttsRef.current.play();
        } catch (e) {
          setIsSpeaking(false);
          setDjSubtitle("DJ 语音遇到小麻烦，不过音乐已经在播放了~");
          return;
        }
        
        ttsRef.current.onended = () => {
          setIsSpeaking(false);

          if (padLoopActiveRef.current) {
            console.log("⚡ [垫乐释放] DJ说完，开始向新歌平滑过渡");
            padLoopActiveRef.current = false;
            pendingSwitchRef.current = false;
            if (bgmRef.current) {
              bgmRef.current.loop = false;
            }
            if (preloadedResponse.current && bgmNextRef.current?.src && switchToNextTrackRef.current) {
              switchToNextTrackRef.current(preloadedResponse.current);
              const cached = preloadedResponse.current;
              if (cached.dj_script && cached.audioData) {
                setDjSubtitle(cached.dj_script);
                ttsRef.current.src = `data:audio/wav;base64,${cached.audioData}`;
                setTimeout(() => {
                  setIsSpeaking(true);
                  ttsRef.current.play().catch(() => setIsSpeaking(false));
                  ttsRef.current.onended = () => {
                    setIsSpeaking(false);
                    advanceCycleAfterTTSCleanup();
                  };
                }, 800);
              } else {
                advanceCycleAfterTTSCleanup();
              }
            } else {
              const cb = callAIBackendRef.current;
              if (cb) cb('');
            }
            return;
          }

          const afterDJ = shouldChange ? AFTER_DJ : [
            "耳机里放着歌，我在等你下一句话。",
            "想继续听歌还是想聊天？Depth 都在。"
          ];
          
          setDjSubtitle(afterDJ[Math.floor(Math.random() * afterDJ.length)]);
          setIsPlaying(true);
          
          if (shouldChange) {
            setSongCycleIndex(prev => (prev + 1) % 3);
            isPreloading.current = false;
            preloadedResponse.current = null;
          }
        };
        ttsRef.current.onerror = () => {
          setIsSpeaking(false);
          if (shouldChange) {
            setDjSubtitle("( DJ 麦克风没声音了，但音乐还在继续~ )");
            setIsPlaying(true);
            setSongCycleIndex(prev => (prev + 1) % 3);
            isPreloading.current = false;
            preloadedResponse.current = null;
          } else {
            setDjSubtitle("( 抱歉，我刚想说什么来着... )");
            setIsPlaying(true);
          }
        };
      };
      playTTS();
    }, 800);
  };

  const callAIBackend = async (mood = '') => {
    if (isSpeaking || isThinking) return;
    if (!mood && preloadedResponse.current) {
      const cached = preloadedResponse.current;
      setIsThinking(true);
      setDjSubtitle(`Depth 已为你准备好了下一首...`);
      playResponse(cached);
      return;
    }
    const phase = songCycleIndexRef.current;
    setIsThinking(true);

    const thinkingMessages = ["Depth 托着下巴想了想... 🤔", "让我品一品你的意思... 🎧"];
    const sensingMessages = ["Depth 正在观察你的世界... 👀", "让我感受一下你此刻的氛围... 🎶", "唱片机唱针正在寻道... 💽"];
    const phaseMessages = ["Depth 刚想说点什么，又停住了... 🎙️", "音乐在交汇，Depth 正在寻找灵感... 🌌", "指尖划过唱片，是时候换个节奏了... 💿"];
    
    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
    
    setDjSubtitle(mood ? pickRandom(thinkingMessages) : (phase === 0 ? pickRandom(sensingMessages) : pickRandom(phaseMessages)));
    
    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setCurrentTaskId(taskId);
    
    try {
      const response = await window.electron.ipcRenderer.invoke(
        'ask-dj', aiConfig, mood, phase,
        lockedVibeRef.current, lastTrackRef.current, taskId
      );
      setIsThinking(false);
      if (response.success) {
        if (response.phase === 'track') {
          bgmRef.current.volume = volumeRef.current;
          setSongInfo({ title: response.track_name, artist: response.artist });
          bgmRef.current.src = response.track_url;
          bgmRef.current.play().catch(e => console.error("BGM播放失败", e));
          setIsPlaying(true);
          setCurrentReasoning(response.reasoning || '');
          setCurrentGenreTag(response.genre_tags?.[0] || response.mood_tag || '');
          setActiveAppName(response.activeApp || '');
          lastTrackRef.current = { name: response.track_name, artist: response.artist, genre_tags: response.genre_tags || [] };
          if (phase === 0 && response.genre_tags?.length) lockedVibeRef.current = response.genre_tags;
          const playingMessages = [
            "🎶 音乐已响起，闭上眼睛沉浸就好...",
            "💿 旋律开始流淌，让音乐接管吧...",
            "🌌 氛围已送达，Depth 正在后台整理思绪..."
          ];
          setDjSubtitle(playingMessages[Math.floor(Math.random() * playingMessages.length)]);
        } else {
          playResponse(response);
        }
      } else {
        setDjSubtitle("Oops, Depth 的大脑似乎断线了：" + response.error);
        setIsSpeaking(false);
      }
    } catch (err) {
      setDjSubtitle("无法连接到主神经元，请重启软件试试。");
      setIsSpeaking(false);
    }
  };

  const handleRoll = () => {
    if (isSpeaking || isThinking) return;
    setSongCycleIndex(0);
    lockedVibeRef.current = null;
    lastTrackRef.current = null;
    preloadedResponse.current = null;
    isPreloading.current = false;

    padLoopActiveRef.current = false;
    pendingSwitchRef.current = false;
    crossfadeActiveRef.current = false;
    waitingForDelayedTTSRef.current = false;
    clearTimeout(delayedTTS_RescueTimer.current);

    if (bgmRef.current) {
      bgmRef.current.loop = false;
      bgmRef.current.volume = volumeRef.current;
    }
    if (bgmNextRef.current) bgmNextRef.current.removeAttribute('src');
    
    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setCurrentTaskId(taskId);
    setIsThinking(true);
    const rollMessages = [
      "Depth 换了个姿势，重新打量你的世界... 🔄", 
      "切歌。让 Depth 重新感受一下... 📻", 
      "打乱牌局，我们换张唱片听听... 🎲"
    ];
    setDjSubtitle(rollMessages[Math.floor(Math.random() * rollMessages.length)]);
    
    window.electron.ipcRenderer.invoke('ask-dj', aiConfig, '', 0, null, null, taskId)
      .then(response => {
        setIsThinking(false);
        if (response.success) {
          if (response.phase === 'track') {
            bgmRef.current.volume = volumeRef.current;
            setSongInfo({ title: response.track_name, artist: response.artist });
            bgmRef.current.src = response.track_url;
            bgmRef.current.play().catch(e => console.error("BGM播放失败", e));
            setIsPlaying(true);
            setIsSpeaking(false);
            setCurrentReasoning(response.reasoning || '');
            setCurrentGenreTag(response.genre_tags?.[0] || response.mood_tag || '');
            setActiveAppName(response.activeApp || '');
            lastTrackRef.current = { name: response.track_name, artist: response.artist, genre_tags: response.genre_tags || [] };
            lockedVibeRef.current = response.genre_tags || [];
            const playingMessages = [
              "🎶 音乐已响起，闭上眼睛沉浸就好...",
              "💿 旋律开始流淌，让音乐接管吧...",
              "🌌 氛围已送达，Depth 正在后台整理思绪..."
            ];
            setDjSubtitle(playingMessages[Math.floor(Math.random() * playingMessages.length)]);
          } else {
            playResponse(response);
          }
        } else {
          setDjSubtitle("Oops, Depth 的大脑似乎断线了：" + response.error);
        }
      })
      .catch(err => {
        setIsThinking(false);
        setIsSpeaking(false);
        setDjSubtitle("无法连接到主神经元，请重启软件试试。");
      });
  };

  const handleSendMood = () => {
    if (!userMood.trim()) return;
    const mood = userMood;
    setUserMood('');
    setSongCycleIndex(0);
    songCycleIndexRef.current = 0;
    lockedVibeRef.current = null;
    callAIBackend(mood);
  };

  // ================= 渲染函数 =================

  // 首页/配置页专属：纯粹的粒子星空，保持绝对的深邃和极简
  const renderSpaceBackground = () => (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0 bg-[#050505]">
      <div className="absolute top-1/2 left-1/2 w-0 h-0">
        {starParticlesRef.current.map((p, i) => (
          <div key={`warp-${i}`} className="absolute origin-center" style={{ transform: `rotate(${p.angle}deg)`, opacity: p.brightness }}>
            <div className="bg-white rounded-full animate-warp-2d" style={{ width: `${p.size}px`, height: `${p.size * 5}px`, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s`, boxShadow: `0 0 ${p.size * 2}px rgba(255,255,255,${p.brightness})` }}></div>
          </div>
        ))}
      </div>
    </div>
  );

  // 播放页专属：由 RetroFutureBackground 组件渲染 Three.js 合成器浪潮背景

  const renderPixelRobot = () => (
    <div className="flex flex-col items-center mb-6 animate-float relative z-10">
      <div className="w-2 h-4 bg-gray-500 rounded-t-sm"></div>
      <div className="w-16 h-12 bg-[#1a1a1a] rounded-xl border-[3px] border-[#333] flex items-center justify-center space-x-2.5 relative overflow-hidden shadow-[0_0_20px_rgba(34,197,94,0.3)]">
         <div className="w-3 h-3 bg-green-400 rounded-sm animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.9)]"></div>
         <div className="w-3 h-3 bg-green-400 rounded-sm animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.9)]" style={{ animationDelay: '0.3s' }}></div>
         <div className="absolute bottom-1.5 w-6 h-1 bg-gray-600 rounded-full"></div>
      </div>
    </div>
  );

  const renderSmoothVisualizer = () => {
    return (
      <div className="absolute bottom-[18%] left-0 w-full h-[100px] overflow-hidden z-10 pointer-events-none flex items-center justify-center">
        <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="w-full h-full">
          <defs>
            <filter id="vis-glow-v1" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur2" />
              <feMerge>
                <feMergeNode in="blur2" />
                <feMergeNode in="blur1" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="vis-glow-v2" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur2" />
              <feMerge>
                <feMergeNode in="blur2" />
                <feMergeNode in="blur1" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="vis-glow-v3" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur2" />
              <feMerge>
                <feMergeNode in="blur2" />
                <feMergeNode in="blur1" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {layers.map(string => (
            <g key={string.id} filter={`url(#vis-glow-${string.id})`}>
              {string.widths.map((w, i) => (
                <path 
                  key={i}
                  ref={string.refs[i]}
                  fill="none" 
                  stroke={string.color} 
                  strokeWidth={w} 
                  opacity={string.opacities[i]} 
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
    );
  };

  return (
    <div className="w-full h-screen font-sans selection:bg-[#1DB954]/30 selection:text-black bg-[#050505] overflow-hidden">

      {currentView === 'platform' && (
        <div className="flex flex-col items-center justify-center h-full w-full relative z-10 p-6">
          {/* 首页：只使用极简星空 */}
          {renderSpaceBackground()}
          <button onClick={() => setCurrentView('ai-config')} className="absolute top-6 right-6 text-gray-400 hover:text-white flex items-center bg-[#111]/80 backdrop-blur-md border border-white/10 p-2.5 rounded-full hover:bg-[#222] transition-all z-20 shadow-lg hover:shadow-indigo-500/20 hover:border-indigo-500/50" title="配置 AI 大脑"><Bot size={18} /></button>
          <div className="mb-12 text-center relative z-10 flex flex-col items-center">
            {renderPixelRobot()}
            <h1 className="text-5xl font-bold mb-2 tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-gray-100 to-gray-500" style={{ fontFamily: "'VT323', monospace" }}>VIBE AUDIO</h1>
            <p className="text-gray-400 text-sm tracking-widest uppercase text-[10px]">Your personal AI DJ Station</p>
          </div>
          <div className="flex flex-col w-full max-w-sm space-y-5 relative z-10">
            <TiltCard className={`flex items-center p-5 bg-[#111]/90 backdrop-blur-md rounded-2xl border transition-all duration-300 group shadow-lg ${neteaseUser ? 'border-[#D4AF37]/30 hover:border-[#D4AF37]/60 hover:shadow-[#D4AF37]/20' : 'border-white/5 hover:border-red-500/50 hover:shadow-red-900/20'}`}>
              <div onClick={() => neteaseUser ? handleSelectPlatform('netease') : handleOpenQr()} className={`flex items-center w-full cursor-pointer`}>
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mr-4 transition-all flex-shrink-0 ${neteaseUser ? 'bg-[#1a1a1a] border-2 border-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.4)]' : 'bg-[#1a1a1a] border border-[#333] group-hover:bg-red-500/20 group-hover:border-red-500/50'}`}>
                <Music className={`transition-colors ${neteaseUser ? 'text-[#D4AF37]' : 'text-gray-400 group-hover:text-red-400'}`} size={20} />
              </div>
              <div className="text-left flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-200 group-hover:text-white transition-colors">网易云音乐</h3>
                  {neteaseUser && (
                    <div className="relative h-7 w-20 overflow-hidden rounded-full group/logout cursor-pointer transition-colors duration-300">
                      <div className="absolute inset-0 bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 flex items-center justify-center text-[10px] font-bold transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/logout:-translate-y-full group-hover/logout:opacity-0 rounded-full">
                        <span className="w-1.5 h-1.5 bg-[#D4AF37] rounded-full mr-1 animate-pulse"></span>
                        VIP
                      </div>
                      <div 
                        role="button" 
                        onClick={(e) => { e.stopPropagation(); handleLogout(); }} 
                        className="absolute inset-0 bg-red-500/10 text-red-400 border border-red-500/30 flex items-center justify-center text-[10px] font-bold transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] translate-y-full opacity-0 group-hover/logout:translate-y-0 group-hover/logout:opacity-100 rounded-full hover:bg-red-500/20"
                      >
                        断开连接
                      </div>
                    </div>
                  )}
                </div>
                <p className={`text-xs mt-1 transition-colors ${neteaseUser ? 'text-[#D4AF37]/70' : 'text-gray-500 group-hover:text-red-300/70'}`}>
                  {neteaseUser ? '最高音质无损直链已就绪' : '点击进行神经元授权接入'}
                </p>
              </div>
              </div>
            </TiltCard>
            <TiltCard className="flex items-center p-5 bg-[#111]/90 backdrop-blur-md rounded-2xl border border-white/5 hover:border-[#1DB954]/50 hover:bg-gradient-to-r hover:from-[#1DB954]/20 hover:to-[#111]/90 transition-all duration-300 group shadow-lg hover:shadow-[#1DB954]/10">
              <div onClick={() => handleSelectPlatform('spotify')} className="flex items-center w-full cursor-pointer">
              <div className="w-12 h-12 rounded-full bg-[#1a1a1a] border border-[#333] flex items-center justify-center mr-4 group-hover:bg-[#1DB954]/20 group-hover:border-[#1DB954]/50 transition-all"><Radio className="text-gray-400 group-hover:text-[#1DB954] transition-colors" size={20} /></div>
              <div className="text-left flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-200 group-hover:text-white transition-colors">Spotify</h3>
                  {(spotifyConfig.clientId && spotifyConfig.clientSecret) && <span className="text-[10px] bg-[#1DB954]/10 text-[#1DB954] border border-[#1DB954]/30 px-2 py-0.5 rounded-full">已配置</span>}
                </div>
                <p className="text-xs text-gray-500 mt-1 group-hover:text-[#1DB954]/70 transition-colors">需填写API，保持客户端开启</p>
              </div>
              </div>
            </TiltCard>
          </div>
        </div>
      )}

      {currentView === 'ai-config' && (
        <div className="flex flex-col items-center h-full w-full relative z-10 p-6 overflow-y-auto pt-16">
          {/* 配置页：只使用极简星空 */}
          {renderSpaceBackground()}
          <button onClick={() => setCurrentView('platform')} className="absolute top-6 left-6 text-gray-400 hover:text-white flex items-center transition-colors z-20 bg-[#111]/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10"><ChevronLeft size={16} /> <span className="ml-1 text-xs">主页</span></button>
          <div className="w-full max-w-sm flex flex-col items-center relative z-10 mt-4 bg-[#111]/60 backdrop-blur-xl p-6 rounded-3xl border border-white/5 shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-6 shadow-[0_10px_20px_rgba(99,102,241,0.3)] border border-white/10"><Bot className="text-white" size={28} /></div>
            <h2 className="text-2xl font-bold mb-2 tracking-wide text-white">激活 AI 大脑</h2>
            <p className="text-gray-400 text-xs text-center mb-8 leading-relaxed">配置 Depth 的思考与发声引擎。凭证将安全地存储在本地。</p>
            <div className="w-full space-y-5">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-indigo-300 mb-2 font-bold ml-1 flex items-center"><MessageSquare size={12} className="mr-1"/> DeepSeek API</label>
                <input type="password" value={aiConfig.deepseekKey} onChange={(e) => setAiConfig({...aiConfig, deepseekKey: e.target.value})} placeholder="sk-..." className="w-full bg-[#0a0a0a] text-white border border-[#222] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-indigo-500 focus:bg-[#151515] transition-all placeholder-gray-700" />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-purple-300 mb-2 font-bold ml-1 flex items-center"><Radio size={12} className="mr-1"/> Mimo TTS API</label>
                <input type="password" value={aiConfig.mimoKey} onChange={(e) => setAiConfig({...aiConfig, mimoKey: e.target.value})} placeholder="小米开放平台密钥..." className="w-full bg-[#0a0a0a] text-white border border-[#222] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-purple-500 focus:bg-[#151515] transition-all placeholder-gray-700" />
              </div>
              <button onClick={handleSaveAiConfig} className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3.5 rounded-xl mt-4 transition-all shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-0.5">保存配置</button>
            </div>
          </div>
        </div>
      )}

      {currentView === 'config' && (
        <div className="flex flex-col items-center h-full w-full relative z-10 p-6 overflow-y-auto pt-20">
          {/* 配置页：只使用极简星空 */}
          {renderSpaceBackground()}
          <button onClick={() => setCurrentView('platform')} className="absolute top-6 left-6 text-gray-400 hover:text-white flex items-center transition-colors z-20 bg-[#111]/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10"><ChevronLeft size={16} /> <span className="ml-1 text-xs">更换平台</span></button>
          <div className="w-full max-w-sm flex flex-col items-center relative z-10 bg-[#111]/60 backdrop-blur-xl p-6 rounded-3xl border border-white/5 shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#1DB954] to-[#128a3c] flex items-center justify-center mb-6 shadow-[0_10px_20px_rgba(29,185,84,0.3)] border border-white/10"><Settings className="text-white" size={28} /></div>
            <h2 className="text-2xl font-bold mb-2 tracking-wide text-white">配置 Spotify API</h2>
            <div className="w-full space-y-5 mt-4">
              <input type="text" value={spotifyConfig.clientId} onChange={(e) => setSpotifyConfig({...spotifyConfig, clientId: e.target.value})} placeholder="Client ID" className="w-full bg-[#0a0a0a] text-white border border-[#222] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#1DB954] transition-all" />
              <input type="password" value={spotifyConfig.clientSecret} onChange={(e) => setSpotifyConfig({...spotifyConfig, clientSecret: e.target.value})} placeholder="Client Secret" className="w-full bg-[#0a0a0a] text-white border border-[#222] rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-[#1DB954] transition-all" />
              <button onClick={handleSaveSpotifyConfig} className="w-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold py-3.5 rounded-xl transition-all shadow-[0_0_15px_rgba(29,185,84,0.2)]">保存并开始</button>
            </div>
          </div>
        </div>
      )}

      {currentView === 'player' && (
        <div className="flex flex-col items-center justify-center h-full w-full relative z-10 p-4 sm:p-8 overflow-hidden">
          
          {/* 播放页：Three.js 蒸汽波背景 */}
          <RetroFutureBackground />

          <div className="w-full max-w-md flex justify-between items-center mb-6 px-2 relative z-20">
             <button onClick={() => { setCurrentView('platform'); bgmRef.current?.pause(); setIsPlaying(false); }} className="text-gray-300 hover:text-white flex items-center text-xs font-medium transition-colors backdrop-blur-md bg-[#111]/60 px-4 py-2 rounded-full border border-white/10 shadow-sm hover:bg-[#222]/80">
                <ChevronLeft size={16} className="mr-1"/> 更换音源
             </button>
             <div className="flex items-center space-x-2">
               <span className="text-[10px] text-white uppercase tracking-widest font-bold backdrop-blur-xl bg-white/5 px-4 py-2 rounded-full border border-white/10 shadow-sm flex items-center">
                 {platform === 'netease' ? 'Netease Cloud' : 'Spotify API'}
                 {platform === 'netease' && neteaseUser && (
                   <span className="ml-2 text-[#1DB954] drop-shadow-[0_0_5px_rgba(29,185,84,0.6)] flex items-center">
                     <span className="w-1 h-1 bg-[#1DB954] rounded-full mr-1 animate-pulse"></span>
                     VIP
                   </span>
                 )}
               </span>
               {platform === 'spotify' && (
                 <button onClick={() => setCurrentView('config')} className="text-gray-300 hover:text-white p-2 rounded-full backdrop-blur-xl bg-white/5 border border-white/10 hover:bg-white/20 transition-all shadow-sm"><Settings size={14} /></button>
               )}
             </div>
          </div>

          <div className="w-full max-w-md h-full max-h-[900px] min-h-0 relative z-20 flex flex-col">

            {/* 实体控制台卡片（TiltCard 包裹，提供流光边缘 + 低频共振阴影） */}
            <TiltCard showFluidEdge isSpeaking={isSpeaking} maxTilt={2} perspective={1500} ref={mainCardRef} className="w-full h-full flex flex-col z-10 rounded-[40px]">
              <div className="flex-[2] min-h-[140px] w-full p-6 relative flex flex-col z-10 overflow-hidden rounded-t-[40px]">
                
                <div
                  className="absolute inset-0 z-[2] pointer-events-none"
                  style={{
                    maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.7) 40%, transparent 80%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.7) 40%, transparent 80%)',
                  }}
                >
                  {meteorsRef.current.map((m) => (
                    <div 
                      key={m.id}
                      className="meteor"
                      style={{
                        left: m.x,
                        top: m.y,
                        '--angle': `${m.angle}deg`,
                        '--length': `${m.length}px`,
                        '--thickness': `${m.thickness}px`,
                        '--opacity': m.opacity,
                        '--duration': `${m.duration}s`,
                        '--delay': `${m.delay}s`,
                        '--distance': `${m.distance}px`,
                        width: 'var(--length)',
                        height: 'var(--thickness)'
                      }}
                    />
                  ))}
                </div>

                <div className="flex justify-between items-start relative z-20">
                <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-full bg-[#1a1a1a] flex items-center justify-center border transition-all duration-300 ${isSpeaking ? 'animate-dj-glow border-[#1DB954]' : (isThinking ? 'border-orange-400 shadow-[0_0_15px_rgba(246,173,85,0.4)]' : 'border-[#333] shadow-inner')}`}>
                      <Bot size={20} className={`${isSpeaking ? 'text-[#1DB954] animate-dj-bounce' : (isThinking ? 'text-orange-400 animate-pulse' : 'text-gray-400')} transition-colors duration-300`} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-gray-200 text-lg tracking-[0.2em]" style={{ fontFamily: "'VT323', monospace" }}>Depth</span>
                      <div className="flex items-center space-x-1.5 mt-0.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? 'bg-[#1DB954] animate-pulse' : (isThinking ? 'bg-orange-400 animate-pulse' : 'bg-[#444]')}`}></div>
                        <span className={`text-[9px] uppercase tracking-wider font-bold ${isSpeaking ? 'text-[#1DB954]' : (isThinking ? 'text-orange-400' : 'text-gray-500')}`}>{isSpeaking ? 'Speaking...' : (isThinking ? 'Thinking...' : 'Standby')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-lg text-gray-400 tracking-[0.2em]" style={{ fontFamily: "'VT323', monospace" }}>{currentTime}</span>
                    <div className="w-32 h-[4px] bg-gray-800/50 rounded-full overflow-hidden mt-1.5 relative">
                      <div className="h-full rounded-full transition-all duration-300 relative" 
                           style={{ width: `${Math.min(100, songProgress)}%`, background: 'linear-gradient(90deg, rgba(29,185,84,0.1) 0%, rgba(29,185,84,1) 100%)', boxShadow: '0 0 10px rgba(29,185,84,0.5)' }}>
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[6px] h-[6px] bg-white rounded-full shadow-[0_0_8px_#fff]"></div>
                      </div>
                    </div>
                  </div>
                </div>
                {renderSmoothVisualizer()}
              </div>

              <div className="flex-[3] min-h-[200px] w-full bg-[#fdfdfd] rounded-t-[40px] rounded-b-[40px] p-5 flex flex-col shadow-[0_-15px_40px_rgba(0,0,0,0.3)] z-20 overflow-hidden">
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="mb-2 flex-shrink-0">
                    <h2 className="text-[22px] sm:text-[26px] font-black text-[#111] leading-tight tracking-tight mb-0.5 break-words"><ScrambleText text={songInfo.title} /></h2>
                    <p className="text-gray-500 text-sm font-medium tracking-wide truncate">{songInfo.artist}</p>
                  </div>
                  <div className="flex-1 min-h-0 bg-[#f4f4f5] rounded-2xl p-4 relative overflow-hidden flex flex-col shadow-inner border border-gray-200/50">
                     <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '8px 8px' }}></div>
                     <div className="relative z-10 flex-1 flex flex-col min-h-0">
                       <div className="flex-shrink-0 mb-2">
                         <div className="flex items-center justify-between">
                           <span className="text-orange-400" style={{ fontFamily: "'VT323', monospace", fontSize: '11px' }}>
                             {'Depth的想法'} <span className="text-[11px]">{'🧠'}</span>
                           </span>
                           <div className="flex items-center space-x-1.5 flex-shrink-0 ml-2">
                             {activeAppName && (
                               <span className="text-[9px] text-gray-400 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full flex items-center max-w-[120px]" title={activeAppName}>
                                 <span className="mr-1 text-[8px] flex-shrink-0">●</span>
                                 <span className="truncate block">{activeAppName}</span>
                               </span>
                             )}
                             {currentGenreTag && (
                               <span className="text-[9px] font-bold uppercase tracking-widest text-[#1DB954] bg-[#1DB954]/10 border border-[#1DB954]/20 px-2.5 py-0.5 rounded-full flex items-center">
                                 <span className="mr-1">⚡</span>{currentGenreTag}
                               </span>
                             )}
                           </div>
                         </div>
                         <div className="mt-0.5">
                           <span className="text-[10px] text-orange-400/80 leading-relaxed break-words" style={{ fontFamily: "'VT323', monospace" }}>
                             <TypewriterText text={currentReasoning || '...scanning'} />
                           </span>
                         </div>
                       </div>
                       <div className="border-t border-gray-200/50 mb-2 flex-shrink-0"></div>
                       <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-0">
                         <p className={`text-[14px] sm:text-[15px] font-medium leading-[1.7] ${isSpeaking ? 'text-[#222]' : 'text-gray-400 italic'}`}>{djSubtitle}</p>
                       </div>
                     </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 space-x-3 flex-shrink-0">
                  {/* 播放核心环：音量能量环 —— 隐藏/悬浮显现，SVG strokeDashoffset 驱动 */}
                  <div
                    ref={volRingRef}
                    className="relative w-14 h-14 flex items-center justify-center group/vol"
                    onMouseEnter={() => setShowVolRing(true)}
                    onMouseLeave={() => setShowVolRing(false)}
                  >
                    {/* 底层半透明参考圆环 */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-500" style={{ opacity: showVolRing ? 0.15 : 0 }}>
                      <circle cx="28" cy="28" r="24" fill="none" stroke="white" strokeWidth="2" />
                    </svg>
                    {/* 紫色渐变进度环 */}
                    <svg
                      className="absolute inset-0 w-full h-full cursor-pointer z-10 transition-opacity duration-500"
                      style={{ opacity: showVolRing ? 1 : 0 }}
                      onMouseDown={handleRingMouseDown}
                    >
                      <defs>
                        <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#a855f7" />
                          <stop offset="100%" stopColor="#ec4899" />
                        </linearGradient>
                      </defs>
                      <circle
                        cx="28" cy="28" r="24" fill="none"
                        stroke="url(#ring-grad)" strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 24}
                        strokeDashoffset={2 * Math.PI * 24 * (1 - volume)}
                        transform="rotate(-90 28 28)"
                        style={{ transition: 'stroke-dashoffset 0.1s linear' }}
                      />
                    </svg>
                    {/* 播放按钮本身 */}
                    <button onClick={togglePlay} className="w-10 h-10 bg-[#111] rounded-full flex items-center justify-center text-white relative z-20 shadow-xl group-hover/vol:scale-95 transition-transform">
                      {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                    </button>
                  </div>
                  <div className="flex-1 relative group">
                    <input type="text" value={userMood} onChange={(e) => setUserMood(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMood()} placeholder="告诉 Depth 你想听什么..." disabled={isSpeaking || isThinking} className="w-full bg-white border border-gray-300 rounded-full py-3.5 pl-5 pr-12 text-[13px] text-black outline-none focus:border-[#1DB954] focus:ring-2 focus:ring-[#1DB954]/20 shadow-sm transition-all disabled:bg-gray-100 disabled:text-gray-400 placeholder-gray-400" />
                    <button onClick={handleSendMood} disabled={!userMood.trim() || isSpeaking || isThinking} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#111] text-white rounded-full flex items-center justify-center hover:bg-[#1DB954] hover:shadow-md transition-all disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none"><Send size={13} className="mr-0.5 mt-0.5" /></button>
                  </div>
                  <button onClick={handleRoll} disabled={isSpeaking || isThinking} className={`w-12 h-12 flex-shrink-0 rounded-full flex items-center justify-center transition-all shadow-sm ${(isSpeaking || isThinking) ? 'bg-gray-100 text-[#1DB954] cursor-not-allowed' : 'bg-white border border-gray-200 text-gray-600 hover:text-black hover:border-gray-300 hover:shadow-md active:scale-95'}`} title="Roll 换一首">
                    <RefreshCw size={18} className={(isSpeaking || isThinking) ? 'animate-spin' : ''} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </TiltCard>
          </div>
        </div>
      )}

      {/* ★ 扫码模态弹窗：毛玻璃 + 深度赛博感 */}
      {showQrModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xl animate-in fade-in duration-500">
          <div className="bg-[#0a0a0a]/80 border border-white/10 p-8 rounded-[32px] flex flex-col items-center w-80 shadow-[0_0_50px_rgba(29,185,84,0.1)] relative overflow-hidden">
            {/* 顶部装饰光晕条 */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-[#1DB954] shadow-[0_0_20px_#1DB954]"></div>
            
            <Bot size={32} className="text-[#1DB954] mb-4 animate-dj-bounce" />
            <h3 className="text-white text-sm font-bold tracking-widest uppercase mb-1">Depth Access</h3>
            <p className="text-gray-400 text-xs text-center mb-6 leading-relaxed">正在请求接入你的音乐神经元网络<br/>请完成扫码授权</p>
            
            <div className="w-48 h-48 bg-white/5 border border-white/10 rounded-2xl p-3 relative flex items-center justify-center overflow-hidden mb-6 group">
              {/* 呼吸边框 */}
              <div className="absolute inset-0 border-2 border-[#1DB954]/50 rounded-2xl animate-pulse pointer-events-none z-10"></div>
              {/* 扫描线 */}
              <div className="absolute top-0 left-0 w-full h-1 bg-[#1DB954] shadow-[0_0_10px_#1DB954] animate-[scan-line_2s_linear_infinite] z-20"></div>
              
              {qrImg ? (
                <img src={qrImg} alt="二维码" className="w-full h-full object-contain" />
              ) : !qrStatusText.includes('失败') ? (
                <div className="w-8 h-8 border-4 border-[#1DB954]/30 border-t-[#1DB954] rounded-full animate-spin"></div>
              ) : (
                <div className="text-gray-400 text-xs text-center">{qrStatusText}</div>
              )}
            </div>
            
            <p className="text-[#1DB954] text-xs font-medium tracking-wide animate-pulse" style={{ fontFamily: "'VT323', monospace", fontSize: '14px' }}>
              {qrStatusText}
            </p>

            <button onClick={() => { setShowQrModal(false); if (pollQrStatusRef.current) clearInterval(pollQrStatusRef.current); handleSelectPlatform('netease'); }} className="mt-4 text-[11px] text-gray-500 hover:text-gray-300 transition-colors tracking-wider underline underline-offset-4 decoration-gray-700 hover:decoration-gray-400">
              跳过登录，以游客身份进入
            </button>

            <button onClick={() => { setShowQrModal(false); if (pollQrStatusRef.current) clearInterval(pollQrStatusRef.current); }} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
