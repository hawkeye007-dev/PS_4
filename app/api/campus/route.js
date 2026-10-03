export const dynamic = "force-dynamic";

export async function GET() {
  const base = process.env.CAMPUS_API_URL || "http://127.0.0.1:8000";
  try {
    const response = await fetch(`${base}/api/data`, { cache: "no-store" });
    if (!response.ok) {
      return Response.json({ error: `Forecast service returned ${response.status}.` }, { status: 502 });
    }
    return Response.json(await response.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Forecast service is unavailable. Start the Python API on port 8000, then reload." },
      { status: 503 },
    );
  }
}
