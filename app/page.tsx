'use client';

import { useMemo, useState } from 'react';
import { PlanResponse, StopCandidate } from '@/lib/types';

type FuelBrand = 'EW' | 'USAMI' | 'BOTH';

type Step = 1 | 2 | 3;

const LAST_RESULT_KEY = 'truck_planner_last_result_v1';

export default function HomePage() {
  const nowLocal = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }, []);

  const [step, setStep] = useState<Step>(1);
  const [mapUrl, setMapUrl] = useState('');
  const [extraWaypoints, setExtraWaypoints] = useState('');
  const [departAtLocal, setDepartAtLocal] = useState(nowLocal);
  const [allowExtendedDrive, setAllowExtendedDrive] = useState(false);
  const [restStyle, setRestStyle] = useState<'SINGLE_30' | 'MULTI_10'>('SINGLE_30');
  const [fuelBrand, setFuelBrand] = useState<FuelBrand>('BOTH');
  const [prioritizeHighwayStations, setPrioritizeHighwayStations] = useState(true);
  const [fuelRangePreset, setFuelRangePreset] = useState<50 | 100 | 150 | 200>(100);
  const [fuelRangeKm, setFuelRangeKm] = useState('');

  const [saPa, setSaPa] = useState(true);
  const [expresswayRest, setExpresswayRest] = useState(true);
  const [michiNoEki, setMichiNoEki] = useState(true);

  const [shower, setShower] = useState(false);
  const [open24h, setOpen24h] = useState(false);
  const [convenience, setConvenience] = useState(false);
  const [largeParking, setLargeParking] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [savedAt, setSavedAt] = useState<string>('');

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setMapUrl(text.trim());
    } catch {
      setError('クリップボード読み取りに失敗しました。手動で貼り付けてください。');
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError('コピーに失敗しました。');
    }
  }

  function facilityLabel(candidate: StopCandidate): string {
    if (candidate.kind === 'FUEL') {
      return `SS${candidate.brand ? ` (${candidate.brand})` : ''}`;
    }
    if (candidate.tags.includes('SA/PA')) return 'SA/PA';
    if (candidate.tags.includes('道の駅')) return '道の駅';
    if (candidate.tags.includes('高速休憩所')) return '高速休憩所';
    return '休憩施設';
  }

  function mapLink(candidate: StopCandidate): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${candidate.lat},${candidate.lng} ${candidate.name}`)}`;
  }

  function buildMarkdownSummary(plan: PlanResponse): string {
    const lines: string[] = [];
    lines.push(`# トラック運行 休憩/給油プラン (${new Date().toLocaleString('ja-JP')})`);
    lines.push('');
    lines.push(`- 出発地: ${plan.extractedRouteInput.origin}`);
    lines.push(`- 到着地: ${plan.extractedRouteInput.destination}`);
    lines.push(`- 距離/時間: ${plan.route.totalDistanceKm}km / ${Math.round(plan.route.totalDurationMin)}分`);
    lines.push('');
    lines.push('## 休憩候補');
    for (const w of plan.restWindows) {
      lines.push(`- 第${w.windowId}休憩（出発後${Math.round(w.startAfterMin)}〜${Math.round(w.endByMin)}分、目安${new Date(w.etaIso).toLocaleString('ja-JP')}）`);
      for (const c of w.primaryCandidates) {
        lines.push(`  - ${c.name} [${facilityLabel(c)}] / ルート離脱${c.distanceFromRouteKm}km / 到達 ${new Date(c.etaIso).toLocaleString('ja-JP')}`);
      }
      for (const c of w.backupCandidates) {
        lines.push(`  - (次点) ${c.name} [${facilityLabel(c)}] / ルート離脱${c.distanceFromRouteKm}km`);
      }
    }
    lines.push('');
    lines.push('## 給油候補');
    for (const c of plan.fuelCandidates) {
      lines.push(`- ${c.name} [${facilityLabel(c)}] / ルート離脱${c.distanceFromRouteKm}km / 到達 ${new Date(c.etaIso).toLocaleString('ja-JP')}`);
    }
    if (plan.warnings.length > 0) {
      lines.push('');
      lines.push('## 警告');
      for (const w of plan.warnings) lines.push(`- ${w}`);
    }
    return lines.join('\n');
  }

  async function runPlan() {
    setLoading(true);
    setError('');

    if (!navigator.onLine) {
      setLoading(false);
      setError('オフラインのため新規検索できません。前回結果を表示してください。');
      return;
    }

    const depart = new Date(departAtLocal);

    try {
      const body = {
        mapUrl,
        departAtIso: depart.toISOString(),
        extraWaypoints: extraWaypoints
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        includeRouteDetails: false,
        allowExtendedDrive,
        restStyle,
        facilityTypes: { saPa, expresswayRest, michiNoEki },
        equipment: { shower, open24h, convenience, largeParking },
        fuelBrand,
        prioritizeHighwayStations,
        fuelRangePreset,
        fuelRangeKm: fuelRangeKm ? Number(fuelRangeKm) : undefined
      };

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'APIエラー');

      const plan = json as PlanResponse;
      setResult(plan);
      setStep(3);

      const saved = { generatedAt: new Date().toISOString(), result: plan };
      localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(saved));
      setSavedAt(saved.generatedAt);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setLoading(false);
    }
  }

  function loadLastResult() {
    try {
      const raw = localStorage.getItem(LAST_RESULT_KEY);
      if (!raw) {
        setError('前回結果がありません。');
        return;
      }
      const parsed = JSON.parse(raw) as { generatedAt: string; result: PlanResponse };
      setResult(parsed.result);
      setSavedAt(parsed.generatedAt);
      setStep(3);
      setError('');
    } catch {
      setError('前回結果の読み込みに失敗しました。');
    }
  }

  function candidateCard(candidate: StopCandidate, key: string) {
    const itemCopy = `${candidate.name}\n${candidate.address}`;
    return (
      <article className="resultCard" key={key}>
        <div className="badgeRow">
          <span className="badge primary">{facilityLabel(candidate)}</span>
          {candidate.equipment.shower && <span className="badge">シャワー</span>}
          {candidate.equipment.open24h && <span className="badge">24h</span>}
          {candidate.equipment.convenience && <span className="badge">コンビニ</span>}
          {candidate.equipment.largeParking && <span className="badge">大型</span>}
        </div>
        <h3>{candidate.name}</h3>
        <p className="address">{candidate.address || '住所不明'}</p>
        <p className="meta">ルート離脱: {candidate.distanceFromRouteKm}km / 出発から: {candidate.distanceFromStartKm}km</p>
        <p className="meta">到達見込み: {new Date(candidate.etaIso).toLocaleString('ja-JP')}</p>
        <div className="btnRow">
          <a className="btn secondary" href={mapLink(candidate)} target="_blank" rel="noreferrer">Googleマップで開く</a>
          <button className="btn ghost" type="button" onClick={() => copyText(itemCopy)}>住所/名称をコピー</button>
        </div>
      </article>
    );
  }

  return (
    <main className="page">
      <header className="headerCard">
        <h1>トラック休憩・給油プランナー</h1>
        <p>スマホ向け3ステップ。URL貼り付けだけで休憩候補とブランド限定給油候補を作成。</p>
        <div className="stepper">
          <button className={`stepChip ${step === 1 ? 'active' : ''}`} type="button" onClick={() => setStep(1)}>Step1</button>
          <button className={`stepChip ${step === 2 ? 'active' : ''}`} type="button" onClick={() => setStep(2)}>Step2</button>
          <button className={`stepChip ${step === 3 ? 'active' : ''}`} type="button" onClick={() => setStep(3)}>Step3</button>
        </div>
      </header>

      {step === 1 && (
        <section className="panel">
          <h2>Step1: URL入力</h2>
          <label className="fieldLabel">Googleマップ共有URL</label>
          <textarea className="textInput" value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} placeholder="https://maps.app.goo.gl/..." rows={3} />
          <div className="btnRow">
            <button className="btn" type="button" onClick={pasteFromClipboard}>クリップボード貼り付け</button>
            <button className="btn secondary" type="button" onClick={loadLastResult}>前回結果を表示</button>
          </div>

          <label className="fieldLabel">出発日時</label>
          <input className="textInput" type="datetime-local" value={departAtLocal} onChange={(e) => setDepartAtLocal(e.target.value)} />

          <label className="fieldLabel">追加経由地（任意、カンマ区切り）</label>
          <input className="textInput" value={extraWaypoints} onChange={(e) => setExtraWaypoints(e.target.value)} placeholder="例: 浜松SA, 御在所SA" />

          <div className="footerRow">
            <button className="btn" type="button" disabled={!mapUrl} onClick={() => setStep(2)}>条件設定へ進む</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="panel">
          <h2>Step2: 条件チェック</h2>

          <h3>休憩ルール</h3>
          <label className="check"><input type="radio" checked={restStyle === 'SINGLE_30'} onChange={() => setRestStyle('SINGLE_30')} />30分一括</label>
          <label className="check"><input type="radio" checked={restStyle === 'MULTI_10'} onChange={() => setRestStyle('MULTI_10')} />10分以上×複数で合計30分</label>
          <label className="check"><input type="checkbox" checked={allowExtendedDrive} onChange={(e) => setAllowExtendedDrive(e.target.checked)} />やむを得ない場合に4時間30分まで許容</label>

          <h3>施設種別</h3>
          <label className="check"><input type="checkbox" checked={saPa} onChange={(e) => setSaPa(e.target.checked)} />SA/PA</label>
          <label className="check"><input type="checkbox" checked={expresswayRest} onChange={(e) => setExpresswayRest(e.target.checked)} />高速休憩所</label>
          <label className="check"><input type="checkbox" checked={michiNoEki} onChange={(e) => setMichiNoEki(e.target.checked)} />道の駅</label>

          <h3>設備</h3>
          <label className="check"><input type="checkbox" checked={shower} onChange={(e) => setShower(e.target.checked)} />シャワー</label>
          <label className="check"><input type="checkbox" checked={open24h} onChange={(e) => setOpen24h(e.target.checked)} />24h飲食</label>
          <label className="check"><input type="checkbox" checked={convenience} onChange={(e) => setConvenience(e.target.checked)} />コンビニ</label>
          <label className="check"><input type="checkbox" checked={largeParking} onChange={(e) => setLargeParking(e.target.checked)} />大型駐車優先</label>

          <h3>給油条件</h3>
          <label className="check"><input type="radio" checked={fuelBrand === 'EW'} onChange={() => setFuelBrand('EW')} />ENEOSウイングのみ</label>
          <label className="check"><input type="radio" checked={fuelBrand === 'USAMI'} onChange={() => setFuelBrand('USAMI')} />宇佐美のみ</label>
          <label className="check"><input type="radio" checked={fuelBrand === 'BOTH'} onChange={() => setFuelBrand('BOTH')} />両方</label>
          <label className="check"><input type="checkbox" checked={prioritizeHighwayStations} onChange={(e) => setPrioritizeHighwayStations(e.target.checked)} />高速道路内SS優先</label>

          <div className="rangeRow">
            <select className="textInput" value={fuelRangePreset} onChange={(e) => setFuelRangePreset(Number(e.target.value) as 50 | 100 | 150 | 200)}>
              <option value={50}>50km以内</option>
              <option value={100}>100km以内</option>
              <option value={150}>150km以内</option>
              <option value={200}>200km以内</option>
            </select>
            <input className="textInput" type="number" value={fuelRangeKm} onChange={(e) => setFuelRangeKm(e.target.value)} placeholder="任意km（例: 120）" />
          </div>

          <div className="footerRow">
            <button className="btn ghost" type="button" onClick={() => setStep(1)}>戻る</button>
            <button className="btn" type="button" disabled={loading || !mapUrl} onClick={runPlan}>{loading ? '計算中...' : '結果を作成'}</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="panel">
          <h2>Step3: 結果</h2>

          {result ? (
            <>
              <div className="summary">
                <p>{result.extractedRouteInput.origin} → {result.extractedRouteInput.destination}</p>
                <p>距離 {result.route.totalDistanceKm}km / 所要 {Math.round(result.route.totalDurationMin)}分</p>
                {savedAt && <p>保存日時: {new Date(savedAt).toLocaleString('ja-JP')}</p>}
              </div>

              <div className="btnRow">
                <button className="btn" type="button" onClick={() => copyText(buildMarkdownSummary(result))}>Markdownを一括コピー</button>
                <button className="btn secondary" type="button" onClick={loadLastResult}>前回結果を再表示</button>
              </div>

              {result.warnings.length > 0 && (
                <div className="warningBox">
                  {result.warnings.map((w) => <p key={w}>警告: {w}</p>)}
                </div>
              )}

              <h3>休憩候補</h3>
              <div className="cards">
                {result.restWindows.flatMap((w) => w.primaryCandidates).slice(0, 8).map((c, idx) => candidateCard(c, `${c.id}-${idx}`))}
              </div>

              <h3>給油候補</h3>
              <div className="cards">
                {result.fuelCandidates.map((c, idx) => candidateCard(c, `${c.id}-${idx}`))}
              </div>

              <div className="footerRow">
                <button className="btn ghost" type="button" onClick={() => setStep(2)}>条件を変えて再検索</button>
              </div>
            </>
          ) : (
            <>
              <p>結果がありません。Step2から検索してください。</p>
              <div className="btnRow">
                <button className="btn secondary" type="button" onClick={loadLastResult}>前回結果を表示</button>
                <button className="btn" type="button" onClick={() => setStep(1)}>最初から</button>
              </div>
            </>
          )}
        </section>
      )}

      {error && <div className="errorBox">{error}</div>}
    </main>
  );
}
