"""
AI-PPON GRAND PRIX Web の統合テスト (HTTP 静的配信 + WebSocket 対戦フロー + 再接続・待機室)
"""
import os
import sys

# プロジェクトルートを sys.path に追加
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import asyncio
from fastapi.testclient import TestClient
from main import app, ROOMS


def test_static_files():
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "<!doctype html>" in response.text.lower() or "<html" in response.text.lower()
    print("[OK] Static file (index.html) served successfully")


def recv_ignore_timer(ws):
    """タイマー停止・再開などの付随メッセージを読み飛ばし、メインのゲームイベントを取得する。"""
    while True:
        msg = ws.receive_json()
        if msg.get("type") not in ("TIMER_PAUSED", "TIMER_RESUMED"):
            return msg


def test_websocket_gameplay():
    from unittest.mock import patch
    client = TestClient(app)
    ROOMS.clear()

    with patch("main.gatekeep") as mock_gk:
        mock_gk.side_effect = [
            (True, ""),
            (True, ""),
            (False, "直前の回答と重複しています"),
        ]
        # プレイヤー1が参加 (初期フェーズは waiting)
        with client.websocket_connect("/ws/test-room/player1") as ws1:
            msg1 = ws1.receive_json()
            assert msg1["type"] == "JOINED"
            assert msg1["room"] == "test-room"
            assert msg1["phase"] == "waiting"

            pj_msg1 = ws1.receive_json()
            assert pj_msg1["type"] == "PLAYER_JOINED"

            # ゲーム開始前は THEME_STARTED は来ない。START_GAME を送信して開始する
            ws1.send_json({"type": "START_GAME"})
            theme_msg1 = ws1.receive_json()
            assert theme_msg1["type"] == "THEME_STARTED"
            assert "theme" in theme_msg1
            print(f"[OK] Player 1 started game, Theme: {theme_msg1['theme']}")

            # プレイヤー2が参加
            with client.websocket_connect("/ws/test-room/player2") as ws2:
                msg2 = ws2.receive_json()
                assert msg2["type"] == "JOINED"
                assert msg2["phase"] == "theme"

                # ws1 にプレイヤー2の参加通知
                p2_joined_msg = ws1.receive_json()
                assert p2_joined_msg["type"] == "PLAYER_JOINED"

                # ws2 にも PLAYER_JOINED が来る
                ws2_pj = ws2.receive_json()
                # プレイヤー1が回答を送信 (1回目)
                ws1.send_json({"type": "SUBMIT", "answer": "回答1"})
                assert recv_ignore_timer(ws1)["type"] == "SUBMIT_ACK"
                assert recv_ignore_timer(ws1)["type"] == "ANSWER_REVEALED"
                assert recv_ignore_timer(ws2)["type"] == "ANSWER_REVEALED"

                score1 = recv_ignore_timer(ws1)
                assert recv_ignore_timer(ws2)["type"] == "SCORE_REVEAL_START"
                assert score1["type"] == "SCORE_REVEAL_START"
                assert recv_ignore_timer(ws1)["type"] == "ROUND_RESULT"
                assert recv_ignore_timer(ws2)["type"] == "ROUND_RESULT"
                print("[OK] 1st answer scored")

                # プレイヤー1が2回目の回答を送信
                ws1.send_json({"type": "SUBMIT", "answer": "回答2"})
                assert recv_ignore_timer(ws1)["type"] == "SUBMIT_ACK"
                assert recv_ignore_timer(ws1)["type"] == "ANSWER_REVEALED"
                assert recv_ignore_timer(ws2)["type"] == "ANSWER_REVEALED"

                score2 = recv_ignore_timer(ws1)
                assert recv_ignore_timer(ws2)["type"] == "SCORE_REVEAL_START"
                assert score2["type"] == "SCORE_REVEAL_START"
                assert recv_ignore_timer(ws1)["type"] == "ROUND_RESULT"
                assert recv_ignore_timer(ws2)["type"] == "ROUND_RESULT"
                print("[OK] 2nd answer scored")

                # プレイヤー1が3回目の同一回答を送信
                ws1.send_json({"type": "SUBMIT", "answer": "回答2"})
                assert recv_ignore_timer(ws1)["type"] == "SUBMIT_ACK"
                assert recv_ignore_timer(ws1)["type"] == "ANSWER_REVEALED"
                assert recv_ignore_timer(ws2)["type"] == "ANSWER_REVEALED"

                reject1 = recv_ignore_timer(ws1)
                assert recv_ignore_timer(ws2)["type"] == "GATEKEEP_REJECTED"
                assert reject1["type"] == "GATEKEEP_REJECTED"
                assert "重複" in reject1["reason"]
                print(f"[OK] 3rd duplicate answer correctly rejected: {reject1['reason']}")


def test_full_scoring_flow():
    from unittest.mock import patch
    client = TestClient(app)
    ROOMS.clear()

    with patch("main.gatekeep", return_value=(True, "")):
        with client.websocket_connect("/ws/test-room-2/player1") as ws1:
            ws1.receive_json()  # JOINED
            ws1.receive_json()  # PLAYER_JOINED

            ws1.send_json({"type": "START_GAME"})
            ws1.receive_json()  # THEME_STARTED

            # 回答送信
            ws1.send_json({"type": "SUBMIT", "answer": "Great Comedy Answer"})
            ack = ws1.receive_json()
            assert ack["type"] == "SUBMIT_ACK"

            ans = recv_ignore_timer(ws1)
            assert ans["type"] == "ANSWER_REVEALED"

            score = recv_ignore_timer(ws1)
            assert score["type"] == "SCORE_REVEAL_START"
            assert len(score["timeline"]) == 10
            print(f"[OK] Full judging flow: Total={score['total']}, IPPON={score['is_ippon']}")

            # 演出時間待機後のラウンド結果
            res = recv_ignore_timer(ws1)
            assert res["type"] == "ROUND_RESULT"
            print(f"[OK] Full flow ROUND_RESULT received: is_ippon={res['is_ippon']}")


def test_timer_pause_resume():
    client = TestClient(app)
    ROOMS.clear()

    with client.websocket_connect("/ws/test-room-timer/player1") as ws1:
        joined = ws1.receive_json()  # JOINED
        assert joined["type"] == "JOINED"
        assert joined["phase"] == "waiting"
        ws1.receive_json()  # PLAYER_JOINED

        ws1.send_json({"type": "START_GAME"})
        theme_msg = ws1.receive_json()  # THEME_STARTED
        assert theme_msg["type"] == "THEME_STARTED"
        assert theme_msg["is_timer_paused"] is False

        # タイマー停止をリクエスト
        ws1.send_json({"type": "TOGGLE_TIMER"})
        pause_msg = ws1.receive_json()
        assert pause_msg["type"] == "TIMER_PAUSED"
        assert pause_msg["remaining"] > 0
        print(f"[OK] Timer paused: remaining={pause_msg['remaining']}")

        # 別のプレイヤーが参加した場合、is_timer_pausedがTrueでremainingが取得できること
        with client.websocket_connect("/ws/test-room-timer/player2") as ws2:
            p2_joined = ws2.receive_json()
            assert p2_joined["type"] == "JOINED"
            assert p2_joined["is_timer_paused"] is True
            assert p2_joined["remaining"] == pause_msg["remaining"]

            ws1.receive_json()  # PLAYER_JOINED (ws1)
            ws2.receive_json()  # PLAYER_JOINED (ws2)

            # タイマー再開をリクエスト
            ws1.send_json({"type": "TOGGLE_TIMER"})
            resumed_msg1 = ws1.receive_json()
            resumed_msg2 = ws2.receive_json()
            assert resumed_msg1["type"] == "TIMER_RESUMED"
            assert resumed_msg2["type"] == "TIMER_RESUMED"
            assert resumed_msg1["deadline_epoch"] is not None
            print(f"[OK] Timer resumed: deadline_epoch={resumed_msg1['deadline_epoch']}")


def test_reconnect_and_leave():
    client = TestClient(app)
    ROOMS.clear()

    # 1. プレイヤーが初回接続
    player_id = None
    with client.websocket_connect("/ws/test-room-recon/player1") as ws:
        joined = ws.receive_json()
        player_id = joined["player_id"]
        assert player_id is not None
        ws.receive_json()  # PLAYER_JOINED

        # 手動でIPPONを付与してみる
        room = ROOMS["test-room-recon"]
        room.players[player_id]["ippons"] = 2

    # ws が切断された（リロードに相当）
    # 猶予期間内（15秒以内）に同一 player_id で再接続
    with client.websocket_connect(f"/ws/test-room-recon/player1?player_id={player_id}") as ws_recon:
        recon_joined = ws_recon.receive_json()
        assert recon_joined["player_id"] == player_id
        # スコアが維持されていることを確認
        assert recon_joined["players"][0]["ippons"] == 2
        print("[OK] Reconnected successfully with preserved score")

        # 2. 明示的退出 (LEAVE)
        ws_recon.send_json({"type": "LEAVE"})

    # 即座に退出処理され、部屋のプレイヤーから消えていること
    room = ROOMS.get("test-room-recon")
    assert player_id not in room.players
    print("[OK] Left room successfully via LEAVE message")


def test_discord_token_endpoint():
    from unittest.mock import patch, AsyncMock
    client = TestClient(app)

    # 認証情報が未設定の場合は 500 エラーになること
    with patch("main.DISCORD_CLIENT_ID", ""), patch("main.DISCORD_CLIENT_SECRET", ""):
        res = client.post("/api/token", json={"code": "dummy_code"})
        assert res.status_code == 500
        assert "not configured" in res.json()["detail"]

    # 認証情報が設定されている場合のモックテスト
    with patch("main.DISCORD_CLIENT_ID", "dummy_id"), patch("main.DISCORD_CLIENT_SECRET", "dummy_secret"):
        with patch("httpx.AsyncClient.post") as mock_post:
            mock_post.return_value = AsyncMock(
                status_code=200,
                json=lambda: {"access_token": "mock_access_token_123", "token_type": "Bearer"}
            )
            res = client.post("/api/token", json={"code": "test_valid_code"})
            assert res.status_code == 200
            assert res.json()["access_token"] == "mock_access_token_123"
            print("[OK] Discord token exchange API passed")


def test_websocket_with_avatar():
    client = TestClient(app)
    ROOMS.clear()

    avatar_url = "https://cdn.discordapp.com/avatars/123/abc.png"
    with client.websocket_connect(f"/ws/DSC-channel123/TestDiscordUser?avatar_url={avatar_url}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "JOINED"
        assert msg["room"] == "DSC-channel123"
        players = msg["players"]
        assert len(players) == 1
        assert players[0]["name"] == "TestDiscordUser"
        assert players[0]["avatar_url"] == avatar_url
        print("[OK] WebSocket connection with avatar_url in DSC room passed")


def test_room_settings_update_and_win_condition():
    from unittest.mock import patch
    client = TestClient(app)
    ROOMS.clear()

    with client.websocket_connect("/ws/test-room-settings/player1") as ws1:
        msg1 = ws1.receive_json()
        assert msg1["type"] == "JOINED"
        assert msg1["target_ippon"] == 3
        assert msg1["time_limit"] == 150
        ws1.receive_json()  # PLAYER_JOINED

        # プレイヤー2が参加
        with client.websocket_connect("/ws/test-room-settings/player2") as ws2:
            msg2 = ws2.receive_json()
            assert msg2["type"] == "JOINED"
            assert msg2["target_ippon"] == 3
            ws1.receive_json()  # PLAYER_JOINED for ws1
            ws2.receive_json()  # PLAYER_JOINED for ws2

            # ルール設定を変更 (1本先取、制限時間60秒)
            ws1.send_json({"type": "UPDATE_SETTINGS", "target_ippon": 1, "time_limit": 60})
            update_ws1 = ws1.receive_json()
            update_ws2 = ws2.receive_json()
            assert update_ws1["type"] == "SETTINGS_UPDATED"
            assert update_ws1["target_ippon"] == 1
            assert update_ws1["time_limit"] == 60
            assert update_ws2["type"] == "SETTINGS_UPDATED"
            assert update_ws2["target_ippon"] == 1
            assert update_ws2["time_limit"] == 60

            # ゲーム開始
            ws1.send_json({"type": "START_GAME"})
            th1 = ws1.receive_json()
            th2 = ws2.receive_json()
            assert th1["type"] == "THEME_STARTED"
            assert th1["target_ippon"] == 1
            assert th1["time_limit"] == 60
            assert th2["type"] == "THEME_STARTED"
            print("[OK] Room settings applied to THEME_STARTED (target_ippon=1, time_limit=60)")

            # 1本獲得で即座にMATCH_WINになることを検証
            with patch("main.gatekeep", return_value=(True, "")):
                with patch("main.judge") as mock_judge:
                    mock_judge.return_value = {
                        "total": 10,
                        "is_ippon": True,
                        "timeline": [{"score": 2, "delay_ms": 10} for _ in range(5)],
                        "failed": [],
                        "raw": {},
                    }
                    ws1.send_json({"type": "SUBMIT", "answer": "Winning Answer"})
                    assert ws1.receive_json()["type"] == "SUBMIT_ACK"
                    recv_ignore_timer(ws1)  # ANSWER_REVEALED
                    recv_ignore_timer(ws2)  # ANSWER_REVEALED
                    recv_ignore_timer(ws1)  # SCORE_REVEAL_START
                    recv_ignore_timer(ws2)  # SCORE_REVEAL_START
                    rr1 = recv_ignore_timer(ws1)  # ROUND_RESULT
                    rr2 = recv_ignore_timer(ws2)  # ROUND_RESULT
                    assert rr1["type"] == "ROUND_RESULT"
                    assert rr1["is_ippon"] is True
                    assert rr1["target_ippon"] == 1
                    assert rr2["type"] == "ROUND_RESULT"

                    mw1 = recv_ignore_timer(ws1)  # MATCH_WIN
                    mw2 = recv_ignore_timer(ws2)  # MATCH_WIN
                    assert mw1["type"] == "MATCH_WIN"
                    assert mw1["winner"] == "player1"
                    assert mw1["target_ippon"] == 1
                    assert mw2["type"] == "MATCH_WIN"
                    print("[OK] MATCH_WIN triggered on 1st IPPON when target_ippon=1")


if __name__ == "__main__":
    test_static_files()
    test_websocket_gameplay()
    test_full_scoring_flow()
    test_timer_pause_resume()
    test_reconnect_and_leave()
    test_discord_token_endpoint()
    test_websocket_with_avatar()
    test_room_settings_update_and_win_condition()
    print("=== All integration tests passed successfully ===")
