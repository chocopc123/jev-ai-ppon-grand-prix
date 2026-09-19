"""
OOGIRI GRAND PRIX Web — Jev (TypeSafe) 判定クライアント

OpenRouter 経由で Jev を呼び出す。
重要: Jev は chat/completions 非対応。専用の /api/alpha/decisions を使う。

OPENROUTER_API_KEY が未設定の場合は決定論的モックにフォールバックするため、
APIキーなしでもローカル開発・演出の調整ができる。

判定設計 (Jevの強みに寄せた構成):
  1. ゲートキーパー  : 採点前の門番 (高頻度・型付き boolean/choice 判断)
  2. 本審査          : 「面白いか」を分解した構造化質問の束 + 総合判断1問
  3. 合成            : 確率から10点満点を組み立てるのはコード側 (プロンプトのブラックボックスにしない)
"""
import hashlib
import os
import random

from dotenv import load_dotenv
import httpx

load_dotenv()

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
JEV_MODEL = os.environ.get("JEV_MODEL", "~typesafe/jev-latest")
DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"

# --- ゲートキーパー (採点前の門番) ---
GATEKEEP_QUESTIONS = {
    "is_on_topic": {
        "type": "noul",
        "instructions": "この回答はお題に対する大喜利の回答として成立しているか？（少し斜め上の発想やシュールなボケも許容し、完全に無関係または意味不明な文字列のみfalse）",
        "criteria": {
            "true": "お題の設定・フリを意識してボケている、または大喜利回答として成立している",
            "false": "お題と全く無関係、または意味不明な記号・文字列"
        }
    },
    "is_offensive": {
        "type": "noul",
        "instructions": "過度に攻撃的、差別的、または不快な表現が含まれているか？",
        "criteria": {
            "true": "深刻な誹謗中傷、差別的ヘイトスピーチ、過度な暴力表現を含む",
            "false": "一般的なコメディ・大喜利表現の許容範囲内である"
        }
    },
    "is_duplicate": {
        "type": "noul",
        "instructions": "直前の過去の回答と実質的に同一・完全重複しているか？",
        "criteria": {
            "true": "直前の回答とほぼ完全に同じネタ・フレーズである",
            "false": "異なる独自の回答である"
        }
    },
    "effort_level": {
        "type": "choice",
        "instructions": "回答の作成意図・工夫の度合いはどの程度か？",
        "criteria": {
            "spam": "無意味なキーボード連打や記号スパム",
            "low": "適当な1文字など極めて手抜きの投稿",
            "genuine": "大喜利としてしっかり考えられたボケ・回答"
        }
    },
}

# --- 本審査 (基準を分解した構造化質問 + 総合判断1問) ---
JUDGE_QUESTIONS = {
    "on_topic": {
        "type": "noul",
        "instructions": "お題のフリやシチュエーションを上手く活かして答えているか？",
        "criteria": {
            "true": "お題の設定や世界観を上手く料理してボケている",
            "false": "お題の設定をほとんど活かせていない"
        }
    },
    "has_punchline": {
        "type": "noul",
        "instructions": "明確なオチ（ツッコミどころ・笑いどころ）が存在するか？",
        "criteria": {
            "true": "意外性のあるオチや鮮やかなボケどころがある",
            "false": "単なる事実の記述や当たり前のことしか言っていない"
        }
    },
    "conciseness": {
        "type": "score",
        "instructions": "言葉の切れ味、テンポ、フレーズの語感の良さはどうか？",
        "criteria": [
            "説明的で冗長、テンポが重い",
            "一般的な文章の長さ",
            "短く切れ味があり、語感・ワードセンスが抜群に良い"
        ]
    },
    "is_cliche": {
        "type": "noul",
        "instructions": "誰でも最初に思いつくような手垢のついたベタなネタか？",
        "criteria": {
            "true": "ベタで定番のありふれたネタ",
            "false": "視点が新しく、定番ではない新鮮なボケ"
        }
    },
    "novelty": {
        "type": "score",
        "instructions": "発想の奇抜さ、独自性、シュールさ、斜め上の視点はあるか？",
        "criteria": [
            "ありきたりで平凡な発想",
            "少しひねりのある面白い発想",
            "誰も思いつかない天才的な切り口、鮮烈なシュールさ、強烈なオリジナリティ"
        ]
    },
    "comprehensible": {
        "type": "noul",
        "instructions": "情景がスッと頭に浮かび、「あるある」「わかる」と共感できるか？",
        "criteria": {
            "true": "絵やシチュエーションが鮮明にイメージでき、共感・納得できる",
            "false": "何を言っているのか意図が伝わりにくい"
        }
    },
    "gut_funny": {
        "type": "noul",
        "instructions": "理屈抜きで直感的に面白い・クスッと笑える破壊力があるか？",
        "criteria": {
            "true": "思わず笑ってしまう、面白い、声が出る",
            "false": "あまり笑えない、ピンとこない"
        }
    },
}

JUDGE_LABELS = ["王道派", "シュール派", "共感派", "勢い派", "辛口派"]


async def _decide(state: dict, questions: dict) -> dict:
    """state + questions を送り、{name: {value, probability}} の形に正規化して返す。"""
    api_key = os.environ.get("OPENROUTER_API_KEY", OPENROUTER_API_KEY)
    if not api_key:
        return _mock(state, questions)

    payload = {"model": JEV_MODEL, "state": state, "questions": questions}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                DECISIONS_URL,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if r.status_code != 200:
                print(f"[WARN] OpenRouter decisions API returned status {r.status_code}: {r.text}")
                print("[WARN] Falling back to mock decision")
                return _mock(state, questions)
            return _normalize(r.json())
    except Exception as e:
        print(f"[ERROR] OpenRouter decisions API request failed: {e}")
        print("[WARN] Falling back to mock decision")
        return _mock(state, questions)


def _normalize(data: dict) -> dict:
    """OpenRouter/Jev のレスポンスを {name: {value, probability}} に整形。"""
    body = data.get("answers") or data.get("results") or data.get("questions") or data
    out = {}
    if isinstance(body, dict):
        for k, v in body.items():
            if isinstance(v, dict):
                # 1. noul 型 (yes/no 確率)
                if "noul" in v:
                    prob = float(v.get("noul", 0.5))
                    value = prob >= 0.5
                # 2. choice 型 (選択肢 + 確率分布)
                elif "choice" in v:
                    value = v["choice"]
                    probs = v.get("probabilities", {})
                    if isinstance(probs, dict) and value in probs:
                        prob = float(probs[value])
                    else:
                        prob = float(v.get("probability", v.get("confidence", 0.8)))
                # 3. score 型 (スコア値)
                elif "score" in v:
                    value = float(v.get("score", 0.0))
                    prob = float(v.get("probability", v.get("confidence", 0.8)))
                # 4. 一般的な value / answer 形式
                else:
                    value = v.get("value", v.get("answer"))
                    prob = float(v.get("probability", v.get("confidence", 0.8)))
                    if value is None and "probability" in v:
                        value = prob >= 0.5
                out[k] = {"value": value, "probability": prob}
            elif isinstance(v, bool):
                out[k] = {"value": v, "probability": 0.9 if v else 0.1}
            elif isinstance(v, (int, float)):
                out[k] = {"value": float(v), "probability": min(1.0, max(0.0, float(v)))}
            else:
                out[k] = {"value": v, "probability": 0.8}
    return out


def _mock(state: dict, questions: dict) -> dict:
    """APIキーなし用の決定論的モック (同一入力には同値を返す)。"""
    seed = hashlib.sha256(str(sorted(state.items(), key=str)).encode()).hexdigest()
    rng = random.Random(seed)
    out = {}
    
    answer = state.get("answer", "")
    recent_answers = state.get("recent_answers", [])
    is_dup = answer.strip() in [a.strip() for a in recent_answers if a]
    
    for name, q in questions.items():
        qtype = q.get("type", "noul")
        if name == "is_duplicate":
            out[name] = {"value": is_dup, "probability": 0.99 if is_dup else 0.05}
        elif name == "is_offensive":
            is_off = any(w in answer for w in ["死ね", "殺す", "バカ", "アホ", "spam", "offensive"])
            out[name] = {"value": is_off, "probability": 0.95 if is_off else 0.02}
        elif name == "is_on_topic":
            is_on = len(answer.strip()) >= 1
            out[name] = {"value": is_on, "probability": 0.92 if is_on else 0.10}
        elif name == "effort_level":
            if len(answer.strip()) < 1:
                eff = "spam"
            elif len(answer.strip()) < 2:
                eff = "low"
            else:
                eff = "genuine"
            out[name] = {"value": eff, "probability": 0.85}
        elif qtype in ["noul", "boolean"]:
            if name == "is_cliche":
                p = round(0.15 + rng.random() * 0.35, 3)
                out[name] = {"value": p > 0.5, "probability": p}
            elif name in ["on_topic", "comprehensible", "format_ok"]:
                p = round(0.75 + rng.random() * 0.20, 3)
                out[name] = {"value": p > 0.5, "probability": p}
            elif name == "gut_funny":
                p = round(0.50 + rng.random() * 0.40, 3)
                out[name] = {"value": p > 0.5, "probability": p}
            else:
                p = round(0.60 + rng.random() * 0.35, 3)
                out[name] = {"value": p > 0.5, "probability": p}
        elif qtype == "score":
            val = round(0.55 + rng.random() * 0.40, 3)
            out[name] = {"value": val, "probability": round(0.7 + rng.random() * 0.25, 3)}
        elif qtype == "choice":
            criteria = q.get("criteria", {})
            opts = list(criteria.keys()) if isinstance(criteria, dict) else q.get("options", ["genuine"])
            i = rng.randrange(len(opts))
            out[name] = {"value": opts[i], "probability": 0.6}
    return out


# ------------------------------------------------------------------
# 1. ゲートキーパー: 採点前に即座にはじく
# ------------------------------------------------------------------

MAGIC_IPPON_WORD = "chair-man"


async def gatekeep(theme: str, answer: str, recent_answers: list) -> tuple[bool, str]:
    if answer.strip().lower() == MAGIC_IPPON_WORD:
        return True, ""

    res = await _decide(
        {
            "situation": "Pre-screening an answer in a Japanese oogiri competition before formal judging.",
            "theme": theme,
            "answer": answer,
            "recent_answers": list(recent_answers[-5:]),
        },
        GATEKEEP_QUESTIONS,
    )

    if res.get("is_offensive", {}).get("value"):
        return False, "不適切な内容と判定されました"
    if res.get("is_duplicate", {}).get("value"):
        return False, "直前の回答と重複しています"
    if res.get("effort_level", {}).get("value") == "spam":
        return False, "お題への回答として成立していません"
    if res.get("is_on_topic", {}).get("value") is False and res.get("effort_level", {}).get("value") != "genuine":
        return False, "お題に答えていないと判定されました"
    return True, ""


# ------------------------------------------------------------------
# 2. 本審査 + 3. 合成 (尖り特化・どれかが突出していれば高得点)
# ------------------------------------------------------------------

async def judge(theme: str, answer: str, recent_answers: list) -> dict:
    if answer.strip().lower() == MAGIC_IPPON_WORD:
        # デバッグ・動作確認用: 確実に10点満点 (全審査員2点) で IPPON 判定
        scores = [2, 2, 2, 2, 2]
        total = 10
        timeline = [
            {"judge": label, "score": 2, "delay_ms": 300}
            for label in JUDGE_LABELS
        ]
        return {
            "scores": scores,
            "total": total,
            "is_ippon": True,
            "timeline": timeline,
            "failed": [],
            "raw": {
                "on_topic": 1.0,
                "has_punchline": 1.0,
                "comprehensible": 1.0,
                "novelty": 1.0,
                "conciseness": 1.0,
                "is_cliche": 0.0,
                "gut_funny": 1.0,
            },
        }

    res = await _decide(
        {
            "situation": "Judging an answer in a Japanese oogiri (quick-witted comedy) competition.",
            "theme": theme,
            "answer": answer,
            "recent_answers": list(recent_answers[-5:]),
        },
        JUDGE_QUESTIONS,
    )

    def bprob(name: str) -> float:  # boolean質問の確率
        return float(res.get(name, {}).get("probability", 0.5))

    def sval(name: str) -> float:   # score質問の値
        val = res.get(name, {}).get("value", 0)
        return float(val if val is not None else 0)

    on_topic = bprob("on_topic")
    punch    = bprob("has_punchline")
    comp     = bprob("comprehensible")
    cliche   = bprob("is_cliche")
    gut      = bprob("gut_funny")
    nov      = sval("novelty")
    conc     = sval("conciseness")

    # 尖り度（最高突出度）の算出
    # どれか1つでも圧倒的に高ければ、全体のベース評価も底上げする
    peak_score = max(punch, nov, comp, conc, gut, (1 - cliche))
    spike_bonus = 0.35 if peak_score >= 0.75 else (0.20 if peak_score >= 0.60 else 0.0)

    # 5人の審査員：それぞれの専門分野が尖っていれば即2点満点を出す
    def calc_judge_score(base_val: float, is_specialized_peak: bool) -> int:
        if is_specialized_peak:
            return 2
        score_val = base_val * 2.0 + spike_bonus
        if score_val >= 1.35:
            return 2
        elif score_val >= 0.55:
            return 1
        return 0

    # 1. 王道派: オチが鮮やか、またはお題適合が綺麗
    oudo_peak = punch >= 0.70 or (on_topic >= 0.75 and punch >= 0.55)
    oudo_base = 0.5 * on_topic + 0.5 * punch
    s_oudo = calc_judge_score(oudo_base, oudo_peak)

    # 2. シュール派: 独自性・奇抜さが尖っていれば意味不明でも2点
    surreal_peak = nov >= 0.65 or (nov >= 0.55 and gut >= 0.65)
    surreal_base = 0.7 * nov + 0.3 * gut
    s_surreal = calc_judge_score(surreal_base, surreal_peak)

    # 3. 共感派: 「あるある！」「情景が浮かぶ」が尖っていれば2点
    empathy_peak = comp >= 0.70 or (comp >= 0.60 and on_topic >= 0.60)
    empathy_base = 0.6 * comp + 0.4 * on_topic
    s_empathy = calc_judge_score(empathy_base, empathy_peak)

    # 4. 勢い派: フレーズのキレ・語感・直感のウケが尖っていれば2点
    momentum_peak = conc >= 0.65 or gut >= 0.65
    momentum_base = 0.5 * conc + 0.5 * gut
    s_momentum = calc_judge_score(momentum_base, momentum_peak)

    # 5. 辛口派: ベタネタでなく新鮮な切り口があれば2点
    sharp_peak = (nov >= 0.65 and cliche <= 0.45) or (1 - cliche >= 0.80)
    sharp_base = 0.5 * (1 - cliche) + 0.5 * nov
    s_sharp = calc_judge_score(sharp_base, sharp_peak)

    scores = [s_oudo, s_surreal, s_empathy, s_momentum, s_sharp]
    total = sum(scores)

    # IPPON = 10点満点（5人全員が2点点灯）達成で確実に IPPON!
    is_ippon = (total == 10)

    # 各審査員の「確信度」
    confs = [
        (on_topic + punch) / 2,
        (nov + gut) / 2,
        (comp + on_topic) / 2,
        (conc + gut) / 2,
        ((1 - cliche) + nov) / 2,
    ]

    # 確信度連動の点灯タイムライン
    timeline = []
    running = 0
    for i, (label, score) in enumerate(zip(JUDGE_LABELS, scores)):
        running += score
        tense = (running >= 7 and i >= 2) or (i == 4 and running >= 8)
        if tense:
            delay = int(1600 - confs[i] * 900)
        else:
            delay = int(500 - confs[i] * 250)
        timeline.append({"judge": label, "score": int(score), "delay_ms": max(250, delay)})

    # 敗因フィードバック
    failed = []
    if on_topic < 0.45:
        failed.append("on_topic")
    if punch < 0.45:
        failed.append("has_punchline")
    if comp < 0.45:
        failed.append("comprehensible")
    if nov < 0.45 or cliche > 0.65:
        failed.append("novelty")
    if conc < 0.45:
        failed.append("conciseness")

    return {
        "scores": scores,
        "total": total,
        "is_ippon": is_ippon,
        "timeline": timeline,
        "failed": failed,
        "raw": {
            "on_topic": round(on_topic, 3),
            "has_punchline": round(punch, 3),
            "comprehensible": round(comp, 3),
            "novelty": round(nov, 3),
            "conciseness": round(conc, 3),
            "is_cliche": round(cliche, 3),
            "gut_funny": round(gut, 3),
            "peak_score": round(peak_score, 3),
        },
    }


# ============================================================================
# お題自動生成 (gemini-flash-lite-latest)
# ============================================================================

THEME_MODEL = "gemini-flash-lite-latest"
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


async def generate_theme(recent_themes: list[str] | None = None) -> str | None:
    """Google Gemini API (GEMINI_API_KEY / GOOGLE_API_KEY) を用いて、
    gemini-flash-lite-latest でお題を直接自動生成する。
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("[WARN] GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Falling back to themes.json.")
        return None

    recent_str = ""
    if recent_themes:
        recent_str = f"\n最近出題されたお題（これらと被らない斬新なお題にしてください）:\n" + "\n".join(
            f"- {t}" for t in recent_themes[-5:]
        )

    system_prompt = (
        "あなたは大喜利グランプリ（OOGIRI GRAND PRIX）のお題作成作家です。\n"
        "回答者が思わずボケたくなる、フリが効いていて意外性のある秀逸な大喜利のお題を日本語で1つ作成してください。\n\n"
        "【ルール】\n"
        "1. 出力はお題の文章1行のみ。\n"
        "2. 「お題:」という接頭辞や解説、挨拶、前置き、カギ括弧（「」）は付けないでください。\n"
        "3. 写真で一言など画像が必要なお題ではなく、言葉だけで完結するお題にしてください。\n"
        "4. 代表的な形式例: 「こんな〇〇は嫌だ。どんなの？」「〇〇の意外な弱点とは？」「〇〇が言いそうなセリフ」「〇〇の第1位とは？」など多様なバリエーションを意識してください。"
        f"{recent_str}"
    )

    url = f"{GEMINI_API_BASE_URL}/models/{THEME_MODEL}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": "新しい大喜利のお題を1つ作成してください。"}]}],
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {"temperature": 0.9, "maxOutputTokens": 100},
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json=payload)
            if r.status_code == 200:
                data = r.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        raw_text = parts[0].get("text", "").strip()
                        cleaned = raw_text.strip("\"'「」")
                        if cleaned.startswith("お題:"):
                            cleaned = cleaned[3:].strip()
                        elif cleaned.startswith("お題："):
                            cleaned = cleaned[3:].strip()
                        if cleaned:
                            print(f"[THEME_GEN] Generated theme via Gemini API ({THEME_MODEL}): {cleaned}")
                            return cleaned
            else:
                print(f"[WARN] Google Gemini API returned status {r.status_code}: {r.text}")
    except Exception as e:
        print(f"[ERROR] Google Gemini API request exception: {e}")

    return None


# ============================================================================
# お題音声読み上げ (Gemini 3.1 Flash TTS Preview - 低い男性ボイス)
# ============================================================================

TTS_MODEL = "gemini-3.1-flash-tts-preview"
TTS_CACHE: dict[str, bytes] = {}

async def generate_theme_audio(theme_text: str, voice_name: str = "Algieba") -> bytes | None:
    """Gemini 3.1 Flash TTS Preview API を使用して、お題テキストから低い男性の声のWAV音声を生成する。
    voice_name: 'Algieba' 等
    """
    clean_text = theme_text.strip()
    if not clean_text:
        return None

    cache_key = f"{voice_name}:{clean_text}"
    if cache_key in TTS_CACHE:
        return TTS_CACHE[cache_key]

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("[WARN] GEMINI_API_KEY is not set. Cannot generate TTS audio.")
        return None

    prompt = (
        "あなたは大喜利グランプリ（OOGIRI GRAND PRIX）のナレーターです。\n"
        "低く落ち着きのある重厚な男性の声で、次の大喜利のお題をはっきりと威厳を持って読み上げてください：\n"
        f"「{clean_text}」"
    )

    url = f"{GEMINI_API_BASE_URL}/models/{TTS_MODEL}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice_name
                    }
                }
            }
        }
    }

    try:
        import base64
        import io
        import wave

        async with httpx.AsyncClient(timeout=25) as client:
            r = await client.post(url, json=payload)
            if r.status_code == 200:
                data = r.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    for part in parts:
                        inline_data = part.get("inlineData", {})
                        raw_b64 = inline_data.get("data")
                        mime_type = inline_data.get("mimeType", "")
                        if raw_b64:
                            pcm_data = base64.b64decode(raw_b64)
                            # audio/l16; rate=24000; channels=1 を WAVコンテナにラップ
                            rate = 24000
                            if "rate=" in mime_type:
                                try:
                                    rate_str = mime_type.split("rate=")[1].split(";")[0].strip()
                                    rate = int(rate_str)
                                except Exception:
                                    pass

                            buf = io.BytesIO()
                            with wave.open(buf, "wb") as wav_file:
                                wav_file.setnchannels(1)
                                wav_file.setsampwidth(2)
                                wav_file.setframerate(rate)
                                wav_file.writeframes(pcm_data)

                            wav_bytes = buf.getvalue()
                            TTS_CACHE[cache_key] = wav_bytes
                            print(f"[TTS] Successfully generated WAV audio for theme ({len(wav_bytes)} bytes)")
                            return wav_bytes
            else:
                print(f"[WARN] Gemini TTS API returned status {r.status_code}: {r.text}")
    except Exception as e:
        print(f"[ERROR] Gemini TTS API request failed: {e}")

    return None



