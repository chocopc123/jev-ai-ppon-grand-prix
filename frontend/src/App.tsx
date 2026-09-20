import { useEffect, useRef, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { useArenaViewport } from "./useArenaViewport";
import "./App.css";

type Player = {
  id: string;
  name: string;
  ippons: number;
  avatar_url?: string | null;
};
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
let ipponAudioLoadingPromise: Promise<AudioBuffer | null> | null = null;

async function loadIpponVoice(): Promise<AudioBuffer | null> {
  if (ipponAudioBuffer) return ipponAudioBuffer;
  if (ipponAudioLoadingPromise) return ipponAudioLoadingPromise;

  ipponAudioLoadingPromise = (async () => {
    try {
      const a = audio();
      const res = await fetch("/aippon_voice.wav");
      const arrayBuffer = await res.arrayBuffer();
      ipponAudioBuffer = await a.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.warn("Failed to load ippon voice:", err);
    } finally {
      ipponAudioLoadingPromise = null;
    }
    return ipponAudioBuffer;
  })();

  return ipponAudioLoadingPromise;
}

// フォールバック用のAudioElement（AudioBufferデコード失敗時の安全策）
let fallbackIpponAudioEl: HTMLAudioElement | null = null;
function getFallbackIpponAudio(): HTMLAudioElement {
  if (!fallbackIpponAudioEl) {
    fallbackIpponAudioEl = new Audio("/aippon_voice.wav");
    fallbackIpponAudioEl.preload = "auto";
  }
  return fallbackIpponAudioEl;
}

// ユーザー操作時に事前ロード & Web Speech API / Web Audio アンロック
if (typeof window !== "undefined") {
  const unlockAudioAndSpeech = () => {
    const a = audio();
    if (a.state === "suspended") {
      a.resume().catch(() => {});
    }
    loadIpponVoice();
    try {
      getFallbackIpponAudio().load();
    } catch {}

    // iOS (Chrome / Safari WebKit) 向け Web Speech API アンロック
    if ("speechSynthesis" in window) {
      try {
        const u = new SpeechSynthesisUtterance("");
        u.volume = 0;
        u.rate = 2;
        window.speechSynthesis.speak(u);
      } catch {}
    }
  };

  window.addEventListener("click", unlockAudioAndSpeech, { once: true });
  window.addEventListener("touchstart", unlockAudioAndSpeech, { once: true });
}

function playIpponVoice() {
  try {
    const a = audio();
    if (a.state === "suspended") {
      a.resume().catch(() => {});
    }

    if (ipponAudioBuffer) {
      // 事前加工済みのWAVをAudioBufferSourceNodeで等倍再生
      // iOS / Android / PC 全ての環境でブラウザ依存なく100%同一の音質・ピッチで再生される
      const source = a.createBufferSource();
      source.buffer = ipponAudioBuffer;
      const gainNode = a.createGain();
      gainNode.gain.setValueAtTime(0.9, a.currentTime);
      source.connect(gainNode).connect(a.destination);
      source.start(a.currentTime);
    } else {
      // まだデコードが完了していない場合のフォールバック再生
      const el = getFallbackIpponAudio();
      el.currentTime = 0;
      el.playbackRate = 1.0;
      el.play().catch((e) => console.warn("playIpponVoice fallback error:", e));
      loadIpponVoice();
    }
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

// ============================================================================
// UI Icons (Premium Vector Icons)
// ============================================================================
function DiceIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="16" cy="8" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="8" cy="16" r="1.4" fill="currentColor" />
      <circle cx="16" cy="16" r="1.4" fill="currentColor" />
    </svg>
  );
}

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2.5" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function EnterArenaIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" opacity="0.25" />
      <path d="M5 3l14 9-14 9V3z" />
      <path d="M12 7l5 5-5 5" />
    </svg>
  );
}

function MicIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function CloseIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}


function AlertIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function PlayIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function ExitIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function GrandPrixLogo({
  onClick,
  className = "join-logo-svg",
}: {
  onClick?: () => void;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 520 250"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="AI-PPON GRAND PRIX"
      onClick={onClick}
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
  );
}


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

function checkIsDiscord(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.has("frame_id") ||
    window.location.host.includes("discordsays.com")
  );
}

const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || "";

export default function App() {
  const [screen, setScreen] = useState<"join" | "game">("join");
  const [roomPhase, setRoomPhase] = useState<
    "waiting" | "theme" | "transition" | "match_win"
  >("waiting");
  const arenaRef = useArenaViewport(screen === "game" && roomPhase !== "waiting");
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
    if (checkIsDiscord()) return ""; // Discord Activity では SDK が DSC-{channelId} を設定する
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room")?.trim();
    if (roomFromUrl) return roomFromUrl;
    return generateRoomId();
  });
  const [toast, setToast] = useState<string | null>(null);
  const [copiedRoomUrl, setCopiedRoomUrl] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Discord Activities 連携ステート
  const [isDiscord, setIsDiscord] = useState<boolean>(() => checkIsDiscord());
  const [discordLoading, setDiscordLoading] = useState<boolean>(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);

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
  const roomIdClickTimesRef = useRef<number[]>([]);

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
      setCopiedRoomUrl(true);
      setTimeout(() => setCopiedRoomUrl(false), 2000);
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

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.cancel();
      } catch {}

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
    targetAvatarUrl?: string,
  ) => {
    const rId = (targetRoomId || roomId || "").trim();
    const pName = (targetName || name || "").trim();
    if (!pName || !rId) return;

    // URLのパラメータを更新 (Discord Activity 内では URL を書き換えない)
    if (!checkIsDiscord()) {
      const newUrl = `${window.location.pathname}?room=${encodeURIComponent(rId)}`;
      window.history.replaceState({}, "", newUrl);
    }

    const pidToUse =
      targetPid ||
      myPlayerId ||
      localStorage.getItem("aippon_player_id") ||
      localStorage.getItem("oogiri_player_id");
    const avatarToUse =
      targetAvatarUrl !== undefined ? targetAvatarUrl : myAvatarUrl;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const queryParts = [];
    if (pidToUse) queryParts.push(`player_id=${encodeURIComponent(pidToUse)}`);
    if (ttsUnlocked) queryParts.push(`enable_tts=true`);
    if (avatarToUse)
      queryParts.push(`avatar_url=${encodeURIComponent(avatarToUse)}`);
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
        case "TTS_TOGGLED":
          setRoomTtsEnabled(Boolean(m.tts_enabled));
          if (m.tts_enabled) {
            sfx.unlock();
            showToast("🎙️ AIナレーションがONになりました！");
          } else {
            showToast("🔇 AIナレーションがOFFになりました");
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
    if (checkIsDiscord()) return; // Discord Activity 内は SDK による自動接続に任せる

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
  const toggleTts = () => {
    wsRef.current?.send(JSON.stringify({ type: "TOGGLE_TTS" }));
  };
  // 隠し要素: 部屋IDを5回連続クリックでナレーション切り替え
  const handleRoomIdClick = () => {
    const now = Date.now();
    const recent = [
      ...roomIdClickTimesRef.current.filter((t) => now - t < 2000),
      now,
    ];
    roomIdClickTimesRef.current = recent;
    if (recent.length >= 5) {
      roomIdClickTimesRef.current = [];
      toggleTts();
    }
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
  // Discord Activity 初期化・自動認証フロー
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!checkIsDiscord()) {
      // 通常ブラウザアクセス: 何もしない (手動ロビー画面を表示)
      return;
    }

    setIsDiscord(true);
    let isMounted = true;

    const initDiscord = async () => {
      try {
        setDiscordLoading(true);

        // 1. Client ID の解決 (Vite環境変数 -> /api/config -> ハードコードフォールバック)
        let clientId = DISCORD_CLIENT_ID;
        if (!clientId) {
          try {
            const cfgRes = await fetch("/api/config");
            if (cfgRes.ok) {
              const cfg = await cfgRes.json();
              clientId = cfg.discord_client_id || "";
            }
          } catch (e) {
            console.warn("[Discord SDK] Failed to fetch /api/config:", e);
          }
        }
        if (!clientId) {
          clientId = "1551072987417944104";
        }

        console.log("[Discord SDK] Starting initialization with Client ID:", clientId);
        const discordSdk = new DiscordSDK(clientId);
        await discordSdk.ready();
        console.log(
          "[Discord SDK] ready() resolved. Channel ID:",
          discordSdk.channelId,
          "Instance ID:",
          discordSdk.instanceId,
        );

        // 2. 認可コード取得
        const { code } = await discordSdk.commands.authorize({
          client_id: clientId,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify", "guilds"],
        });
        console.log("[Discord SDK] Authorize success, code acquired");

        // 3. バックエンドで access_token と交換
        const tokenRes = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        if (!tokenRes.ok) {
          const errDetail = await tokenRes.text();
          throw new Error(`トークン交換失敗 (${tokenRes.status}): ${errDetail}`);
        }

        const { access_token } = await tokenRes.json();
        console.log("[Discord SDK] Access token exchanged successfully");

        // 4. SDK 認証
        const auth = await discordSdk.commands.authenticate({ access_token });
        if (!isMounted) return;

        console.log("[Discord SDK] Authenticated as user:", auth.user);
        const user = auth.user;
        const displayName = user.global_name || user.username || "名無し";
        let avatarUrl = "";
        if (user.avatar) {
          avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
        } else {
          try {
            const defaultIdx = Number((BigInt(user.id) >> 22n) % 6n);
            avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
          } catch {
            avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
          }
        }

        // 5. 部屋ID: ボイスチャンネルID優先 (DSC-${channelId})
        const channelId =
          discordSdk.channelId || discordSdk.instanceId || "voice";
        const discordRoomId = `DSC-${channelId}`;

        console.log(
          `[Discord SDK] Auto-joining room: ${discordRoomId}, player: ${displayName}, avatar: ${avatarUrl}`,
        );

        setName(displayName);
        setRoomId(discordRoomId);
        setMyAvatarUrl(avatarUrl);

        // 6. 自動接続
        connect(discordRoomId, displayName, user.id, avatarUrl);
      } catch (err: any) {
        console.error("[Discord SDK Error]", err);
        if (isMounted) {
          setDiscordError(`Discord連携エラー: ${err.message || err}`);
        }
      } finally {
        if (isMounted) {
          setDiscordLoading(false);
        }
      }
    };

    initDiscord();
    return () => {
      isMounted = false;
    };
  }, []);

  // --------------------------------------------------------------------------
  // Join Screen
  // --------------------------------------------------------------------------
  if (screen === "join") {
    if (discordLoading) {
      return (
        <div className="join-container">
          <div className="join-inner">
            <div className="discord-loading-card">
              <div className="discord-loading-spinner" />
              <h2 className="discord-loading-title">Discord 連携中...</h2>
              <p className="discord-loading-desc">
                チャンネル情報とアカウントを確認しています
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="join-container">
        <div className="join-inner">
          {discordError && (
            <div className="discord-error-banner">
              <AlertIcon className="banner-alert-icon" />
              <span>{discordError}</span>
            </div>
          )}
          {/* 画像の色合い・質感を完全再現したベクタータイトルロゴ (5回連続タップでナレーション解禁) */}
          <div
            className="join-logo-wrapper"
            aria-label="AI-PPON GRAND PRIX"
            title="AI-PPON GRAND PRIX"
          >
            <GrandPrixLogo
              className="join-logo-svg"
              onClick={handleLogoClick}
            />
          </div>


          {/* 隠しアンロック状態のインジケーター */}
          {ttsUnlocked && (
            <div className="narration-unlocked-badge">
              <span className="narration-unlocked-text">
                <MicIcon className="narration-badge-icon" />
                <span>NARRATION MODE (AI-TTS) ACTIVE</span>
              </span>
              <button
                type="button"
                onClick={handleDisableNarration}
                className="narration-disable-btn"
                title="ナレーションモードを解除"
              >
                <CloseIcon />
                <span>解除</span>
              </button>
            </div>
          )}

          {/* 参加登録カード (洗練されたプロダクトUI) */}
          <div className="join-card">
            <div className="join-card-header">
              <h2 className="join-card-title">プレイヤーエントリー</h2>
              <p className="join-card-desc">名前を入力して対戦アリーナに入場してください</p>
            </div>

            <div className="join-form">
              <div className="join-field">
                <label htmlFor="player-name" className="join-field-label">
                  プレイヤー名
                </label>
                <div className="join-input-wrapper">
                  <input
                    id="player-name"
                    className="join-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && connect()}
                    aria-label="プレイヤー名"
                    autoComplete="off"
                    autoFocus
                    maxLength={20}
                  />
                </div>
              </div>

              <div className="join-field">
                <label htmlFor="room-id" className="join-field-label">
                  対戦ルームID
                </label>
                <div className="room-input-group">
                  <input
                    id="room-id"
                    className="join-input room-input"
                    placeholder="例: ABC123"
                    value={roomId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRoomId(val);
                      const newUrl = `${window.location.pathname}?room=${encodeURIComponent(val)}`;
                      window.history.replaceState({}, "", newUrl);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && connect()}
                    aria-label="対戦ルームID"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn-random-room"
                    onClick={regenerateRoomId}
                    title="ランダムな部屋IDを再生成"
                  >
                    <DiceIcon className="btn-action-icon" />
                    <span>再生成</span>
                  </button>
                </div>
              </div>

              <div className="join-submit-container">
                <button
                  type="button"
                  className="join-submit-btn"
                  onClick={() => connect()}
                  disabled={!name.trim()}
                  aria-label="アリーナに入場する"
                >
                  <span className="join-btn-text">アリーナに入場する</span>
                  <EnterArenaIcon className="join-btn-arrow-icon" />
                </button>
              </div>
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
    <div className="arena-container" ref={arenaRef}>
      {roomPhase === "waiting" ? (
        <div className="waiting-room-container">
          <div className="waiting-room-inner">
            <div className="waiting-logo-wrapper" aria-label="AI-PPON GRAND PRIX">
              <GrandPrixLogo className="waiting-logo-svg" />
            </div>

            <div className="waiting-card">
              <div className="waiting-card-header">
                {roomTtsEnabled && (
                  <div className="waiting-tag-row">
                    <span className="waiting-tts-badge">
                      <MicIcon />
                      <span>AIナレーション</span>
                    </span>
                  </div>
                )}
                <h1 className="waiting-card-title">参加者を待っています</h1>
                <p className="waiting-desc">
                  メンバーが集まったら「ゲームを開始する」を押してください
                </p>
              </div>

              <div className="waiting-share-bar">
                <div className="waiting-share-info">
                  <span className="waiting-share-label">ルームID</span>
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                  <span
                    className="waiting-share-id"
                    onClick={handleRoomIdClick}
                    style={{ userSelect: "none" }}
                    title="クリックして部屋URLをコピー"
                  >
                    {roomId}
                  </span>
                </div>
                {!isDiscord && (
                  <button
                    type="button"
                    className={`btn-waiting-copy ${copiedRoomUrl ? "is-copied" : ""}`}
                    onClick={() => copyRoomUrl()}
                  >
                    {copiedRoomUrl ? (
                      <>
                        <CheckIcon className="btn-action-icon" />
                        <span>コピー完了</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon className="btn-action-icon" />
                        <span>招待URLをコピー</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="waiting-players-section">
                <div className="waiting-players-header">
                  <span className="waiting-players-label">参加者リスト</span>
                  <span className="waiting-players-count">
                    <strong>{players.length}</strong> 名
                  </span>
                </div>
                <div className="waiting-players-grid">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className={`waiting-player-chip ${p.id === myPlayerId ? "is-me" : ""}`}
                    >
                      <div className="waiting-player-avatar">
                        {p.avatar_url ? (
                          <img
                            src={p.avatar_url}
                            alt={p.name}
                            className="waiting-player-avatar-img"
                          />
                        ) : (
                          p.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <span className="waiting-player-name">{p.name}</span>
                      {p.id === myPlayerId && (
                        <span className="waiting-player-me-tag">あなた</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="waiting-actions">
                <button
                  type="button"
                  className="waiting-start-btn"
                  onClick={startGame}
                >
                  <PlayIcon className="waiting-start-btn-icon" />
                  <span className="waiting-start-btn-text">ゲームを開始する</span>
                </button>
                {!isDiscord && (
                  <button
                    type="button"
                    className="waiting-leave-btn"
                    onClick={leaveRoom}
                  >
                    <ExitIcon className="waiting-leave-btn-icon" />
                    <span>退出する</span>
                  </button>
                )}
              </div>
            </div>

            <footer className="waiting-page-footer">
              <div className="waiting-copyright">
                &copy; 2026 AI-PPON GRAND PRIX
              </div>
            </footer>
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

                  <div className="themeStage__hudRight">
                    <div className="themeStage__roomMeta">
                      {!isDiscord ? (
                        <button
                          type="button"
                          className={`themeStage__roomIdBtn ${copiedRoomUrl ? "is-copied" : ""}`}
                          onClick={() => copyRoomUrl()}
                          title="クリックして部屋URLをコピー"
                        >
                          <span>{roomId}</span>
                          {copiedRoomUrl ? (
                            <CheckIcon className="themeStage__roomIdIcon" />
                          ) : (
                            <CopyIcon className="themeStage__roomIdIcon" />
                          )}
                        </button>
                      ) : (
                        <span className="themeStage__roomIdTag">{roomId}</span>
                      )}
                      {!isDiscord && (
                        <button
                          type="button"
                          className="themeStage__leaveBtn"
                          onClick={leaveRoom}
                          title="部屋から退出"
                        >
                          <ExitIcon className="themeStage__leaveBtnIcon" />
                          <span>退出</span>
                        </button>
                      )}
                    </div>

                    <div className="themeStage__controls">
                      <button
                        type="button"
                        className={`themeStage__timer ${isTimerPaused ? "themeStage__timer--paused" : ""}`}
                        onClick={toggleTimer}
                        title={isTimerPaused ? "タイマーを再開" : "タイマーを一時停止"}
                        aria-label={`残り時間 ${formatTime(remaining)} ${isTimerPaused ? "（停止中・クリックで再開）" : "（クリックで一時停止）"}`}
                      >
                        <span
                          className="themeStage__timerIcon"
                          aria-hidden="true"
                        >
                          {isTimerPaused ? "▶" : "⏸"}
                        </span>
                        <span>{formatTime(remaining)}</span>
                        {isTimerPaused && (
                          <span className="themeStage__timerPausedTag">
                            停止中
                          </span>
                        )}
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
                  <div className="answerArea__player-wrapper">
                    {(() => {
                      const pObj = players.find(
                        (pl) => pl.name === judging.player,
                      );
                      if (pObj?.avatar_url) {
                        return (
                          <img
                            src={pObj.avatar_url}
                            alt={judging.player}
                            className="answerArea__avatar-img"
                          />
                        );
                      }
                      return null;
                    })()}
                    <div className="answerArea__player">
                      {judging.player} の回答
                    </div>
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
                  <div className="player-score-identity">
                    <div className="player-mini-avatar">
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt={p.name}
                          className="player-mini-avatar-img"
                        />
                      ) : (
                        <span>{p.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <span className="player-name">{p.name}</span>
                  </div>
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

            {/* Input & Feed */}
            <section className="feed-section">
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

              <div className="feed-list" role="log" aria-live="polite">
                {feed.map((f) => (
                  <div key={f.key} className={`feed-bubble ${f.kind}`}>
                    {f.text}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {/* 3. Match Winner Overlay */}
      {winner &&
        (() => {
          const winPlayer = players.find((pl) => pl.name === winner);
          return (
            <div className="overlay" role="dialog" aria-modal="true">
              <div className="reveal-card">
                {winPlayer?.avatar_url && (
                  <div className="winner-avatar-container">
                    <img
                      src={winPlayer.avatar_url}
                      alt={winner}
                      className="winner-avatar-img"
                    />
                  </div>
                )}
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
          );
        })()}

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
