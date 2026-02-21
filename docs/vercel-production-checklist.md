# Vercel Production Checklist

## 1) Project Setup

- VercelでリポジトリをImport
- Framework presetが `Next.js` になっていることを確認
- Production Branchを指定（例: `main`）

## 2) Environment Variables

Vercel Project Settings -> Environment Variables に設定:

- `DATABASE_URL`
- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_PLACES_API_KEY`（任意）
- `OVERPASS_API_URLS`（任意）
- `ROUTE_BUFFER_KM`（任意）

推奨:
- `GOOGLE_MAPS_API_KEY` は API制限 + アプリケーション制限を設定
- APIを `Directions API` / `Places API` に限定

## 3) Security

- APIキーをクライアント側コードへ埋め込まない
- すべて `/api/plan` 経由で外部APIを呼ぶ
- `.env` はコミットしない

## 4) Data Store Notes

- 本番は外部DB（Postgres）を前提にする
- Prismaマイグレーションを先に適用する（`prisma migrate deploy`）
- `stations:update` はCIまたは手動ジョブで定期更新

## 5) Deployment Verification

デプロイ後、公開URL（例: `https://your-app.vercel.app`）で以下を確認:

- `Step1 -> Step2 -> Step3` の導線がスマホで破綻しない
- 共有URL貼り付けで結果が返る
- `Googleマップで開く` が機能する
- `Markdownを一括コピー` が機能する
- `前回結果を表示` が機能する
- オフライン時に新規検索を止め、前回結果が表示できる

## 6) PWA Verification (iPhone)

- Safariで公開URLを開く
- 「共有」->「ホーム画面に追加」で追加可能
- ホーム画面から起動できる
- アイコン/アプリ名が正しく表示される
- 一度オンラインで開いた後、機内モードで前回結果表示が可能

## 7) Operational Checks

- APIエラー時にユーザーへ警告が表示される
- Overpass失敗時にフォールバック警告が表示される
- ログで `429` / `403`（API制限）を監視
