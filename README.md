# Truck Rest & Fuel Planner

Googleマップ共有URLを貼るだけで、ルート沿いの休憩候補とブランド限定給油候補を提案するNext.jsツールです。

## 対応要件

- `maps.app.goo.gl` を含むGoogleマップ共有URLをサーバー側で展開し、`origin/destination/waypoints` を抽出
- 抽出失敗時に備えた「追加経由地（任意）」入力
- スマホ向け3ステップウィザードUI（Step1 URL入力 / Step2 条件設定 / Step3 結果カード）
- 各候補カードに `Googleマップで開く` / `住所・名称コピー` ボタン
- 結果Markdownの一括生成・一括コピー
- 前回検索結果を端末保存し、オフライン時に再表示
- PWA対応（ホーム画面追加 / manifest / service worker）
- 改善基準告示の考え方に沿った休憩設計
  - 連続運転4時間以内
  - 例外モードON時は4時間30分
  - 休憩スタイル: `30分一括` / `10分以上×複数で合計30分`
- 給油はブランド縛り
  - ENEOSウイングのみ / 宇佐美のみ / 両方
  - 高速道路内SSをマスターに含め、優先表示可能
- 休憩候補の条件絞り込み
  - 施設: SA/PA / 高速休憩所 / 道の駅
  - 設備: シャワー / 24h / コンビニ / 大型駐車

## 技術構成

- Next.js (App Router) + TypeScript
- API: `/api/plan`
- DB: SQLite + Prisma
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

`.env` の主な項目:

- `DATABASE_URL="file:../data/planner.db"`
- `GOOGLE_MAPS_API_KEY` (必須: ルート取得に使用)
- `GOOGLE_PLACES_API_KEY` (任意: 休憩候補のPlaces補完)
- `OVERPASS_API_URL` (既定: Overpass API)
- `OVERPASS_API_URLS` (任意: カンマ区切りで複数Overpassエンドポイント指定)
- `ROUTE_BUFFER_KM` (既定: `8`)
- APIキーは必ずサーバー環境変数で管理し、クライアント側コードへ埋め込まない

3. Prismaクライアント生成・DB反映

```bash
npm run db:generate
npm run db:push
```

4. 給油マスター更新

```bash
npm run stations:update
```

5. 起動

```bash
npm run dev
```

`http://localhost:3000` を開いて利用します。

## 使い方

1. Googleマップ共有URLを貼り付け
2. 必要なら追加経由地を入力（カンマ区切り）
3. 休憩ルール・設備条件・給油ブランド・距離レンジを選択
4. 「提案を作成」で結果一覧を取得

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

- `includeRouteDetails=false` を推奨（レスポンス軽量化のため）

## PWA利用

- `https` の公開URLでアクセスすると、iPhoneのSafariから「ホーム画面に追加」が可能
- manifest: `/manifest.webmanifest`
- service worker: `/sw.js`
- オフライン時は新規検索ではなく「前回結果を表示」を利用

## デプロイ（Vercel）

本番前チェックリスト: `/Users/atsuatsu/Projects/codex-test/docs/vercel-production-checklist.md`
iPhone受け入れテストシート: `/Users/atsuatsu/Projects/codex-test/docs/iphone-uat-template.md`
記入例: `/Users/atsuatsu/Projects/codex-test/docs/iphone-uat-sample-filled.md`
今回URL用実施シート: `/Users/atsuatsu/Projects/codex-test/docs/iphone-uat-run-2026-02-21.md`


1. GitHubへpush
2. VercelでリポジトリをImport
3. Environment Variablesを設定
   - `DATABASE_URL`（SQLite運用なら永続ボリューム前提。実運用は外部DB推奨）
   - `GOOGLE_MAPS_API_KEY`
   - `GOOGLE_PLACES_API_KEY`（任意）
   - `OVERPASS_API_URLS`（任意）
4. Deploy実行

注意:
- VercelのServerless + SQLiteは永続性に制約があるため、実運用はPostgres等の外部DBへ移行推奨。

出力例（抜粋）:

```json
{
  "status": "ok",
  "warnings": [],
  "extractedRouteInput": {
    "finalExpandedUrl": "https://www.google.com/maps/dir/...",
    "origin": "東京都江東区",
    "destination": "愛知県名古屋市",
    "waypoints": ["浜松SA"]
  },
  "route": {
    "totalDistanceKm": 360.4,
    "totalDurationMin": 298.2
  },
  "restWindows": [
    {
      "windowId": 1,
      "startAfterMin": 210,
      "endByMin": 240,
      "targetBreakMin": 30,
      "primaryCandidates": []
    }
  ],
  "fuelCandidates": [
    {
      "name": "ENEOSウイング 浜松SA下りSS",
      "brand": "EW",
      "isHighway": true,
      "distanceFromStartKm": 142.6,
      "etaIso": "2026-02-20T03:02:00.000Z"
    }
  ]
}
```

## ローカル検証

1. 開発サーバー起動

```bash
npm run dev
```

2. リクエストJSONを編集（`/Users/atsuatsu/Projects/codex-test/examples/plan-request.sample.json` の `mapUrl` を差し替え）

3. API実行

```bash
/Users/atsuatsu/Projects/codex-test/scripts/runPlanCurl.sh
```

4. チェックリスト

`/Users/atsuatsu/Projects/codex-test/docs/validation-checklist.md`

## 備考

- 地図表示は行わず、内部でルート距離/時間を計算して一覧表示します。
- Overpass/公式サイト取得に失敗した場合は警告付きでフォールバック（空候補またはシード）します。
- 給油の漏れを減らすため、`scripts/updateStations.mjs` で公式サイト由来データをDBへ取り込みます（取得不可時はシード維持）。
- `data/station-extra.json` を置くと、公式で取り切れない店舗を追加投入できます。
