"use client";

import { useEffect, useState } from "react";

function Metric({ label, value, suffix = "kWh" }) {
  return <div className="model-metric"><span>{label}</span><strong>{typeof value === "number" ? value.toFixed(1) : "—"}<small>{suffix}</small></strong></div>;
}

export default function ModelStatus() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/campus", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Forecast data is unavailable.");
        return body;
      })
      .then((payload) => active && setData(payload))
      .catch((cause) => active && setError(cause.message));
    return () => { active = false; };
  }, []);

  if (error) return <main className="model-state"><section><p className="model-eyebrow">Model status</p><h1>Forecast service is offline</h1><p>{error}</p><code>python3 app.py</code></section></main>;
  if (!data) return <main className="model-state"><section><i className="model-spinner" /><p className="model-eyebrow">Model status</p><h1>Loading the active forecast</h1><p>Reading the current model run and its evaluation record.</p></section></main>;

  const neural = data.metrics.neural;
  const baseline = data.metrics.same_hours_last_week;
  const split = data.split;
  return <main className="model-page">
    <header className="model-nav"><div><a className="model-brand" href="/"><i><b /><b /><b /></i>Campus Load</a><nav><a href="/">Overview</a><a href="/#building">Building</a><a href="/#calendar">Calendar</a><a href="/#forecast">Forecast</a><a className="active" href="/model">Model</a></nav><span><b /> Live API <em /> Asia/Kolkata</span></div></header>
    <div className="model-wrap">
      <section className="model-hero">
        <div><p className="model-eyebrow">Forecast system / active run</p><h1>How tomorrow’s<br />load is produced.</h1><p>One causal model produces all 24 campus kWh values at midnight. It uses only the meter history and planning inputs that existed when the forecast was issued.</p></div>
        <aside><p>ACTIVE MODEL</p><strong>Two encoders</strong><span>{data.model_version}</span><hr /><div><span>Forecast horizon</span><b>24 hourly values</b></div><div><span>Forecast issue</span><b>00:00 local time</b></div></aside>
      </section>

      <section className="model-section model-running">
        <header><div><p className="model-eyebrow">Running now</p><h2>Two inputs, one 24-hour sequence</h2></div><span className="model-live"><i /> Running</span></header>
        <div className="model-flow" aria-label="Forecast architecture">
          <article><span>01 / HISTORY</span><h3>Temporal encoder</h3><p>168 hourly meter readings, with a matching missing-value flag for every hour.</p><ul><li>Observed campus kWh</li><li>Forward-fill only from past readings</li><li>Meter outage remains explicit</li></ul></article>
          <i className="model-arrow">→</i>
          <article><span>02 / FUTURE</span><h3>Future-hour encoder</h3><p>Known features are encoded separately for each of the next 24 forecast hours.</p><ul><li>Calendar, weekend and holiday</li><li>Published room schedules</li><li>Archived weather forecast vintage</li></ul></article>
          <i className="model-arrow">→</i>
          <article className="model-output"><span>03 / OUTPUT</span><h3>Fusion decoder</h3><p>Combines both encodings, applies a learned correction to last week, and emits the full sequence.</p><strong>24 × predicted kWh</strong><small>Non-negative campus load forecast</small></article>
        </div>
      </section>

      <section className="model-section model-evaluation">
        <header><div><p className="model-eyebrow">Evaluation</p><h2>Chronological holdout performance</h2></div><p>Peak hours fixed before testing: <b>{data.peak_definition}</b></p></header>
        <div className="model-score-grid"><article><p>ACTIVE NEURAL MODEL</p><Metric label="Overall MAE" value={neural.mae} /><Metric label="Overall RMSE" value={neural.rmse} /><div className="model-submetrics"><Metric label="Peak MAE" value={neural.peak?.mae} /><Metric label="Off-peak MAE" value={neural.off_peak?.mae} /></div></article><article><p>REFERENCE BASELINE</p><h3>Same hours last week</h3><Metric label="Overall MAE" value={baseline.mae} /><Metric label="Overall RMSE" value={baseline.rmse} /><small>Baseline is retained for comparison and fallback.</small></article><aside><p>DATA SPLIT</p><strong>{split.train_days}<small> days</small></strong><div><span>Train</span><b>{split.train_days} daily windows</b></div><div><span>Validation</span><b>{split.validation_days} daily windows</b></div><div><span>Test</span><b>{split.test_days} daily windows</b></div><hr /><p>{neural.hours} observed test hours scored. Missing meter targets are excluded.</p></aside></div>
      </section>

      <section className="model-section model-guardrails"><header><div><p className="model-eyebrow">Decision record</p><h2>Guardrails in the live pipeline</h2></div></header><div><article><b>Weather is time-safe</b><p>Only the weather forecast archived at the midnight issue time is a model input.</p></article><article><b>Missing readings are never labels</b><p>Outage periods can be inputs through their flags, but fabricated readings are never scored.</p></article><article><b>Attention is not active</b><p>It will be introduced only if chronological validation improves over this two-encoder model.</p></article></div></section>
      <footer className="model-footer">The current dataset is simulated. The service shows the actual runtime configuration, while accuracy becomes decision-ready only after real campus data is connected.</footer>
    </div>
  </main>;
}
