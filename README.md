# Ashi — AIに、足を。

Give your AI legs.

今の AI は頭が良いのに、話しかけられるまでその場から一歩も動けない。Ashi は、その AI に「足」を与えるプログラムである。自分で歩き出し、行き先を選び、寄り道し、疲れたら休む。

名前には二つの意味がある。ひとつは「自分の足で歩く」の足。もうひとつはパスカルの「人間は考える葦である」の葦。LLM はもともと考える葦で、Ashi はそこに足を与える。

## 頭と足

| | 受け持ち | コード |
| --- | --- | --- |
| 頭(LLM / Claude API) | 問いの評価、調べた結果の理解、知識のまとめ、新しい問い、内省、日記、自己記述、持ち主の興味の地図、足跡をいつ読むかの判断 | [`src/lib/server/ashi/head/`](src/lib/server/ashi/head/) |
| 足(Ashi 本体) | ループを回す、状態ファイルの読み書き、問いの選択(点数とさいころ)、道具の実行、休眠と起床、予算、ガードレール、足跡の巡回 | [`src/lib/server/ashi/legs/`](src/lib/server/ashi/legs/) |

- 足は「何を考えるか」を持たない。判断の中身は頭に任せ、足はそれを実行して安全な範囲に収める
- 頭との境目は `Head` インターフェース 1 つ([`head/head.ts`](src/lib/server/ashi/head/head.ts))。頭を差し替えるときは `Head` を実装したクラスを作り、[`runtime.ts`](src/lib/server/runtime.ts) と [`cli.ts`](src/cli.ts) で渡すものを変える
- 頭に見せる文と答えの形(JSON Schema)は [`prompts.ts`](src/lib/server/ashi/prompts.ts) にまとめてある

### ガードレール(頭の判断より常に優先する)

| | どこで |
| --- | --- |
| 予算の上限。1 日(ローカル時刻 0 時で戻る)と 1 歩の両方。使い切ったら翌日まで眠る。失敗した歩みや対話の分も数える | `guard.ts` `allowance` / `walk.ts` |
| 休む時間の範囲。頭の希望は `sleep.minMinutes`〜`maxMinutes` に丸める。疲れていたら上限まで休む | `guard.ts` `clampSleep` |
| コア原則の保護。`core.md` は人が書き、頭には書き換える手段が無い。中身が承認なしに変わったら歩くのを止め、人が `ashi core --accept` するまで再開しない | `walk.ts` / `cli.ts` |
| 読み取り専用。頭に渡す道具は `readOnly` のものだけ(fetch_url は GET、ノートは読むだけ)。手元のネットワーク(プライベートアドレス・転送先も)は読まない | `tools.ts` |
| 同じテーマの連続制限。`themeStreakLimit` 歩続いたら、そのテーマは選ばない。頭がまた出してきても受け取らない | `select.ts` / `walk.ts` |
| 頭の出力の検査。問いの数・長さ・重複、見立ての値の範囲、自己記述と地図の長さ、抱える問いの上限 | `guard.ts` |
| 足跡の巡回。人が `ashi.json` に書いた先だけを、同じ足跡は `feedMinHours` 時間空けて、1 歩で 3 つまで | `feeds.ts` |
| 弾かれたら知らせる。権限・鍵・課金・巡回の失敗は `/blocked` に直し方つきで出し、初めて起きたときに通知する。頭が歩いていて気づいた壁(有料の論文など)も同じ | `blockers.ts` |

## 二つの系統: 先回りと個性

問いは 2 つの系統に分かれる。どちらを歩くかは足がさいころで決める(`ownerShare`、既定は先回り 6 割)。

- **先回り(owner)**: 持ち主が知らなそうだが、いつか聞きそうなこと。聞かれたときにはもう掘ってある状態にしておく
- **個性(self)**: 持ち主の地図に無い方向。持ち主の写しにならず、持ち主に無い発想を自分の個性として育てる

持ち主の興味の地図(`owner.md`)は頭が書き直す。材料は次の 3 つ。

1. 画面の「話す」での持ち主の発言
2. 画面の「持ち主」で渡した文章(貼り付け・URL)
3. 持ち主の足跡の巡回(ブログの RSS・GitHub の公開イベント・X)

足跡を**いつ**読みに行くかは頭が決める。歩くたびに各足跡の様子(最後に読んだのは何時間前か、そのとき新しいものがいくつあったか)を見せ、読みたいものを答えの `crawl` に入れさせる。足は次の歩みの前に、間隔の下限を守って GET で読む。対話で「ブログを書いた」と言えば、頭がそれを受けて読みに行くこともある。

## 状態ディレクトリ(`ASHI_HOME`、既定は `./data`)

| ファイル | 書くのは | 中身 |
| --- | --- | --- |
| `ashi.json` | 人 | 設定([`config.ts`](src/lib/server/ashi/config.ts))。読むときに範囲へ丸める |
| `core.md` | 人 | コア原則 |
| `self.md` | 頭(内省) | 自己記述 |
| `owner.md` | 頭(地図の書き直し) | 持ち主の興味の地図 |
| `questions.json` | 足 | 問い |
| `notes.json` `notes/<id>.md` | 足(中身は頭) | 知識のノート |
| `diary/<日付>.md` | 足(中身は頭) | 日記 |
| `sources.json` `sources/<id>.md` | 足 | 持ち主から受け取った材料 |
| `feeds.json` | 足 | 足跡ごとの最後に読んだ時刻と取り込み済みの鍵 |
| `walk.json` `budget.json` | 足 | 歩数・直近のテーマ・次に起きる時刻、今日使った額 |
| `log.jsonl` `chat.jsonl` | 足 | 出来事、対話 |

足跡の書き方(`ashi.json`。環境変数 `ASHI_FEEDS` に同じ配列を JSON で入れると、そちらが勝つ。クラスタでは `deploy/deployment.yaml` に書いてある):

```json
{
	"feeds": [
		{ "id": "blog", "kind": "rss", "target": "https://doany.io/rss.xml", "title": "ブログ" },
		{ "id": "github", "kind": "github", "target": "5ym" },
		{ "id": "forgejo", "kind": "forgejo", "target": "yui" },
		{ "id": "x", "kind": "x", "target": "<X のユーザー名>" }
	]
}
```

- GitHub は公開イベント(push・PR・issue・スター・fork・リリース)。`GITHUB_TOKEN` があれば使う(無くても 1 時間 60 回まで読める)
- Forgejo は非公開リポジトリの動きも読む。`FORGEJO_URL`(クラスタの中の Service)と `FORGEJO_TOKEN`(read:user・read:repository)が要る
- X は公式 API だけを使う(ページの取り込みは規約に反するのでしない)。読むには `X_BEARER_TOKEN`(有料の API)が要る。無ければ「失敗」として残して飛ばす

## 画面

SvelteKit。ログインは Entra ID で、同じプロセスが歩みも回す(状態ファイルを 2 つのプロセスで書き合わないため。`walk.lock` で 1 プロセスに絞る)。

| 画面 | 中身 |
| --- | --- |
| `/` いま | 歩いているか・次に起きる時刻・今日の予算・次に歩きそうな問い・足どり。「起こす」 |
| `/chat` 話す | 何を学んだかを聞く、調べ物を頼む(問いに加わり、足が後で歩く)。答えるときはノートを引く |
| `/notes` ノート | 調べたことのノート |
| `/questions` 問い | 開いている問いと点数、答えた・手放した問い |
| `/diary` 日記 | 内省で書いた日記 |
| `/owner` 持ち主 | 持ち主の興味の地図、足跡の様子、文章を渡す |
| `/blocked` 弾かれたこと | 権限・鍵・課金・巡回の失敗と、その直し方。開いているものがあると全画面の上に帯が出る |
| `/context` 頭の中 | 自己記述・コア原則と、頭に毎回渡している system の全文、設定 |

### 環境変数

| 変数 | |
| --- | --- |
| `ANTHROPIC_API_KEY` | 頭(Claude API)の鍵 |
| `ENTRA_TENANT_ID` `ENTRA_CLIENT_ID` `ENTRA_CLIENT_SECRET` | Entra ID のアプリ登録。リダイレクト URI は `<ORIGIN>/auth/callback` |
| `ENTRA_ROLE` | 通すアプリロール(既定 `admin`)。空にするとテナントの全員 |
| `SESSION_SECRET` | セッションの署名(32 文字以上) |
| `ORIGIN` | 公開する URL(adapter-node。リダイレクト URI の組み立てに使う) |
| `ASHI_HOME` | 状態ディレクトリ(イメージでは `/data`) |
| `ASHI_WALK` | `0` なら歩かず画面だけ |
| `ASHI_CONFIG` | `ashi.json` の上に重ねる設定(JSON)。例 `{"budget":{"dailyUsd":5}}`。クラスタでは `deploy/deployment.yaml` に書く |
| `GITHUB_TOKEN` `X_BEARER_TOKEN` `FORGEJO_URL` `FORGEJO_TOKEN` | 足跡の巡回(任意) |
| `NOTIFY_WEBHOOK_URL` | 弾かれたことの通知(Mattermost / Slack の incoming webhook、任意) |

どの権限をどう付けるか、弾かれたときにどう直すかは [docs/permissions.md](docs/permissions.md) にまとめてある。

頭のモデルは `ashi.json` の `model`(既定 `claude-opus-5`、effort `high`)。拒否されたときはサーバー側のフォールバック(`fallbacks: "default"`)で別のモデルが答え直す。

## デプロイ

lgtm と同じ形。`deploy/argocd.yaml` を ArgoCD の ApplicationSet が拾い、`deploy/` を namespace `ashi` に同期する。公開は <https://as.doany.io>(HTTPRoute を Cilium Gateway に付ける)。main に push すると `docker-publish.yml` が ghcr.io/danything/ashi を焼き、イメージのタグを差し替える PR を作って自分でマージする。秘密は Infisical の `/ashi/ashi-secrets`(鍵の一覧は [docs/permissions.md](docs/permissions.md))。状態ディレクトリは PVC `ashi-data`(k8up がファイルとして取る)。Pod は 1 つで Recreate(歩くのは 1 プロセスだけ)。

## 手元で

```sh
bun i
bun src/cli.ts init "最初に歩きたい問い"   # ./data を作る
bun src/cli.ts step                        # 1 歩だけ
bun src/cli.ts walk                        # 止めるまで(Ctrl+C)
bun src/cli.ts status
bun run dev                                # 画面(歩みも回る。ASHI_WALK=0 で止める)
bun run check && bun test tests
```
