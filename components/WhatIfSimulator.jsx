"use client";

import { useMemo, useState } from "react";

function ScenarioCurve({ base, scenario }) {
  const values = [...base, ...scenario];
  const min = Math.min(...values) * .88;
  const max = Math.max(...values) * 1.08;
  const width = 720, height = 190, left = 38, right = 12, top = 16, bottom = 27;
  const x = (index) => left + index * (width - left - right) / 23;
  const y = (value) => top + (max - value) * (height - top - bottom) / Math.max(max - min, 1);
  const path = (series) => series.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return <svg className="scenario-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Base forecast and schedule-shift scenario comparison"><rect x={x(12)} y={top} width={x(18) - x(12)} height={height - top - bottom} className="scenario-peak-zone" />{[0, 1, 2, 3].map((step) => { const value = min + (max - min) * step / 3; return <g key={step}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} /><text x="2" y={y(value) + 3}>{value.toFixed(0)}</text></g>; })}<path d={path(base)} className="scenario-base-line" /><path d={path(scenario)} className="scenario-plan-line" />{[0, 6, 12, 18, 23].map((hour) => <text key={hour} x={x(hour)} y={height - 5} textAnchor="middle">{String(hour).padStart(2, "0")}:00</text>)}</svg>;
}

export default function WhatIfSimulator({ data }) {
  const scenarios = data.schedule_scenarios || [];
  const [id, setId] = useState(scenarios[1]?.id || scenarios[0]?.id);
  const scenario = useMemo(() => scenarios.find((item) => item.id === id) || scenarios[0], [id, scenarios]);
  if (!scenario) return null;
  const base = data.forecast.map((item) => item.kwh);
  const basePeak = base.slice(12, 18).reduce((sum, value) => sum + value, 0);
  return <section className="scenario-section" id="scenario"><header className="scenario-section-head"><div><p className="overline">What-if planner</p><h2>Shift flexible activity out of peak hours.</h2></div><p>Model-backed counterfactual</p></header><div className="scenario-layout"><article><div className="scenario-controls"><div><p>PLANNING ACTION</p><strong>Delay flexible rooms to 18:00–20:59</strong><span>Only published room-schedule occupancy changes. Weather, calendar and meter history stay fixed.</span></div><div className="scenario-buttons" role="group" aria-label="Peak activity shift"><span>SHIFT</span>{scenarios.map((item) => <button className={item.id === scenario.id ? "active" : ""} key={item.id} onClick={() => setId(item.id)}>{item.shift_percent}%</button>)}</div></div><ScenarioCurve base={base} scenario={scenario.forecast_kwh} /><footer><span><i className="scenario-base-key" />Current plan</span><span><i className="scenario-plan-key" />Shifted schedule</span><span>Shaded area: peak period</span></footer></article><aside><p className="overline">Expected effect</p><h3>{scenario.peak_reduction_kwh.toFixed(1)} <small>kWh</small></h3><span>lower predicted peak-period energy</span><dl><div><dt>Base peak period</dt><dd>{basePeak.toFixed(1)} kWh</dd></div><div><dt>Scenario peak period</dt><dd>{scenario.peak_kwh.toFixed(1)} kWh</dd></div><div><dt>Activity moved</dt><dd>{scenario.moved_occupancy_hours.toFixed(2)} occupancy-hours</dd></div></dl><p className="scenario-method">{scenario.method}</p></aside></div></section>;
}
