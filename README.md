# Truck Rest & Fuel Planner

Googleマップ共有URLを貼るだけで、ルート沿いの休憩候補とブランド限定給油候補を提案するNext.jsツールです。

## 主な機能

- `maps.app.goo.gl` を含むGoogleマップ共有URLをサーバー側で展開し、`origin/destination/waypoints` を抽出
- 抽出失敗時に備えた追加経由地入力
- 改善基準告示の考え方に沿った休憩設計
  - 連続運転4時間（例外モードONで4時間30分）
  - 休憩スタイル: `30分一括` / `10分以上×複数で合計30分`
- 給油ブランド縛り: ENEOSウイング / 宇佐美 / 両方
- 高速道路内SS優先表示
- 休憩候補の設備フィルタ（シャワー/24h/コンビニ/大型駐車）
- スマホ向け3ステップUI + PWA（ホーム画面追加）
- 前回結果の端末保存・オフライン再表示
- Markdown一括コピー + 候補個別コピー

## 技術構成

- Next.js (App Router) + TypeScript
- API: `/api/plan`
- DB: PostgreSQL + Prisma（本番安定運用向け）
- 店舗マスター更新: `scripts/updateStations.mjs`

## セットアップ

1. 依存インストール

```bash
npm install
```

2. 環境変数設定

```bash
cp .env.example .env
```

`.env` 主要項目:

- `DATABASE_URL`（必須。Postgres接続文字列）
- `GOOGLE_MAPS_API_KEY`（必須）
- `GOOGLE_PLACES_API_KEY`（任意）
- `OVERPASS_API_URLS`（任意）
- `OVERPASS_TIMEOUT_MS`（任意。既定12000）
- `OVERPASS_TOTAL_BUDGET_MS`（任意。既定14000）
- `PLACES_NEARBY_TIMEOUT_MS`（任意。既定4500）
- `PLACES_DETAILS_TIMEOUT_MS`（任意。既定2500）
- `PLACES_TOTAL_BUDGET_MS`（任意。既定8000）
- `ROUTE_BUFFER_KM`（任意。既定8）

3. Prisma

```bash
npm run db:generate
npm run db:migrate:deploy
```

4. 給油マスター更新（初期投入）

```bash
npm run stations:update
```

5. 起動

```bash
npm run dev
```

## API仕様（要約）

### POST `/api/plan`

入力例:

```json
{
  "mapUrl": "https://maps.app.goo.gl/xxxxxxxx",
  "departAtIso": "2026-02-20T01:00:00.000Z",
  "extraWaypoints": ["浜松SA"],
  "includeRouteDetails": false,
  "allowExtendedDrive": false,
  "restStyle": "SINGLE_30",
  "facilityTypes": { "saPa": true, "expresswayRest": true, "michiNoEki": true },
  "equipment": { "shower": false, "open24h": false, "convenience": false, "largeParking": true },
  "fuelBrand": "BOTH",
  "prioritizeHighwayStations": true,
  "fuelRangePreset": 100
}
```

- `includeRouteDetails=false` 推奨（レスポンス軽量化）

## 給油マスター初期化（重要）

- `/api/plan` 起動時に `FuelStation` テーブルをチェック
- 空の場合は `data/station-seed.json` を自動投入
- 公式取得（EW/宇佐美）を試行し、取得分をupsert
- 公式取得失敗時でもseedで候補0件を回避

## PWA利用

- `https` の公開URLでアクセスし、iPhone Safariの「ホーム画面に追加」を利用
- manifest: `/manifest.webmanifest`
- service worker: `/sw.js`
- 圏外時は新規検索を行わず「前回結果を表示」を利用

## デプロイ（Vercel）

1. GitHubへpush
2. VercelでリポジトリをImport
3. Environment VariablesをProduction/Preview両方に設定
4. デプロイ
5. マイグレーション実行（CIまたは手動）
6. `npm run stations:update` 実行（CIまたは手動）

本番前チェック:
- `/Users/atsuatsu/Projects/codex-test/docs/vercel-production-checklist.md`
- `/Users/atsuatsu/Projects/codex-test/docs/iphone-uat-template.md`
- `/Users/atsuatsu/Projects/codex-test/docs/iphone-uat-run-2026-02-21.md`

## ローカル検証

1. `npm run dev`
2. `examples/plan-request.sample.json` の `mapUrl` を実URLに変更
3. `scripts/runPlanCurl.sh` 実行
4. `docs/validation-checklist.md` で確認

## セキュリティ

- APIキーはサーバー環境変数のみで管理
- クライアントコードにキーを埋め込まない
- Google CloudでAPI制限（Directions/Places）と利用元制限を設定
