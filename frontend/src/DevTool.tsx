import React, { useState, useRef } from "react";
import {
  DefaultArenaFrame,
  JudgmentFrameMeter,
  sfx,
} from "./App";
import "./App.css";
import scoringConfig from "../../scoring_config.json";

// バックエンド（jev_client.py）と完全同一の遅延計算関数
export function calcItemDelay(conf: number, pass: boolean): number {
  if (!pass) {
    return Number(scoringConfig.fail_delay_ms ?? 300);
  }
  const scale = Number(scoringConfig.delay_scale_ms ?? 1000);
  return Math.max(0, Math.floor((1.0 - conf) * scale));
}

// ローカル環境かどうかを判定
export function isLocalEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const isDev = Boolean(import.meta.env.DEV);
  const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]";
  return isDev || isLocalHost;
}

export interface CriterionItem {
  id: string;
  name: string;
  description: string;
  threshold: number; // 点灯閾値 (例: 0.50, 0.65 など)
  conf: number;      // 0.0 ~ 1.0 (確信度)
  pass: boolean;     // 確信度 >= 閾値 で自動計算
}

// scoring_config.json から基準定義を読み込み
const DEFAULT_CRITERIA: CriterionItem[] = scoringConfig.criteria.map((c) => ({
  id: c.id,
  name: c.name,
  description: c.description,
  threshold: c.threshold,
  conf: 1.0,
  pass: true,
}));

export const DevTool: React.FC = () => {
  const [litFrames, setLitFrames] = useState<number>(0);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [isDone, setIsDone] = useState<boolean>(false);
  const [isIppon, setIsIppon] = useState<boolean>(false);
  const [currentItemIndex, setCurrentItemIndex] = useState<number | null>(null);

  const [playerName, setPlayerName] = useState<string>("テスト回答者");
  const [answerText, setAnswerText] = useState<string>("写真で一言：ここに面白い回答が入ります");
  const [autoReset, setAutoReset] = useState<boolean>(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1.0);

  // 10項目の評価基準
  const [criteria, setCriteria] = useState<CriterionItem[]>(DEFAULT_CRITERIA);

  const abortControllerRef = useRef<boolean>(false);

  const wait = (ms: number) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (abortControllerRef.current) {
        clearTimeout(timer);
        resolve(null);
      }
    });

  // 合計点数 (自動判定 pass が true の項目数 = 0〜10点)
  const totalScore = criteria.filter((c) => c.pass).length;

  // 本家バックエンド（jev_client.py）と同一ロジック:
  // 1. 確信度が高い順（降順）にソート
  // 2. calcItemDelay で一元計算
  const calculateTimeline = (currentCriteria: CriterionItem[]) => {
    // 確信度が高い順にソート
    const sorted = [...currentCriteria].sort((a, b) => b.conf - a.conf);

    const timeline = sorted.map((c) => {
      const delay = calcItemDelay(c.conf, c.pass);
      return {
        judge: c.name,
        score: c.pass ? 1 : 0,
        delay_ms: delay,
        conf: c.conf,
        pass: c.pass,
      };
    });

    return { sorted, timeline };
  };

  // scoring_config.json の frame_step_ms を使用
  const getFrameStepDelay = (_score: number): number => {
    return Number(scoringConfig.frame_step_ms ?? 80);
  };

  const stopAnimation = () => {
    abortControllerRef.current = true;
    setIsAnimating(false);
    setCurrentItemIndex(null);
  };

  const runSimulation = async (itemsToRun = criteria) => {
    abortControllerRef.current = false;
    setIsAnimating(true);
    setIsDone(false);
    setIsIppon(false);
    setLitFrames(0);
    setCurrentItemIndex(null);

    const { timeline } = calculateTimeline(itemsToRun);
    const targetTotal = itemsToRun.filter((c) => c.pass).length;
    const isTargetIppon = targetTotal === 10;

    // フリップ表示前の間 (案2: 50ms)
    await wait(50 * speedMultiplier);

    let scoreSoFar = 0;

    for (let i = 0; i < timeline.length; i++) {
      if (abortControllerRef.current) return;
      setCurrentItemIndex(i);
      const item = timeline[i];

      // Jev確信度連動ディレイ（確度が高い項目から即決）
      await wait(item.delay_ms * speedMultiplier);

      // 点灯 (1点獲得していれば1本点灯)
      if (item.score > 0) {
        if (abortControllerRef.current) return;
        scoreSoFar += 1;
        const cur = scoreSoFar;
        setLitFrames(cur);
        sfx.frameStep(cur);

        if (cur === 10 && isTargetIppon) {
          setIsIppon(true);
          setIsDone(true);
          setIsAnimating(false);
          setCurrentItemIndex(null);
          sfx.fanfare();
          return;
        }

        await wait(getFrameStepDelay(cur) * speedMultiplier);
      }
    }

    if (abortControllerRef.current) return;
    setCurrentItemIndex(null);
    await wait(450 * speedMultiplier);

    // 10点未満（不成立）
    sfx.shakin();
    setIsDone(true);
    setIsIppon(false);
    setIsAnimating(false);

    if (autoReset) {
      await wait(2600);
      if (!abortControllerRef.current) {
        setIsDone(false);
        setLitFrames(0);
      }
    }
  };

  // 確信度変更時に「確度 >= 閾値」で自動的に pass (点灯/非点灯) を判定
  const updateCriterionConf = (id: string, conf: number) => {
    setCriteria((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const pass = conf >= c.threshold;
        return { ...c, conf, pass };
      })
    );
  };

  const applyPreset = (presetType: "allMax" | "fastIppon" | "slowIppon" | "miss9" | "miss7" | "miss5") => {
    let newItems: CriterionItem[];
    switch (presetType) {
      case "allMax":
        // 全10項目満点＆確度1.0 (ノンストップIPPON)
        newItems = criteria.map((c) => ({ ...c, conf: 1.0, pass: true }));
        break;
      case "fastIppon":
        // 全10項目高確度IPPON (すべて閾値超え)
        newItems = criteria.map((c, i) => {
          const conf = Math.max(c.threshold + 0.15, 1.0 - i * 0.03);
          return { ...c, conf, pass: true };
        });
        break;
      case "slowIppon":
        // 迷いながらもギリギリ全10項目クリア (閾値すれすれ)
        newItems = criteria.map((c) => {
          const conf = Number((c.threshold + 0.05).toFixed(2));
          return { ...c, conf, pass: true };
        });
        break;
      case "miss9":
        // 9点惜しい！不成立（「脱ベタ」だけ閾値0.50未満に落とす）
        newItems = criteria.map((c) => {
          const conf = c.id === "cliche" ? 0.35 : 0.85;
          return { ...c, conf, pass: conf >= c.threshold };
        });
        break;
      case "miss7":
        // 7点不成立（3項目落とす）
        newItems = criteria.map((c) => {
          const conf = ["cliche", "novelty", "conciseness"].includes(c.id) ? 0.30 : 0.80;
          return { ...c, conf, pass: conf >= c.threshold };
        });
        break;
      case "miss5":
        // 5点不成立（半分合格）
        newItems = criteria.map((c, i) => {
          const conf = i < 5 ? 0.75 : 0.25;
          return { ...c, conf, pass: conf >= c.threshold };
        });
        break;
    }
    setCriteria(newItems);
    runSimulation(newItems);
  };

  const getAnswerSizeClass = (text: string): string => {
    const len = text.trim().length;
    if (len <= 14) return "answerFlip__text--short";
    if (len <= 28) return "answerFlip__text--medium";
    if (len <= 50) return "answerFlip__text--long";
    if (len <= 80) return "answerFlip__text--xlarge";
    return "answerFlip__text--xxlarge";
  };

  const { sorted: sortedCriteria } = calculateTimeline(criteria);
  const activeItemName = currentItemIndex !== null && sortedCriteria[currentItemIndex] ? sortedCriteria[currentItemIndex].name : null;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0b0c10", color: "#fff", display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
      {/* ヘッダー */}
      <header
        style={{
          padding: "10px 20px",
          backgroundColor: "#161b22",
          borderBottom: "1px solid #30363d",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ background: "#f85149", color: "#fff", padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold" }}>
            DEV ONLY
          </span>
          <h1 style={{ margin: 0, fontSize: "16px", fontWeight: "bold", color: "#ffd200" }}>
            10項目独立点灯 ＆ Jev確信度 DevTool
          </h1>
        </div>

        <a
          href="/"
          style={{
            color: "#58a6ff",
            textDecoration: "none",
            fontSize: "13px",
            padding: "5px 12px",
            background: "#21262d",
            borderRadius: "6px",
            border: "1px solid #30363d",
          }}
        >
          ← 本番アプリに戻る
        </a>
      </header>

      {/* メインレイアウト */}
      <div style={{ display: "grid", gridTemplateColumns: "500px 1fr", flex: 1, minHeight: 0 }}>
        {/* 左側コントロールパネル */}
        <aside
          style={{
            backgroundColor: "#0d1117",
            borderRight: "1px solid #30363d",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            overflowY: "auto",
            maxHeight: "calc(100vh - 55px)",
          }}
        >
          {/* ワンクリックプリセット */}
          <div>
            <div style={{ fontSize: "13px", color: "#8b949e", fontWeight: "bold", marginBottom: "8px" }}>
              ⚡ 演出シナリオプリセット
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <button
                onClick={() => applyPreset("allMax")}
                disabled={isAnimating}
                style={{
                  gridColumn: "span 2",
                  padding: "9px 6px",
                  background: "#238636",
                  color: "#fff",
                  border: "1px solid #3fb950",
                  borderRadius: "6px",
                  cursor: isAnimating ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: "bold",
                  boxShadow: "0 0 10px rgba(63, 185, 80, 0.3)",
                }}
              >
                ✨ 10項目全点灯 (ノンストップIPPON!)
              </button>
              <button
                onClick={() => applyPreset("fastIppon")}
                disabled={isAnimating}
                style={{
                  padding: "8px 6px",
                  background: "#1f6feb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isAnimating ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                🚀 高確度 IPPON
              </button>
              <button
                onClick={() => applyPreset("slowIppon")}
                disabled={isAnimating}
                style={{
                  padding: "8px 6px",
                  background: "#d29922",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isAnimating ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                🐢 迷いながら IPPON
              </button>
              <button
                onClick={() => applyPreset("miss9")}
                disabled={isAnimating}
                style={{
                  padding: "8px 6px",
                  background: "#8957e5",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isAnimating ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                😱 9点 惜しい不成立
              </button>
              <button
                onClick={() => applyPreset("miss7")}
                disabled={isAnimating}
                style={{
                  padding: "8px 6px",
                  background: "#da3633",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isAnimating ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                ❌ 7点 不成立
              </button>
            </div>
          </div>

          {/* 10項目の評価基準リスト（固定順表示、閾値インジケーター付き） */}
          <div style={{ background: "#161b22", padding: "12px", borderRadius: "8px", border: "1px solid #30363d" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: "bold", color: "#ffd200" }}>
                💡 10評価項目 (合計: {totalScore} / 10点)
              </span>
              <button
                onClick={() => runSimulation()}
                disabled={isAnimating}
                style={{
                  padding: "4px 12px",
                  background: isAnimating ? "#30363d" : "#238636",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isAnimating ? "not-allowed" : "pointer",
                  fontWeight: "bold",
                  fontSize: "12px",
                }}
              >
                ▶ 再生
              </button>
            </div>
            <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "10px" }}>
              スライダーを閾値（赤▼）以上に動かすと自動で点灯（1点）になります。
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {criteria.map((c, fixedIdx) => {
                const order = sortedCriteria.findIndex((sc) => sc.id === c.id);
                const delayMs = calcItemDelay(c.conf, c.pass);
                const isCurrentlyActive = activeItemName === c.name;
                const thresholdPercent = c.threshold * 100;

                return (
                  <div
                    key={c.id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "6px",
                      background: isCurrentlyActive ? "#1f6feb22" : "#21262d",
                      border: isCurrentlyActive ? "1px solid #58a6ff" : "1px solid #30363d",
                      transition: "background 0.2s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "#8b949e", fontSize: "11px", width: "16px" }}>
                          {fixedIdx + 1}.
                        </span>
                        <span style={{ fontSize: "12px", fontWeight: "bold", color: isCurrentlyActive ? "#58a6ff" : "#c9d1d9" }}>
                          {c.name}
                        </span>
                        <span
                          style={{
                            fontSize: "10px",
                            background: "rgba(255, 210, 0, 0.15)",
                            color: "#ffd200",
                            padding: "1px 5px",
                            borderRadius: "3px",
                            border: "1px solid rgba(255, 210, 0, 0.3)",
                          }}
                          title="確信度順による点灯順番"
                        >
                          点灯 #{order + 1}
                        </span>
                      </div>

                      {/* 点灯・非点灯ステータスバッジ（確信度により自動制御） */}
                      <span
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontWeight: "bold",
                          borderRadius: "4px",
                          background: c.pass ? "#238636" : "#30363d",
                          color: c.pass ? "#fff" : "#8b949e",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {c.pass ? "✔ 点灯 (1点)" : "✕ 消灯 (0点)"}
                      </span>
                    </div>

                    {/* スライダーと閾値目印 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                      <span style={{ fontSize: "10px", color: "#8b949e", width: "24px" }}>確度</span>
                      
                      {/* スライダー＋目印コンテナ */}
                      <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={c.conf}
                          disabled={isAnimating}
                          onChange={(e) => updateCriterionConf(c.id, parseFloat(e.target.value))}
                          style={{
                            width: "100%",
                            accentColor: c.pass ? "#ffd200" : "#8b949e",
                            height: "6px",
                            cursor: isAnimating ? "not-allowed" : "pointer",
                          }}
                        />

                        {/* 閾値の目印ライン＆▼マーカー */}
                        <div
                          style={{
                            position: "absolute",
                            left: `${thresholdPercent}%`,
                            top: "50%",
                            transform: "translate(-50%, -50%)",
                            pointerEvents: "none",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            height: "18px",
                            zIndex: 2,
                          }}
                          title={`点灯閾値: ${c.threshold.toFixed(2)} 以上で点灯`}
                        >
                          {/* 赤い三角マーカー */}
                          <div
                            style={{
                              width: 0,
                              height: 0,
                              borderLeft: "4px solid transparent",
                              borderRight: "4px solid transparent",
                              borderTop: "5px solid #f85149",
                              marginBottom: "1px",
                            }}
                          />
                          {/* 垂直バー */}
                          <div style={{ width: "2px", height: "10px", backgroundColor: "#f85149", opacity: 0.9 }} />
                        </div>
                      </div>

                      {/* 確信度数値 */}
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "monospace",
                          width: "32px",
                          textAlign: "right",
                          fontWeight: "bold",
                          color: c.pass ? "#ffd200" : "#8b949e",
                        }}
                      >
                        {c.conf.toFixed(2)}
                      </span>

                      {/* 閾値情報＆遅延ms */}
                      <span style={{ fontSize: "10px", color: "#8b949e", width: "95px", textAlign: "right" }}>
                        (閾値:<strong style={{ color: "#f85149" }}>{c.threshold.toFixed(2)}</strong>/{delayMs}ms)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 再生制御 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: "13px", color: "#8b949e", fontWeight: "bold" }}>
              ⏱️ 再生スピード倍率 (全体スケール)
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              {[
                { label: "1.0x (本番)", val: 1.0 },
                { label: "0.5x (倍速)", val: 0.5 },
                { label: "0.2x (超高速)", val: 0.2 },
                { label: "1.5x (ゆっくり)", val: 1.5 },
              ].map(({ label, val }) => (
                <button
                  key={val}
                  onClick={() => setSpeedMultiplier(val)}
                  style={{
                    flex: 1,
                    padding: "6px 2px",
                    borderRadius: "6px",
                    border: "1px solid #30363d",
                    background: speedMultiplier === val ? "#1f6feb" : "#21262d",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: "11px",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {isAnimating && (
              <button
                onClick={stopAnimation}
                style={{
                  width: "100%",
                  padding: "8px",
                  background: "#da3633",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "13px",
                }}
              >
                演出を即時停止
              </button>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", marginTop: "4px" }}>
              <input
                type="checkbox"
                checked={autoReset}
                onChange={(e) => setAutoReset(e.target.checked)}
              />
              不成立時に2.6秒後自動リセット
            </label>
          </div>

          {/* 回答文テキスト調整 */}
          <div>
            <div style={{ fontSize: "13px", color: "#8b949e", fontWeight: "bold", marginBottom: "6px" }}>
              ✏️ 回答文テスト
            </div>
            <textarea
              rows={2}
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                background: "#161b22",
                border: "1px solid #30363d",
                borderRadius: "6px",
                color: "#c9d1d9",
                boxSizing: "border-box",
                fontSize: "12px",
              }}
            />
          </div>
        </aside>

        {/* 右側演出プレビュー */}
        <main
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background: "radial-gradient(ellipse at center, #151520 0%, #08080c 100%)",
            overflow: "hidden",
          }}
        >
          {/* 現在の演出状況HUD */}
          <div
            style={{
              position: "absolute",
              top: "14px",
              left: "20px",
              fontSize: "12px",
              color: "#8b949e",
              background: "rgba(0,0,0,0.7)",
              border: "1px solid #30363d",
              padding: "6px 12px",
              borderRadius: "6px",
              zIndex: 20,
              pointerEvents: "none",
              display: "flex",
              gap: "14px",
            }}
          >
            <div>
              状態: <strong style={{ color: isDone ? (isIppon ? "#ffd200" : "#ff7b72") : isAnimating ? "#58a6ff" : "#aaa" }}>
                {isAnimating ? "🟡 点灯進行中" : isDone ? (isIppon ? "🌟 IPPON 達成" : "⚪ 不成立終了") : "待機中"}
              </strong>
            </div>
            <div>
              点灯数: <strong style={{ color: "#ffd200" }}>{litFrames}</strong> / 10
            </div>
            <div>
              審査項目: <strong>{currentItemIndex !== null ? `#${currentItemIndex + 1} ${sortedCriteria[currentItemIndex].name}` : "-"}</strong>
            </div>
          </div>

          <div className="arena-screen" style={{ width: "100%", maxWidth: "980px", height: "auto", aspectRatio: "16 / 10" }}>
            <section
              className={`stage stage--answerShown ${isDone && isIppon ? "stage--ipponSuccess" : ""}`}
              style={{ width: "100%", height: "100%", position: "relative" }}
            >
              {/* デフォルトアリーナ外枠 */}
              <DefaultArenaFrame variant="judgment" />

              {/* 採点フレーム (0〜10本) */}
              <JudgmentFrameMeter
                litFrames={litFrames}
                totalFrames={10}
                isIppon={isDone && isIppon}
              />

              {/* 回答エリア */}
              <div className="answerArea">
                <div className="answerArea__player">{playerName} の回答</div>

                {/* 白フリップ */}
                <div className={`answerFlip ${isDone && isIppon ? "answerFlip--ippon" : ""}`}>
                  <p className={`answerFlip__text ${getAnswerSizeClass(answerText)}`}>
                    「{answerText}」
                  </p>
                </div>
              </div>

              {/* IPPON特大バナー */}
              {isDone && isIppon && (
                <div className="ipponBanner">IPPON!</div>
              )}

              {/* 未IPPON時の点数丸バッジ */}
              {isDone && !isIppon && (
                <div className="scoreBadge" aria-label={`得点: ${totalScore}点`}>
                  <span className="scoreBadge__number">{totalScore}</span>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DevTool;
