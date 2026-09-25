# 権限の付け方

Ashi が自分で学ぶために要る権限と、弾かれたときの直し方。弾かれると画面の上に帯が出て(`/blocked` に一覧)、`NOTIFY_WEBHOOK_URL` があれば初めて起きたときに通知する。同じ先がうまくいけば自動で片づく。

値はどれもサーバーの環境変数で渡す。クラスタでは Infisical(il.doany.io、プロジェクト `doa`・環境 `prod`)のフォルダ **`/ashi/ashi-secrets`** に置く。Infisical operator が Secret `ashi-secrets` にし、Deployment は同期で自動的に入れ替わる(`deploy/secret.yaml`)。同期しないときは `kubectl -n ashi rollout restart deploy/ashi`(operator は失敗のあとバックオフする)。

| Infisical の鍵 | 環境変数 | |
| --- | --- | --- |
| `claude-code-oauth-token` | `CLAUDE_CODE_OAUTH_TOKEN` | 必須(頭を `claude-code` にしているとき)。`claude setup-token` の出力 |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | 頭を `api` にするときだけ |
| `entra-client-secret` | `ENTRA_CLIENT_SECRET` | 必須。値は `${prod.auth.auth-secrets.oidc-client-secret}`(Main のシークレットへの参照) |
| `session-secret` | `SESSION_SECRET` | 必須。`openssl rand -base64 48` |
| `github-token` | `GITHUB_TOKEN` | 任意 |
| `x-bearer-token` | `X_BEARER_TOKEN` | 任意 |
| `forgejo-token` | `FORGEJO_TOKEN` | 任意 |
| `notify-webhook-url` | `NOTIFY_WEBHOOK_URL` | 任意 |

必須のものが無いと Pod は起動しない(CreateContainerConfigError)。任意のものは無くても動き、使う場面で `/blocked` に出る。`ENTRA_TENANT_ID`・`ENTRA_CLIENT_ID`・`ORIGIN`(https://as.doany.io)・`FORGEJO_URL` は秘密ではないので `deploy/deployment.yaml` に直接書いてある。

## 最初に要るもの

### 1. 頭

頭の繋ぎ方は 2 つある(`ASHI_CONFIG` の `head`)。クラスタでは `claude-code` にしてある。

| `head` | 払い方 | 鍵 | 止め方 |
| --- | --- | --- | --- |
| `claude-code` | Claude のサブスク(Pro / Max) | `claude-code-oauth-token` | 1 日の歩数(`maxStepsPerDay`、既定 30) |
| `api` | platform.claude.com の従量課金 | `anthropic-api-key` | 1 日と 1 歩の額(`budget`) |

#### サブスク(`claude-code`)

1. 手元で `claude setup-token` を実行する(ブラウザでログイン)。出てきた `sk-ant-oat…`(1 年有効)を Infisical の `claude-code-oauth-token` に入れる
2. 5 時間ごと・週ごとの上限は、手元の Claude Code と共有する。当たると「サブスクの使用量の上限に当たった」が `/blocked` に出て、Ashi は長く休む
3. 頭の web の読み込みは Claude Code の WebFetch になるので、プライベートアドレスを読まない制限は `deploy/networkpolicy.yaml`(Pod の外向きの通信)で掛けている。ノートを読む Read は状態ディレクトリの `notes/` の中だけ

| 弾かれ方 | `/blocked` の題 | 付け方 |
| --- | --- | --- |
| 401 | Claude Code のサブスクのトークンが通らない | `claude setup-token` で出し直して差し替える |
| 429・上限 | サブスクの使用量の上限に当たった | 戻るのを待つ。減らすなら `maxStepsPerDay` を下げる |

#### 従量課金(`api`)

| 弾かれ方 | `/blocked` の題 | 付け方 |
| --- | --- | --- |
| 401 | Claude API の鍵が通らない(`sk-ant-oat…` なら「サブスクのトークンが入っている」) | <https://platform.claude.com/settings/keys> で API キーを作り、`ANTHROPIC_API_KEY` に入れる |
| 残高不足 | Claude API の残高が足りない | <https://platform.claude.com/settings/billing> でクレジットを足す。自動チャージも設定できる |
| web 検索が使えない | Claude の web 検索が組織で許可されていない | Console の組織の設定(Settings → Privacy)で web search を有効にする。使わせないなら `ashi.json` の `allowWeb: false` |
| 403 | Claude API で権限が足りない | キーのワークスペースで `ashi.json` の `model`(既定 `claude-opus-5-5`)が使えるか確かめる |

使う額の上限は Ashi の側でも決めている(`ashi.json` の `budget.dailyUsd`、既定 2 ドル / 日)。Console のワークスペースにも月の上限を付けておくと二重に止まる。

### 2. Entra ID(画面のログイン)

doany.io の他のアプリと同じく、共有のアプリ登録 `Main`(クライアント ID `b0fa498f-…`)を使う。

1. リダイレクト URI `https://as.doany.io/auth/callback` は `Main` に登録済み(2026-09-24、`az ad app update --web-redirect-uris` で既存の一覧に足した。この az は一覧を丸ごと置き換えるので、足すときは今の一覧を読んでから全部渡す)
2. クライアントシークレットは写さず、Infisical で `entra-client-secret` に `${prod.auth.auth-secrets.oidc-client-secret}` と書いて参照する
3. アプリ ロール `admin` があること(`Main` には既にある)
4. エンタープライズ アプリケーション → 同じアプリ → ユーザーとグループ → 使う人に `admin` を割り当てる。**テナントに P1 が無いのでグループは割り当てられない。人ごとに割り当てる**
5. `session-secret` に 32 文字以上の乱数(`openssl rand -base64 48`)

ロールが無い人は「アプリロール admin が割り当てられていない」で 403 になる。テナントの全員に開けるなら `ENTRA_ROLE=`(空)。

### 3. 通知(任意)

弾かれたことを画面を開かなくても知るため。

- Mattermost: 統合機能 → 内向きのウェブフック → 追加 → URL を `NOTIFY_WEBHOOK_URL`
- Slack: Incoming Webhooks のアプリを入れて URL を `NOTIFY_WEBHOOK_URL`

どちらも `{"text": "..."}` を POST するだけ。

## 持ち主の足跡(`ashi.json` の `feeds`)

いつ読みに行くかは頭が決める。足は同じ足跡を `feedMinHours`(既定 6 時間)空けて読む。

| 足跡 | 要るもの | 弾かれたら |
| --- | --- | --- |
| ブログ(`rss`) | 無し。`https://doany.io/rss.xml` のような公開のフィード | 404 なら URL を直す(記事一覧のページではなくフィードの URL)。ログインが要るフィードは読めない |
| GitHub(`github`) | 無くても 1 時間 60 回まで読める。回数の上限に当たったら鍵を足す | <https://github.com/settings/personal-access-tokens/new> で fine-grained token を作る。Repository access は **Public repositories**、権限は**何も付けない**。`GITHUB_TOKEN` に入れる |
| Forgejo(`forgejo`) | **鍵が要る**(非公開リポジトリの動きも読むため) | <https://fj.doany.io/user/settings/applications> でアクセストークンを作る。権限は **read:user と read:repository だけ**(書き込みは付けない)→ Infisical の `forgejo-token`。宛先はクラスタの中の Service(`FORGEJO_URL`、ノードから Gateway の 443 に折り返せないため) |
| X(`x`) | **有料の API の鍵が要る**(ページの取り込みは規約に反するのでしない) | <https://developer.x.com/en/portal/dashboard> で Project と App を作り、ユーザーのポストを読めるプランにして Bearer Token を発行 → `X_BEARER_TOKEN`。読まないなら `feeds` から外す |

GitHub で読むのは公開イベント(push・PR・issue・スター・fork・リリース)、Forgejo は push・PR・issue・コメント・スター・リリース。

`FORGEJO_URL` だけは、人が決めた宛先なのでプライベートアドレスでも読む。そのかわり転送は追わない(鍵を付けたまま別の先へ飛ばされないため)。頭が選ぶ fetch_url のガードは変わらない。

## 頭が歩いていて弾かれたとき

- **ページが 401 / 403 / 451**(`<host> に弾かれた`): ログインが要るか、ロボットを締め出しているページ。**Ashi は読むだけの足なので、ログインはしない**(鍵を渡す口も作っていない)。要る中身なら「持ち主」の画面で貼り付けるか、公開されている別の出典を話しかけて教える
- **手元のネットワークを読もうとして止めた**: ガードレールで、プライベートアドレス(クラスタの中・家の LAN)は読まない。これは権限で開けるものではない。中身を貼り付ける
- **頭が知らせてきたもの**(`<どこ> に入れなかった`): 有料の論文・購読の要る記事・鍵の要る API など。論文は、頭がまず `find_papers` で公開版(PMC・機関リポジトリ・著者版)を探し、それも無かったときだけ知らせる(2026-09-25 から)。直し方は頭が書いてくる。対応したら `/blocked` で「対応した・気にしない」を押す

## 権限を足しても開けないもの

ガードレールなので、設定では外れない。

- 外の世界に書き込むこと(投稿・送信・購入・登録・フォームの送信)。道具は GET だけ
- コア原則(`core.md`)を頭が書き換えること。人が書き換えたら `ashi core --accept` で認める
- 1 日と 1 歩の予算を超えること
