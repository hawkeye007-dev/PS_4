"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

const BuildingScene = dynamic(() => import("./BuildingScene"), {
  ssr: false,
  loading: () => <div className="scene-loading">Loading building model…</div>,
});

function formatStamp(value, options = { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) {
  return new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function Sparkline({ values, color = "#246b50", secondValues }) {
  const width = 620, height = 142, left = 36, right = 8, top = 10, bottom = 22;
  const all = [...values, ...(secondValues || [])].filter(Number.isFinite);
  const min = Math.min(...all) * 0.88, max = Math.max(...all) * 1.08 || 1;
  const x = (i) => left + (i * (width - left - right)) / Math.max(1, values.length - 1);
  const y = (n) => top + ((max - n) * (height - top - bottom)) / (max - min || 1);
  const pathFor = (series) => series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hourly campus load forecast chart">
      {[0, 1, 2, 3].map((step) => {
        const value = min + ((max - min) * step) / 3;
        const yy = y(value);
        return <g key={step}><line x1={left} y1={yy} x2={width - right} y2={yy} className="chart-grid" /><text x="0" y={yy + 3} className="chart-label">{value.toFixed(0)}</text></g>;
      })}
      {secondValues && <path d={pathFor(secondValues)} fill="none" stroke="#bd8b45" strokeWidth="1.8" strokeDasharray="4 4" />}
      <path d={pathFor(values)} fill="none" stroke={color} strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round" />
      {[0, 6, 12, 18, 23].map((i) => <text key={i} x={x(i)} y={height - 3} textAnchor="middle" className="chart-label">{String(i).padStart(2, "0")}:00</text>)}
    </svg>
  );
}

export default function CampusDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [hour, setHour] = useState(14);
  const [floor, setFloor] = useState("all");
  const [roomId, setRoomId] = useState("hall-101");

  useEffect(() => {
    let active = true;
    fetch("/api/campus", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Forecast data is unavailable.");
        return body;
      })
      .then((payload) => { if (active) setData(payload); })
      .catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);

  const room = useMemo(() => data?.rooms?.find((item) => item.id === roomId) || data?.rooms?.[0], [data, roomId]);
  if (error) return <main className="state-page"><div className="state-card"><div className="eyebrow">Campus energy / local simulation</div><h1>Forecast data is offline</h1><p>{error}</p><code>python3 app.py</code></div></main>;
  if (!data || !room) return <main className="state-page"><div className="state-card"><div className="loading-mark" /><h1>Preparing the campus model</h1><p>Connecting to the local forecast service…</p></div></main>;

  const currentForecast = data.forecast[hour];
  const scheduledRooms = data.rooms.filter((item) => item.schedule[hour] > 0).length;
  const roomIsActive = room.schedule[hour] > 0;
  const maxRoomLoad = Math.max(...data.rooms.map((item) => item.forecast_kwh[hour]));
  const forecastTotal = data.forecast.reduce((sum, item) => sum + item.kwh, 0);
  const roomShare = room.forecast_kwh[hour] / Math.max(currentForecast.kwh, 1) * 100;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>Fieldhouse <small>ENERGY PLANNING</small></span></div>
        <div className="top-meta"><span className="service-state"><b /> SIMULATION CONNECTED</span><span>Asia/Kolkata · Local time</span></div>
      </header>

      <div className="page-content">
        <div className="page-heading">
          <div><div className="eyebrow">Building operations <span>/</span> room plan</div><h1>Energy, by space.</h1><p>Explore scheduled use and estimated demand throughout the teaching block.</p></div>
          <div className="forecast-stamp"><span>FORECAST ISSUE</span><strong>{formatStamp(data.forecast_issue)}</strong></div>
        </div>

        <section className="summary-strip" aria-label="Current simulation summary">
          <div className="summary-item"><span>CAMPUS · {String(hour).padStart(2, "0")}:00</span><strong>{currentForecast.kwh.toFixed(1)} <small>kWh</small></strong><em>Predicted campus load</em></div>
          <div className="summary-item"><span>SELECTED SPACE</span><strong>{room.forecast_kwh[hour].toFixed(1)} <small>kWh</small></strong><em>{room.name} · estimated</em></div>
          <div className="summary-item"><span>ACTIVE SPACES</span><strong>{scheduledRooms}<small> / {data.rooms.length}</small></strong><em>Planned at selected hour</em></div>
          <div className="summary-item"><span>NEXT 24 HOURS</span><strong>{forecastTotal.toFixed(0)} <small>kWh</small></strong><em>Campus forecast sequence</em></div>
        </section>

        <section className="outage-note"><span className="outage-symbol">!</span><div><strong>Simulated meter outage is represented in historical inputs</strong><p>Missing campus readings stay blank and are excluded from scoring. Room demand below is an estimated allocation of campus-level load; room meters are not available.</p></div><span className="outage-count">{data.outage_hours} missing hours in simulation</span></section>

        <div className="workspace-grid">
          <section className="panel building-panel">
            <div className="panel-heading"><div><div className="section-kicker">SPATIAL LOAD VIEW</div><h2>Teaching block</h2><p>Choose a room in the model or the list. Drag to orbit · scroll to zoom.</p></div><span className="estimate-tag">ROOM LOAD · ESTIMATED</span></div>
            <div className="building-stage">
              <BuildingScene rooms={data.rooms} hour={hour} selectedRoom={roomId} onSelectRoom={setRoomId} floorFilter={floor} />
              <div className="floor-filter" aria-label="Filter building floor">
                {["all", "1", "2", "3"].map((item) => <button key={item} className={floor === item ? "active" : ""} onClick={() => setFloor(item)}>{item === "all" ? "All floors" : `L${item}`}</button>)}
              </div>
              <div className="heat-legend"><span>LOW</span><i /><b /><em /> <span>HIGH</span><small>{maxRoomLoad.toFixed(0)} kWh max</small></div>
            </div>
            <div className="selected-room">
              <div className="room-index">L{room.floor}</div><div className="room-title"><strong>{room.name}</strong><span>{room.kind} · {roomIsActive ? "Scheduled" : "No planned activity"}</span></div><div className="room-readout"><strong>{room.forecast_kwh[hour].toFixed(1)} <small>kWh</small></strong><span>{roomShare.toFixed(0)}% of campus estimate</span></div>
            </div>
            <div className="room-list" aria-label="Room selector">{data.rooms.map((item) => <button key={item.id} className={room.id === item.id ? "selected" : ""} onClick={() => setRoomId(item.id)}><span className="room-floor">L{item.floor}</span><span className="room-list-name">{item.name}</span><span className="room-list-load">{item.forecast_kwh[hour].toFixed(1)} kWh</span></button>)}</div>
          </section>

          <div className="side-column">
            <section className="panel schedule-panel">
              <div className="panel-heading"><div><div className="section-kicker">ROOM SCHEDULE</div><h2>Planned activity</h2><p>{formatStamp(data.forecast[0].timestamp, { weekday: "long", month: "long", day: "numeric" })}</p></div><span className="soft-count">{data.rooms.length} spaces</span></div>
              <div className="timeline-control"><div><span>SIMULATION TIME</span><strong>{formatStamp(currentForecast.timestamp, { hour: "2-digit", minute: "2-digit", hour12: false })}</strong></div><input aria-label="Simulation hour" type="range" min="0" max="23" value={hour} onChange={(event) => setHour(Number(event.target.value))} /><div className="timeline-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div></div>
              <div className="schedule-scroll"><div className="schedule-grid"><div className="schedule-head"><span>SPACE</span>{data.forecast.map((item, index) => <span key={item.timestamp} className={index === hour ? "now" : ""}>{index % 3 === 0 ? String(index).padStart(2, "0") : ""}</span>)}</div>{data.rooms.map((item) => <button key={item.id} className={`schedule-row ${item.id === room.id ? "current" : ""}`} onClick={() => setRoomId(item.id)}><span className="schedule-name">{item.name}</span>{item.schedule.map((occupancy, index) => <i key={index} title={`${String(index).padStart(2, "0")}:00 · ${occupancy > 0 ? `planned occupancy ${(occupancy * 100).toFixed(0)}%` : "no planned activity"}`} className={`${occupancy ? "occupied" : "empty"} ${occupancy > 0.6 ? "busy" : "light"} ${index === hour ? "now" : ""}`} />)}</button>)}</div></div>
              <div className="schedule-legend"><span><i className="legend-block busy" />Higher scheduled activity</span><span><i className="legend-block light" />Light use</span><span><i className="legend-block empty" />Unscheduled</span></div>
            </section>

            <section className="panel forecast-panel">
              <div className="panel-heading"><div><div className="section-kicker">SIMULATION OUTPUT</div><h2>24-hour load shape</h2></div><span className="estimate-tag">CAMPUS METER</span></div>
              <Sparkline values={data.forecast.map((item) => item.kwh)} />
              <div className="chart-caption"><span><i className="line-key" />Predicted campus kWh</span><span>Issued at midnight</span></div>
              <div className="input-summary"><div><span>WEATHER INPUT</span><strong>{currentForecast.temperature_forecast_c.toFixed(1)}°C forecast</strong></div><div><span>MODEL CHECK</span><strong>{data.model_selection.includes("zero residual") ? "Weekly baseline retained" : "Validation-selected model"}</strong></div></div>
            </section>
          </div>
        </div>

        <section className="lower-grid">
          <article className="panel lower-panel"><div><div className="section-kicker">MODEL CONTEXT</div><h2>Campus load is forecast as one sequence</h2><p>{data.model_selection} Room values divide the campus forecast using synthetic room schedules and fixed space weights. They are not independent model predictions.</p></div><div className="model-metrics"><div><span>TEST MAE</span><strong>{data.metrics.neural.mae.toFixed(1)} <small>kWh</small></strong></div><div><span>TEST RMSE</span><strong>{data.metrics.neural.rmse.toFixed(1)} <small>kWh</small></strong></div><div><span>TEST COVERAGE</span><strong>{data.metrics.neural.hours}<small> observed hours</small></strong></div></div></article>
          <article className="panel lower-panel source-panel"><div className="section-kicker">DATA STATUS</div><h2>What feeds this view</h2><div className="source-line"><span>Campus meter</span><b>Observed + missing flags</b></div><div className="source-line"><span>Schedule</span><b>Synthetic room plan</b></div><div className="source-line"><span>Weather</span><b>Archived forecast vintage</b></div><div className="source-line"><span>Room demand</span><b>Estimated allocation</b></div></article>
        </section>
        <footer className="page-footer">Simulation data · room schedules and room-wise demand are estimates · campus meter remains the only load target</footer>
      </div>
    </main>
  );
}
