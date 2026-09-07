import { NextResponse } from "next/server";

// Liveness for the app tier plus a real reachability check against the ML
// service.
export async function GET() {
  const mlServiceUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

  let mlReachable = false;
  try {
    const res = await fetch(`${mlServiceUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    mlReachable = res.ok;
  } catch {
    mlReachable = false;
  }

  return NextResponse.json({ status: "ok", ml_service_reachable: mlReachable });
}
