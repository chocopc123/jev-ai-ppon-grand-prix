"""
OOGIRI GRAND PRIX Web — FastAPI / WebSocket サーバー

フロー:
  お題出題 → プレイヤーがチャット送信 → ピンポン & 解答発表 (全員へ)
  → ゲートキーパー (Jev) → 本審査 (Jev) → 確信度連動の審査員点灯演出 → 結果

注意: ルーム状態はメモリ管理 (シングルインスタンス想定)。
複数インスタンスでスケールする場合は Memorystore (Redis) への移行が必要。
"""
import asyncio
import json
import os
import time
import datetime
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from jev_client import gatekeep, judge, generate_theme, generate_theme_audio

load_dotenv()

def log_answer(room_id: str, theme: str, player: str, answer: str, gatekeep_ok: bool, gatekeep_reason: str = "", judge_result: dict = None):
    """解答履歴をコンソールに出力する。"""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if not gatekeep_ok:
        print(f"[{now}] [ROOM: {room_id}] [没/GATEKEEP] プレイヤー: {player} | お題: {theme} | 回答: 「{answer}」 | 理由: {gatekeep_reason}")
    else:
        total = judge_result.get("total", 0) if judge_result else 0
        is_ippon = judge_result.get("is_ippon", False) if judge_result else False
        ippon_mark = "★ IPPON! (10点)" if is_ippon else f"{total}点"
        print(f"[{now}] [ROOM: {room_id}] [{ippon_mark}] プレイヤー: {player} | お題: {theme} | 回答: 「{answer}」")


app = FastAPI(title="AI-PPON GRAND PRIX Web")

@app.get("/api/tts/theme")
async def get_theme_audio(text: str, voice: str = "Algieba"):
    """Gemini 3.1 Flash TTS Preview で生成したお題の低音WAV音声を返す。"""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text parameter is required")
    audio_bytes = await generate_theme_audio(text.strip(), voice_name=voice)
    if not audio_bytes:
        raise HTTPException(status_code=502, detail="Failed to generate audio via Gemini TTS")
    return Response(content=audio_bytes, media_type="audio/wav")

with open(os.path.join(os.path.dirname(__file__), "themes.json"), encoding="utf-8") as f:
    THEMES = [t["text"] for t in json.load(f)["themes"]]

THEME_TIME_LIMIT = int(os.environ.get("THEME_TIME_LIMIT", "150"))  # 1お題の制限時間(秒)
TARGET_IPPON = int(os.environ.get("TARGET_IPPON", "3"))             # 勝利IPPON数


class Room:
    def __init__(self, room_id: str):
        self.id = room_id
        self.players: dict[str, dict] = {}  # pid -> {"name", "ws", "ippons", "connected", "disconnect_task"}
        self.phase = "waiting"              # waiting | theme | transition
        self.theme = None
        self.theme_index = -1
        self.round_number = 0
        self.deadline = None
        self.queue: list[tuple[str, str]] = []  # (pid, answer)
        self.draining = False
        self.recent_answers: list[str] = []
        self.recent_themes: list[str] = []
        self.ticker_started = False
        self._order = []
        self.is_timer_paused = False
        self.paused_remaining = 0.0
        self.next_theme_buffer: str | None = None
        self._pregen_task: asyncio.Task | None = None
        self.tts_enabled: bool = False       # 隠しコマンド有効化フラグ (部屋単位)

    # ---------------- 基礎 ----------------

    def roster(self):
        return [
            {"id": pid, "name": p["name"], "ippons": p["ippons"]}
            for pid, p in self.players.items()
        ]

    def broadcast(self, msg: dict):
        for p in list(self.players.values()):
            ws = p.get("ws")
            if ws:
                try:
                    asyncio.ensure_future(ws.send_json(msg))
                except Exception:
                    pass

    def send(self, pid: str, msg: dict):
        p = self.players.get(pid)
        if p and p.get("ws"):
            try:
                asyncio.ensure_future(p["ws"].send_json(msg))
            except Exception:
                pass

    # ---------------- ゲーム進行 ----------------

    async def _resolve_theme(self) -> str:
        """gemini-flash-lite-latest で生成し、失敗時は themes.json から選択。"""
        gen_theme = await generate_theme(self.recent_themes)
        if gen_theme:
            return gen_theme

        # フォールバック (themes.json)
        if not self._order:
            order = list(range(len(THEMES)))
            __import__("random").shuffle(order)
            self._order = order
        self.theme_index = (self.theme_index + 1) % len(self._order)
        return THEMES[self._order[self.theme_index]]

    async def _pregenerate_next_theme_and_audio(self):
        """次のお題のテキスト（およびTTS解禁時のみ音声）をバックグラウンドで事前生成して待機させる。"""
        try:
            next_t = await self._resolve_theme()
            self.next_theme_buffer = next_t
            if self.tts_enabled:
                print(f"[PREGEN] Next theme prepared: 「{next_t}」. Starting TTS generation...")
                await generate_theme_audio(next_t)
                print(f"[PREGEN] Next theme TTS completely ready in cache for: 「{next_t}」")
            else:
                print(f"[PREGEN] Next theme prepared: 「{next_t}」 (TTS disabled, saving API quota)")
        except Exception as e:
            print(f"[PREGEN] Failed to pregenerate next theme or audio: {e}")

    def schedule_next_pregeneration(self):
        if self._pregen_task and not self._pregen_task.done():
            self._pregen_task.cancel()
        self._pregen_task = asyncio.create_task(self._pregenerate_next_theme_and_audio())

    async def _async_start_theme(self):
        if not self.players:
            return

        # 1) 事前生成バッファがあれば即座に採用（待ち時間 0秒）
        if self.next_theme_buffer:
            self.theme = self.next_theme_buffer
            self.next_theme_buffer = None
            print(f"[THEME] Using pregenerated theme: 「{self.theme}」 (TTS enabled: {self.tts_enabled})")
            if self.tts_enabled:
                asyncio.create_task(generate_theme_audio(self.theme))
        else:
            # 初回などバッファがない場合は即座に生成
            self.theme = await self._resolve_theme()
            if self.theme and self.tts_enabled:
                asyncio.create_task(generate_theme_audio(self.theme))

        self.recent_themes.append(self.theme)

        # 2) 現在のお題が始まった瞬間、直ちに「次のお題とその音声」の事前生成を開始
        self.schedule_next_pregeneration()

        self.round_number += 1
        self.phase = "theme"
        self.queue.clear()
        self.recent_answers.clear()
        self.is_timer_paused = False
        self.paused_remaining = 0.0
        self.deadline = time.time() + THEME_TIME_LIMIT
        self.broadcast({
            "type": "THEME_STARTED",
            "theme": self.theme,
            "question_number": self.round_number,
            "deadline_epoch": self.deadline,
            "is_timer_paused": False,
            "players": self.roster(),
            "tts_enabled": self.tts_enabled,
        })
        if not self.ticker_started:
            self.ticker_started = True
            asyncio.ensure_future(self._ticker())

    def start_theme(self):
        asyncio.ensure_future(self._async_start_theme())

    def next_theme(self, reason: str):
        if self.phase != "theme":
            return
        self.phase = "transition"
        self.broadcast({"type": "THEME_ENDED", "reason": reason})
        self.start_theme()

    def pause_timer(self, silent: bool = False):
        if self.phase != "theme" or self.is_timer_paused:
            return
        self.is_timer_paused = True
        now = time.time()
        if self.deadline and self.deadline > now:
            self.paused_remaining = max(0.0, self.deadline - now)
        else:
            self.paused_remaining = 0.0
        self.deadline = None
        self.broadcast({
            "type": "TIMER_PAUSED",
            "remaining": int(self.paused_remaining),
            "silent": silent,
        })

    def resume_timer(self, silent: bool = False):
        if self.phase != "theme" or not self.is_timer_paused:
            return
        if self.paused_remaining <= 0.0:
            return
        self.is_timer_paused = False
        self.deadline = time.time() + self.paused_remaining
        self.broadcast({
            "type": "TIMER_RESUMED",
            "deadline_epoch": self.deadline,
            "remaining": int(self.paused_remaining),
            "silent": silent,
        })

    def toggle_timer(self):
        if self.phase != "theme":
            return
        if not self.is_timer_paused:
            self.pause_timer(silent=False)
        else:
            self.resume_timer(silent=False)

    def reset_to_waiting(self):
        for p in self.players.values():
            p["ippons"] = 0
        self.theme_index = -1
        self.round_number = 0
        self.is_timer_paused = False
        self.paused_remaining = 0.0
        self.phase = "waiting"
        self.theme = None
        self.deadline = None
        self.queue.clear()
        self.draining = False
        self.next_theme_buffer = None
        self.broadcast({
            "type": "WAITING_LOBBY",
            "phase": "waiting",
            "players": self.roster()
        })
        # 待機中（次の1問目）のお題およびTTS音声を事前生成
        self.schedule_next_pregeneration()

    def reset_room_state(self):
        self.phase = "waiting"
        self.theme = None
        self.theme_index = -1
        self.round_number = 0
        self.deadline = None
        self.is_timer_paused = False
        self.paused_remaining = 0.0
        self.queue.clear()
        self.draining = False
        self.recent_answers.clear()
        self.recent_themes.clear()
        self.next_theme_buffer = None
        if self._pregen_task and not self._pregen_task.done():
            self._pregen_task.cancel()

    def enqueue(self, pid: str, answer: str):
        if self.phase != "theme":
            return
        if not self.is_timer_paused and self.deadline and time.time() >= self.deadline:
            return  # 時間切れ後の新規回答は受け付けない
        self.queue.append((pid, answer.strip()[:200]))
        self.send(pid, {"type": "SUBMIT_ACK", "position": len(self.queue)})
        if not self.draining:
            asyncio.ensure_future(self._drain())

    async def _ticker(self):
        while True:
            await asyncio.sleep(1)
            if (
                not self.is_timer_paused
                and self.phase == "theme"
                and self.deadline
                and time.time() >= self.deadline
                and not self.queue
                and not self.draining
            ):
                self.next_theme("時間切れ")

    # ---------------- 採点パイプライン ----------------

    async def _drain(self):
        self.draining = True
        try:
            while self.queue and self.phase == "theme":
                pid, answer = self.queue.pop(0)
                if not answer or pid not in self.players:
                    continue
                name = self.players[pid]["name"]

                # 回答審査中のタイマー一時停止（動作中だった場合のみ後で再開）
                was_timer_running = not self.is_timer_paused
                if was_timer_running:
                    self.pause_timer(silent=True)

                try:
                    # 1) 解答発表 (クライアントでピンポン音)
                    self.broadcast({"type": "ANSWER_REVEALED", "player": name, "answer": answer})

                    # 2) ゲートキーパー (採点前の門番)
                    ok, reason = await gatekeep(self.theme, answer, self.recent_answers)
                    if not ok:
                        log_answer(self.id, self.theme, name, answer, False, reason)
                        self.broadcast({
                            "type": "GATEKEEP_REJECTED",
                            "player": name, "answer": answer, "reason": reason,
                        })
                        if was_timer_running and self.paused_remaining > 0:
                            self.resume_timer(silent=True)
                        elif self.paused_remaining <= 0 and not self.queue:
                            await asyncio.sleep(1.2)
                            self.next_theme("時間切れ")
                            return
                        continue

                    # 3) 本審査 (分解基準 + gut_funny)
                    result = await judge(self.theme, answer, self.recent_answers)
                    self.recent_answers.append(answer)
                    log_answer(self.id, self.theme, name, answer, True, judge_result=result)

                    # 4) 点灯演出の指示を送る (クライアントが delay_ms に従って再生)
                    self.broadcast({
                        "type": "SCORE_REVEAL_START",
                        "player": name,
                        "answer": answer,
                        "timeline": result["timeline"],
                        "total": result["total"],
                        "is_ippon": result["is_ippon"],
                        "failed": result["failed"],
                        "raw": result["raw"],
                    })

                    # 演出時間ぶん待ってから状態更新
                    # クライアント側アニメーション所要時間:
                    # - 準備待ち: 350ms (フリップ前) + 50ms (フリップ後) = 400ms
                    # - 回答読み上げ待ち (Web Speech API rate 0.92): 1文字約0.2秒、最低2.0秒、最大7.0秒 + 読み上げ後の間 300ms
                    # - 各項目ディレイ: sum(delay_ms)
                    # - 各点灯ディレイ: total * 80ms
                    # - IPPON時: 10点目で即座にファンファーレ発動するため +2.6秒待機
                    # - 不成立時: 終了ウェイト(450ms) + 結果確認(2.6秒)
                    speak_wait_sec = max(2.0, min(7.0, len(answer) * 0.2)) + 0.3
                    anim_ms = sum(s["delay_ms"] for s in result["timeline"])
                    total = result["total"]
                    step_ms = total * 80
                    base_wait = speak_wait_sec + (anim_ms + 400 + step_ms) / 1000
                    if result["is_ippon"]:
                        await asyncio.sleep(base_wait + 2.6)
                    else:
                        miss_wait = base_wait + 0.45 + 2.6
                        await asyncio.sleep(miss_wait)

                    # 5) 結果処理
                    if result["is_ippon"]:
                        self.players[pid]["ippons"] += 1
                        self.broadcast({
                            "type": "ROUND_RESULT",
                            "player": name, "answer": answer, "is_ippon": True,
                            "players": self.roster(),
                        })
                        if self.players[pid]["ippons"] >= TARGET_IPPON:
                            self.phase = "match_win"
                            self.broadcast({"type": "MATCH_WIN", "winner": name, "players": self.roster()})
                            return

                        # 時間が残っていればお題は切り替えずにタイマー再開
                        if self.paused_remaining > 0:
                            if was_timer_running:
                                self.resume_timer(silent=True)
                        else:
                            await asyncio.sleep(1.0)
                            if not self.queue:
                                self.next_theme("時間切れ")
                                return
                    else:
                        self.broadcast({
                            "type": "ROUND_RESULT",
                            "player": name, "answer": answer, "is_ippon": False,
                            "total": result["total"],
                            "failed": result["failed"],
                            "players": self.roster(),
                        })
                        if self.paused_remaining > 0:
                            if was_timer_running:
                                self.resume_timer(silent=True)
                        else:
                            await asyncio.sleep(1.0)
                            if not self.queue:
                                self.next_theme("時間切れ")
                                return
                except Exception as e:
                    print(f"[ERROR] Error processing answer for {name}: {e}")
                    if was_timer_running and self.paused_remaining > 0:
                        self.resume_timer(silent=True)
        finally:
            self.draining = False


ROOMS: dict[str, Room] = {}


@app.websocket("/ws/{room_id}/{player_name}")
async def ws_endpoint(
    ws: WebSocket,
    room_id: str,
    player_name: str,
    player_id: str | None = None,
    enable_tts: bool = False,
):
    await ws.accept()
    room = ROOMS.setdefault(room_id, Room(room_id))

    # 隠しコマンド有効化者が入室または作成した場合、その部屋全体でTTSを有効化
    if enable_tts and not room.tts_enabled:
        room.tts_enabled = True
        print(f"[ROOM {room_id}] 🎙️ TTS (Narration Mode) UNLOCKED by player {player_name}!")
        # もし事前生成がまだ未着手またはTTSなしで生成されていた場合はTTS付きで再スケジュール
        if room.phase == "waiting" and (not room._pregen_task or room._pregen_task.done()):
            room.schedule_next_pregeneration()

    # player_id が渡され、かつ既存のプレイヤー一覧にあればセッション復帰
    pid = player_id if (player_id and player_id in room.players) else (player_id or uuid.uuid4().hex[:8])

    if pid in room.players:
        p = room.players[pid]
        task = p.get("disconnect_task")
        if task and not task.done():
            task.cancel()
        p["disconnect_task"] = None
        p["ws"] = ws
        if player_name:
            p["name"] = player_name
        p["connected"] = True
    else:
        room.players[pid] = {
            "name": player_name or "名無し",
            "ws": ws,
            "ippons": 0,
            "connected": True,
            "disconnect_task": None,
        }

    await ws.send_json({
        "type": "JOINED",
        "player_id": pid,
        "room": room_id,
        "phase": room.phase,
        "theme": room.theme,
        "question_number": max(1, room.round_number),
        "deadline_epoch": room.deadline,
        "is_timer_paused": room.is_timer_paused,
        "remaining": int(room.paused_remaining) if room.is_timer_paused else None,
        "players": room.roster(),
        "target_ippon": TARGET_IPPON,
        "tts_enabled": room.tts_enabled,
    })
    room.broadcast({
        "type": "PLAYER_JOINED",
        "players": room.roster(),
        "tts_enabled": room.tts_enabled,
    })
    if room.phase == "waiting" and not room.next_theme_buffer and (not room._pregen_task or room._pregen_task.done()):
        room.schedule_next_pregeneration()

    try:
        while True:
            data = await ws.receive_json()
            t = data.get("type")
            if t == "SUBMIT":
                room.enqueue(pid, data.get("answer", ""))
            elif t == "TOGGLE_TIMER" and room.phase == "theme":
                room.toggle_timer()
            elif t == "SKIP" and room.phase == "theme" and not room.queue:
                room.next_theme("スキップされました")
            elif t == "START_GAME" and room.phase == "waiting":
                room.start_theme()
            elif t == "RESTART":
                room.reset_to_waiting()
            elif t == "LEAVE":
                # 明示的な退出: 猶予なしで即時削除
                task = room.players.get(pid, {}).get("disconnect_task")
                if task and not task.done():
                    task.cancel()
                room.players.pop(pid, None)
                room.broadcast({"type": "PLAYER_LEFT", "players": room.roster()})
                if not room.players:
                    room.reset_room_state()
                break
    except WebSocketDisconnect:
        p = room.players.get(pid)
        if p:
            p["connected"] = False
            p["ws"] = None

            async def _remove_after_timeout(target_pid: str):
                try:
                    await asyncio.sleep(15)
                    target_p = room.players.get(target_pid)
                    if target_p and not target_p.get("connected"):
                        room.players.pop(target_pid, None)
                        room.broadcast({"type": "PLAYER_LEFT", "players": room.roster()})
                        if not any(pl.get("connected") for pl in room.players.values()):
                            room.reset_room_state()
                except asyncio.CancelledError:
                    pass

            p["disconnect_task"] = asyncio.create_task(_remove_after_timeout(pid))


# frontend をビルドした場合は配信する (ローカル実行 / コンテナ実行の両方に対応)
_possible_dist_paths = [
    os.path.join(os.path.dirname(__file__), "frontend", "dist"),
    os.path.join(os.path.dirname(__file__), "static"),
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"),
]
for _path in _possible_dist_paths:
    if os.path.isdir(_path):
        app.mount("/", StaticFiles(directory=_path, html=True), name="static")
        break
