declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const ANALYTICS_UID_KEY = "aippon_analytics_uid";

/**
 * 永続的なユーザーID（匿名識別子）を取得または生成
 * - localStorage に保存し、Cookie 有効期限切れ（Safari ITP等）後も再訪者として認識できるようにする
 */
export function getOrCreateAnalyticsUserId(): string {
  if (typeof window === "undefined") return "";
  try {
    let uid = localStorage.getItem(ANALYTICS_UID_KEY);
    if (!uid) {
      uid =
        localStorage.getItem("aippon_player_id") ||
        localStorage.getItem("oogiri_player_id") ||
        (typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `usr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(ANALYTICS_UID_KEY, uid);
    }
    return uid;
  } catch {
    return "";
  }
}

/**
 * GA4 に user_id をセット（リピーター・再訪者識別の精度向上）
 */
export function setUserId(userId?: string | null) {
  const uid = userId || getOrCreateAnalyticsUserId();
  if (!uid) return;
  try {
    localStorage.setItem(ANALYTICS_UID_KEY, uid);
  } catch {}

  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    try {
      window.gtag("set", { user_id: uid });
      window.gtag("config", "G-KRD07K2LJE", { user_id: uid });
    } catch (err) {
      console.warn("[Analytics] Failed to set user_id:", err);
    }
  }
}

/**
 * Google Analytics (GA4) カスタムイベント送信用ラッパー
 */
export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  if (typeof window !== "undefined" && typeof window.gtag === "function") {
    try {
      window.gtag("event", eventName, params);
    } catch (err) {
      console.warn("[Analytics] Failed to track event:", eventName, err);
    }
  }
}

export const Analytics = {
  /**
   * 永続ユーザーIDの設定（初回訪問またはDiscord認証時・ルーム参加時）
   */
  setUserId,

  /**
   * ゲーム（対戦・マッチ）開始
   */
  gameStart: (params: {
    roomId: string;
    playerCount: number;
    targetIppon?: number;
    isDiscord?: boolean;
  }) => {
    trackEvent("game_start", {
      room_id: params.roomId,
      player_count: params.playerCount,
      target_ippon: params.targetIppon ?? 3,
      is_discord: Boolean(params.isDiscord),
    });
  },

  /**
   * 回答送信
   */
  answerSubmit: (params: {
    theme: string;
    questionNumber: number;
    answerLength: number;
    roomId?: string;
  }) => {
    trackEvent("answer_submit", {
      theme: params.theme,
      question_number: params.questionNumber,
      answer_length: params.answerLength,
      room_id: params.roomId,
    });
  },

  /**
   * IPPON獲得
   */
  ipponGet: (params: {
    playerName: string;
    theme: string;
    answer: string;
    isSelf: boolean;
    roomId?: string;
  }) => {
    trackEvent("ippon_get", {
      player_name: params.playerName,
      theme: params.theme,
      answer: params.answer,
      is_self: params.isSelf,
      room_id: params.roomId,
    });
  },

  /**
   * 採点結果（全採点対象）
   */
  answerScored: (params: {
    score: number;
    isIppon: boolean;
    playerName: string;
    theme: string;
    isSelf: boolean;
    roomId?: string;
  }) => {
    trackEvent("answer_scored", {
      score: params.score,
      is_ippon: params.isIppon,
      player_name: params.playerName,
      theme: params.theme,
      is_self: params.isSelf,
      room_id: params.roomId,
    });
  },

  /**
   * マッチ終了（優勝者決定）
   */
  gameFinish: (params: {
    winner: string;
    isWinner: boolean;
    targetIppon: number;
    roomId?: string;
  }) => {
    trackEvent("game_finish", {
      winner: params.winner,
      is_winner: params.isWinner,
      target_ippon: params.targetIppon,
      room_id: params.roomId,
    });
  },
};
