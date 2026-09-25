# Ashi を直すときに

Ashi は、AI(頭)に「足」を与えて自分で学び続けさせるプログラム。何をするものかは README.md、権限と弾かれたときの直し方は docs/permissions.md。ここには、コードとプロンプトを直すときに守ることを書く。

## 設計の芯

- **頭と足を混ぜない。** 頭(LLM)は考えることだけ、足(本体)はループ・状態ファイル・問いの選択・道具・休眠・予算・ガードレール。足は「何を考えるか」を持たない。判断の中身を足に書き足したくなったら、プロンプトで頭に任せられないかを先に考える
- **ガードレールは頭の判断より常に勝つ。** 頭の出力は必ず `legs/guard.ts` を通してから状態に書く。ガードレールを緩める変更(予算・休む時間・読み取り専用・コア原則・NetworkPolicy)は持ち主の判断が要る。頼まれていなければしない
- **頭との境目は `Head`(`head/head.ts`)の 1 か所。** 頭は 2 つある。`claude.ts` は Messages API と API キー、`claude-code.ts` は Claude Code の CLI とサブスクのトークン。どちらかにしか無い機能を足の側で前提にしない。頭は `head/make.ts` で設定の `head` から作る
- **Ashi に書き込む道具を渡さない。** 頭に渡す道具は `readOnly` のものだけ。Claude Code の頭には `Read(./notes/**)`・WebSearch と、足の道具を出す MCP サーバー(`src/mcp.ts`、`build/mcp.js`)の `fetch_url`・`find_papers`・`read_paper`・`archived_copy` しか許さない。組み込みの WebFetch はプライベートアドレスのガードが効かないので、MCP が無いときの代わりにだけ使う。CLI には API キーや要らない秘密を渡さない(`claude-code.ts` の `run`)
- **外に書くのは X だけ。** コア原則の 1 番。Ashi 名義の X アカウント(DoaRetail)への投稿と返信だけを、頭が決めて足が送る(`legs/x.ts`)。承認はしない代わりに、数と額の上限(`x`)で止める。X での来客の言葉は `<visitor>` で囲って渡し、個性の材料にする(持ち主の地図には入れない)。持ち主の地図・材料・非公開の活動は外に書かない(コア原則の 3 番)
- **論文は公開版を探してから。** 出版社のページは有料の壁やロボットの締め出しで 403 になりやすい。`legs/papers.ts` が Europe PMC と OpenAlex で公開版(PMC・リポジトリ・著者版)を探し、PDF も読む(unpdf)
- **ロボットの締め出しは装って抜けない。** 公取委・中小企業庁などは Akamai が 403 を返す。ブラウザを装わず、`legs/archive.ts` の `archived_copy` で Wayback Machine の写しを読む(available API は空を返すことがあるので CDX で引き直す)。写しが読めたらその先の「弾かれた」を片づける
- **状態ファイルを書くのは足だけ、1 プロセスだけ。** 画面のサーバーが歩みも回す(`walk.lock`、Pod は Recreate)。頭を待つ間に古くなった値で上書きしないよう、書く直前に読み直す(`store.updateQuestions`)

## 問いの系統(持ち主と決めた、2026-09-25)

- **owner(先回り)**: 持ち主が知らなそうだが、いつか聞きそうなこと
- **self(個性)**: 持ち主の地図から**一歩外れた**ところ。「地図の外なら何でも」にすると脈略の無い問いが並んだので、戻り道が見える距離にしてある
- **橋渡し**: 個性の問いを歩いたら、分かったことが持ち主の関心に効くかを考えさせ、効くなら先回りの問いにして持ち帰る(親が self の owner の問い)
- どちらを歩くかは足のさいころ(`ownerShare`)。**出た系統が空なら、もう一方に回さずその系統の問いを探させる**(回すと割合が効かず、空の系統が育たない)

## 問いの選び方の決めごと(Ashi の改善案から、2026-09-25)

- テーマは連続(`themeStreakLimit`)に加えて、直近 `themeWindow` 歩で `themeWindowMax` 回に達したら休ませる(交互に挟まると連続の上限に当たらなかった)
- 内省の `next_steps`(次の一歩)と `bridge_ideas`(橋の候補)は足が持ち、次の内省まで歩く・探すたびに見せる。日記に書いただけでは次の問い選びに届かなかった
- 探した場所(`searched`)を問いに残し、`missesToPark` 回見つからなかったら未測定の棚(`parked`)へ
- 頭は問いを選べない。プロンプトで「選ぶのは足で、影響できるのは new_questions・bridge_ideas・next_steps」と伝える(`HOW_LEGS_CHOOSE`)
- 問いの重複: 足がはじくのは文字 bigram の Jaccard が 0.45 以上のものだけ(echoes を足す)。実際の問いで測ると、言い換えの重複(0.25〜0.49)と同じ話題の別の問い(0.33〜0.41)が重なっていて、機械だけでは線が引けない。その下は内省で頭に統合の候補(similarPairs)として見せ、merges / themes で頭が決め、足が当てる。テーマごとの開いた問いは maxOpenPerTheme まで
- 頭に見せる問いの一覧は全部(80 本まで、テーマごと)。先頭 30 本で切っていて、頭が同じ問いを重ねていた
- 問いの出どころ(source / via)を残し、個性のうち持ち主から生まれた割合(ownerPull)を内省と画面に出す。2026-09-25 の時点では、偏りは X での持ち主との会話から来ていた(Ashi は「先回りのノートから」と見立てていたが、親が先回りの問いは 33 本中 2 本だった)
- 学びのリセットは消さずに `archive/<時刻>/` へ移す。持ち主の地図と材料・改善案は残す(`store.resetLearning`)

## 直したら

```sh
bun run check      # biome(警告も落とす)+ svelte-check
bun test tests
bun run build      # 画面と CLI(build/cli.js)
```

- 頭の答えの形(`prompts.ts` の `*_SCHEMA`)を変えたら、`required` と `properties` が揃っているかのテスト(`tests/blockers.test.ts` の「答えの形」)が通るか見る。**プロンプトの文字列を Python などで置き換えたときは、置き換わったか grep で確かめる**(biome の整形で一致せず、黙って入っていなかったことが 2 回あった)
- 歩みのテストは偽の頭(`tests/helpers.ts` の `FakeHead`)で書く。本物の API や CLI をテストから呼ばない
- Claude Code の CLI のフラグを足すときは、手元で `claude --help` と小さな `claude -p` で確かめてから(`--bare` は OAuth を読まないので使えない、など)

## 画面

トドロクと同じ作り。Pico の出来合いの CSS + `src/app.css` の共通クラス(`.page-container` `.head` `.panel` `.panel-head` `.rows` `.stats` `.stat` `.tag` `.note` `.two` `.stack` `.cluster` `.empty`)+ 画面ごとの scoped style。アイコンは `Icon.svelte`(lucide のパスを持つ)。Web フォントは束ねない。色は Pico の既定と、差し色の葦の緑(`--ui-accent`)。

文言は日本語。見出しに括弧で説明を付けない(補足は文に開く)。

## デプロイ

main に入ると `docker-publish.yml` がイメージを焼き、`deploy/deployment.yaml` のタグを差し替える PR を作って自分でマージする。ArgoCD が `deploy/argocd.yaml` を拾って as.doany.io に出す。

- 設定は `deployment.yaml` の `ASHI_CONFIG`(ashi.json に重ねる)と `ASHI_FEEDS`(足跡)。PVC の ashi.json は触らなくてよい
- 秘密は Infisical の `/ashi/ashi-secrets`(鍵の一覧は `deploy/secret.yaml` の先頭)
- 頭はクラスタでは `claude-code`(サブスク)。1 日の歩数(`maxStepsPerDay`)で止める

## 改善案

Ashi は内省のときに自分の仕組みへの改善案を出す(`/proposals`)。持ち主が「issue にする」で `ashi-proposal` ラベルの issue にする。issue を頼まれたら、Ashi が書いた「困ったこと」は実際に歩いて起きたことなので、まずそれがコードのどこで起きるかを確かめてから直す。
