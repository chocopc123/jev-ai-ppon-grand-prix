import { useEffect, useRef, useState } from "react";
import "./App.css";

type Player = { id: string; name: string; ippons: number };
type TimelineItem = { judge: string; score: number; delay_ms: number };

type FeedItem = { key: number; text: string; kind: "info" | "miss" | "reject" | "ippon" };


let ac: AudioContext | null = null;
function audio(): AudioContext {
  if (!ac) ac = new AudioContext();
  return ac;
}
function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", vol = 0.25) {
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
    const res = await fetch("/ippon_voice.m4a");
    const arrayBuffer = await res.arrayBuffer();
    ipponAudioBuffer = await a.decodeAudioData(arrayBuffer);
  } catch (err) {
    console.warn("Failed to load ippon voice:", err);
  }
  return ipponAudioBuffer;
}
// 初回ロードをバックグラウンドで走らせておく
if (typeof window !== "undefined") {
  window.addEventListener("click", () => {
    audio();
    loadIpponVoice();
  }, { once: true });
}

let ipponAudioEl: HTMLAudioElement | null = null;
let ipponMediaSourceNode: MediaElementAudioSourceNode | null = null;

function getIpponAudioPipeline() {
  const a = audio();
  if (!ipponAudioEl) {
    ipponAudioEl = new Audio("/ippon_voice.m4a");
    // ピッチを上げずに速度だけ上げる設定（標準ブラウザ対応）
    (ipponAudioEl as any).preservesPitch = true;
    (ipponAudioEl as any).mozPreservesPitch = true;
    (ipponAudioEl as any).webkitPreservesPitch = true;
    ipponAudioEl.playbackRate = 1.15; // 速度は速く保つ
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
    delayFeedback.gain.setValueAtTime(0.30, a.currentTime);

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
  window.addEventListener("click", () => {
    audio();
    try {
      getIpponAudioPipeline().load();
    } catch {}
  }, { once: true });
}

function playIpponVoice() {
  try {
    const el = getIpponAudioPipeline();
    el.currentTime = 0;
    el.playbackRate = 1.15;
    el.play().catch((e) => console.warn("playIpponVoice error:", e));
  } catch (e) {
    console.warn("playIpponVoice failure:", e);
  }
}

const sfx = {
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

    // IPPONボイスを即時先行再生（ファンファーレ演出より0.3秒早く立ち上がる）
    playIpponVoice();

    const fanfareStart = now + 0.30;

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
    const arpeggioNotes = [261.63, 329.63, 392.0, 493.88, 587.33, 659.25, 783.99, 1046.5];
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
      osc.frequency.setValueAtTime(freq * (1 + (idx % 2 === 0 ? 0.015 : -0.015)), now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.97, now + 0.55);

      const vol = 0.22 / (idx + 1);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55 + idx * 0.04);

      osc.connect(gain).connect(a.destination);
      osc.start(now);
      osc.stop(now + 0.65);
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
    <div className={`defaultArenaFrame defaultArenaFrame--${variant}`} aria-hidden="true">
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
      <div className="defaultArenaFrame__brand">OOGIRI GRAND PRIX</div>
    </div>
  );
}

type JudgmentFrameMeterProps = {
  litFrames: number;
  totalFrames?: number;
  isIppon?: boolean;
};

export function JudgmentFrameMeter({ litFrames, totalFrames = 10, isIppon = false }: JudgmentFrameMeterProps) {
  const frames = Array.from({ length: totalFrames }, (_, i) => {
    const isLit = i < litFrames;
    // デフォルトフレーム inner(余白28px) の内側に外側から内側へ配置
    const inset = 46 + i * 14;
    const corner = Math.max(16, 80 - i * 5);
    const points = `${inset + corner},${inset} ${1000 - inset - corner},${inset} ${1000 - inset},${inset + corner} ${1000 - inset},${620 - inset - corner} ${1000 - inset - corner},${620 - inset} ${inset + corner},${620 - inset} ${inset},${620 - inset - corner} ${inset},${inset + corner}`;
    return { index: i, isLit, points };
  });

  return (
    <div className={`frameMeter ${isIppon ? "frameMeter--ippon" : ""}`} aria-hidden="true">
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

export default function App() {
  const [screen, setScreen] = useState<"join" | "game">("join");
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("arena");
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
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const speakTheme = async (textToSpeak?: string) => {
    const targetText = (textToSpeak ?? theme).trim();
    if (!targetText) return;

    stopSpeaking();

    try {
      // 1. まず Gemini 3.1 Flash TTS (音声プリセット 'Algieba') のAPIを試行
      const audioUrl = `/api/tts/theme?text=${encodeURIComponent(targetText)}&voice=Algieba`;
      const audioObj = new Audio(audioUrl);
      currentAudioRef.current = audioObj;

      audioObj.onended = () => {
        currentAudioRef.current = null;
      };

      audioObj.onerror = () => {
        console.warn("[TTS] Gemini TTS playback failed, falling back to Web Speech API");
        fallbackWebSpeech(targetText);
      };

      await audioObj.play();
    } catch (err) {
      console.warn("[TTS] Failed to play Gemini TTS audio:", err);
      fallbackWebSpeech(targetText);
    }
  };

  const fallbackWebSpeech = (targetText: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const u = new SpeechSynthesisUtterance(targetText);
    u.lang = "ja-JP";
    u.pitch = 0.72; // 男性低音化
    u.rate = 0.90;

    const voices = window.speechSynthesis.getVoices();
    const jaVoices = voices.filter((v) => v.lang.startsWith("ja"));
    const preferredVoice =
      jaVoices.find((v) => v.name.includes("Keita") || v.name.includes("Ichiro") || v.name.includes("Natural")) ||
      jaVoices[0];
    if (preferredVoice) {
      u.voice = preferredVoice;
    }

    window.speechSynthesis.speak(u);
  };

  // 回答テキストの読み上げ: Web Speech API のみ使用
  const speakAnswer = (answerText: string) => {
    const text = answerText.trim();
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.pitch = 1.0;
    u.rate = 0.92;

    const voices = window.speechSynthesis.getVoices();
    const jaVoices = voices.filter((v) => v.lang.startsWith("ja"));
    const preferredVoice =
      jaVoices.find((v) => v.name.includes("Keita") || v.name.includes("Ichiro") || v.name.includes("Natural")) ||
      jaVoices[0];
    if (preferredVoice) {
      u.voice = preferredVoice;
    }

    window.speechSynthesis.speak(u);
  };

  const formatTime = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  const pushFeed = (text: string, kind: FeedItem["kind"]) => {
    feedKey.current += 1;
    setFeed((f) => [{ key: feedKey.current, text, kind }, ...f.slice(0, 29)]);
  };

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function getFrameDelay(score: number): number {
    if (score === 10) return 600; // 10本目は最大のタメ
    if (score >= 8) return 380;   // 8〜9本目は緊張感の延長
    return 180;                   // 1〜7本目はテンポよく
  }

  async function runJudgmentAnimation(judgement: JudgingState) {
    let scoreSoFar = 0;

    // 白フリップ表示後の「間」
    await wait(400);

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
        if (currentScore === 10 && judgement.isIppon) {
          sfx.fanfare();
          pushFeed(`★ IPPON! ${judgement.player} 「${judgement.answer}」`, "ippon");
          judgingRef.current = { ...judgement, litFrames: 10, done: true };
          setJudging((prev) => {
            if (!prev || prev.player !== judgement.player) return prev;
            return { ...prev, litFrames: 10, done: true };
          });
          // IPPON演出が出た直後に、保留されていたプレイヤー得点更新があれば反映
          if (pendingPlayersRef.current) {
            setPlayers(pendingPlayersRef.current);
            pendingPlayersRef.current = null;
          }
          return;
        }

        await wait(getFrameDelay(currentScore));
      }
    }

    await wait(450);

    // 10点未満（不成立）の場合の結果処理
    sfx.shakin();
    pushFeed(
      `${judgement.player} ${judgement.totalScore}点… 「${judgement.answer}」`,
      "miss"
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
  }

  // カウントダウン
  useEffect(() => {
    isTimerPausedRef.current = isTimerPaused;
  }, [isTimerPaused]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!isTimerPausedRef.current && deadlineRef.current) {
        setRemaining(Math.max(0, Math.ceil(deadlineRef.current - Date.now() / 1000)));
      }
    }, 500);
    return () => clearInterval(t);
  }, []);

  const connect = () => {
    if (!name.trim()) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/${roomId}/${encodeURIComponent(name.trim())}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      switch (m.type) {
        case "JOINED":
          setScreen("game");
          setPlayers(m.players);
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
          setStageMode("theme");
          judgingRef.current = null;
          pendingPlayersRef.current = null;
          setJudging(null);
          setIsTimerPaused(false);
          setTheme(m.theme);
          setQuestionNumber(m.question_number ?? 1);
          setPlayers(m.players);
          deadlineRef.current = m.deadline_epoch;
          setDeadline(m.deadline_epoch);
          pushFeed(`お題: ${m.theme}`, "info");
          if (m.theme) {
            speakTheme(m.theme);
          }
          break;
        case "TIMER_PAUSED":
          setIsTimerPaused(true);
          deadlineRef.current = null;
          if (typeof m.remaining === "number") {
            setRemaining(m.remaining);
          }
          pushFeed("⏸ タイマーが停止されました", "info");
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
          pushFeed("▶ タイマーが再開されました", "info");
          break;
        case "THEME_ENDED":
          stopSpeaking();
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
          setTimeout(() => {
            setStageMode("answerShown");
            runJudgmentAnimation(newJudging);
            speakAnswer(m.answer);
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

  const submit = () => {
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "SUBMIT", answer: input }));
  };
  const toggleTimer = () => {
    wsRef.current?.send(JSON.stringify({ type: "TOGGLE_TIMER" }));
  };
  const skip = () => wsRef.current?.send(JSON.stringify({ type: "SKIP" }));
  const restart = () => {
    setStageMode("theme");
    setJudging(null);
    setWinner(null);
    setQuestionNumber(1);
    wsRef.current?.send(JSON.stringify({ type: "RESTART" }));
  };

  // --------------------------------------------------------------------------
  // Join Screen
  // --------------------------------------------------------------------------
  if (screen === "join") {
    return (
      <div className="join-container">
        <div className="join-inner">
          {/* 画像の色合い・質感を完全再現したベクタータイトルロゴ */}
          <div className="join-logo-wrapper" aria-label="OOGIRI GRAND PRIX">
            <svg
              className="join-logo-svg"
              viewBox="0 0 520 250"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="OOGIRI GRAND PRIX"
            >
              <defs>
                <linearGradient id="chromeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
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
                <linearGradient id="barBorderGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#b8bcc4" />
                  <stop offset="25%" stopColor="#ffffff" />
                  <stop offset="50%" stopColor="#8a8e98" />
                  <stop offset="75%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#a0a4ae" />
                </linearGradient>
                <linearGradient id="sheenGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
                  <stop offset="35%" stopColor="#ffffff" stopOpacity="0.12" />
                  <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>

                <filter id="logoShadow" x="-10%" y="-10%" width="120%" height="125%">
                  <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000000" floodOpacity="0.22" />
                </filter>
              </defs>

              <g filter="url(#logoShadow)">
                {/* === 1. 極太ブラック「OOGIRI」 === */}
                <text
                  x="4"
                  y="125"
                  fontFamily="'Impact', 'Arial Black', 'Helvetica Neue', sans-serif"
                  fontSize="136"
                  fontWeight="900"
                  letterSpacing="2"
                  fill="#000000"
                >
                  OOGIRI
                </text>

                {/* === 3. 極太ブラック「GRAND PRIX」 === */}
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
                  <polygon points="4,196 290,196 150,242 4,242" fill="url(#sheenGlow)" />
                  {/* 上辺の極細ホワイト光彩ライン */}
                  <line x1="6" y1="198" x2="514" y2="198" stroke="#ffffff" strokeWidth="1.2" strokeOpacity="0.9" />
                </g>
              </g>
            </svg>
          </div>

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
                <input
                  id="room-id"
                  className="join-input"
                  placeholder="例: arena"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connect()}
                  aria-label="ルームID"
                  autoComplete="off"
                />
              </div>

              <button
                type="button"
                className="join-submit-btn"
                onClick={connect}
                disabled={!name.trim()}
                aria-label="大会に入場する"
              >
                <span className="join-btn-sheen" aria-hidden="true" />
                <span className="join-btn-sub">ENTER ARENA</span>
                <span className="join-btn-main">入場する</span>
              </button>
            </div>

            <div className="join-card-footer">
              <span className="join-footer-hint">名前を入力してEnterキーでも入場できます</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Main Arena Screen
  // --------------------------------------------------------------------------
  return (
    <div className="arena-container">
      {/* 1. Upper Theme & Judgment Stage (RESULT_ANNOUNCEMENT_SPEC v2.0) */}
      <section className={`themeStage themeStage--${stageMode}`} aria-label="大喜利ステージ">
        {/* Layer 1: 常時表示デフォルトフレーム */}
        <DefaultArenaFrame variant={stageMode === "theme" ? "theme" : "judgment"} />

        {/* Phase 0: 通常のお題表示 */}
        {stageMode === "theme" && (
          <>
            <div className="themeStage__hud">
              <div className="themeStage__roundBadge" aria-label={`第${questionNumber}問`}>
                第 {questionNumber} 問
              </div>

              <div className="themeStage__controls">
                <div
                  className={`themeStage__timer ${isTimerPaused ? "themeStage__timer--paused" : ""}`}
                  aria-label={`残り時間 ${formatTime(remaining)} ${isTimerPaused ? "（停止中）" : ""}`}
                >
                  <span className="themeStage__timerIcon" aria-hidden="true">
                    {isTimerPaused ? "⏸" : "◷"}
                  </span>
                  <span>{formatTime(remaining)}</span>
                  {isTimerPaused && <span className="themeStage__timerPausedTag">停止中</span>}
                </div>

                <button
                  type="button"
                  className={`themeStage__timerButton ${isTimerPaused ? "themeStage__timerButton--paused" : ""}`}
                  onClick={toggleTimer}
                  title={isTimerPaused ? "タイマーを再開" : "タイマーを停止"}
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
              <h1 className="themeStage__title">{theme || "お題を読み込んでいます..."}</h1>
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
              <div className="answerArea__player">{judging.player} の回答</div>

              {/* 白フリップ */}
              <div className={`answerFlip ${judging.done && judging.isIppon ? "answerFlip--ippon" : ""}`}>
                <p className={`answerFlip__text ${
                  judging.answer.length <= 14
                    ? "answerFlip__text--short"
                    : judging.answer.length <= 28
                    ? "answerFlip__text--medium"
                    : judging.answer.length <= 45
                    ? "answerFlip__text--long"
                    : "answerFlip__text--xlarge"
                }`}>
                  「{judging.answer}」
                </p>
              </div>
            </div>

            {/* IPPON特大バナー */}
            {judging.done && judging.isIppon && (
              <div className="ipponBanner">IPPON!</div>
            )}

            {/* 未IPPON時の点数丸バッジ */}
            {judging.done && !judging.isIppon && (
              <div className="scoreBadge" aria-label={`得点: ${judging.totalScore}点`}>
                <span className="scoreBadge__number">{judging.totalScore}</span>
              </div>
            )}

            {/* アクセシビリティ用通知（視覚的には非表示） */}
            <div className="srOnly" aria-live="polite">
              {!judging.done && `採点中: ${judging.litFrames} / 10`}
              {judging.done && (
                judging.isIppon ? "IPPON、10点満点" : `今回の得点は ${judging.totalScore} 点`
              )}
            </div>
          </>
        )}
      </section>

      {/* 2. Lower Area: Scoreboard + Feed + Input */}
      <div className="arena-bottom">
        {/* Player Scoreboard */}
        <section className="player-scoreboard" aria-label="出場者一覧と得点">
          {players.map((p) => (
            <div key={p.id} className="player-score-card" aria-label={`${p.name}: ${p.ippons} IPPON`}>
              <span className="player-name">{p.name}</span>
              <div className="ippon-bars-container" title={`${p.ippons} IPPON`}>
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className={`ippon-bar ${idx < p.ippons ? "active" : ""}`} />
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

      {/* 3. Match Winner Overlay */}
      {winner && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="reveal-card">
            <div className="ippon-banner" style={{ marginBottom: 24 }}>
              🏆 {winner} 優勝!!
            </div>
            <p style={{ color: "#aaa", marginBottom: 24, fontSize: 16 }}>3本のIPPONを獲得して勝利しました！</p>
            <button className="submit-btn" onClick={restart}>
              もう一度遊ぶ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
