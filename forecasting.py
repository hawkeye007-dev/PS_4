"""Leakage-safe daily forecast assembly, baseline, neural model, and scoring."""
from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

TZ = ZoneInfo("Asia/Kolkata")
HISTORY_HOURS = 168
PEAK_HOURS = set(range(12, 18))  # Fixed before held-out test scoring.
MODEL_VERSION = "numpy-two-encoder-v2"

# Room weights are synthetic allocation rules, not meter measurements. Their
# aggregate is conserved to the campus forecast at each target hour.
ROOMS = [
    {"id": "hall-101", "name": "Lecture hall 101", "floor": 1, "base": 0.9, "kind": "Teaching"},
    {"id": "hall-102", "name": "Lecture hall 102", "floor": 1, "base": 0.9, "kind": "Teaching"},
    {"id": "seminar-1", "name": "Seminar room", "floor": 1, "base": 0.55, "kind": "Teaching"},
    {"id": "library", "name": "Library", "floor": 2, "base": 1.1, "kind": "Study"},
    {"id": "study-lounge", "name": "Study lounge", "floor": 2, "base": 0.75, "kind": "Study"},
    {"id": "it-lab", "name": "Computer lab", "floor": 2, "base": 0.8, "kind": "Lab"},
    {"id": "science-lab", "name": "Science lab", "floor": 3, "base": 1.0, "kind": "Lab"},
    {"id": "faculty", "name": "Faculty offices", "floor": 3, "base": 0.85, "kind": "Office"},
    {"id": "admin", "name": "Administration", "floor": 3, "base": 0.7, "kind": "Office"},
]


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def parse_ts(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt.replace(tzinfo=TZ) if dt.tzinfo is None else dt.astimezone(TZ)


def calendar_features(ts: datetime, occupancy: float, temp: float, humidity: float) -> np.ndarray:
    hour_angle = 2 * np.pi * ts.hour / 24
    weekday_angle = 2 * np.pi * ts.weekday() / 7
    holiday = ts.date().isoformat() in {"2025-01-26", "2025-03-14", "2025-08-15"}
    return np.array([np.sin(hour_angle), np.cos(hour_angle), np.sin(weekday_angle),
                     np.cos(weekday_angle), float(ts.weekday() >= 5), float(holiday),
                     occupancy, temp / 40.0, humidity / 100.0], dtype=np.float32)


@dataclass
class Window:
    issue: datetime
    history: np.ndarray
    missing: np.ndarray
    future: np.ndarray
    target: np.ndarray
    target_missing: np.ndarray
    baseline: np.ndarray


def load_sources(data_dir: Path):
    meter_rows = read_rows(data_dir / "meter_readings.csv")
    meters = {parse_ts(r["timestamp"]): (float(r["campus_kwh"]) if r["campus_kwh"] else np.nan,
                                           bool(int(r["meter_missing"]))) for r in meter_rows}
    schedule_rows = read_rows(data_dir / "schedules.csv")
    # A file may contain a campus-wide plan or one row per room. Preserve each
    # availability timestamp so unpublished room changes cannot leak into an
    # earlier midnight forecast.
    schedules: dict[datetime, list[tuple[float, datetime]]] = {}
    for row in schedule_rows:
        schedules.setdefault(parse_ts(row["start_time"]), []).append(
            (float(row["planned_occupancy"]), parse_ts(row["available_at"])))
    weather_rows = read_rows(data_dir / "weather_forecasts.csv")
    weather: dict[tuple[datetime, datetime], tuple[float, float]] = {}
    for r in weather_rows:
        weather[(parse_ts(r["issue_time"]), parse_ts(r["target_time"]))] = (
            float(r["temperature_forecast_c"]), float(r["humidity_forecast_pct"]))
    return meters, schedules, weather


def assemble_window(meters, schedules, weather, issue: datetime, require_targets: bool) -> Window | None:
    """Build one issue-time window without reading target meter values as inputs.

    `require_targets` is true only for historical training/evaluation windows.
    The deployed forecast path passes false, so tomorrow's meter values cannot
    influence either the feature vector or the returned 24-hour prediction.
    """
    history_times = [issue - timedelta(hours=HISTORY_HOURS - i) for i in range(HISTORY_HOURS)]
    target_times = [issue + timedelta(hours=i) for i in range(24)]
    if any(t not in meters for t in history_times):
        return None
    if require_targets and any(t not in meters for t in target_times):
        return None
    if any((issue, t) not in weather or t not in schedules for t in target_times):
        return None
    historical_values = np.array([meters[t][0] for t in history_times], dtype=np.float32)
    missing = np.isnan(historical_values).astype(np.float32)
    # Training and serving share this explicit causal imputation: forward-fill
    # from observed history, falling back to the earliest available reading.
    valid = np.flatnonzero(~np.isnan(historical_values))
    if not len(valid):
        return None
    filled = historical_values.copy()
    last = float(filled[valid[0]])
    for i in range(len(filled)):
        if np.isnan(filled[i]):
            filled[i] = last
        else:
            last = float(filled[i])
    history = filled / 150.0
    def published_occupancy(ts: datetime) -> float:
        plans = schedules.get(ts, [])
        published = [occupancy for occupancy, available_at in plans if available_at <= issue]
        return float(np.mean(published)) if published else 0.0

    future_rows = []
    schedule_deltas = []
    for t in target_times:
        # Aggregate the room plans that were known at issue time. An unknown
        # schedule entry contributes no occupancy until it is published.
        occupancy = published_occupancy(t)
        last_week_occupancy = published_occupancy(t - timedelta(days=7))
        temp, humidity = weather[(issue, t)]  # Archived forecast vintage only.
        future_rows.append(calendar_features(t, occupancy, temp, humidity))
        schedule_deltas.append(occupancy - last_week_occupancy)
    # The first 24 history values are the matching hours from seven days ago.
    # They form the baseline that the neural decoder corrects.
    future = np.column_stack([np.stack(future_rows), history[:24], missing[:24], np.asarray(schedule_deltas, dtype=np.float32)])
    if require_targets:
        target = np.array([meters[t][0] for t in target_times], dtype=np.float32)
        target_missing = np.isnan(target)
    else:
        # Forecast targets do not exist at issue time. Keeping an all-missing
        # label preserves the invariant that fabricated readings are never scored.
        target = np.full(24, np.nan, dtype=np.float32)
        target_missing = np.ones(24, dtype=bool)
    baseline = np.array([meters[t - timedelta(days=7)][0] if t - timedelta(days=7) in meters else np.nan for t in target_times], dtype=np.float32)
    return Window(issue, history, missing, future, target, target_missing, baseline)


def load_windows(data_dir: Path) -> list[Window]:
    meters, schedules, weather = load_sources(data_dir)

    timestamps = sorted(meters)
    windows: list[Window] = []
    for issue in timestamps:
        if issue.hour != 0 or issue.minute != 0 or issue.second != 0:
            continue
        window = assemble_window(meters, schedules, weather, issue, require_targets=True)
        if window is not None:
            windows.append(window)
    return windows


def load_inference_window(data_dir: Path, issue: datetime) -> Window:
    """Assemble a forecast strictly from data available at `issue`."""
    meters, schedules, weather = load_sources(data_dir)
    window = assemble_window(meters, schedules, weather, issue, require_targets=False)
    if window is None:
        raise ValueError(f"Missing history, schedule, or archived forecast inputs for {issue.isoformat()}.")
    return window


class SequenceMLP:
    """Temporal history encoder fused with each target hour's known features."""

    def __init__(self, history_size: int, future_size: int, seed: int = 1234):
        rng = np.random.default_rng(seed)
        self.hidden = 48
        self.future_hidden = 12
        self.wh = rng.normal(0, np.sqrt(2 / history_size), (history_size, self.hidden)).astype(np.float32)
        self.bh = np.zeros(self.hidden, dtype=np.float32)
        self.wf = rng.normal(0, np.sqrt(2 / future_size), (future_size, self.future_hidden)).astype(np.float32)
        self.bf = np.zeros(self.future_hidden, dtype=np.float32)
        # Start at the known same-hour-last-week estimate and learn a correction.
        self.wo = np.zeros((self.hidden + self.future_hidden, 1), dtype=np.float32)
        self.bo = np.zeros(1, dtype=np.float32)
        # The 12th future feature is today's published schedule occupancy less
        # the matching hour's published schedule last week. This direct decoder
        # term makes planned schedule counterfactuals explicit and auditable.
        self.schedule_gain = 0.0

    def forward(self, hist: np.ndarray, future: np.ndarray):
        # Hist consists of 168 normalized readings followed by 168 missing flags.
        x = hist
        hpre = x @ self.wh + self.bh
        h = np.maximum(hpre, 0)
        fpre = future @ self.wf + self.bf
        f = np.tanh(fpre)
        joined = np.concatenate([np.repeat(h[:, None, :], 24, axis=1), f], axis=2)
        residual = (joined @ self.wo + self.bo)[..., 0] * 150.0 + future[:, :, 11] * self.schedule_gain
        pred = np.maximum(future[:, :, 9] * 150.0 + residual, 0.0)
        return pred, (x, hpre, h, future, fpre, f, joined)

    def fit(self, histories: np.ndarray, futures: np.ndarray, targets: np.ndarray,
            masks: np.ndarray, epochs: int = 45, lr: float = 0.012,
            validation: tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None = None) -> None:
        n = len(histories)
        if n == 0:
            return
        best_mae = float("inf")
        best_weights = tuple(p.copy() for p in (self.wh, self.bh, self.wf, self.bf, self.wo, self.bo))
        stale_epochs = 0
        if validation is not None:
            vh, vf, vt, vm = validation
            vp = self.predict(vh, vf)
            valid = (vm > 0) & np.isfinite(vt)
            best_mae = float(np.mean(np.abs(vp[valid] - vt[valid]))) if np.any(valid) else float("inf")
        for epoch in range(epochs):
            order = np.random.default_rng(8000 + epoch).permutation(n)
            for start in range(0, n, 128):
                ix = order[start:start + 128]
                hist, future, target, mask = histories[ix], futures[ix], targets[ix], masks[ix]
                pred, cache = self.forward(hist, future)
                x, hpre, h, fut, fpre, f, joined = cache
                denom = max(float(mask.sum()), 1.0)
                # Optimize normalized squared error. Output residuals are stored
                # in units of 150 kWh, so undo that output scale in the gradient.
                dpre = (2 * (pred - target) * mask / denom / 150.0)[..., None]
                gwo = np.sum(joined * dpre, axis=(0, 1), keepdims=False)[:, None]
                gbo = dpre.sum(axis=(0, 1))
                dj = dpre @ self.wo.T
                dh = dj[:, :, :self.hidden].sum(axis=1)
                df = dj[:, :, self.hidden:]
                dff = df * (1 - f * f)
                gwf = np.einsum("bti,btj->ij", fut, dff)
                gbf = dff.sum(axis=(0, 1))
                dhpre = dh * (hpre > 0)
                gwh = x.T @ dhpre
                gbh = dhpre.sum(axis=0)
                for param, grad in ((self.wo, gwo), (self.bo, gbo), (self.wf, gwf),
                                    (self.bf, gbf), (self.wh, gwh), (self.bh, gbh)):
                    param -= lr * np.clip(grad, -5, 5)
            if validation is not None:
                vh, vf, vt, vm = validation
                vp = self.predict(vh, vf)
                valid = (vm > 0) & np.isfinite(vt)
                val_mae = float(np.mean(np.abs(vp[valid] - vt[valid]))) if np.any(valid) else float("inf")
                if val_mae < best_mae:
                    best_mae = val_mae
                    best_weights = tuple(p.copy() for p in (self.wh, self.bh, self.wf, self.bf, self.wo, self.bo))
                    stale_epochs = 0
                else:
                    stale_epochs += 1
                    if stale_epochs >= 8:
                        break
        if best_weights is not None:
            for param, saved in zip((self.wh, self.bh, self.wf, self.bf, self.wo, self.bo), best_weights):
                param[...] = saved
        # Fit the schedule-delta decoder on training residuals only. It is a
        # component of the output decoder, never estimated from validation or
        # test labels. A non-negative gain matches the energy domain.
        baseline = futures[:, :, 9] * 150.0
        delta = futures[:, :, 11]
        valid = (masks > 0) & np.isfinite(targets)
        denominator = float(np.sum((delta[valid]) ** 2))
        if denominator > 1e-8:
            gain = float(np.sum(delta[valid] * (targets[valid] - baseline[valid])) / denominator)
            self.schedule_gain = float(np.clip(gain, 0.0, 250.0))

    def predict(self, histories: np.ndarray, futures: np.ndarray) -> np.ndarray:
        return self.forward(histories, futures)[0]


def score(pred: np.ndarray, target: np.ndarray, missing: np.ndarray) -> dict:
    valid = ~missing & np.isfinite(pred) & np.isfinite(target)
    errors = pred[valid] - target[valid]
    return {"mae": float(np.mean(np.abs(errors))) if len(errors) else None,
            "rmse": float(np.sqrt(np.mean(errors ** 2))) if len(errors) else None,
            "hours": int(valid.sum()), "possible_hours": int(valid.size),
            "coverage": float(valid.sum() / valid.size) if valid.size else 0.0}


def room_occupancy(room_id: str, ts: datetime) -> float:
    hour, weekend = ts.hour, ts.weekday() >= 5
    holiday = ts.date().isoformat() in {"2025-01-26", "2025-03-14", "2025-08-15"}
    if holiday:
        return 0.0
    if room_id.startswith("hall-"):
        return 0.82 if not weekend and 8 <= hour < 18 else (0.18 if not weekend and 18 <= hour < 20 else 0.0)
    if room_id == "seminar-1":
        return 0.65 if not weekend and 10 <= hour < 17 else 0.0
    if room_id == "library":
        return (0.58 if not weekend else 0.38) if 7 <= hour < 23 else 0.0
    if room_id == "study-lounge":
        return (0.5 if not weekend else 0.42) if 8 <= hour < 23 else 0.0
    if room_id == "it-lab":
        return (0.68 if not weekend else 0.32) if (9 <= hour < 19 if not weekend else 10 <= hour < 16) else 0.0
    if room_id == "science-lab":
        return 0.72 if not weekend and 9 <= hour < 20 else 0.0
    if room_id == "faculty":
        return 0.66 if not weekend and 8 <= hour < 18 else 0.0
    if room_id == "admin":
        return 0.72 if not weekend and 9 <= hour < 17 else 0.0
    return 0.0


def allocate_room_estimates(forecast: list[dict]) -> list[dict]:
    room_results = [{**room, "estimated": True, "schedule": [], "forecast_kwh": []} for room in ROOMS]
    for hour_index, item in enumerate(forecast):
        ts = parse_ts(item["timestamp"])
        occupancies = [room_occupancy(room["id"], ts) for room in ROOMS]
        weights = [room["base"] + occupancy * 1.7 for room, occupancy in zip(ROOMS, occupancies)]
        total_weight = sum(weights)
        for i, result in enumerate(room_results):
            result["schedule"].append(occupancies[i])
            result["forecast_kwh"].append(item["kwh"] * weights[i] / total_weight)
    for result in room_results:
        result["daily_kwh"] = sum(result["forecast_kwh"])
        result["current_kwh"] = result["forecast_kwh"][0]
        result["schedule_label"] = "Estimated from simulated campus schedule"
    return room_results


def build_week_calendar(issue: datetime) -> dict:
    monday = (issue - timedelta(days=issue.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    days = [monday + timedelta(days=offset) for offset in range(7)]
    hours = list(range(6, 23))
    return {
        "start_hour": hours[0],
        "hours": hours,
        "days": [{"date": day.date().isoformat(), "label": day.strftime("%a"),
                  "day_number": day.day, "is_issue_day": day.date() == issue.date()} for day in days],
        "rooms": [{"id": room["id"], "schedule": [[room_occupancy(room["id"], day + timedelta(hours=hour))
                                                       for hour in hours] for day in days]}
                  for room in ROOMS],
    }


def build_exploration(data_dir: Path) -> tuple[list[dict], list[dict]]:
    """Aggregate observed meter data only for the dashboard exploration charts."""
    meters, _, _ = load_sources(data_dir)
    hourly = [[] for _ in range(24)]
    weekdays = [[] for _ in range(7)]
    for ts, (value, missing) in meters.items():
        if missing or not np.isfinite(value):
            continue
        hourly[ts.hour].append(float(value))
        weekdays[ts.weekday()].append(float(value))
    daily_pattern = [{"hour": hour, "mean_kwh": float(np.mean(values)) if values else None,
                      "observed_hours": len(values)} for hour, values in enumerate(hourly)]
    weekly_pattern = [{"day": label, "weekday": day, "mean_kwh": float(np.mean(values)) if values else None,
                       "observed_hours": len(values)}
                      for day, (label, values) in enumerate(zip(("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"), weekdays))]
    return daily_pattern, weekly_pattern


def build_outage_view(data_dir: Path, padding_hours: int = 12) -> dict | None:
    """Expose the outage and causal imputation used for missing history inputs."""
    meters, _, _ = load_sources(data_dir)
    timestamps = sorted(meters)
    outage_indices = [i for i, ts in enumerate(timestamps) if meters[ts][1] or not np.isfinite(meters[ts][0])]
    if not outage_indices:
        return None
    first, last = outage_indices[0], outage_indices[-1]
    start_index = max(0, first - padding_hours)
    end_index = min(len(timestamps), last + padding_hours + 1)
    last_observed = None
    imputed: dict[datetime, float | None] = {}
    for ts in timestamps:
        value, missing = meters[ts]
        if missing or not np.isfinite(value):
            imputed[ts] = last_observed
        else:
            last_observed = float(value)
            imputed[ts] = last_observed
    timeline = []
    for ts in timestamps[start_index:end_index]:
        value, missing = meters[ts]
        timeline.append({"timestamp": ts.isoformat(), "observed_kwh": None if missing else float(value),
                         "missing": bool(missing), "causal_input_kwh": imputed[ts]})
    return {"start": timestamps[first].isoformat(), "end": (timestamps[last] + timedelta(hours=1)).isoformat(),
            "hours": len(outage_indices), "dataset_hours": len(timestamps), "context_hours": len(timeline), "timeline": timeline,
            "policy": "Historical gaps are forward-filled from the last observed meter reading and retain a missing-value flag. Missing target readings are excluded from scoring."}


def simulate_peak_schedule_shift(model: SequenceMLP, latest: Window, base_prediction: np.ndarray, fraction: float) -> dict:
    """Move a fraction of peak planned occupancy to the 18:00–20:59 window.

    This changes only future schedule features, leaving history, missing flags,
    calendar data and forecast weather fixed. It therefore answers a planning
    counterfactual with the same trained model rather than scaling a chart.
    """
    future = latest.future.copy()
    peak_indices = np.array(sorted(PEAK_HOURS))
    original_occupancy = future[:, 6].copy()
    removed = original_occupancy[peak_indices] * fraction
    future[peak_indices, 6] -= removed
    # Schedule delta is current planned occupancy minus that hour last week.
    future[peak_indices, 11] -= removed
    receiver_indices = np.array([18, 19, 20])
    capacity = np.maximum(0.0, 1.0 - future[receiver_indices, 6])
    movable = min(float(removed.sum()), float(capacity.sum()))
    if movable and capacity.sum() > 0:
        additions = movable * capacity / capacity.sum()
        future[receiver_indices, 6] += additions
        future[receiver_indices, 11] += additions
    prediction = model.predict(np.concatenate([latest.history, latest.missing])[None, :], future[None, :, :])[0]
    base_peak = float(base_prediction[peak_indices].sum())
    scenario_peak = float(prediction[peak_indices].sum())
    return {"id": f"shift-{int(fraction * 100)}", "shift_percent": int(fraction * 100),
            "label": f"Shift {int(fraction * 100)}% of flexible peak activity to 18:00–20:59",
            "forecast_kwh": [float(value) for value in prediction],
            "peak_kwh": scenario_peak, "peak_reduction_kwh": base_peak - scenario_peak,
            "daily_delta_kwh": float(prediction.sum() - base_prediction.sum()),
            "moved_occupancy_hours": movable,
            "method": "The trained model reruns with changed published schedule occupancy. Weather, calendar and meter history are held fixed."}


def train_and_evaluate(data_dir: Path) -> dict:
    windows = load_windows(data_dir)
    if len(windows) < 30:
        raise ValueError("Need at least 30 daily forecast windows with archived weather.")
    n = len(windows)
    train_end, val_end = int(n * 0.70), int(n * 0.85)
    def pack(items):
        histories = np.stack([np.concatenate([w.history, w.missing]) for w in items]).astype(np.float32)
        futures = np.stack([w.future for w in items]).astype(np.float32)
        raw_targets = np.stack([w.target for w in items]).astype(np.float32)
        masks = np.stack([~w.target_missing for w in items]).astype(np.float32)
        targets = np.nan_to_num(raw_targets, nan=0.0)
        return histories, futures, targets, masks
    tr = pack(windows[:train_end])
    va = pack(windows[train_end:val_end])
    te = pack(windows[val_end:])
    model = SequenceMLP(tr[0].shape[1], tr[1].shape[2])
    model.fit(*tr[:3], tr[3], validation=va)
    # Validation is chronological and never feeds final test fitting.
    val_pred = model.predict(va[0], va[1])
    test_pred = model.predict(te[0], te[1])
    test_truth = te[2]
    test_missing = te[3] == 0
    base_pred = np.stack([w.baseline for w in windows[val_end:]])
    # Baseline missing history hours remain unavailable; score only their valid pairs.
    baseline_missing = test_missing | ~np.isfinite(base_pred)
    peak = np.tile(np.isin(np.arange(24), list(PEAK_HOURS)), len(te[0]))
    model_metrics = score(test_pred.reshape(-1), test_truth.reshape(-1), test_missing.reshape(-1))
    baseline_metrics = score(base_pred.reshape(-1), test_truth.reshape(-1), baseline_missing.reshape(-1))
    val_baseline = np.stack([w.baseline for w in windows[train_end:val_end]])
    val_baseline_missing = (va[3] == 0) | ~np.isfinite(val_baseline)
    val_baseline_metrics = score(val_baseline.reshape(-1), va[2].reshape(-1), val_baseline_missing.reshape(-1))
    flat_pred, flat_truth, flat_missing = test_pred.reshape(-1), test_truth.reshape(-1), test_missing.reshape(-1)
    model_metrics["peak"] = score(flat_pred[peak], flat_truth[peak], flat_missing[peak])
    model_metrics["off_peak"] = score(flat_pred[~peak], flat_truth[~peak], flat_missing[~peak])
    validation_mae = score(val_pred.reshape(-1), va[2].reshape(-1), (va[3] == 0).reshape(-1))["mae"]

    # Reassemble the latest issue as an inference window. This intentionally
    # does not read its target meter values, even when historical demo files
    # contain them after the fact.
    latest = load_inference_window(data_dir, windows[-1].issue)
    next_pred = model.predict(np.concatenate([latest.history, latest.missing])[None, :], latest.future[None, :, :])[0]
    schedule_scenarios = [simulate_peak_schedule_shift(model, latest, next_pred, fraction) for fraction in (0.10, 0.20, 0.30)]
    hourly_actual = []
    for i, w in enumerate(windows[val_end:]):
        for h in range(24):
            hourly_actual.append({"timestamp": (w.issue + timedelta(hours=h)).isoformat(),
                                  "actual": None if w.target_missing[h] else float(w.target[h]),
                                  "predicted": float(test_pred[i, h])})
    forecast = [{"timestamp": (latest.issue + timedelta(hours=i)).isoformat(), "kwh": float(next_pred[i]),
                 "temperature_forecast_c": float(latest.future[i, 7] * 40),
                 "occupancy": float(latest.future[i, 6])} for i in range(24)]
    outage_hours = sum(w.target_missing.sum() for w in windows)
    latest_hist = [{"timestamp": (latest.issue - timedelta(hours=HISTORY_HOURS - i)).isoformat(),
                    "kwh": None if latest.missing[i] else float(latest.history[i] * 150),
                    "missing": bool(latest.missing[i])} for i in range(HISTORY_HOURS)]
    daily_pattern, weekly_pattern = build_exploration(data_dir)
    return {"model_version": MODEL_VERSION, "timezone": "Asia/Kolkata", "peak_definition": "12:00–17:59 local time",
            "split": {"train_days": train_end, "validation_days": val_end - train_end, "test_days": n - val_end},
            "metrics": {"neural": model_metrics, "same_hours_last_week": baseline_metrics},
            "validation_mae": validation_mae,
            "validation_baseline_mae": val_baseline_metrics["mae"],
            "model_selection": "Two-encoder residual model evaluated chronologically against the same-hours-last-week baseline. Its decoder includes a schedule-delta correction fitted on training windows only for counterfactual planning.",
            "forecast": forecast, "history": latest_hist, "hourly": hourly_actual,
            "rooms": allocate_room_estimates(forecast),
            "schedule": [{"timestamp": row["start_time"], "activity": row["planned_activity"],
                          "occupancy": float(row["planned_occupancy"])}
                         for row in read_rows(data_dir / "schedules.csv")[-168:]],
            "week_calendar": build_week_calendar(latest.issue),
            "outage_hours": int(outage_hours), "forecast_issue": latest.issue.isoformat(),
            "daily_pattern": daily_pattern, "weekly_pattern": weekly_pattern,
            "outage": build_outage_view(data_dir),
            "schedule_scenarios": schedule_scenarios}
