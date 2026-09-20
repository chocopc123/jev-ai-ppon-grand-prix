"""
AI-PPON GRAND PRIX Web — FastAPI / WebSocket サーバー

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

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import Response, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from jev_client import gatekeep, judge, generate_theme, generate_theme_audio

load_dotenv()

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")

def log_answer(room_id: str, theme: str, player: str, answer: str, gatekeep_ok: bool, gatekeep_reason: str = "", judge_result: dict = None):
    """解答履歴をコンソールに出力する。"""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if not gatekeep_ok:
        print(f"[{now}] [ROOM: {room_id}] [没/GATEKEEP] プレイヤー: {player} | お題: {theme} | 回答: 「{answer}」 | 理由: {gatekeep_reason}")
    else:
        total = judge_result.get("total", 0) if judge_result else 0
        is_ippon = judge_result.get("is_ippon", False) if judge_result else False
        ippon_mark = "★ AI-PPON! (10点)" if is_ippon else f"{total}点"
        print(f"[{now}] [ROOM: {room_id}] [{ippon_mark}] プレイヤー: {player} | お題: {theme} | 回答: 「{answer}」")


app = FastAPI(title="AI-PPON GRAND PRIX Web")

@app.middleware("http")
async def add_discord_security_headers(request: Request, call_next):
    response = await call_next(request)
    # Discord Activity の iframe 埋め込みを許可
    response.headers["Content-Security-Policy"] = (
        "frame-ancestors 'self' https://*.discordsays.com https://discord.com https://*.discord.com;"
    )
    return response


class DiscordTokenRequest(BaseModel):
    code: str


@app.post("/api/token")
async def exchange_discord_token(req: DiscordTokenRequest):
    """Discord Embedded App SDK から届いた認証コードを Discord API で access_token に交換する。"""
    if not DISCORD_CLIENT_ID or not DISCORD_CLIENT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="Discord credentials (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET) are not configured on server"
        )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://discord.com/api/oauth2/token",
            data={
                "client_id": DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": req.code,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Discord token exchange failed: {resp.text}")
    return resp.json()


@app.get("/api/config")
async def get_config():
    """フロントエンドに必要な動的設定（Discord Client IDなど）を返す。"""
    return {
        "discord_client_id": DISCORD_CLIENT_ID,
    }


@app.get("/api/tts/theme")
async def get_theme_audio(text: str, voice: str = "Algieba"):
    """Gemini 3.1 Flash TTS Preview で生成したお題の低音WAV音声を返す。"""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text parameter is required")
    audio_bytes = await generate_theme_audio(text.strip(), voice_name=voice)
    if not audio_bytes:
        raise HTTPException(status_code=502, detail="Failed to generate audio via Gemini TTS")
    return Response(content=audio_bytes, media_type="audio/wav")


@app.get("/terms", response_class=HTMLResponse)
async def terms_of_service():
    """Discord App Directory 審査対応・全15条形式の利用規約"""
    html_content = """<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>利用規約 - AI-PPON GRAND PRIX</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; max-width: 820px; margin: 0 auto; padding: 40px 20px; background: #0f1117; color: #e2e8f0; }
        h1 { color: #ffd700; border-bottom: 2px solid #ffd700; padding-bottom: 12px; font-size: 26px; }
        h2 { color: #f6ad55; margin-top: 32px; font-size: 19px; border-left: 4px solid #f6ad55; padding-left: 10px; }
        p, li { color: #cbd5e1; font-size: 15px; }
        ul, ol { padding-left: 20px; }
        .date { color: #718096; font-size: 13px; margin-bottom: 24px; }
        .lang-switch { margin-top: 45px; padding-top: 25px; border-top: 1px dashed #4a5568; }
    </style>
</head>
<body>
    <h1>利用規約</h1>
    <div class="date">制定日: 2026年9月20日 / Last Updated: September 20, 2026</div>

    <p>この利用規約（以下，「本規約」といいます。）は，AI-PPON GRAND PRIX 開発運営チーム（以下，「当チーム」といいます。）が提供するサービス「AI-PPON GRAND PRIX」（以下，「本サービス」といいます。）の利用条件を定めるものです。ユーザーの皆さま（以下，「ユーザー」といいます。）には，本規約に従って，本サービスをご利用いただきます。</p>

    <section>
        <h2>第1条（適用）</h2>
        <p>1. 本規約は，ユーザーと当チームとの間の本サービスの利用に関わる一切の関係に適用されるものとします。<br>
        2. 当チームは本サービスに関し，本規約のほか，ご利用にあたってのルール等，各種の定め（以下，「個別規定」といいます。）をすることがあります。これら個別規定はその名称のいかんに関わらず，本規約の一部を構成するものとします。<br>
        3. 本規約の規定が個別規定の規定と矛盾する場合には，個別規定において特段の定めなき限り，個別規定の規定が優先されるものとします。</p>

        <h2>第2条（利用登録および利用開始）</h2>
        <p>1. 本サービスは，Webブラウザ上でのプレイヤー名入力，またはDiscord Embedded App SDK等を通じたアカウント認証により，アカウント登録不要で即座にご利用を開始いただけます。<br>
        2. 当チームは，ユーザーが以下の事由に該当すると判断した場合，本サービスの利用を承認しない（または遮断する）ことがあり，その理由については一切の開示義務を負わないものとします：</p>
        <ul>
            <li>本規約に違反したことがある者からの利用である場合</li>
            <li>Discord経由の利用において，Discordの利用規約またはコミュニティガイドラインに違反している場合</li>
            <li>その他，当チームが利用を相当でないと判断した場合</li>
        </ul>

        <h2>第3条（認証情報およびアクセスの管理）</h2>
        <p>1. ユーザーは，自己の責任において，本サービスへのアクセスに用いる環境（Webブラウザ環境，Discordアカウント等）を適切に管理するものとします。<br>
        2. ユーザーは，いかなる場合にも，認証情報を第三者に譲渡または貸与し，もしくは第三者と共用することはできません。<br>
        3. アカウントまたは端末の不正利用等によって生じた損害について，当チームに故意または重大な過失がある場合を除き，当チームは一切の責任を負わないものとします。</p>

        <h2>第4条（利用料金）</h2>
        <p>1. 本サービスは，Web版およびDiscord版ともに原則として無料でご利用いただけます。<br>
        2. 将来的に有料機能または追加コンテンツを提供する場合，利用料金および支払方法は本サービス上にて別途告知するものとします。</p>

        <h2>第5条（禁止事項）</h2>
        <p>ユーザーは，本サービスの利用にあたり，以下の行為をしてはなりません：</p>
        <ol>
            <li>法令または公序良俗に違反する行為</li>
            <li>犯罪行為に関連する行為</li>
            <li>Discord経由の利用において，Discordの利用規約またはコミュニティガイドラインに反する行為</li>
            <li>他者に対する嫌がらせ，脅迫，中傷，差別的表現，わいせつな表現を含む大喜利回答等の投稿</li>
            <li>当チーム，他のユーザー，または第三者のサーバー・ネットワーク・インフラの機能を破壊または妨害する行為</li>
            <li>本サービスの運営を妨害するおそれのある行為、または過度なリクエストを送信する行為</li>
            <li>不正アクセスをし，またはこれを試みる行為</li>
            <li>他のユーザーの個人情報を無断で収集または蓄積する行為</li>
            <li>他のユーザーに成りすます行為</li>
            <li>当チームが許諾しない本サービス上での宣伝，広告，勧誘，または営業行為</li>
            <li>反社会的勢力に対して直接または間接に利益を供与する行為</li>
            <li>その他，当チームが不適切と判断する行為</li>
        </ol>

        <h2>第6条（本サービスの提供の停止等）</h2>
        <p>1. 当チームは，以下のいずれかの事由があると判断した場合，ユーザーに事前に通知することなく本サービスの全部または一部の提供を停止または中断することができるものとします：</p>
        <ul>
            <li>本サービスにかかるコンピュータシステムの保守点検または更新を行う場合</li>
            <li>地震，落雷，火災，停電または天災などの不可抗力により，本サービスの提供が困難となった場合</li>
            <li>コンピュータまたは通信回線，外部AI API等の障害により停止した場合</li>
            <li>その他，当チームが本サービスの提供が困難と判断した場合</li>
        </ul>
        <p>2. 当チームは，本サービスの提供の停止または中断により，ユーザーまたは第三者が被ったいかなる不利益または損害についても，一切の責任を負わないものとします。</p>

        <h2>第7条（利用制限等）</h2>
        <p>当チームは，ユーザーが本規約のいずれかの条項に違反した場合，または当チームが利用を不適当と判断した場合には，事前の通知なく，当該ユーザーに対する本サービスの全部もしくは一部の利用を制限・遮断することができるものとします。</p>

        <h2>第8条（利用終了）</h2>
        <p>ユーザーは，Webブラウザのタブを閉じる，ゲーム内の退出ボタンを押す，またはDiscordクライアント上で本アクティビティを閉じる・連携解除することにより，いつでも自由に本サービスの利用を終了することができます。</p>

        <h2>第9条（保証の否認および免責事項）</h2>
        <p>1. 当チームは，本サービスに事実上または法律上の瑕疵（安全性，信頼性，正確性，完全性，有効性，特定の目的への適合性，セキュリティなどに関する欠陥，エラーやバグ，権利侵害などを含みます。）がないことを明示的にも黙示的にも保証しておりません。<br>
        2. 本サービス内でAI（人工知能）により生成・判定されるお題，音声，判定結果（一本等のユーモア評価）は娯楽目的のみで提供され，その正確性や妥当性を保証するものではありません。<br>
        3. 当チームは，本サービスに起因してユーザーに生じたあらゆる損害について，当チームの故意または重過失による場合を除き，一切の責任を負いません。<br>
        4. 当チームは，本サービスに関して，ユーザーと他のユーザーまたは第三者との間において生じた取引，連絡または紛争等について一切責任を負いません。</p>

        <h2>第10条（サービス内容の変更等）</h2>
        <p>当チームは，ユーザーへの事前の告知または本ウェブサイト上への掲載をもって，本サービスの内容を変更，追加または廃止することがあり，ユーザーはこれを承諾するものとします。</p>

        <h2>第11条（利用規約の変更）</h2>
        <p>当チームは，必要と判断した場合には，ユーザーへの個別の事前承諾を得ることなく，本ウェブサイト上に変更後の規約を掲示することにより本規約を変更できるものとします。変更後の規約は，本ウェブサイト上に表示された時点より効力を生じるものとします。</p>

        <h2>第12条（個人情報の取扱い）</h2>
        <p>当チームは，本サービスの利用によって取得する情報については，当チームが別途定める「プライバシーポリシー」に従い適切に取り扱うものとします。</p>

        <h2>第13条（通知または連絡）</h2>
        <p>ユーザーと当チームとの間の通知または連絡は，本ウェブサイト上またはDiscord上のアナウンス，その他当チームが適当と認める方法により行うものとします。</p>

        <h2>第14条（権利義務の譲渡の禁止）</h2>
        <p>ユーザーは，当チームの書面による事前の承諾なく，利用契約上の地位または本規約に基づく権利もしくは義務を第三者に譲渡し，または担保に供することはできません。</p>

        <h2>第15条（準拠法・裁判管轄）</h2>
        <p>1. 本規約の解釈にあたっては，日本法を準拠法とします。<br>
        2. 本サービスに関して紛争が生じた場合には，日本国内の東京地方裁判所を第一審の専属的合意管轄裁判所とします。</p>
    </section>

    <div class="lang-switch">
        <h2>English Summary (for Discord Verification & Web Users)</h2>
        <p><strong>Terms of Service Summary:</strong> "AI-PPON GRAND PRIX" is a free online entertainment party game available via web browsers and as a Discord Activity. No account registration is required. Users must adhere to applicable laws and platform rules (including Discord Community Guidelines when using Discord). Harmful, harassing, or infringing content is strictly prohibited. AI judgments, voices, and generated themes are for amusement purposes only with no warranty. The service is provided "AS IS" and may be modified or terminated at any time.</p>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html_content)


@app.get("/privacy", response_class=HTMLResponse)
async def privacy_policy():
    """Discord App Directory 審査対応・個人情報保護法準拠・Developer Policy準拠のプライバシーポリシー（Web/Discord両対応）"""
    html_content = """<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>プライバシーポリシー - AI-PPON GRAND PRIX</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; max-width: 820px; margin: 0 auto; padding: 40px 20px; background: #0f1117; color: #e2e8f0; }
        h1 { color: #ffd700; border-bottom: 2px solid #ffd700; padding-bottom: 12px; font-size: 26px; }
        h2 { color: #f6ad55; margin-top: 32px; font-size: 19px; border-left: 4px solid #f6ad55; padding-left: 10px; }
        p, li { color: #cbd5e1; font-size: 15px; }
        ul { padding-left: 20px; }
        .date { color: #718096; font-size: 13px; margin-bottom: 24px; }
        .contact-box { background: rgba(255, 255, 255, 0.05); border: 1px solid #4a5568; border-radius: 8px; padding: 16px 20px; margin-top: 10px; }
        .notice-box { background: rgba(246, 173, 85, 0.1); border-left: 3px solid #f6ad55; padding: 10px 14px; margin-top: 8px; font-size: 14px; }
        .lang-switch { margin-top: 45px; padding-top: 25px; border-top: 1px dashed #4a5568; }
    </style>
</head>
<body>
    <h1>プライバシーポリシー</h1>
    <div class="date">制定日: 2026年9月20日 / Last Updated: September 20, 2026</div>

    <p>AI-PPON GRAND PRIX 開発運営チーム（以下，「当チーム」といいます。）は，WebブラウザおよびDiscordアクティビティとして提供する本サービス「AI-PPON GRAND PRIX」（以下，「本サービス」といいます。）におけるユーザーの情報の取扱いについて，以下のとおりプライバシーポリシー（以下，「本ポリシー」といいます。）を定めます。</p>

    <section>
        <h2>第1条（個人情報および取得する情報）</h2>
        <p>1. 「個人情報」とは，個人情報保護法にいう「個人情報」を指すものとします。<br>
        2. 本サービスにおいて当チームが取得する情報は，利用形態（Discord版またはWebブラウザ版）に応じた以下の情報に限定されます：</p>
        <ul>
            <li><strong>Discordアクティビティ経由での利用時：</strong>
                <ul>
                    <li>Discordアカウント公開情報（ユーザーID，表示名/ユーザー名，アバター画像URL）</li>
                </ul>
            </li>
            <li><strong>Webブラウザ経由での利用時：</strong>
                <ul>
                    <li>ユーザー自身が入力した任意のプレイヤー名（ニックネーム）</li>
                    <li>同一端末からの再接続を識別するためのランダム生成された一時的識別子（ブラウザのローカルストレージにのみ保存）</li>
                </ul>
            </li>
            <li><strong>共通情報（ゲームプレイデータ）：</strong>
                <ul>
                    <li>ゲームルーム内でお題に対して送信された大喜利の回答テキスト</li>
                </ul>
            </li>
        </ul>
        <p>※ パスワード，実名，メールアドレス，住所，電話番号，クレジットカード番号等の機密情報は一切取得・保管いたしません。</p>

        <h2>第2条（個人情報の収集方法）</h2>
        <p>当チームは，ユーザーがDiscordクライアント上で認証した際にDiscord API（Embedded App SDK）を通じて，またはWebブラウザ上の入力フォームを通じて，上記第1条記載の情報を必要最小限取得します。</p>

        <h2>第3条（個人情報を収集・利用する目的）</h2>
        <p>当チームが情報を収集・利用する目的は，以下のとおりです。</p>
        <ul>
            <li>本サービスにおけるゲームセッションの作成・マッチングおよび対戦運営のため</li>
            <li>ゲームルーム内における参加プレイヤーの識別，スコア集計および勝敗判定の表示のため</li>
            <li>ユーザーが入力した回答に対するAIによるリアルタイム審査・採点処理の実行のため</li>
            <li>不正行為・利用規約違反行為の防止および調査のため</li>
            <li>ユーザーからのお問い合わせに対応するため</li>
        </ul>

        <h2>第4条（利用目的の変更）</h2>
        <p>当チームは，利用目的が変更前と関連性を有すると合理的に認められる場合に限り，個人情報の利用目的を変更するものとします。変更を行った場合には，変更後の目的について本ウェブサイト上に公表します。</p>

        <h2>第5条（個人情報の第三者提供・外部連携およびAI学習の禁止）</h2>
        <p>1. 当チームは，次に掲げる場合を除いて，あらかじめユーザーの同意を得ることなく第三者に個人情報を提供することはありません：</p>
        <ul>
            <li>人の生命，身体または財産の保護のために必要がある場合</li>
            <li>国の機関もしくは地方公共団体またはその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合</li>
            <li>法令に基づく場合</li>
        </ul>
        <p>2. （AI審査機能における外部サービス連携）本サービスは，回答のユーモア判定・審査のためにGoogle LLC等の提供するAIサービス（Gemini API等）とテキスト連携を行います。当該送信には回答テキストおよびお題のみが含まれ，個人を特定可能な情報（個人名や連絡先等）は含まれません。<br>
        3. （AI学習・トレーニングの禁止 / Discord Developer Policy準拠）本サービスを通じて取得したDiscordユーザーデータおよび回答テキストは，ゲーム内でのリアルタイム判定および演出の目的のみに使用され，<strong>AI・機械学習モデルのトレーニング・追加学習データとして使用・提供されることは一切ありません</strong>。</p>

        <h2>第6条（データの管理と保持期間）</h2>
        <p>本サービスで送受信されるユーザー情報および回答データは，ゲームセッション（ルーム）の進行中のみサーバーの揮発性メモリ上に一時保持されます。ゲームセッションの終了または切断後，当該データは自動的に消去され，永続的なデータベース等への保存は行いません。</p>

        <h2>第7条（個人情報の開示・訂正・削除）</h2>
        <p>1. ユーザーは，当チームの保有する自己の個人情報について開示・訂正・削除を請求することができます。当チームは，ユーザー本人からの請求であることを確認の上，遅滞なく対応を行います。<br>
        2. <strong>（データ非保持に関する特記事項）</strong>当チームは第6条に定めるとおり，ユーザーデータをサーバー上に永続保持せず，ゲームセッション終了後にすべて自動消去いたします。そのため，セッション終了後における開示・訂正・削除のご請求については，当チーム側に保有する対象データが存在しないため，対応いたしかねる旨をあらかじめご了承ください。</p>

        <h2>第8条（個人情報の利用停止等）</h2>
        <p>1. 当チームは，本人から個人情報が利用目的の範囲を超えて取り扱われている等の理由により利用停止を求められた場合には，遅滞なく必要な調査を行い，その結果に基づき利用停止等の措置を講じます。<br>
        2. 第7条第2項と同様に，セッション終了後は対象データが既に自動破棄されているため，利用停止措置を行うべきデータが存在しない状態となります。</p>

        <h2>第9条（未成年者・児童のプライバシー保護）</h2>
        <p>本サービスは，13歳未満（または利用者の居住地域の法令が定める年齢未満）の児童を対象としておらず，13歳未満の児童から意図して個人情報を収集することはありません。13歳未満のお子様が本サービスを利用されたことが判明した場合，速やかに関連する一時データを破棄します。</p>

        <h2>第10条（プライバシーポリシーの変更）</h2>
        <p>本ポリシーの内容は，法令その他本ポリシーに別段の定めのある事項を除いて，ユーザーに通知することなく変更することができるものとします。変更後のプライバシーポリシーは，本ウェブサイトに掲載したときから効力を生じるものとします。</p>

        <h2>第11条（お問い合わせ窓口）</h2>
        <p>本ポリシーに関するお問い合わせ・苦情・ご質問等は，以下の窓口までご連絡ください。Discordアカウントをお持ちでないWebユーザーの方もメールまたはお問い合わせフォームよりご連絡いただけます。</p>
        <div class="contact-box">
            <p style="margin: 4px 0;"><strong>サービス名：</strong> AI-PPON GRAND PRIX</p>
            <p style="margin: 4px 0;"><strong>運営組織：</strong> AI-PPON GRAND PRIX 開発運営チーム</p>
            <p style="margin: 4px 0;"><strong>Discordサポート：</strong> 公式Discordサーバーまたは開発者DM</p>
            <p style="margin: 4px 0;"><strong>Web・メール窓口：</strong> <a href="mailto:support@ai-ppon.internal" style="color: #ffd700;">support@ai-ppon.internal</a> （またはアプリ公式お問い合わせフォーム）</p>
        </div>
    </section>

    <div class="lang-switch">
        <h2>English Summary (for Discord Verification & Compliance)</h2>
        <p><strong>Privacy Policy Summary:</strong> "AI-PPON GRAND PRIX" operates via web browsers and as a Discord Activity. Via Discord, we only access public profile details (User ID, username, avatar URL) to display scores. Via web, only self-assigned nicknames and temporary local storage session tokens are used.<br>
        <strong>Zero Data Retention:</strong> All user information and submitted game answers are strictly processed in-memory during an active session and are permanently wiped immediately upon session closure. Thus, no persistent personal data is stored on disk.<br>
        <strong>No AI Model Training:</strong> In compliance with Discord Developer Policy (Rule 21), user data and answers are NEVER used to train, tune, or improve machine learning or AI models.<br>
        <strong>Children's Privacy:</strong> The service is not directed at children under the age of 13, and does not knowingly collect personal data from them.<br>
        <strong>Contact:</strong> For privacy inquiries, please contact our support desk via Discord or support email.</p>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html_content)


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
            {
                "id": pid,
                "name": p["name"],
                "ippons": p["ippons"],
                "avatar_url": p.get("avatar_url"),
            }
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
    avatar_url: str | None = None,
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
        if avatar_url:
            p["avatar_url"] = avatar_url
        p["connected"] = True
    else:
        room.players[pid] = {
            "name": player_name or "名無し",
            "ws": ws,
            "ippons": 0,
            "connected": True,
            "disconnect_task": None,
            "avatar_url": avatar_url,
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
            elif t == "TOGGLE_TTS":
                room.tts_enabled = not room.tts_enabled
                pname = room.players.get(pid, {}).get("name", "プレイヤー")
                print(f"[ROOM {room_id}] 🎙️ TTS toggled to {room.tts_enabled} by {pname}")
                if room.tts_enabled and room.phase == "waiting" and (not room._pregen_task or room._pregen_task.done()):
                    room.schedule_next_pregeneration()
                room.broadcast({
                    "type": "TTS_TOGGLED",
                    "tts_enabled": room.tts_enabled,
                })
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
