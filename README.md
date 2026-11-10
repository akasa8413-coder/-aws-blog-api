# AWS Blog API

TypeScript / Express 5 / Prisma 7 / PostgreSQL のBlog APIです。

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
| GET /api/posts | 全投稿の一覧（従来仕様） | 200 |
| GET /api/posts/:id | 投稿の取得（従来仕様） | 200 |
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

閲覧パス、ステータス、投稿レスポンスの項目を維持しています。従来どおり未公開投稿もGETで取得できます。新たに書き込みには認証が必要です。`authorId`を送信しても所有者の指定・変更はできません。

所有者のない既存投稿は誰もAPIから更新・削除できません。必要な場合は、管理者が対象投稿と実際の所有者を確認した上で別途データ移行してください。最初の登録ユーザーへ自動割り当てはしません。ユーザー削除で投稿が消えないよう外部キーにRESTRICTを設定しています。

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
