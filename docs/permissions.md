# 権限の付け方

Ashi が自分で学ぶために要る権限と、弾かれたときの直し方。弾かれると画面の上に帯が出て(`/blocked` に一覧)、`NOTIFY_WEBHOOK_URL` があれば初めて起きたときに通知する。同じ先がうまくいけば自動で片づく。

値はどれもサーバーの環境変数で渡す。クラスタでは Infisical(il.doany.io、プロジェクト `doa`・環境 `prod`)のフォルダ **`/ashi/ashi-secrets`** に置く。Infisical operator が Secret `ashi-secrets` にし、Deployment は同期で自動的に入れ替わる(`deploy/secret.yaml`)。同期しないときは `kubectl -n ashi rollout restart deploy/ashi`(operator は失敗のあとバックオフする)。

| Infisical の鍵 | 環境変数 | |
| --- | --- | --- |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | 必須 |
| `entra-tenant-id` | `ENTRA_TENANT_ID` | 必須 |
| `entra-client-id` | `ENTRA_CLIENT_ID` | 必須 |
| `entra-client-secret` | `ENTRA_CLIENT_SECRET` | 必須 |
| `session-secret` | `SESSION_SECRET` | 必須。`openssl rand -base64 48` |
| `github-token` | `GITHUB_TOKEN` | 任意 |
| `x-bearer-token` | `X_BEARER_TOKEN` | 任意 |
| `forgejo-token` | `FORGEJO_TOKEN` | 任意 |
| `notify-webhook-url` | `NOTIFY_WEBHOOK_URL` | 任意 |

必須のものが無いと Pod は起動しない(CreateContainerConfigError)。任意のものは無くても動き、使う場面で `/blocked` に出る。`ORIGIN`(https://as.doany.io)と `FORGEJO_URL` は秘密ではないので `deploy/deployment.yaml` に直接書いてある。

## 最初に要るもの

### 1. Claude API(頭)

| 弾かれ方 | `/blocked` の題 | 付け方 |
| --- | --- | --- |
| 401 | Claude API の鍵が通らない | <https://platform.claude.com/settings/keys> で API キーを作り、`ANTHROPIC_API_KEY` に入れる |
| 残高不足 | Claude API の残高が足りない | <https://platform.claude.com/settings/billing> でクレジットを足す。自動チャージも設定できる |
| web 検索が使えない | Claude の web 検索が組織で許可されていない | Console の組織の設定(Settings → Privacy)で web search を有効にする。使わせないなら `ashi.json` の `allowWeb: false` |
| 403 | Claude API で権限が足りない | キーのワークスペースで `ashi.json` の `model`(既定 `claude-opus-5`)が使えるか確かめる |

使う額の上限は Ashi の側でも決めている(`ashi.json` の `budget.dailyUsd`、既定 2 ドル / 日)。Console のワークスペースにも月の上限を付けておくと二重に止まる。

### 2. Entra ID(画面のログイン)

doany.io の他のアプリと同じ作り。共有のアプリ登録 `Main` に足すか、Ashi 用に新しく登録する。

1. Entra 管理センター → アプリの登録 → (`Main` か新規)→ 認証 → Web のリダイレクト URI に `https://as.doany.io/auth/callback` を足す
2. 証明書とシークレット → クライアント シークレットを作る → `ENTRA_CLIENT_SECRET`。`ENTRA_TENANT_ID` と `ENTRA_CLIENT_ID` は概要のページから
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
- **頭が知らせてきたもの**(`<どこ> に入れなかった`): 有料の論文・購読の要る記事・鍵の要る API など。直し方は頭が書いてくる。対応したら `/blocked` で「対応した・気にしない」を押す

## 権限を足しても開けないもの

ガードレールなので、設定では外れない。

- 外の世界に書き込むこと(投稿・送信・購入・登録・フォームの送信)。道具は GET だけ
- コア原則(`core.md`)を頭が書き換えること。人が書き換えたら `ashi core --accept` で認める
- 1 日と 1 歩の予算を超えること
