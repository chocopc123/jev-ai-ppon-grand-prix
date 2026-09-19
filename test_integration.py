"""
OOGIRI GRAND PRIX Web の統合テスト (HTTP 静的配信 + WebSocket 対戦フロー)
"""
import asyncio
from fastapi.testclient import TestClient
from main import app, ROOMS


def test_static_files():
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "<!doctype html>" in response.text.lower() or "<html" in response.text.lower()
    print("[OK] Static file (index.html) served successfully")


def test_websocket_gameplay():
    from unittest.mock import patch
    client = TestClient(app)
    ROOMS.clear()

    with patch("main.gatekeep") as mock_gk:
        # 1回目: 通過、2回目: 通過、3回目: 重複没
        mock_gk.side_effect = [
            (True, ""),
            (True, ""),
            (False, "直前の回答と重複しています"),
        ]
        # プレイヤー1が参加
        with client.websocket_connect("/ws/test-room/player1") as ws1:
            msg1 = ws1.receive_json()
            assert msg1["type"] == "JOINED"
            assert msg1["room"] == "test-room"
            
            pj_msg1 = ws1.receive_json()
            assert pj_msg1["type"] == "PLAYER_JOINED"

            theme_msg1 = ws1.receive_json()
            assert theme_msg1["type"] == "THEME_STARTED"
            assert "theme" in theme_msg1
            print(f"[OK] Player 1 joined, Theme: {theme_msg1['theme']}")

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
                ws1.receive_json() # SUBMIT_ACK
                ws1.receive_json() # ANSWER_REVEALED
                ws2.receive_json()

                score1 = ws1.receive_json()
                ws2.receive_json()
                assert score1["type"] == "SCORE_REVEAL_START"
                ws1.receive_json() # ROUND_RESULT
                ws2.receive_json()
                print("[OK] 1st answer scored")

                # プレイヤー1が2回目の回答を送信
                ws1.send_json({"type": "SUBMIT", "answer": "回答2"})
                ws1.receive_json() # SUBMIT_ACK
                ws1.receive_json() # ANSWER_REVEALED
                ws2.receive_json()

                score2 = ws1.receive_json()
                ws2.receive_json()
                assert score2["type"] == "SCORE_REVEAL_START"
                ws1.receive_json() # ROUND_RESULT
                ws2.receive_json()
                print("[OK] 2nd answer scored")

                # プレイヤー1が3回目の同一回答を送信
                ws1.send_json({"type": "SUBMIT", "answer": "回答2"})
                ws1.receive_json() # SUBMIT_ACK
                ws1.receive_json() # ANSWER_REVEALED
                ws2.receive_json()

                reject1 = ws1.receive_json()
                ws2.receive_json()
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
            ws1.receive_json()  # THEME_STARTED

            # 回答送信
            ws1.send_json({"type": "SUBMIT", "answer": "Great Comedy Answer"})
            ack = ws1.receive_json()
            assert ack["type"] == "SUBMIT_ACK"

            ans = ws1.receive_json()
            assert ans["type"] == "ANSWER_REVEALED"

            score = ws1.receive_json()
            assert score["type"] == "SCORE_REVEAL_START"
            assert len(score["timeline"]) == 5
            print(f"[OK] Full judging flow: Total={score['total']}, IPPON={score['is_ippon']}")

            # 演出時間待機後のラウンド結果
            res = ws1.receive_json()
            assert res["type"] == "ROUND_RESULT"
            print(f"[OK] Full flow ROUND_RESULT received: is_ippon={res['is_ippon']}")


def test_timer_pause_resume():
    client = TestClient(app)
    ROOMS.clear()

    with client.websocket_connect("/ws/test-room-timer/player1") as ws1:
        joined = ws1.receive_json()  # JOINED
        assert joined["type"] == "JOINED"
        assert joined["is_timer_paused"] is False
        ws1.receive_json()  # PLAYER_JOINED
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


if __name__ == "__main__":
    test_static_files()
    test_websocket_gameplay()
    test_full_scoring_flow()
    test_timer_pause_resume()
    print("=== All integration tests passed successfully ===")
