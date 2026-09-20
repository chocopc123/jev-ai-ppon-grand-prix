import React, { useState, useRef } from "react";
import {
  DefaultArenaFrame,
  JudgmentFrameMeter,
  sfx,
} from "./App";
import "./App.css";

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
  conf: number;  // 0.0 ~ 1.0 (確信度)
  pass: boolean; // 合格/点灯 (1点 or 0点)
}

const DEFAULT_CRITERIA: CriterionItem[] = [
  { id: "on_topic", name: "お題適合", description: "お題のフリや世界観を上手く料理しているか", conf: 1.0, pass: true },
  { id: "punchline", name: "オチの鮮やかさ", description: "意外性のあるオチや裏切り・ボケどころがあるか", conf: 1.0, pass: true },
  { id: "novelty", name: "発想の独自性", description: "誰も思いつかない斬新・奇抜・シュールな視点か", conf: 1.0, pass: true },
  { id: "comprehensible", name: "情景描写・共感", description: "頭に絵がスッと浮かび、「あるある」と共感できるか", conf: 1.0, pass: true },
  { id: "conciseness", name: "言葉のキレ・語感", description: "無駄がなく短く研ぎ澄まされ、語感が抜群か", conf: 1.0, pass: true },
  { id: "cliche", name: "脱ベタ・新鮮さ", description: "手垢のついたベタや安易な下ネタではないか", conf: 1.0, pass: true },
  { id: "gut_funny", name: "直感的な面白さ", description: "理屈抜きで思わず吹き出す破壊力・笑いがあるか", conf: 1.0, pass: true },
  { id: "peak", name: "突出したキレ味", description: "どれか1つの要素が圧倒的に突出しているか", conf: 1.0, pass: true },
  { id: "structure", name: "構成・完成度", description: "お題適合・オチ・情景の全体の調和と完成度", conf: 1.0, pass: true },
  { id: "impact", name: "総合インパクト", description: "会場を揺らす決め手・IPPONの決定打があるか", conf: 1.0, pass: true },
];

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

  // 合計点数 (合格項目の個数 = 0〜10点)
  const totalScore = criteria.filter((c) => c.pass).length;

  // 本家バックエンド（jev_client.py）と同一ロジック (案2: 電光石火仕様):
  // 1. 確信度が高い順（降順）にソート
  // 2. 確信度1.0なら遅延0ms、最低遅延ゼロ: max(0, (1 - conf) * 250)
  const calculateTimeline = (currentCriteria: CriterionItem[]) => {
    // 確信度が高い順にソート
    const sorted = [...currentCriteria].sort((a, b) => b.conf - a.conf);

    const timeline = sorted.map((c) => {
      const delay = Math.max(0, Math.floor((1.0 - c.conf) * 250));
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

  // 案2: 電光石火 80ms間隔でタタタタッと点灯
  const getFrameStepDelay = (_score: number): number => {
    return 80;
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

  const toggleCriterionPass = (id: string) => {
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pass: !c.pass } : c))
    );
  };

  const updateCriterionConf = (id: string, conf: number) => {
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, conf } : c))
    );
  };

  const applyPreset = (presetType: "allMax" | "fastIppon" | "slowIppon" | "miss9" | "miss7" | "miss5") => {
    let newItems: CriterionItem[];
    switch (presetType) {
      case "allMax":
        // 全10項目満点＆確度1.0 (ノンストップIPPON)
        newItems = criteria.map((c) => ({ ...c, pass: true, conf: 1.0 }));
        break;
      case "fastIppon":
        // 全10項目高確度IPPON
        newItems = criteria.map((c, i) => ({
          ...c,
          pass: true,
          conf: Math.max(0.7, 1.0 - i * 0.03),
        }));
        break;
      case "slowIppon":
        // 迷いながらもギリギリ全10項目クリア
        newItems = criteria.map((c, i) => ({
          ...c,
          pass: true,
          conf: Math.max(0.1, 0.9 - i * 0.09),
        }));
        break;
      case "miss9":
        // 9点惜しい！不成立（「脱ベタ」項目だけ落とす）
        newItems = criteria.map((c) =>
          c.id === "cliche"
            ? { ...c, pass: false, conf: 0.15 }
            : { ...c, pass: true, conf: 0.85 }
        );
        break;
      case "miss7":
        // 7点不成立（3項目落とす）
        newItems = criteria.map((c) =>
          ["cliche", "novelty", "conciseness"].includes(c.id)
            ? { ...c, pass: false, conf: 0.3 }
            : { ...c, pass: true, conf: 0.75 }
        );
        break;
      case "miss5":
        // 5点不成立（半分合格）
        newItems = criteria.map((c, i) => ({
          ...c,
          pass: i < 5,
          conf: i < 5 ? 0.7 : 0.25,
        }));
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

  const { sorted: sortedCriteria, timeline: currentTimeline } = calculateTimeline(criteria);
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
      <div style={{ display: "grid", gridTemplateColumns: "480px 1fr", flex: 1, minHeight: 0 }}>
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

          {/* 10項目の評価基準リスト（確度が高い順に自動整列） */}
          <div style={{ background: "#161b22", padding: "12px", borderRadius: "8px", border: "1px solid #30363d" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
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
              確信度が高い項目から順に1本ずつバラバラに点灯します。
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {criteria.map((c, fixedIdx) => {
                // 点灯順（確信度降順での順位）を計算
                const order = sortedCriteria.findIndex((sc) => sc.id === c.id);
                const delayMs = Math.max(0, Math.floor((1.0 - c.conf) * 250));
                const isCurrentlyActive = activeItemName === c.name;

                return (
                  <div
                    key={c.id}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "6px",
                      background: isCurrentlyActive ? "#1f6feb22" : "#21262d",
                      border: isCurrentlyActive ? "1px solid #58a6ff" : "1px solid #30363d",
                      transition: "background 0.2s",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
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

                      {/* 合格（点灯）/ 不合格（不点灯）切り替え */}
                      <button
                        onClick={() => toggleCriterionPass(c.id)}
                        disabled={isAnimating}
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontWeight: "bold",
                          borderRadius: "4px",
                          border: "none",
                          cursor: isAnimating ? "not-allowed" : "pointer",
                          background: c.pass ? "#238636" : "#30363d",
                          color: c.pass ? "#fff" : "#8b949e",
                        }}
                      >
                        {c.pass ? "✔ 1点 点灯" : "✕ 0点"}
                      </button>
                    </div>

                    {/* 確信度スライダー */}
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                      <span style={{ fontSize: "10px", color: "#8b949e", width: "36px" }}>確度</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={c.conf}
                        disabled={isAnimating}
                        onChange={(e) => updateCriterionConf(c.id, parseFloat(e.target.value))}
                        style={{ flex: 1, accentColor: "#ffd200", height: "4px" }}
                      />
                      <span style={{ fontSize: "10px", fontFamily: "monospace", width: "28px", textAlign: "right", color: "#ffd200" }}>
                        {c.conf.toFixed(2)}
                      </span>
                      <span style={{ fontSize: "10px", color: "#7ee787", width: "42px", textAlign: "right" }}>
                        {delayMs}ms
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
