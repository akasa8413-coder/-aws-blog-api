# AWS Blog API

TypeScript / Express 5 / Prisma 7 / PostgreSQL のBlog APIと、日本語ブログ画面「余白」です。名称・配色は初期案です。

## ローカル起動

```zsh
npm ci
cp .env.example .env # 初回のみ。既存の .env は上書きしない
openssl rand -hex 32
```

生成した値を `.env` の `JWT_SECRET` に設定し、DB接続情報も設定してください。実際の秘密鍵、パスワード、JWTはGitやログ、チャットへ貼り付けないでください。

```zsh
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run build
npm run dev
```

`prisma7.config.ts` を明示するスクリプトを利用します。DBを消す `migrate reset` や `db push` は不要です。JWT_SECRETが未設定・32バイト未満の場合、サーバー起動は失敗します。秘密鍵は開発環境と本番環境で別々に生成し、本番ではシークレット管理サービスから渡してください。

## 実装の段階

1. 既存のUserモデルを利用し、ユーザーテーブルとPostとの任意の所有者リレーションを追加。既存投稿は削除せずauthorIdをNULLのまま保持。
2. 非同期scrypt（N=32768、r=8、p=3）、16バイトのランダムソルト、定時間比較を追加。保存値には方式のバージョンを付与。
3. 登録・ログイン、メールの小文字化と前後空白除去、入力検証を追加。レスポンスにはパスワードハッシュを含めない。
4. joseでHS256のJWTを発行・検証。署名・期限・発行者・宛先・subject・必要なclaimを検証し、ユーザーの実在を確認。
5. 投稿の作成・更新・削除に認証を要求。所有者はJWTから決定し、更新・削除は所有者だけに許可。

## API

| メソッド / パス | 入力 / 動作 | 成功 |
| --- | --- | --- |
| POST /api/auth/register | name, email, password | 201 `{ user }` |
| POST /api/auth/login | email, password | 200 `{ user, accessToken, tokenType: "Bearer", expiresIn: 3600 }` |
| GET /api/posts | 公開済み投稿の一覧、新しい順 | 200 |
| GET /api/posts/:id | 公開済み投稿の取得 | 200 |
| GET /api/auth/me | Bearer認証で現在のユーザーを取得 | 200 `{ user }` |
| GET /api/me/posts | 自分の公開記事・下書き一覧。Bearer認証必須 | 200 |
| GET /api/me/posts/:id | 自分の記事の取得。Bearer認証必須 | 200 |
| POST /api/posts | title, content。Bearer認証必須 | 201 |
| PATCH /api/posts/:id | title / content / published。所有者のみ | 200 |
| DELETE /api/posts/:id | 所有者のみ | 204 |

登録例:

```json
{"name":"Sakyo","email":"sakyo@example.com","password":"a-long-unique-password"}
```

ログイン後は `Authorization: Bearer <accessToken>` ヘッダーを送信します。JWTの有効期限は1時間です。更新トークン・ログアウトによる失効・パスワード再設定・メール認証はこの段階では実装していません。HTTPS経由で利用してください。

入力条件:

- 名前: 空白除去後1〜100文字。
- メール: 254文字以内、簡易形式チェック。小文字化して一意に管理。
- パスワード: 12文字以上、UTF-8で128バイト以内。前後の空白は保持。
- 投稿: title/contentは空白だけの文字列を拒否。publishedはbooleanのみ。
- JSONボディは100KBまで。

主なエラー: 入力不正400、認証失敗401、所有者以外403、未存在404、メール重複409、ボディ過大413、認証試行制限429。

### 互換性と既存投稿

投稿レスポンスの項目は維持しています。画面実装に伴い、公開GETはpublished=trueの記事だけを返すよう訂正しました。下書きの公開URLへのアクセスは、所有者のトークンを付けても404です。自分の下書きは認証必須の /api/me/posts から取得します。既存のAPI利用者はこの閲覧仕様の変更に対応してください。`authorId`を送信しても所有者の指定・変更はできません。

所有者のない既存投稿は誰もAPIから更新・削除できません。公開済みなら閲覧できますが、未公開なら公開一覧には表示されません。必要な場合は、管理者が対象投稿と実際の所有者を確認した上で別途データ移行してください。最初の登録ユーザーへ自動割り当てはしません。ユーザー削除で投稿が消えないよう外部キーにRESTRICTを設定しています。

認証エンドポイントにはプロセス全体で1分30リクエスト・同時4件の制限があります。再起動でリセットされる簡易制限で、複数プロセスで共有されません。本番ではロードバランサーや共有ストアで利用者ごとの制限も設定してください。

## テスト

```zsh
npm run build
npm test
```

結合テストは専用DB `auth_test` のみ受け付け、テスト開始時にそのDBのPost/Userを初期化します。開発DBのURLを渡さないでください。別の使い捨てPostgreSQLを利用します。

```zsh
docker run --detach --name aws-blog-auth-test \
  -e POSTGRES_USER=authtest -e POSTGRES_PASSWORD=local-disposable-test \
  -e POSTGRES_DB=auth_test -p 127.0.0.1:55439:5432 postgres:17
# DBの起動を待ってから:
DATABASE_URL=postgresql://authtest:local-disposable-test@127.0.0.1:55439/auth_test npm run db:migrate
TEST_DATABASE_URL=postgresql://authtest:local-disposable-test@127.0.0.1:55439/auth_test npm run test:integration
# 検証が終わったらコンテナを停止:
docker stop aws-blog-auth-test
```

単体テスト: ソルト・正誤パスワード・不正なハッシュ、JWTの改ざん・期限・発行者・宛先・署名方式・秘密鍵・subject・設定不備。
結合テスト: 既存投稿を保持する移行、登録と重複、ログイン、認証必須、所有者チェック、所有権の横取り防止、従来の閲覧、入力エラー、外部キー制約、認証試行制限。


## ブログ画面（ローカル）

起動後に http://localhost:3000/ を開きます。PORT環境変数でポートを変更できます。/ は以前のHello Expressからブログ画面に変更しました。公開・ホスティング設定は追加していません。

- 記事一覧・検索・詳細、空の一覧・読込中・エラー表示。
- 登録後の自動ログイン、ログイン・ログアウト。
- 「自分の記事」で公開済み／下書きの絞り込み。
- 記事作成・編集・公開／下書きの切り替え・削除確認。
- 本文はプレーンテキストとして表示し、HTMLを実行しません。
- 新規記事の公開は、下書き作成後に公開へ更新します。途中で公開に失敗した場合は保存済みIDを保持して再試行時の重複作成を防ぎます。

JWTはブラウザーのメモリ内だけで保持し、localStorageやsessionStorageには保存しません。ページ再読み込み・タブを閉じた後は再ログインが必要です。ログアウトはブラウザー内のトークンを破棄する操作で、発行済みJWT自体の失効ではありません。

画面のTypeScriptソースは web/app.ts、HTML/CSS/SVGは public/ にあります。追加のフロントエンドライブラリ・外部フォント・外部配信スクリプトは使用しません。ビルド済み public/assets/app.js はGit管理外です。

```zsh
npm run build       # サーバーと画面の型チェック・ビルド
npm start           # ビルド済みアプリを起動
# 開発中の別ターミナルで、画面ソースの変更を監視する場合:
npm run dev:web
```

npm run dev は画面を一度ビルドし、サーバー変更を監視します。web/app.tsを継続編集する場合はdev:webも併用してください。CSS/HTMLの変更後はブラウザーを再読み込みします。

UIの動作確認は使い捨てのauth_test DBで実施し、開発DBにサンプル記事は追加していません。PC幅1280pxとスマホ幅375pxで表示を確認しました。
