import { useEffect, useRef, useState } from "react";
import "./App.css";

type Player = { id: string; name: string; ippons: number };
type TimelineItem = { judge: string; score: number; delay_ms: number };

type FeedItem = {
  key: number;
  text: string;
  kind: "info" | "miss" | "reject" | "ippon";
};

let ac: AudioContext | null = null;
function audio(): AudioContext {
  if (!ac) ac = new AudioContext();
  return ac;
}
function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = "sine",
  vol = 0.25,
) {
  const a = audio();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur);
}
let ipponAudioBuffer: AudioBuffer | null = null;
async function loadIpponVoice() {
  if (ipponAudioBuffer) return ipponAudioBuffer;
  try {
    const a = audio();
    const res = await fetch("/aippon_voice.wav");
    const arrayBuffer = await res.arrayBuffer();
    ipponAudioBuffer = await a.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn("Failed to load ippon voice:", err);
  }
  return ipponAudioBuffer;
}
// 初回ロードをバックグラウンドで走らせておく
if (typeof window !== "undefined") {
  window.addEventListener(
    "click",
    () => {
      audio();
      loadIpponVoice();
    },
    { once: true },
  );
}

let ipponAudioEl: HTMLAudioElement | null = null;
let ipponMediaSourceNode: MediaElementAudioSourceNode | null = null;

function getIpponAudioPipeline() {
  const a = audio();
  if (!ipponAudioEl) {
    ipponAudioEl = new Audio("/aippon_voice.wav");
    // ピッチを上げずに速度だけ上げる設定（標準ブラウザ対応）
    (ipponAudioEl as any).preservesPitch = true;
    (ipponAudioEl as any).mozPreservesPitch = true;
    (ipponAudioEl as any).webkitPreservesPitch = true;
    ipponAudioEl.playbackRate = 2;
    ipponAudioEl.preload = "auto";

    ipponMediaSourceNode = a.createMediaElementSource(ipponAudioEl);

    // 1. 低音・男性らしいドス・重厚感を補強するEQ（150Hz〜250Hzをブースト、高域を抑えて声を太く低く）
    const bassBoost = a.createBiquadFilter();
    bassBoost.type = "lowshelf";
    bassBoost.frequency.setValueAtTime(260, a.currentTime);
    bassBoost.gain.setValueAtTime(6.0, a.currentTime); // 重低音ブースト

    const highCut = a.createBiquadFilter();
    highCut.type = "peaking";
    highCut.frequency.setValueAtTime(3200, a.currentTime);
    highCut.gain.setValueAtTime(-3.5, a.currentTime); // キンキンした高音をカットし太さを強調

    // 2. 音圧コンプレッサー
    const comp = a.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-16, a.currentTime);
    comp.knee.setValueAtTime(20, a.currentTime);
    comp.ratio.setValueAtTime(6, a.currentTime);

    // 3. メインゲイン
    const mainGain = a.createGain();
    mainGain.gain.setValueAtTime(0.85, a.currentTime);

    // 4. アリーナ風ディレイ（空間エコー）
    const delay = a.createDelay();
    delay.delayTime.setValueAtTime(0.16, a.currentTime);

    const delayFeedback = a.createGain();
    delayFeedback.gain.setValueAtTime(0.3, a.currentTime);

    const delayFilter = a.createBiquadFilter();
    delayFilter.type = "lowpass";
    delayFilter.frequency.setValueAtTime(1800, a.currentTime);

    const delayGain = a.createGain();
    delayGain.gain.setValueAtTime(0.28, a.currentTime);

    // 接続
    ipponMediaSourceNode.connect(bassBoost);
    bassBoost.connect(highCut);
    highCut.connect(comp);
    comp.connect(mainGain);

    mainGain.connect(a.destination);

    mainGain.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delay);
    delayFilter.connect(delayGain);
    delayGain.connect(a.destination);
  }
  return ipponAudioEl;
}

// ユーザー操作時に事前ロード
if (typeof window !== "undefined") {
  window.addEventListener(
    "click",
    () => {
      audio();
      try {
        getIpponAudioPipeline().load();
      } catch {}
    },
    { once: true },
  );
}

function playIpponVoice() {
  try {
    const el = getIpponAudioPipeline();
    el.currentTime = 0;
    el.playbackRate = 2.0;
    el.play().catch((e) => console.warn("playIpponVoice error:", e));
  } catch (e) {
    console.warn("playIpponVoice failure:", e);
  }
}

export const sfx = {
  pingpong() {
    const a = audio();
    const now = a.currentTime;

    // 定番の早押し・回答権「ピンポーン」チャイム
    // 音程: 1音目「ピン」= E6 (1318.51Hz), 2音目「ポーン」= C6 (1046.50Hz) (長3度下降)
    const notes = [
      { freq: 1318.51, start: 0, dur: 0.55, vol: 0.32 },
      { freq: 1046.5, start: 0.15, dur: 1.35, vol: 0.38 },
    ];

    notes.forEach(({ freq, start, dur, vol }) => {
      const noteStart = now + start;

      // 1. 基音（まろやかで芯のあるサイン波）
      const osc1 = a.createOscillator();
      const gain1 = a.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(freq, noteStart);
      gain1.gain.setValueAtTime(0.001, noteStart);
      gain1.gain.linearRampToValueAtTime(vol, noteStart + 0.003); // 俊敏なアタック
      gain1.gain.exponentialRampToValueAtTime(0.0003, noteStart + dur);
      osc1.connect(gain1).connect(a.destination);
      osc1.start(noteStart);
      osc1.stop(noteStart + dur);

      // 2. オクターブ倍音（明るさと抜けの良さ）
      const osc2 = a.createOscillator();
      const gain2 = a.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(freq * 2, noteStart);
      gain2.gain.setValueAtTime(0.001, noteStart);
      gain2.gain.linearRampToValueAtTime(vol * 0.22, noteStart + 0.002);
      gain2.gain.exponentialRampToValueAtTime(0.0003, noteStart + dur * 0.45);
      osc2.connect(gain2).connect(a.destination);
      osc2.start(noteStart);
      osc2.stop(noteStart + dur * 0.45);

      // 3. チャイムバーの金属アタック共鳴音 (約2.76倍音)
      const osc3 = a.createOscillator();
      const gain3 = a.createGain();
      osc3.type = "sine";
      osc3.frequency.setValueAtTime(freq * 2.76, noteStart);
      gain3.gain.setValueAtTime(0.001, noteStart);
      gain3.gain.linearRampToValueAtTime(vol * 0.14, noteStart + 0.002);
      gain3.gain.exponentialRampToValueAtTime(0.0003, noteStart + 0.12);
      osc3.connect(gain3).connect(a.destination);
      osc3.start(noteStart);
      osc3.stop(noteStart + 0.12);
    });
  },
  tick() {
    tone(880, 0, 0.05, "square", 0.08);
  },
  frameStep(score: number) {
    // 採点フレームが増えるごとに半音ずつ高くなる電子音
    const freq = 523.25 * Math.pow(2, (score - 1) / 12);
    tone(freq, 0, 0.07, "square", 0.1);
  },
  bon() {
    tone(440, 0, 0.25, "triangle", 0.2);
  },
  fanfare() {
    const a = audio();
    const now = a.currentTime;

    // 10個目の点灯音と同時にIPPONボイスとファンファーレ効果音を再生
    playIpponVoice();

    const fanfareStart = now;

    // 1. 神聖で深みのある低音パッド（柔らかなアタックで包み込む）
    const bass = a.createOscillator();
    const bassGain = a.createGain();
    bass.type = "sine";
    bass.frequency.setValueAtTime(130.81, fanfareStart); // C3
    bassGain.gain.setValueAtTime(0.001, fanfareStart);
    bassGain.gain.linearRampToValueAtTime(0.2, fanfareStart + 0.08);
    bassGain.gain.exponentialRampToValueAtTime(0.0005, fanfareStart + 2.5);
    bass.connect(bassGain).connect(a.destination);
    bass.start(fanfareStart);
    bass.stop(fanfareStart + 2.5);

    // 2. 「じゃら〜ん」と駆け上がる神聖なハープ / ウィンドチャイム風アルペジオ (Cメジャー9th / リディアン系)
    // C4, E4, G4, B4, D5, E5, G5, C6
    const arpeggioNotes = [
      261.63, 329.63, 392.0, 493.88, 587.33, 659.25, 783.99, 1046.5,
    ];
    arpeggioNotes.forEach((freq, idx) => {
      const noteStart = fanfareStart + idx * 0.038; // 38msずつ流れるように「じゃら〜ん」
      const dur = 2.4 - idx * 0.12;

      // 澄んだサイン波（基音）+ 微かな倍音（三角波）でハープ/鐘の質感
      [
        { type: "sine" as OscillatorType, vol: 0.13, detune: 0 },
        { type: "triangle" as OscillatorType, vol: 0.05, detune: 3 },
      ].forEach(({ type, vol, detune }) => {
        const osc = a.createOscillator();
        const gain = a.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, noteStart);
        osc.detune.setValueAtTime(detune, noteStart);

        // 柔らかなアタック（ピッキング）から美しい自然減衰
        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.linearRampToValueAtTime(vol, noteStart + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0003, noteStart + dur);

        osc.connect(gain).connect(a.destination);
        osc.start(noteStart);
        osc.stop(noteStart + dur);
      });
    });

    // 3. 神秘的なきらめき・星屑のような高音チャイム（微小なベル音）
    const sparkles = [1318.51, 1567.98, 2093.0];
    sparkles.forEach((freq, i) => {
      const sparkleStart = fanfareStart + 0.22 + i * 0.06;
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, sparkleStart);
      gain.gain.setValueAtTime(0.001, sparkleStart);
      gain.gain.linearRampToValueAtTime(0.04, sparkleStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0003, sparkleStart + 1.6);
      osc.connect(gain).connect(a.destination);
      osc.start(sparkleStart);
      osc.stop(sparkleStart + 1.6);
    });

    // 4. 天使の光のような柔らかく広がるシマーノイズ（耳に刺さる打撃音を排除）
    const bufferSize = Math.floor(a.sampleRate * 2.2);
    const buffer = a.createBuffer(1, bufferSize, a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = a.createBufferSource();
    noise.buffer = buffer;

    const filter = a.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(3200, fanfareStart);
    filter.Q.value = 2.0;

    const noiseGain = a.createGain();
    noiseGain.gain.setValueAtTime(0.001, fanfareStart);
    noiseGain.gain.linearRampToValueAtTime(0.06, fanfareStart + 0.2); // ふわっと立ち上がる
    noiseGain.gain.exponentialRampToValueAtTime(0.0003, fanfareStart + 2.2);

    noise.connect(filter).connect(noiseGain).connect(a.destination);
    noise.start(fanfareStart);
  },
  miss() {
    this.shakin();
  },
  shakin() {
    const a = audio();
    const now = a.currentTime;

    // 1. ノイズによる鋭い摩擦・切裂き音 ("シャッ")
    const bufferSize = Math.floor(a.sampleRate * 0.35);
    const buffer = a.createBuffer(1, bufferSize, a.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = a.createBufferSource();
    noise.buffer = buffer;

    const filter = a.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(4500, now);
    filter.frequency.exponentialRampToValueAtTime(1500, now + 0.3);
    filter.Q.value = 3.5;

    const noiseGain = a.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    noise.connect(filter).connect(noiseGain).connect(a.destination);
    noise.start(now);

    // 2. 金属の鋭い余韻 ("キーン")
    const freqs = [1860, 2600, 3720, 4850];
    freqs.forEach((freq, idx) => {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(
        freq * (1 + (idx % 2 === 0 ? 0.015 : -0.015)),
        now,
      );
      osc.frequency.exponentialRampToValueAtTime(freq * 0.97, now + 0.55);

      const vol = 0.22 / (idx + 1);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55 + idx * 0.04);

      osc.connect(gain).connect(a.destination);
      osc.start(now);
      osc.stop(now + 0.65);
    });
  },
  unlock() {
    const a = audio();
    const now = a.currentTime;
    // 解禁音: 明るい2音のピコーン（E5 -> B5）
    [659.25, 987.77].forEach((freq, idx) => {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);
      gain.gain.setValueAtTime(0.001, now + idx * 0.1);
      gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.1 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);
      osc.connect(gain).connect(a.destination);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.35);
    });
  },
};

// ============================================================================
// Stages & Frames (RESULT_ANNOUNCEMENT_SPEC v2.0)
// ============================================================================

type StageMode = "theme" | "answerWaiting" | "answerShown";

type JudgingState = {
  player: string;
  answer: string;
  litFrames: number;
  totalScore: number;
  isIppon: boolean;
  timeline: TimelineItem[];
  failed: string[];
  done: boolean;
};

type DefaultArenaFrameProps = {
  variant: "theme" | "judgment";
};

export function DefaultArenaFrame({ variant }: DefaultArenaFrameProps) {
  return (
    <div
      className={`defaultArenaFrame defaultArenaFrame--${variant}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 1000 620" preserveAspectRatio="none">
        <polygon
          points="110,8 890,8 992,110 992,510 890,612 110,612 8,510 8,110"
          className="defaultArenaFrame__outer"
        />
        <polygon
          points="132,28 868,28 972,132 972,488 868,592 132,592 28,488 28,132"
          className="defaultArenaFrame__inner"
        />
      </svg>
      <div className="defaultArenaFrame__brand">AI-PPON GRAND PRIX</div>
    </div>
  );
}

type JudgmentFrameMeterProps = {
  litFrames: number;
  totalFrames?: number;
  isIppon?: boolean;
};

export function JudgmentFrameMeter({
  litFrames,
  totalFrames = 10,
  isIppon = false,
}: JudgmentFrameMeterProps) {
  const frames = Array.from({ length: totalFrames }, (_, i) => {
    const isLit = i < litFrames;
    // デフォルトフレーム inner(余白28px) の内側に外側から内側へ配置
    const inset = 46 + i * 14;
    const corner = Math.max(16, 80 - i * 5);
    const points = `${inset + corner},${inset} ${1000 - inset - corner},${inset} ${1000 - inset},${inset + corner} ${1000 - inset},${620 - inset - corner} ${1000 - inset - corner},${620 - inset} ${inset + corner},${620 - inset} ${inset},${620 - inset - corner} ${inset},${inset + corner}`;
    return { index: i, isLit, points };
  });

  return (
    <div
      className={`frameMeter ${isIppon ? "frameMeter--ippon" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 1000 620" preserveAspectRatio="none">
        {frames.map((f) => (
          <polygon
            key={f.index}
            points={f.points}
            className={`frameMeter__frame ${
              f.isLit
                ? `frameMeter__frame--on ${f.index >= 7 ? "frameMeter__frame--high" : ""}`
                : "frameMeter__frame--off"
            }`}
          />
        ))}
      </svg>
    </div>
  );
}

function getThemeSizeClass(text: string): string {
  const len = text.trim().length;
  if (len <= 20) return "themeStage__title--short";
  if (len <= 40) return "themeStage__title--medium";
  if (len <= 70) return "themeStage__title--long";
  if (len <= 110) return "themeStage__title--xlarge";
  return "themeStage__title--xxlarge";
}

function getAnswerSizeClass(text: string): string {
  const len = text.trim().length;
  if (len <= 14) return "answerFlip__text--short";
  if (len <= 28) return "answerFlip__text--medium";
  if (len <= 50) return "answerFlip__text--long";
  if (len <= 80) return "answerFlip__text--xlarge";
  return "answerFlip__text--xxlarge";
}

function generateRoomId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let res = "";
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

export default function App() {
  const [screen, setScreen] = useState<"join" | "game">("join");
  const [roomPhase, setRoomPhase] = useState<
    "waiting" | "theme" | "transition" | "match_win"
  >("waiting");
  const [myPlayerId, setMyPlayerId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return (
      localStorage.getItem("aippon_player_id") ||
      localStorage.getItem("oogiri_player_id")
    );
  });
  const [name, setName] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return (
      localStorage.getItem("aippon_player_name") ||
      localStorage.getItem("oogiri_player_name") ||
      ""
    );
  });
  const [roomId, setRoomId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room")?.trim();
    if (roomFromUrl) return roomFromUrl;
    const newId = generateRoomId();
    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(newId)}`;
    window.history.replaceState({}, "", newUrl);
    return newId;
  });
  const [toast, setToast] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [theme, setTheme] = useState("");
  const [, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [input, setInput] = useState("");
  const [stageMode, setStageMode] = useState<StageMode>("theme");
  const [judging, setJudging] = useState<JudgingState | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [questionNumber, setQuestionNumber] = useState(1);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const isTimerPausedRef = useRef(false);
  const deadlineRef = useRef<number | null>(null);
  const feedKey = useRef(0);
  const judgingRef = useRef<JudgingState | null>(null);
  const pendingPlayersRef = useRef<Player[] | null>(null);
  const pendingThemeStartedRef = useRef<any | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // 隠しTTSナレーション要素: ロゴ5回連続タップでアンロック
  const [ttsUnlocked, setTtsUnlocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("ai_ppon_tts_unlocked") === "true";
  });
  const [roomTtsEnabled, setRoomTtsEnabled] = useState<boolean>(false);
  const logoClickTimesRef = useRef<number[]>([]);

  const handleLogoClick = () => {
    const now = Date.now();
    // 直近2秒以内のクリックのみ保持
    const recent = [
      ...logoClickTimesRef.current.filter((t) => now - t < 2000),
      now,
    ];
    logoClickTimesRef.current = recent;

    if (recent.length >= 5) {
      logoClickTimesRef.current = [];
      const newState = !ttsUnlocked;
      setTtsUnlocked(newState);
      if (typeof window !== "undefined") {
        localStorage.setItem("ai_ppon_tts_unlocked", String(newState));
      }
      if (newState) {
        sfx.unlock();
        showToast("🎙️ NARRATION MODE UNLOCKED! (ナレーション解禁)");
      } else {
        showToast("🎙️ ナレーションモードを解除しました");
      }
    }
  };

  const handleDisableNarration = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTtsUnlocked(false);
    if (typeof window !== "undefined") {
      localStorage.setItem("ai_ppon_tts_unlocked", "false");
    }
    showToast("🎙️ ナレーションモードを解除しました");
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3000);
  };

  const copyRoomUrl = async (rId?: string) => {
    const target = (rId || roomId || "").trim();
    if (!target) return;
    try {
      const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(target)}`;
      await navigator.clipboard.writeText(url);
      showToast("招待URLをコピーしました！");
    } catch (e) {
      console.warn("Copy failed:", e);
      showToast("URLのコピーに失敗しました");
    }
  };

  const regenerateRoomId = () => {
    const newId = generateRoomId();
    setRoomId(newId);
    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(newId)}`;
    window.history.replaceState({}, "", newUrl);
  };

  const stopSpeaking = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const speakTheme = async (
    textToSpeak?: string,
    isTtsActive: boolean = false,
  ) => {
    // 部屋でTTSが有効化されていない場合は一切APIリクエストを投げない
    if (!isTtsActive && !roomTtsEnabled) return;

    const targetText = (textToSpeak ?? theme).trim();
    if (!targetText) return;

    stopSpeaking();

    try {
      // Gemini 3.1 Flash TTS (音声プリセット 'Algieba') のAPIを試行
      const audioUrl = `/api/tts/theme?text=${encodeURIComponent(targetText)}&voice=Algieba`;
      const audioObj = new Audio(audioUrl);
      currentAudioRef.current = audioObj;

      audioObj.onended = () => {
        currentAudioRef.current = null;
      };

      audioObj.onerror = () => {
        console.warn("[TTS] Gemini TTS playback failed");
        currentAudioRef.current = null;
      };

      await audioObj.play();
    } catch (err) {
      console.warn("[TTS] Failed to play Gemini TTS audio:", err);
      currentAudioRef.current = null;
    }
  };

  // 回答テキストの読み上げ: Web Speech API のみ使用（読み上げ完了を待機できるようにPromiseを返す）
  const speakAnswer = (answerText: string): Promise<void> => {
    return new Promise((resolve) => {
      const text = answerText.trim();
      if (
        !text ||
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
      ) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      u.pitch = 1.0;
      u.rate = 0.92;

      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };

      u.onend = done;
      u.onerror = done;

      // 音声読み上げがブラウザ環境等でハングした場合の安全対策（最大8秒でフォールバック）
      const timeoutMs = Math.max(2500, Math.min(8000, text.length * 250));
      setTimeout(done, timeoutMs);

      const voices = window.speechSynthesis.getVoices();
      const jaVoices = voices.filter((v) => v.lang.startsWith("ja"));
      const preferredVoice =
        jaVoices.find(
          (v) =>
            v.name.includes("Keita") ||
            v.name.includes("Ichiro") ||
            v.name.includes("Natural"),
        ) || jaVoices[0];
      if (preferredVoice) {
        u.voice = preferredVoice;
      }

      window.speechSynthesis.speak(u);
    });
  };

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  const pushFeed = (text: string, kind: FeedItem["kind"]) => {
    feedKey.current += 1;
    setFeed((f) => [{ key: feedKey.current, text, kind }, ...f.slice(0, 29)]);
  };

  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  function getFrameDelay(_score: number): number {
    return 80; // 電光石火: 80ms間隔でタタタタッと点灯
  }

  const applyThemeStarted = (m: any) => {
    setRoomPhase("theme");
    setStageMode("theme");
    judgingRef.current = null;
    pendingPlayersRef.current = null;
    pendingThemeStartedRef.current = null;
    setJudging(null);
    setIsTimerPaused(false);
    setTheme(m.theme);
    setQuestionNumber(m.question_number ?? 1);
    setPlayers(m.players);
    deadlineRef.current = m.deadline_epoch;
    setDeadline(m.deadline_epoch);
    if (m.tts_enabled !== undefined) {
      setRoomTtsEnabled(Boolean(m.tts_enabled));
    }
    pushFeed(`お題: ${m.theme}`, "info");
    if (m.theme && (m.tts_enabled || roomTtsEnabled)) {
      speakTheme(m.theme, true);
    }
  };

  async function runJudgmentAnimation(judgement: JudgingState) {
    let scoreSoFar = 0;

    // 白フリップ表示後の「間」 (案2: 50ms)
    await wait(50);

    for (let judgeIdx = 0; judgeIdx < judgement.timeline.length; judgeIdx++) {
      const judgeItem = judgement.timeline[judgeIdx];

      // 審査員の事前ディレイ
      await wait(judgeItem.delay_ms ?? 300);

      // 1点ずつフレームを点灯
      for (let p = 0; p < judgeItem.score; p++) {
        scoreSoFar += 1;
        const currentScore = scoreSoFar;

        setJudging((prev) => {
          if (!prev || prev.player !== judgement.player) return prev;
          return { ...prev, litFrames: currentScore };
        });

        sfx.frameStep(currentScore);

        // 10本目に達した瞬間に即座にIPPON表示・ファンファーレを発動
        if (currentScore === 10) {
          sfx.fanfare();
          pushFeed(
            `💥 ${judgement.player} AI-PPON獲得!! 「${judgement.answer}」`,
            "ippon",
          );
          setJudging((prev) => {
            if (!prev || prev.player !== judgement.player) return prev;
            return { ...prev, isIppon: true, done: true };
          });
          break;
        }

        await wait(getFrameDelay(currentScore));
      }

      if (scoreSoFar === 10) break;
    }

    if (scoreSoFar === 10) {
      await wait(2600);
      setStageMode((current) =>
        current === "answerShown" ? "theme" : current,
      );
      judgingRef.current = null;
      setJudging((prev) => (prev?.player === judgement.player ? null : prev));
      if (pendingThemeStartedRef.current) {
        const nextThemeMsg = pendingThemeStartedRef.current;
        pendingThemeStartedRef.current = null;
        applyThemeStarted(nextThemeMsg);
      }
      return;
    }

    // 10点未満（不成立）の場合の結果処理
    sfx.shakin();
    pushFeed(
      `${judgement.player} ${judgement.totalScore}点… 「${judgement.answer}」`,
      "miss",
    );

    judgingRef.current = { ...judgement, done: true };
    setJudging((prev) => {
      if (!prev || prev.player !== judgement.player) return prev;
      return { ...prev, done: true };
    });
    if (pendingPlayersRef.current) {
      setPlayers(pendingPlayersRef.current);
      pendingPlayersRef.current = null;
    }

    // IPPON未達成時はバッジを表示して約2.6秒後にお題画面へ戻す（再回答可能にする）
    await wait(2600);
    setStageMode((current) => (current === "answerShown" ? "theme" : current));
    judgingRef.current = null;
    setJudging((prev) => (prev?.player === judgement.player ? null : prev));
    if (pendingThemeStartedRef.current) {
      const nextThemeMsg = pendingThemeStartedRef.current;
      pendingThemeStartedRef.current = null;
      applyThemeStarted(nextThemeMsg);
    }
  }

  const connect = (
    targetRoomId?: string,
    targetName?: string,
    targetPid?: string,
  ) => {
    const rId = (targetRoomId || roomId || "").trim();
    const pName = (targetName || name || "").trim();
    if (!pName || !rId) return;

    // URLのパラメータを更新
    const newUrl = `${window.location.pathname}?room=${encodeURIComponent(rId)}`;
    window.history.replaceState({}, "", newUrl);

    const pidToUse =
      targetPid ||
      myPlayerId ||
      localStorage.getItem("aippon_player_id") ||
      localStorage.getItem("oogiri_player_id");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const queryParts = [];
    if (pidToUse) queryParts.push(`player_id=${encodeURIComponent(pidToUse)}`);
    if (ttsUnlocked) queryParts.push(`enable_tts=true`);
    const queryParam = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
    const ws = new WebSocket(
      `${proto}://${location.host}/ws/${encodeURIComponent(rId)}/${encodeURIComponent(pName)}${queryParam}`,
    );
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      switch (m.type) {
        case "JOINED":
          setScreen("game");
          setRoomPhase(m.phase || "waiting");
          setMyPlayerId(m.player_id);
          localStorage.setItem("aippon_room_id", m.room);
          localStorage.setItem("aippon_player_id", m.player_id);
          localStorage.setItem("aippon_player_name", pName);
          setPlayers(m.players);
          if (m.tts_enabled !== undefined) {
            setRoomTtsEnabled(Boolean(m.tts_enabled));
          }
          if (m.theme) setTheme(m.theme);
          if (m.question_number) setQuestionNumber(m.question_number);
          if (m.is_timer_paused !== undefined) {
            setIsTimerPaused(m.is_timer_paused);
            if (m.is_timer_paused && typeof m.remaining === "number") {
              setRemaining(m.remaining);
            }
          }
          if (m.deadline_epoch) {
            deadlineRef.current = m.deadline_epoch;
            setDeadline(m.deadline_epoch);
          }
          break;
        case "PLAYER_JOINED":
        case "PLAYER_LEFT":
          setPlayers(m.players);
          if (m.tts_enabled !== undefined) {
            setRoomTtsEnabled(Boolean(m.tts_enabled));
          }
          break;
        case "WAITING_LOBBY":
          pendingThemeStartedRef.current = null;
          setRoomPhase("waiting");
          setPlayers(m.players);
          setTheme("");
          setWinner(null);
          setJudging(null);
          setStageMode("theme");
          break;
        case "ROUND_RESULT":
          // 採点アニメーション中（まだdoneになっていない場合）は、IPPON演出が出る前に得点が加算されて先ばれするのを防ぐ
          if (judgingRef.current && !judgingRef.current.done) {
            pendingPlayersRef.current = m.players;
          } else {
            pendingPlayersRef.current = null;
            setPlayers(m.players);
          }
          break;
        case "THEME_STARTED":
          if (judgingRef.current) {
            // 採点アニメーション中またはIPPON余韻中は、演出完了まで次のお題への移行を保留する
            pendingThemeStartedRef.current = m;
          } else {
            applyThemeStarted(m);
          }
          break;
        case "TIMER_PAUSED":
          setIsTimerPaused(true);
          deadlineRef.current = null;
          if (typeof m.remaining === "number") {
            setRemaining(m.remaining);
          }
          if (!m.silent) {
            pushFeed("⏸ タイマーが停止されました", "info");
          }
          break;
        case "TIMER_RESUMED":
          setIsTimerPaused(false);
          if (m.deadline_epoch) {
            deadlineRef.current = m.deadline_epoch;
            setDeadline(m.deadline_epoch);
          }
          if (typeof m.remaining === "number") {
            setRemaining(m.remaining);
          }
          if (!m.silent) {
            pushFeed("▶ タイマーが再開されました", "info");
          }
          break;
        case "THEME_ENDED":
          if (!judgingRef.current) {
            stopSpeaking();
          }
          if (m.reason && !m.reason.includes("IPPON")) {
            pushFeed(`(${m.reason})`, "info");
          }
          break;
        case "ANSWER_REVEALED":
          stopSpeaking();
          sfx.pingpong();
          setStageMode("answerWaiting");
          break;
        case "GATEKEEP_REJECTED":
          pushFeed(`✕ ${m.player} の回答は却下（${m.reason}）`, "reject");
          // 門番で弾かれたらお題画面へ戻す
          setStageMode("theme");
          break;
        case "SCORE_REVEAL_START": {
          const newJudging: JudgingState = {
            player: m.player,
            answer: m.answer,
            litFrames: 0,
            totalScore: m.total,
            isIppon: m.is_ippon,
            timeline: m.timeline,
            failed: m.failed ?? [],
            done: false,
          };
          judgingRef.current = newJudging;
          pendingPlayersRef.current = null;
          setJudging(newJudging);

          // ワンテンポ遅れて白フリップを出す (Phase 2)
          setTimeout(async () => {
            setStageMode("answerShown");
            // 回答の読み上げが完了するまで待機
            await speakAnswer(m.answer);
            // 読み上げ後の短い「間」をとってから採点発表を開始
            await wait(300);
            runJudgmentAnimation(newJudging);
          }, 350);
          break;
        }
        case "MATCH_WIN":
          setWinner(m.winner);
          pushFeed(`🏆 優勝: ${m.winner}!!`, "ippon");
          break;
        case "SUBMIT_ACK":
          setInput("");
          break;
      }
    };
  };

  // URLパラメータと自動再接続（リロード対策）
  useEffect(() => {
    const savedRoom =
      localStorage.getItem("aippon_room_id") ||
      localStorage.getItem("oogiri_room_id");
    const savedName =
      localStorage.getItem("aippon_player_name") ||
      localStorage.getItem("oogiri_player_name");
    const savedPid =
      localStorage.getItem("aippon_player_id") ||
      localStorage.getItem("oogiri_player_id");

    if (savedRoom === roomId && savedName && savedPid) {
      connect(roomId, savedName, savedPid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // カウントダウン
  useEffect(() => {
    isTimerPausedRef.current = isTimerPaused;
  }, [isTimerPaused]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!isTimerPausedRef.current && deadlineRef.current) {
        setRemaining(
          Math.max(0, Math.ceil(deadlineRef.current - Date.now() / 1000)),
        );
      }
    }, 500);
    return () => clearInterval(t);
  }, []);

  const submit = () => {
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "SUBMIT", answer: input }));
  };
  const toggleTimer = () => {
    wsRef.current?.send(JSON.stringify({ type: "TOGGLE_TIMER" }));
  };
  const skip = () => wsRef.current?.send(JSON.stringify({ type: "SKIP" }));
  const startGame = () => {
    wsRef.current?.send(JSON.stringify({ type: "START_GAME" }));
  };
  const restart = () => {
    setStageMode("theme");
    setJudging(null);
    setWinner(null);
    setQuestionNumber(1);
    wsRef.current?.send(JSON.stringify({ type: "RESTART" }));
  };

  const leaveRoom = () => {
    if (!window.confirm("対戦ルームから退出しますか？")) return;
    try {
      wsRef.current?.send(JSON.stringify({ type: "LEAVE" }));
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
    localStorage.removeItem("aippon_player_id");
    localStorage.removeItem("oogiri_player_id");
    setScreen("join");
    setRoomPhase("waiting");
    setPlayers([]);
    setTheme("");
    setJudging(null);
    setWinner(null);
    stopSpeaking();
  };

  // --------------------------------------------------------------------------
  // Join Screen
  // --------------------------------------------------------------------------
  if (screen === "join") {
    return (
      <div className="join-container">
        <div className="join-inner">
          {/* 画像の色合い・質感を完全再現したベクタータイトルロゴ (5回連続タップでナレーション解禁) */}
          <div
            className="join-logo-wrapper"
            aria-label="AI-PPON GRAND PRIX"
            onClick={handleLogoClick}
            style={{ cursor: "pointer", userSelect: "none" }}
            title="AI-PPON GRAND PRIX"
          >
            <svg
              className="join-logo-svg"
              viewBox="0 0 520 250"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="AI-PPON GRAND PRIX"
            >
              <defs>
                <linearGradient
                  id="chromeGradient"
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="35%" stopColor="#e2e8f0" />
                  <stop offset="48%" stopColor="#818ea3" />
                  <stop offset="50%" stopColor="#1e293b" />
                  <stop offset="53%" stopColor="#475569" />
                  <stop offset="85%" stopColor="#cbd5e1" />
                  <stop offset="100%" stopColor="#ffffff" />
                </linearGradient>

                <linearGradient id="barGloss" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
                  <stop offset="5%" stopColor="#48382d" />
                  <stop offset="18%" stopColor="#251a14" />
                  <stop offset="50%" stopColor="#0c0907" />
                  <stop offset="85%" stopColor="#19120d" />
                  <stop offset="96%" stopColor="#3c2e25" />
                  <stop offset="100%" stopColor="#554236" />
                </linearGradient>
                <linearGradient
                  id="barBorderGrad"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#b8bcc4" />
                  <stop offset="25%" stopColor="#ffffff" />
                  <stop offset="50%" stopColor="#8a8e98" />
                  <stop offset="75%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#a0a4ae" />
                </linearGradient>
                <linearGradient
                  id="sheenGlow"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
                  <stop offset="35%" stopColor="#ffffff" stopOpacity="0.12" />
                  <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>

                <filter
                  id="logoShadow"
                  x="-10%"
                  y="-10%"
                  width="120%"
                  height="125%"
                >
                  <feDropShadow
                    dx="0"
                    dy="6"
                    stdDeviation="8"
                    floodColor="#000000"
                    floodOpacity="0.22"
                  />
                </filter>
              </defs>

              <g filter="url(#logoShadow)">
                {/* === 1. 極太ブラック「AI-PPON」 === */}
                <text
                  x="8"
                  y="125"
                  fontFamily="'Impact', 'Arial Black', 'Helvetica Neue', sans-serif"
                  fontSize="122"
                  fontWeight="900"
                  letterSpacing="1"
                  textLength="504"
                  lengthAdjust="spacingAndGlyphs"
                  fill="#000000"
                >
                  AI-PPON
                </text>

                {/* === 2. 極太ブラック「GRAND PRIX」 === */}
                <text
                  x="8"
                  y="184"
                  fontFamily="'Impact', 'Arial Black', 'Helvetica Neue', sans-serif"
                  fontSize="62"
                  fontWeight="900"
                  letterSpacing="2"
                  textLength="500"
                  lengthAdjust="spacingAndGlyphs"
                  fill="#000000"
                >
                  GRAND PRIX
                </text>

                {/* === 4. 下部ブラック光沢バー === */}
                <g id="bottom-bar">
                  <rect
                    x="4"
                    y="196"
                    width="512"
                    height="46"
                    rx="3"
                    fill="url(#barGloss)"
                    stroke="url(#barBorderGrad)"
                    strokeWidth="1.6"
                  />
                  {/* ガラス反射の斜め光沢ハイライト */}
                  <polygon
                    points="4,196 290,196 150,242 4,242"
                    fill="url(#sheenGlow)"
                  />
                  {/* 上辺の極細ホワイト光彩ライン */}
                  <line
                    x1="6"
                    y1="198"
                    x2="514"
                    y2="198"
                    stroke="#ffffff"
                    strokeWidth="1.2"
                    strokeOpacity="0.9"
                  />
                </g>
              </g>
            </svg>
          </div>

          {/* 隠しアンロック状態のインジケーター */}
          {ttsUnlocked && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                background: "linear-gradient(135deg, #11141a 0%, #1a1e29 100%)",
                border: "1px solid #ffd700",
                padding: "6px 14px",
                borderRadius: "24px",
                boxShadow:
                  "0 4px 14px rgba(0, 0, 0, 0.4), 0 0 10px rgba(255, 215, 0, 0.25)",
                marginTop: "-10px",
                marginBottom: "4px",
                zIndex: 10,
              }}
            >
              <span
                style={{
                  color: "#ffd700",
                  fontSize: "12px",
                  fontWeight: "800",
                  letterSpacing: "0.5px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>🎙️</span>
                <span>NARRATION MODE (AI-TTS) ACTIVE</span>
              </span>
              <button
                type="button"
                onClick={handleDisableNarration}
                style={{
                  background: "rgba(239, 68, 68, 0.25)",
                  border: "1px solid rgba(239, 68, 68, 0.6)",
                  color: "#ffffff",
                  borderRadius: "12px",
                  padding: "3px 8px",
                  fontSize: "11px",
                  fontWeight: "700",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "inline-flex",
                  alignItems: "center",
                  lineHeight: "1.2",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.5)";
                  e.currentTarget.style.borderColor = "#ef4444";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.25)";
                  e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.6)";
                }}
                title="ナレーションモードを解除"
              >
                ✕ 解除
              </button>
            </div>
          )}

          {/* 漆黒×クローム光沢のエントリーコンソール */}
          <div className="join-card">
            <div className="join-card-sheen" aria-hidden="true" />
            <div className="join-card-header">
              <span className="join-card-tag">ENTRY DESK</span>
              <h2 className="join-card-title">プレイヤー参戦登録</h2>
            </div>

            <div className="join-form">
              <div className="join-field">
                <label htmlFor="player-name" className="join-field-label">
                  <span className="label-en">PLAYER NAME</span>
                  <span className="label-jp">あなたの名前</span>
                </label>
                <input
                  id="player-name"
                  className="join-input"
                  placeholder="回答者名を入力"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connect()}
                  aria-label="あなたの名前"
                  autoComplete="off"
                  autoFocus
                />
              </div>

              <div className="join-field">
                <label htmlFor="room-id" className="join-field-label">
                  <span className="label-en">ROOM ID</span>
                  <span className="label-jp">対戦ルーム</span>
                </label>
                <div className="room-input-group">
                  <input
                    id="room-id"
                    className="join-input"
                    placeholder="例: ABC123"
                    value={roomId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRoomId(val);
                      const newUrl = `${window.location.pathname}?room=${encodeURIComponent(val)}`;
                      window.history.replaceState({}, "", newUrl);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && connect()}
                    aria-label="ルームID"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn-random-room"
                    onClick={regenerateRoomId}
                    title="ランダムな部屋IDを再生成"
                  >
                    🎲 再生成
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", width: "100%" }}>
                <button
                  type="button"
                  className="join-submit-btn"
                  style={{ flex: 1 }}
                  onClick={() => connect()}
                  disabled={!name.trim()}
                  aria-label="大会に入場する"
                >
                  <span className="join-btn-sheen" aria-hidden="true" />
                  <span className="join-btn-sub">ENTER ARENA</span>
                  <span className="join-btn-main">入場する</span>
                </button>
                <button
                  type="button"
                  className="btn-copy-url"
                  onClick={() => copyRoomUrl()}
                  title="友達に共有するURLをコピー"
                  style={{ padding: "0 14px", height: "auto" }}
                >
                  📋 URLコピー
                </button>
              </div>
            </div>

            <div className="join-card-footer">
              <span className="join-footer-hint">
                URLを共有すると同じ部屋に対戦相手を招待できます
              </span>
              {(import.meta.env.DEV ||
                (typeof window !== "undefined" &&
                  (window.location.hostname === "localhost" ||
                    window.location.hostname === "127.0.0.1"))) && (
                <div style={{ marginTop: "12px", textAlign: "center" }}>
                  <a
                    href="/devtool"
                    style={{
                      fontSize: "12px",
                      color: "#ffd200",
                      textDecoration: "none",
                      background: "rgba(255, 210, 0, 0.1)",
                      border: "1px solid rgba(255, 210, 0, 0.3)",
                      padding: "4px 10px",
                      borderRadius: "12px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    🛠️ 演出デバッグツール (DevTool) を開く
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* 法的情報フッター（利用規約 / プライバシーポリシー） */}
          <footer className="join-page-footer">
            <div className="join-legal-links">
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="join-legal-link"
              >
                利用規約
              </a>
              <span className="join-legal-divider">•</span>
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="join-legal-link"
              >
                プライバシーポリシー
              </a>
            </div>
            <div className="join-copyright">
              &copy; 2026 AI-PPON GRAND PRIX
            </div>
          </footer>
        </div>
        {toast && (
          <div className="toast-container">
            <div className="toast-message">
              <span>✔</span> {toast}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Main Arena Screen
  // --------------------------------------------------------------------------
  return (
    <div className="arena-container">
      {roomPhase === "waiting" ? (
        <div className="waiting-room-container">
          <div className="waiting-card">
            <div className="waiting-badge">
              <span className="waiting-pulse-dot" />
              <span>ENTRY OPEN</span>
              {roomTtsEnabled && (
                <span
                  style={{
                    marginLeft: "8px",
                    background: "rgba(255, 215, 0, 0.2)",
                    color: "#ffd700",
                    border: "1px solid #ffd700",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    fontSize: "10px",
                    fontWeight: "900",
                  }}
                >
                  🎙️ AI NARRATION ON
                </span>
              )}
            </div>
            <h1 className="waiting-title">参加者を待っています</h1>
            <p className="waiting-desc">
              参加メンバーが集まったら「ゲームを開始する」を押してください。
            </p>

            <div className="room-share-bar">
              <div className="room-share-info">
                <span className="room-share-label">ROOM:</span>
                <span className="room-share-id">{roomId}</span>
              </div>
              <button
                type="button"
                className="btn-copy-url"
                onClick={() => copyRoomUrl()}
              >
                📋 招待URLをコピー
              </button>
            </div>

            <div className="waiting-players-section">
              <div className="waiting-players-header">
                <span className="waiting-players-count">
                  参加人数: <span>{players.length}</span> 名
                </span>
              </div>
              <div className="waiting-players-grid">
                {players.map((p) => (
                  <div
                    key={p.id}
                    className={`waiting-player-chip ${p.id === myPlayerId ? "is-me" : ""}`}
                  >
                    <div className="waiting-player-avatar">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="waiting-player-name">
                      {p.name} {p.id === myPlayerId ? " (あなた)" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="waiting-actions">
              <button
                type="button"
                className="btn-start-game"
                onClick={startGame}
              >
                ▶ ゲームを開始する
              </button>
              <button
                type="button"
                className="btn-leave-room"
                onClick={leaveRoom}
              >
                🚪 退出する
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 1. Upper Theme & Judgment Stage (RESULT_ANNOUNCEMENT_SPEC v2.0) */}
          <section
            className={`themeStage themeStage--${stageMode}`}
            aria-label="大喜利ステージ"
          >
            {/* Layer 1: 常時表示デフォルトフレーム */}
            <DefaultArenaFrame
              variant={stageMode === "theme" ? "theme" : "judgment"}
            />

            {/* Phase 0: 通常のお題表示 */}
            {stageMode === "theme" && (
              <>
                <div className="themeStage__hud">
                  <div
                    className="themeStage__roundBadge"
                    aria-label={`第${questionNumber}問`}
                  >
                    第 {questionNumber} 問
                    {roomTtsEnabled && (
                      <span
                        style={{
                          marginLeft: "6px",
                          fontSize: "11px",
                          color: "#ffd700",
                          verticalAlign: "middle",
                        }}
                        title="AIナレーション有効"
                      >
                        🎙️
                      </span>
                    )}
                  </div>

                  <div className="themeStage__controls">
                    <div className="themeStage__roomMeta">
                      <span className="themeStage__roomIdTag">{roomId}</span>
                      <button
                        type="button"
                        className="themeStage__copyBtn"
                        onClick={() => copyRoomUrl()}
                        title="部屋URLをコピー"
                      >
                        📋 コピー
                      </button>
                      <button
                        type="button"
                        className="themeStage__leaveBtn"
                        onClick={leaveRoom}
                        title="部屋から退出"
                      >
                        🚪 退出
                      </button>
                    </div>

                    <div
                      className={`themeStage__timer ${isTimerPaused ? "themeStage__timer--paused" : ""}`}
                      aria-label={`残り時間 ${formatTime(remaining)} ${isTimerPaused ? "（停止中）" : ""}`}
                    >
                      <span
                        className="themeStage__timerIcon"
                        aria-hidden="true"
                      >
                        {isTimerPaused ? "⏸" : "◷"}
                      </span>
                      <span>{formatTime(remaining)}</span>
                      {isTimerPaused && (
                        <span className="themeStage__timerPausedTag">
                          停止中
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      className={`themeStage__timerButton ${isTimerPaused ? "themeStage__timerButton--paused" : ""}`}
                      onClick={toggleTimer}
                      title={
                        isTimerPaused ? "タイマーを再開" : "タイマーを停止"
                      }
                    >
                      {isTimerPaused ? "▶ 再開" : "⏸ 停止"}
                    </button>

                    <button
                      type="button"
                      className="themeStage__skipButton"
                      onClick={skip}
                    >
                      スキップ
                    </button>
                  </div>
                </div>

                <div className="themeStage__question">
                  <p className="themeStage__eyebrow">お 題</p>
                  <div className="themeStage__titleWrapper">
                    <h1
                      className={`themeStage__title ${getThemeSizeClass(theme || "")}`}
                    >
                      {theme || "お題を読み込んでいます..."}
                    </h1>
                  </div>
                </div>
              </>
            )}

            {/* Phase 1: 回答受信・判定待機（テキストなし・採点背景のみ） */}
            {stageMode === "answerWaiting" && null}

            {/* Phase 2, 3, 4: 白フリップ・採点フレーム点灯・結果発表 */}
            {stageMode === "answerShown" && judging && (
              <>
                {/* 採点フレーム (0〜10本、デフォルトフレームの内側・白フリップの外側) */}
                <JudgmentFrameMeter
                  litFrames={judging.litFrames}
                  totalFrames={10}
                  isIppon={judging.done && judging.isIppon}
                />

                <div className="answerArea">
                  <div className="answerArea__player">
                    {judging.player} の回答
                  </div>

                  {/* 白フリップ */}
                  <div
                    className={`answerFlip ${judging.done && judging.isIppon ? "answerFlip--ippon" : ""}`}
                  >
                    <p
                      className={`answerFlip__text ${getAnswerSizeClass(judging.answer)}`}
                    >
                      「{judging.answer}」
                    </p>
                  </div>
                </div>

                {/* IPPON特大バナー */}
                {judging.done && judging.isIppon && (
                  <div className="ipponBanner">AI-PPON!</div>
                )}

                {/* 未IPPON時の点数丸バッジ */}
                {judging.done && !judging.isIppon && (
                  <div
                    className="scoreBadge"
                    aria-label={`得点: ${judging.totalScore}点`}
                  >
                    <span className="scoreBadge__number">
                      {judging.totalScore}
                    </span>
                  </div>
                )}

                {/* アクセシビリティ用通知（視覚的には非表示） */}
                <div className="srOnly" aria-live="polite">
                  {!judging.done && `採点中: ${judging.litFrames} / 10`}
                  {judging.done &&
                    (judging.isIppon
                      ? "AI-PPON、10点満点"
                      : `今回の得点は ${judging.totalScore} 点`)}
                </div>
              </>
            )}
          </section>

          {/* 2. Lower Area: Scoreboard + Feed + Input */}
          <div className="arena-bottom">
            {/* Player Scoreboard */}
            <section
              className="player-scoreboard"
              aria-label="出場者一覧と得点"
            >
              {players.map((p) => (
                <div
                  key={p.id}
                  className="player-score-card"
                  aria-label={`${p.name}: ${p.ippons} AI-PPON`}
                >
                  <span className="player-name">{p.name}</span>
                  <div
                    className="ippon-bars-container"
                    title={`${p.ippons} AI-PPON`}
                  >
                    {[0, 1, 2].map((idx) => (
                      <div
                        key={idx}
                        className={`ippon-bar ${idx < p.ippons ? "active" : ""}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>

            {/* Feed & Input */}
            <section className="feed-section">
              <div className="feed-list" role="log" aria-live="polite">
                {feed.map((f) => (
                  <div key={f.key} className={`feed-bubble ${f.kind}`}>
                    {f.text}
                  </div>
                ))}
              </div>

              <div className="input-bar">
                <input
                  className="answer-input"
                  placeholder="回答を入力してEnter (例: ○○○○○)"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  aria-label="大喜利回答の入力"
                />
                <button className="submit-btn" onClick={submit}>
                  送信
                </button>
              </div>
            </section>
          </div>
        </>
      )}

      {/* 3. Match Winner Overlay */}
      {winner && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="reveal-card">
            <div className="ippon-banner" style={{ marginBottom: 24 }}>
              🏆 {winner} 優勝!!
            </div>
            <p style={{ color: "#aaa", marginBottom: 24, fontSize: 16 }}>
              3本のAI-PPONを獲得して勝利しました！
            </p>
            <button className="submit-btn" onClick={restart}>
              もう一度遊ぶ
            </button>
          </div>
        </div>
      )}

      {/* トースト通知 */}
      {toast && (
        <div className="toast-container">
          <div className="toast-message">
            <span>✔</span> {toast}
          </div>
        </div>
      )}
    </div>
  );
}
