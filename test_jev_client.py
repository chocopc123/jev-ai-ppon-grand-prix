"""
jev_client.py の単体テストおよび検証スクリプト
"""
import asyncio
import unittest
from jev_client import _normalize, gatekeep, judge, _mock, GATEKEEP_QUESTIONS, JUDGE_QUESTIONS


class TestJevClient(unittest.TestCase):

    def test_normalize_noul(self):
        """OpenRouter decisions API の noul 型の正規化テスト"""
        raw = {
            "answers": {
                "on_topic": {"type": "noul", "noul": 0.85},
                "is_cliche": {"type": "noul", "noul": 0.20},
            }
        }
        res = _normalize(raw)
        self.assertTrue(res["on_topic"]["value"])
        self.assertAlmostEqual(res["on_topic"]["probability"], 0.85)
        self.assertFalse(res["is_cliche"]["value"])
        self.assertAlmostEqual(res["is_cliche"]["probability"], 0.20)

    def test_normalize_choice(self):
        """OpenRouter decisions API の choice 型の正規化テスト"""
        raw = {
            "answers": {
                "effort_level": {
                    "type": "choice",
                    "choice": "genuine",
                    "probabilities": {
                        "spam": 0.05,
                        "low": 0.15,
                        "genuine": 0.80
                    }
                }
            }
        }
        res = _normalize(raw)
        self.assertEqual(res["effort_level"]["value"], "genuine")
        self.assertAlmostEqual(res["effort_level"]["probability"], 0.80)

    def test_normalize_score(self):
        """OpenRouter decisions API の score 型の正規化テスト"""
        raw = {
            "answers": {
                "novelty": {
                    "type": "score",
                    "score": 0.75,
                    "confidence": 0.90
                }
            }
        }
        res = _normalize(raw)
        self.assertAlmostEqual(res["novelty"]["value"], 0.75)
        self.assertAlmostEqual(res["novelty"]["probability"], 0.90)

    def test_normalize_legacy_and_primitives(self):
        """従来の形式やプリミティブ値に対する耐性テスト"""
        raw = {
            "results": {
                "bool_key": True,
                "score_key": 0.65,
                "str_key": "test",
                "obj_key": {"value": "ok", "probability": 0.95}
            }
        }
        res = _normalize(raw)
        self.assertTrue(res["bool_key"]["value"])
        self.assertAlmostEqual(res["bool_key"]["probability"], 0.9)
        self.assertAlmostEqual(res["score_key"]["value"], 0.65)
        self.assertEqual(res["str_key"]["value"], "test")
        self.assertEqual(res["obj_key"]["value"], "ok")
        self.assertAlmostEqual(res["obj_key"]["probability"], 0.95)

    def test_mock_generation(self):
        """決定論的モックのテスト (同一入力で同一結果)"""
        state = {"theme": "テストお題", "answer": "テスト回答"}
        res1 = _mock(state, JUDGE_QUESTIONS)
        res2 = _mock(state, JUDGE_QUESTIONS)
        self.assertEqual(res1, res2)
        for k in JUDGE_QUESTIONS:
            self.assertIn(k, res1)
            self.assertIn("value", res1[k])
            self.assertIn("probability", res1[k])


class TestAsyncWorkflow(unittest.IsolatedAsyncioTestCase):

    async def test_gatekeep_mock(self):
        """ゲートキーパーの動作確認 (モック)"""
        theme = "こんなコンビニは嫌だ"
        answer = "レジ袋が有料どころか店員が有料"
        ok, reason = await gatekeep(theme, answer, [])
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(reason, str)

    async def test_judge_mock(self):
        """本審査・合成ロジックの動作確認 (モック)"""
        theme = "こんなコンビニは嫌だ"
        answer = "レジ袋が有料どころか店員が有料"
        result = await judge(theme, answer, [])
        
        self.assertIn("scores", result)
        self.assertEqual(len(result["scores"]), 10)
        self.assertIn("total", result)
        self.assertTrue(0 <= result["total"] <= 10)
        self.assertIn("is_ippon", result)
        self.assertIsInstance(result["is_ippon"], bool)
        self.assertIn("timeline", result)
        self.assertEqual(len(result["timeline"]), 10)
        
        for item in result["timeline"]:
            self.assertIn("judge", item)
            self.assertIn("score", item)
            self.assertIn("delay_ms", item)
            self.assertTrue(item["delay_ms"] >= 0)

    async def test_magic_ippon_word(self):
        """魔法の言葉 (chair-man) で必ずIPPONになることの検証"""
        theme = "どんなお題でも"
        answer = "chair-man"
        
        ok, reason = await gatekeep(theme, answer, [])
        self.assertTrue(ok)
        self.assertEqual(reason, "")

        result = await judge(theme, answer, [])
        self.assertTrue(result["is_ippon"])
        self.assertEqual(result["total"], 10)
        self.assertEqual(result["scores"], [1] * 10)
        self.assertEqual(len(result["timeline"]), 10)

    async def test_clutch_ippon_delay(self):
        """IPPONかつ確信度0.50の項目がある場合、最後の点灯ディレイが1000msになることの検証"""
        from unittest.mock import patch
        # 10項目すべて合格かつ、1つが0.50になるモック決定
        mock_decisions = {
            "on_topic": {"probability": 0.50},
            "has_punchline": {"probability": 0.90},
            "comprehensible": {"probability": 0.90},
            "is_cliche": {"probability": 0.10},
            "gut_funny": {"probability": 0.90},
            "novelty": {"value": 0.90},
            "conciseness": {"value": 0.90},
        }
        with patch("jev_client._decide", return_value=mock_decisions):
            result = await judge("お題", "テスト回答", [])
            self.assertTrue(result["is_ippon"])
            self.assertEqual(result["total"], 10)
            # 確信度0.50の項目（on_topic）が最後（10項目目）に来るため、delay_msが1000msになっていること
            last_item = result["timeline"][-1]
            self.assertEqual(last_item["delay_ms"], 1000)
            self.assertEqual(round(last_item["conf"], 2), 0.50)

    def test_room_timer_pause_and_resume(self):
        """Room の pause_timer / resume_timer の動作検証"""
        from main import Room
        import time

        room = Room("test_room")
        room.phase = "theme"
        room.deadline = time.time() + 60.0
        room.is_timer_paused = False

        # ポーズ実行
        room.pause_timer(silent=True)
        self.assertTrue(room.is_timer_paused)
        self.assertIsNone(room.deadline)
        self.assertGreater(room.paused_remaining, 55.0)

        # 再開実行
        room.resume_timer(silent=True)
        self.assertFalse(room.is_timer_paused)
        self.assertIsNotNone(room.deadline)
        self.assertGreater(room.deadline, time.time() + 55.0)


if __name__ == "__main__":
    unittest.main()


