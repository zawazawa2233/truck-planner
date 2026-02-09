# codex-test

Notion風の日報保管庫（MVP）。

## Features

- 日報の新規作成（date, prefecture, company, title, body, tags）
- 画像/ PDF 添付（複数、jpg/png/pdf）
- 一覧表示（最新順）
- 検索（company/prefecture/tags/body）
- 詳細ページ（本文＋添付一覧、画像クリックで拡大）

## Run

```sh
npm install
npm run dev
```

本番用は以下。

```sh
npm run start
```

## Storage

- SQLite DB: `data/app.db`
- Uploads: `uploads/`
