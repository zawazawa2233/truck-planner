# Validation Checklist

## 1) URL貼るだけで動く

- `examples/plan-request.sample.json` の `mapUrl` を実URLに差し替える
- `/api/plan` 実行で `extractedRouteInput.origin` と `destination` が返る
- `maps.app.goo.gl` の短縮URLでも `finalExpandedUrl` が返る

## 2) 休憩ロジック

- `allowExtendedDrive=false` で `restWindows[].targetDriveLimitMin=240`
- `allowExtendedDrive=true` で `restWindows[].targetDriveLimitMin=270`
- `restStyle=SINGLE_30` で `targetBreakMin=30`
- `restStyle=MULTI_10` でも `targetBreakMin=30`（UIで複数回休憩運用）

## 3) 給油ブランド縛り

- `fuelBrand=EW` で `fuelCandidates[].brand` が `EW` のみ
- `fuelBrand=USAMI` で `USAMI` のみ
- `fuelBrand=BOTH` で両方許容
- `prioritizeHighwayStations=true` で `isHighway=true` が先頭側に出る

## 4) フィルタとフォールバック

- 設備フィルタを厳しくして候補0件を作り、`warnings` が返ることを確認
- Overpass失敗時もAPIが500にならず `status=fallback` で返ることを確認
