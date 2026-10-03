function svgPath(values, width, height, padding) {
  const finite = values.flat().filter(Number.isFinite);
  const min = Math.min(...finite) * .9;
  const max = Math.max(...finite) * 1.08;
  const x = (index) => padding.left + index * (width - padding.left - padding.right) / Math.max(values[0].length - 1, 1);
  const y = (value) => padding.top + (max - value) * (height - padding.top - padding.bottom) / Math.max(max - min, 1);
  return { min, max, x, y, path: (series) => {
    let drawing = "";
    let open = false;
    series.forEach((value, index) => {
      if (!Number.isFinite(value)) { open = false; return; }
      drawing += `${open ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
      open = true;
    });
    return drawing;
  } };
}

function ComparisonChart({ rows }) {
  const predicted = rows.map((row) => row.predicted);
  const actual = rows.map((row) => row.actual);
  const { min, max, x, y, path } = svgPath([predicted, actual], 720, 210, { left: 40, right: 12, top: 16, bottom: 25 });
  return <svg className="analysis-line-chart" viewBox="0 0 720 210" role="img" aria-label="Observed and predicted campus load across held-out test hours">
    {[0, 1, 2, 3].map((step) => { const value = min + (max - min) * step / 3; return <g key={step}><line x1="40" x2="708" y1={y(value)} y2={y(value)} /><text x="3" y={y(value) + 3}>{value.toFixed(0)}</text></g>; })}
    <path d={path(predicted)} className="analysis-predicted" /><path d={path(actual)} className="analysis-actual" />
    {[0, Math.floor(rows.length / 2), rows.length - 1].map((index) => <text key={index} x={x(index)} y="205" textAnchor="middle">{new Date(rows[index].timestamp).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}</text>)}
  </svg>;
}

function PatternBars({ values, label }) {
  const max = Math.max(...values.map((value) => value.mean_kwh || 0), 1);
  return <div className="pattern-bars" aria-label={label}>{values.map((value, index) => <div key={index}><span title={`${value.mean_kwh?.toFixed(1) || "No observed"} kWh`} style={{ height: `${Math.max(2, (value.mean_kwh || 0) / max * 100)}%` }} /><small>{value.hour ?? value.day}</small></div>)}</div>;
}

function OutageView({ outage }) {
  if (!outage) return null;
  const max = Math.max(...outage.timeline.map((row) => row.causal_input_kwh || 0), 1);
  const datasetShare = outage.hours / outage.dataset_hours * 100;
  return <article className="analysis-outage"><div className="analysis-card-head"><div><p className="overline">Outage handling</p><h2>Meter gap remains visible</h2></div><span>{outage.hours} missing of {outage.context_hours} shown</span></div><div className="outage-strip" aria-label="Simulated meter outage timeline">{outage.timeline.map((row) => <div className={row.missing ? "missing" : "observed"} key={row.timestamp} title={`${new Date(row.timestamp).toLocaleString("en-IN")} · ${row.missing ? "missing meter reading" : "observed meter reading"}`}><i style={{ height: `${Math.max(8, (row.causal_input_kwh || 0) / max * 100)}%` }} /></div>)}</div><div className="outage-legend"><span><i className="outage-observed" />Observed meter</span><span><i className="outage-missing" />Missing reading</span><span>{datasetShare.toFixed(1)}% of full dataset</span></div><p>{outage.policy}</p><footer><span>Outage start</span><b>{new Date(outage.start).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</b></footer></article>;
}

export default function AnalysisPanels({ data }) {
  const comparison = data.hourly.slice(-168);
  return <section className="analysis-section" id="analysis">
    <header className="analysis-section-head"><div><p className="overline">Exploration & validation</p><h2>See the load, test the forecast.</h2></div><p>Pattern summaries use observed meter readings only.</p></header>
    <div className="analysis-grid"><article className="analysis-comparison"><div className="analysis-card-head"><div><p className="overline">Held-out test period</p><h2>Actual versus predicted</h2></div><span>Last 7 days</span></div><ComparisonChart rows={comparison} /><footer><span><i className="key-actual" />Observed campus kWh</span><span><i className="key-predicted" />24-hour sequence prediction</span></footer></article><article className="analysis-patterns"><div className="analysis-card-head"><div><p className="overline">Observed demand</p><h2>Daily & weekly patterns</h2></div></div><h3>Mean load by hour of day</h3><PatternBars values={data.daily_pattern} label="Mean load by hour of day" /><h3>Mean load by weekday</h3><PatternBars values={data.weekly_pattern} label="Mean load by weekday" /></article></div>
    <OutageView outage={data.outage} />
  </section>;
}
