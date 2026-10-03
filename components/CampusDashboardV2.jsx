"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import AnalysisPanels from "./AnalysisPanels";
import WhatIfSimulator from "./WhatIfSimulator";

const BuildingScene = dynamic(() => import("./BuildingScene"), { ssr: false, loading: () => <div className="scene-loading">Rendering building…</div> });

function formatStamp(value, options = { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) {
  return new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function LoadCurve({ values }) {
  const width = 720, height = 188, left = 42, right = 12, top = 18, bottom = 28;
  const min = Math.min(...values) * .86, max = Math.max(...values) * 1.1 || 1;
  const x = (i) => left + i * (width - left - right) / Math.max(1, values.length - 1);
  const y = (value) => top + (max - value) * (height - top - bottom) / (max - min || 1);
  const path = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return <svg className="load-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Campus forecast load chart">
    {[0, 1, 2, 3].map((step) => { const value = min + (max - min) * step / 3; return <g key={step}><line x1={left} y1={y(value)} x2={width - right} y2={y(value)} /><text x="2" y={y(value) + 3}>{value.toFixed(0)}</text></g>; })}
    <path d={`${path} L${x(values.length - 1)},${height - bottom} L${x(0)},${height - bottom} Z`} className="load-area" /><path d={path} className="load-line" />
    {[0, 6, 12, 18, 23].map((index) => <text key={index} x={x(index)} y={height - 5} textAnchor="middle">{String(index).padStart(2, "0")}:00</text>)}
  </svg>;
}

function WeekCalendar({ data, roomId }) {
  const calendar = data.week_calendar;
  if (!calendar) return null;
  const schedule = calendar.rooms.find((item) => item.id === roomId) || calendar.rooms[0];
  const roomName = data.rooms.find((room) => room.id === schedule.id)?.name;
  return <section className="week-calendar" id="calendar" aria-label="Weekly room calendar">
    <div className="week-calendar-head"><div><p className="overline">Weekly schedule</p><h2>Planned use across the teaching block</h2></div><span>Viewing <b>{roomName}</b></span></div>
    <div className="week-grid-wrap"><div className="week-grid" style={{ gridTemplateColumns: `76px repeat(${calendar.days.length}, minmax(92px, 1fr))` }}>
      <div className="week-corner">TIME</div>{calendar.days.map((day) => <div className={`day-head ${day.is_issue_day ? "today" : ""}`} key={day.date}><span>{day.label}</span><strong>{day.day_number}</strong></div>)}
      {calendar.hours.map((hour, row) => <div className="week-row" key={hour}><div className="time-label">{String(hour).padStart(2, "0")}:00</div>{calendar.days.map((day, col) => { const amount = schedule.schedule[col][row]; return <div key={day.date} title={`${day.label} ${String(hour).padStart(2, "0")}:00`} className={`calendar-slot ${amount > 0 ? "booked" : ""} ${amount > .6 ? "high" : ""} ${day.is_issue_day && hour === 14 ? "focus" : ""}`}>{amount > .6 && (hour === 9 || hour === 14) ? <span>Class</span> : null}</div>; })}</div>)}
    </div></div>
    <div className="calendar-foot"><span><i className="calendar-key available" />Unscheduled</span><span><i className="calendar-key planned" />Planned</span><span><i className="calendar-key high" />High activity</span><p>Schedule dates are synthetic. Demand is estimated from campus load.</p></div>
  </section>;
}

export default function CampusDashboardV2() {
  const [data, setData] = useState(null); const [error, setError] = useState(""); const [hour, setHour] = useState(14); const [floor, setFloor] = useState("all"); const [roomId, setRoomId] = useState("hall-101");
  useEffect(() => { let active = true; fetch("/api/campus", { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Forecast data is unavailable."); return body; }).then((payload) => active && setData(payload)).catch((cause) => active && setError(cause.message)); return () => { active = false; }; }, []);
  const room = useMemo(() => data?.rooms?.find((item) => item.id === roomId) || data?.rooms?.[0], [data, roomId]);
  if (error) return <main className="v2-state"><section><p className="overline">Campus energy</p><h1>Forecast data is offline</h1><p>{error}</p><code>python3 app.py</code></section></main>;
  if (!data || !room) return <main className="v2-state"><section><div className="v2-spinner" /><h1>Preparing the building view</h1><p>Connecting to the local forecast service…</p></section></main>;
  const current = data.forecast[hour]; const activeRooms = data.rooms.filter((item) => item.schedule[hour] > 0).length; const roomShare = room.forecast_kwh[hour] / Math.max(current.kwh, 1) * 100; const isActive = room.schedule[hour] > 0; const total = data.forecast.reduce((sum, item) => sum + item.kwh, 0); const peak = data.forecast.reduce((a, item) => item.kwh > a.kwh ? item : a, data.forecast[0]);
  return <main className="v2-app"><header className="v2-nav"><div><a className="v2-brand" href="#top"><i><b /><b /><b /></i>Campus Load</a><nav><a className="active" href="#overview">Overview</a><a href="#building">Building</a><a href="#calendar">Calendar</a><a href="#forecast">Forecast</a><a href="/model">Model</a></nav><span className="v2-status"><b /> Simulation active <em /> Asia/Kolkata</span></div></header>
    <div className="v2-wrap" id="top"><section className="v2-intro" id="overview"><div><p className="overline">Campus energy planning</p><h1>Know the load<br />before the day begins.</h1><p className="v2-lede">A room-level planning view for the next operating day. Explore schedules, space use and estimated demand from one campus forecast.</p><div className="v2-intro-meta"><span>FORECAST ISSUED <b>{formatStamp(data.forecast_issue)}</b></span><span>MODEL <b>24 hour sequence</b></span></div></div><aside><p>EXPECTED CAMPUS ENERGY</p><strong>{total.toFixed(0)}<small> kWh</small></strong><span>Next 24 hours</span><hr /><div><span>Peak expected at</span><b>{formatStamp(peak.timestamp, { hour: "2-digit", minute: "2-digit", hour12: false })}</b></div><div><span>Active spaces at {String(hour).padStart(2, "0")}:00</span><b>{activeRooms} / {data.rooms.length}</b></div></aside></section>
      <section className="v2-control"><div><span>SIMULATION TIME</span><strong>{formatStamp(current.timestamp, { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</strong></div><label><input aria-label="Simulation hour" type="range" min="0" max="23" value={hour} onChange={(event) => setHour(Number(event.target.value))} /><span><b>00</b><b>06</b><b>12</b><b>18</b><b>23</b></span></label><div><span>CAMPUS LOAD</span><strong>{current.kwh.toFixed(1)} <small>kWh</small></strong></div></section>
      <section className="v2-building" id="building"><article><header><div><p className="overline">Spatial load model</p><h2>Teaching block</h2></div><p>Drag to orbit. Select a room for detail.</p></header><div className="v2-scene"><BuildingScene rooms={data.rooms} hour={hour} selectedRoom={roomId} onSelectRoom={setRoomId} floorFilter={floor} /><div className="v2-floor-filter">{[["all", "All levels"], ["1", "Level 01"], ["2", "Level 02"], ["3", "Level 03"]].map(([value, label]) => <button key={value} className={floor === value ? "active" : ""} onClick={() => setFloor(value)}>{label}</button>)}</div><div className="v2-legend"><span>Estimated room load</span><i /><i /><i /><b>Low</b><b>High</b></div></div></article><aside><div className="v2-rail-head"><p className="overline">Selected space</p><span>Estimated</span></div><h2>{room.name}</h2><p className="v2-sub">Level {room.floor} · {room.kind}</p><div className="v2-room-number"><strong>{room.forecast_kwh[hour].toFixed(1)}</strong><span>kWh at {String(hour).padStart(2, "0")}:00</span></div><div className="v2-room-facts"><div><span>Scheduled use</span><b>{isActive ? `${Math.round(room.schedule[hour] * 100)}% planned` : "None planned"}</b></div><div><span>Campus share</span><b>{roomShare.toFixed(0)}% estimated</b></div></div><div className="v2-room-picker">{data.rooms.map((item) => <button key={item.id} className={item.id === room.id ? "chosen" : ""} onClick={() => { setRoomId(item.id); setFloor(String(item.floor)); }}><i>0{item.floor}</i><span>{item.name}<small>{item.kind}</small></span><b>{item.forecast_kwh[hour].toFixed(1)}</b></button>)}</div></aside></section>
      <section className="v2-insights" id="forecast"><article><header><div><p className="overline">Forecast</p><h2>Tomorrow’s load profile</h2></div><span>24 hourly values</span></header><LoadCurve values={data.forecast.map((item) => item.kwh)} /><footer><span><i />Predicted campus kWh</span><span>Weather: {current.temperature_forecast_c.toFixed(1)}°C forecast</span><span>Issued at midnight</span></footer></article><aside><p className="overline">Data integrity</p><h2>Inputs remain time-safe.</h2><p>Weather comes from the forecast issued at midnight. The meter outage is excluded from target scoring.</p><dl><div><dt>Test MAE</dt><dd>{data.metrics.neural.mae.toFixed(1)} kWh</dd></div><div><dt>Observed hours</dt><dd>{data.metrics.neural.hours}</dd></div><div><dt>Missing hours</dt><dd>{data.outage_hours}</dd></div></dl><small>Room estimates conserve the campus forecast each hour. No room meters are present.</small></aside></section>
      <WhatIfSimulator data={data} /><AnalysisPanels data={data} /><WeekCalendar data={data} roomId={room.id} /><footer className="v2-footer">Simulated planning data. Campus meter is the forecasting target; room demand is an explicit estimate.</footer>
    </div></main>;
}
