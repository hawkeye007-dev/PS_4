"""Create a deterministic, leakage-safe synthetic campus dataset."""
from __future__ import annotations

import csv
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

TZ = ZoneInfo("Asia/Kolkata")
SEED = 271828
START = datetime(2025, 1, 1, tzinfo=TZ)
DAYS = 240
OUTAGE_START = datetime(2025, 5, 12, 8, tzinfo=TZ)
OUTAGE_END = datetime(2025, 5, 14, 20, tzinfo=TZ)
HOLIDAYS = {date(2025, 1, 26), date(2025, 3, 14), date(2025, 8, 15)}
ROOM_IDS = ("hall-101", "hall-102", "seminar-1", "library", "study-lounge", "it-lab", "science-lab", "faculty", "admin")


def write_csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def planned_room_occupancy(room_id: str, ts: datetime, day_multiplier: float) -> tuple[float, str]:
    """A published room-plan input; it is distinct from the simulated meter."""
    hour, weekend = ts.hour, ts.weekday() >= 5
    if ts.date() in HOLIDAYS:
        return 0.0, "holiday closure"
    if room_id.startswith("hall-"):
        base = 0.82 if not weekend and 8 <= hour < 18 else 0.18 if not weekend and 18 <= hour < 20 else 0.0
        return min(1.0, base * day_multiplier), "exam" if day_multiplier >= 1.18 and base else "teaching"
    if room_id == "seminar-1":
        return min(1.0, (0.65 if not weekend and 10 <= hour < 17 else 0.0) * day_multiplier), "seminar"
    if room_id == "library":
        return min(1.0, ((0.58 if not weekend else 0.38) if 7 <= hour < 23 else 0.0) * day_multiplier), "study"
    if room_id == "study-lounge":
        return min(1.0, ((0.5 if not weekend else 0.42) if 8 <= hour < 23 else 0.0) * day_multiplier), "study"
    if room_id == "it-lab":
        return min(1.0, (0.68 if not weekend and 9 <= hour < 19 else 0.32 if weekend and 10 <= hour < 16 else 0.0) * day_multiplier), "lab"
    if room_id == "science-lab":
        return min(1.0, (0.72 if not weekend and 9 <= hour < 20 else 0.0) * day_multiplier), "lab"
    if room_id == "faculty":
        return min(1.0, (0.66 if not weekend and 8 <= hour < 18 else 0.0) * day_multiplier), "office"
    return min(1.0, (0.72 if not weekend and 9 <= hour < 17 else 0.0) * day_multiplier), "office"


def make_dataset(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    n = DAYS * 24
    times = [START + timedelta(hours=i) for i in range(n)]
    actual_weather: list[tuple[float, float]] = []
    temp = 25.0
    for ts in times:
        seasonal = 5 * np.sin(2 * np.pi * (ts.timetuple().tm_yday - 30) / 365)
        temp = 0.93 * temp + 0.07 * (26 + seasonal) + rng.normal(0, 0.7)
        actual_weather.append((temp, float(np.clip(62 - (temp - 25) * 1.7 + rng.normal(0, 5), 25, 95))))

    schedule_rows: list[dict] = []
    planned_by_hour: dict[datetime, float] = {}
    # Day-level room-plan changes simulate published examinations, events and
    # lighter teaching days. They are known a day ahead through schedules.csv.
    daily_schedule_multiplier = {}
    for day_offset in range(DAYS):
        day = (START + timedelta(days=day_offset)).date()
        daily_schedule_multiplier[day] = 1.0 if day.weekday() >= 5 or day in HOLIDAYS else float(rng.choice(
            [0.74, 0.88, 1.0, 1.12, 1.26], p=[0.08, 0.18, 0.46, 0.20, 0.08]))
    for ts in times:
        room_plans = []
        for room_id in ROOM_IDS:
            occupancy, activity = planned_room_occupancy(room_id, ts, daily_schedule_multiplier[ts.date()])
            room_plans.append(occupancy)
            schedule_rows.append({
                "room_or_building_id": room_id, "start_time": ts.isoformat(),
                "end_time": (ts + timedelta(hours=1)).isoformat(), "planned_activity": activity,
                "planned_occupancy": occupancy, "available_at": (ts - timedelta(days=1)).isoformat(),
            })
        # The model receives this aggregate through the room schedule rows.
        planned_by_hour[ts] = float(np.mean(room_plans))

    latent_rows, observed_rows = [], []
    noise = 0.0
    for i, ts in enumerate(times):
        hour, weekday = ts.hour, ts.weekday()
        occupied = planned_by_hour[ts]
        weekend_factor = 0.58 if weekday >= 5 else 1.0
        holiday_factor = 0.48 if ts.date() in HOLIDAYS else 1.0
        diurnal = 52 + 18 * np.sin(2 * np.pi * (hour - 7) / 24) + 9 * np.sin(4 * np.pi * (hour - 8) / 24)
        occupancy = 72 * occupied
        t, humidity = actual_weather[i]
        cooling = 5.2 * max(t - 24, 0)
        heating = 2.8 * max(19 - t, 0)
        noise = 0.72 * noise + rng.normal(0, 8)
        latent = max(8.0, (diurnal + occupancy + cooling + heating + 0.15 * humidity + noise) * weekend_factor * holiday_factor)
        latent_rows.append({"timestamp": ts.isoformat(), "latent_kwh": round(float(latent), 3), "actual_temperature_c": round(t, 3), "actual_humidity_pct": round(humidity, 3)})
        outage = OUTAGE_START <= ts < OUTAGE_END
        observed = "" if outage else round(float(max(0, latent + rng.normal(0, 2.2))), 3)
        observed_rows.append({"timestamp": ts.isoformat(), "campus_kwh": observed, "meter_missing": int(outage)})

    weather_rows: list[dict] = []
    for issue_day in range(DAYS - 1):
        issue = START + timedelta(days=issue_day)
        for lead in range(24):
            target = issue + timedelta(hours=lead)
            target_idx = (target - START).days * 24 + target.hour
            actual_t, actual_h = actual_weather[target_idx]
            weather_rows.append({
                "issue_time": issue.isoformat(), "target_time": target.isoformat(),
                "temperature_forecast_c": round(float(actual_t + 0.12 * (lead + 1) + rng.normal(0, 0.65 + lead * 0.09)), 3),
                "humidity_forecast_pct": round(float(np.clip(actual_h + rng.normal(0, 2 + lead * 0.16), 0, 100)), 3),
            })

    write_csv(directory / "meter_readings.csv", ["timestamp", "campus_kwh", "meter_missing"], observed_rows)
    write_csv(directory / "schedules.csv", ["room_or_building_id", "start_time", "end_time", "planned_activity", "planned_occupancy", "available_at"], schedule_rows)
    write_csv(directory / "weather_forecasts.csv", ["issue_time", "target_time", "temperature_forecast_c", "humidity_forecast_pct"], weather_rows)
    write_csv(directory / "simulation_truth.csv", ["timestamp", "latent_kwh", "actual_temperature_c", "actual_humidity_pct"], latent_rows)
    (directory / "metadata.txt").write_text(
        f"seed={SEED}\ntimezone=Asia/Kolkata\nstart={START.isoformat()}\ndays={DAYS}\n"
        f"outage_start={OUTAGE_START.isoformat()}\noutage_end={OUTAGE_END.isoformat()}\n"
        "peak_hours=12:00-17:59 local\ntruth_file=simulation_truth.csv; never an input or scoring target\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    make_dataset(Path(__file__).parent / "data")
