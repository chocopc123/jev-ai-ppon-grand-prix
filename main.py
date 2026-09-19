"""
IPPON GRAND PRIX Web — FastAPI / WebSocket サーバー

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


app = FastAPI(title="IPPON GP Web")

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
        self.players: dict[str, dict] = {}  # pid -> {"name", "ws", "ippons"}
        self.phase = "lobby"                # lobby | theme
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

    # ---------------- 基礎 ----------------

    def roster(self):
        return [
            {"id": pid, "name": p["name"], "ippons": p["ippons"]}
            for pid, p in self.players.items()
        ]

    def broadcast(self, msg: dict):
        for p in list(self.players.values()):
            try:
                asyncio.ensure_future(p["ws"].send_json(msg))
            except Exception:
                pass

    def send(self, pid: str, msg: dict):
        p = self.players.get(pid)
        if p:
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

    async def _async_start_theme(self):
        if not self.players:
            return
        self.theme = await self._resolve_theme()
        self.recent_themes.append(self.theme)
        # クライアントがリクエストする前にサーバー側で先行してTTS音声を生成・キャッシュ
        if self.theme:
            asyncio.create_task(generate_theme_audio(self.theme))

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

    def toggle_timer(self):
        if self.phase != "theme":
            return
        if not self.is_timer_paused:
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
            })
        else:
            self.is_timer_paused = False
            self.deadline = time.time() + self.paused_remaining
            self.broadcast({
                "type": "TIMER_RESUMED",
                "deadline_epoch": self.deadline,
                "remaining": int(self.paused_remaining),
            })

    def reset(self):
        for p in self.players.values():
            p["ippons"] = 0
        self.theme_index = -1
        self.round_number = 0
        self.is_timer_paused = False
        self.paused_remaining = 0.0
        self.phase = "transition"
        self.start_theme()

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
                        if not self.is_timer_paused and self.deadline and time.time() >= self.deadline and not self.queue:
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
                    # - 準備待ち: 350ms (フリップ前) + 400ms (フリップ後) = 750ms
                    # - 審査員思考ディレイ: sum(delay_ms)
                    # - フレーム点灯ディレイ:
                    #     IPPON時(10点): 1~7点目(180ms*7=1260ms) + 8~9点目(380ms*2=760ms) = 2020ms
                    #     演出完了までの合計 = sum(delay_ms) + 2770ms
                    #     IPPON演出(ファンファーレ+文字)表示直後(~0.4秒後)に加算通知するため +3.2秒待機
                    #     不成立時: 各点灯ディレイ + 不成立ウェイト(450ms)
                    anim_ms = sum(s["delay_ms"] for s in result["timeline"])
                    if result["is_ippon"]:
                        await asyncio.sleep(anim_ms / 1000 + 3.2)
                    else:
                        total = result["total"]
                        step_ms = min(total, 7) * 180 + max(0, total - 7) * 380
                        miss_wait = (anim_ms + 750 + step_ms + 450) / 1000 + 0.2
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
                            self.broadcast({"type": "MATCH_WIN", "winner": name, "players": self.roster()})
                            self.reset()
                            return
                        await asyncio.sleep(2.5)
                        self.next_theme(f"{name} のIPPON! 次のお題へ")
                        return
                    else:
                        self.broadcast({
                            "type": "ROUND_RESULT",
                            "player": name, "answer": answer, "is_ippon": False,
                            "total": result["total"],
                            "failed": result["failed"],
                            "players": self.roster(),
                        })
                        # 判定中にタイマーが時間切れになっていた場合、結果演出を見届けてから次のお題へ
                        if not self.is_timer_paused and self.deadline and time.time() >= self.deadline:
                            await asyncio.sleep(2.5)
                            if not self.queue:
                                self.next_theme("時間切れ")
                                return
                except Exception as e:
                    print(f"[ERROR] Error processing answer for {name}: {e}")
        finally:
            self.draining = False


ROOMS: dict[str, Room] = {}


@app.websocket("/ws/{room_id}/{player_name}")
async def ws_endpoint(ws: WebSocket, room_id: str, player_name: str):
    await ws.accept()
    room = ROOMS.setdefault(room_id, Room(room_id))
    pid = uuid.uuid4().hex[:8]
    room.players[pid] = {"name": player_name or "名無し", "ws": ws, "ippons": 0}

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
    })
    room.broadcast({"type": "PLAYER_JOINED", "players": room.roster()})

    if room.phase == "lobby":
        room.start_theme()

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
            elif t == "RESTART":
                room.reset()
    except WebSocketDisconnect:
        room.players.pop(pid, None)
        room.broadcast({"type": "PLAYER_LEFT", "players": room.roster()})
        if not room.players:
            # 部屋のプレイヤーが全員退出したらロビー状態に戻し、次回入場時に新しいお題を即時生成
            room.phase = "lobby"
            room.theme = None
            room.deadline = None
            room.is_timer_paused = False
            room.paused_remaining = 0.0
            room.queue.clear()
            room.draining = False


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
