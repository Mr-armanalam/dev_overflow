/**
 * /admin/ai — AI usage dashboard (design §9.1).
 *
 * Shows today's AI calls: calls/day, cost/day, p50/p95 latency,
 * cache hit rate, error rate by provider, plus the most recent calls.
 *
 * Admin-only (P3 RBAC): `requirePermissionForPage("ai:admin:dashboard")`
 * redirects signed-out users to sign-in and 404s for signed-in users
 * without the admin role. Cache hit rate is real since the P3 cache
 * landed (0% until Upstash env vars are set — see docs/upstash-setup.md).
 */
import { connectToDatabase } from "@/lib/mongoose";
import AiUsageLog from "@/database/ai-usage-log.model";
import { startOfTodayUtc } from "@/lib/ai/budgets";
import { requirePermissionForPage } from "@/lib/auth/server-permissions";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

const STATUS_STYLES: Record<string, string> = {
  success: "text-green-600",
  flagged: "text-yellow-600",
  error: "text-red-600",
  rejected: "text-orange-600",
  pending: "text-light-500",
};

const AdminAiPage = async () => {
  // Admin-only: redirects to sign-in when signed out, 404s otherwise.
  await requirePermissionForPage("ai:admin:dashboard");

  await connectToDatabase();
  const since = startOfTodayUtc();
  // P1 traffic is small (10 drafts + 20 tag calls per user per day),
  // so today's rows are computed in JS. Move to an aggregation
  // pipeline if daily volume grows past a few thousand rows.
  const logs = await AiUsageLog.find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .lean();

  const callsToday = logs.length;
  const costToday = logs.reduce((sum, log) => sum + log.costUsd, 0);
  const completedLatencies = logs
    .filter((log) => log.status === "success" || log.status === "flagged")
    .map((log) => log.latencyMs)
    .filter((ms) => ms > 0);
  const p50Latency = percentile(completedLatencies, 50);
  const p95Latency = percentile(completedLatencies, 95);
  const errorRows = logs.filter((log) => log.status === "error").length;
  const errorRate = callsToday > 0 ? (errorRows / callsToday) * 100 : 0;
  const cacheHits = logs.filter((log) => log.cacheHit).length;
  const cacheHitRate = callsToday > 0 ? (cacheHits / callsToday) * 100 : 0;

  const byProvider = new Map<string, { calls: number; errors: number }>();
  for (const log of logs) {
    const entry = byProvider.get(log.provider) ?? { calls: 0, errors: 0 };
    entry.calls += 1;
    if (log.status === "error") entry.errors += 1;
    byProvider.set(log.provider, entry);
  }

  const recent = logs.slice(0, 20);

  return (
    <div>
      <h1 className="h1-bold text-dark100_light900">AI Usage</h1>
      <p className="body-regular mt-2 text-light-500">
        Today&apos;s AI calls (UTC day). Costs are approximate — see the
        price table in lib/ai/pricing.ts. Admin-only page (RBAC, P3).
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="background-light900_dark300 light-border rounded-md border p-4">
          <p className="small-medium text-light-500">Calls today</p>
          <p className="h2-bold text-dark100_light900 mt-1">{callsToday}</p>
        </div>
        <div className="background-light900_dark300 light-border rounded-md border p-4">
          <p className="small-medium text-light-500">Cost today (approx.)</p>
          <p className="h2-bold text-dark100_light900 mt-1">
            ${costToday.toFixed(4)}
          </p>
        </div>
        <div className="background-light900_dark300 light-border rounded-md border p-4">
          <p className="small-medium text-light-500">Latency p50 / p95</p>
          <p className="h2-bold text-dark100_light900 mt-1">
            {p50Latency} / {p95Latency} ms
          </p>
        </div>
        <div className="background-light900_dark300 light-border rounded-md border p-4">
          <p className="small-medium text-light-500">Cache hit rate</p>
          <p className="h2-bold text-dark100_light900 mt-1">
            {cacheHitRate.toFixed(1)}%
          </p>
          <p className="small-regular text-light-500">
            0% until Upstash env vars are set — see docs/upstash-setup.md.
          </p>
        </div>
        <div className="background-light900_dark300 light-border rounded-md border p-4">
          <p className="small-medium text-light-500">Error rate</p>
          <p className="h2-bold text-dark100_light900 mt-1">
            {errorRate.toFixed(1)}%
          </p>
          <p className="small-regular text-light-500">
            {errorRows} failed of {callsToday} calls
          </p>
        </div>
        <div className="background-light900_dark300 light-border rounded-md border p-4">
          <p className="small-medium text-light-500">Error rate by provider</p>
          {byProvider.size === 0 ? (
            <p className="body-regular text-dark100_light900 mt-1">
              No calls yet
            </p>
          ) : (
            [...byProvider.entries()].map(([provider, stats]) => (
              <p
                key={provider}
                className="body-regular text-dark100_light900 mt-1"
              >
                {provider}:{" "}
                {stats.calls > 0
                  ? ((stats.errors / stats.calls) * 100).toFixed(1)
                  : "0.0"}
                % ({stats.errors}/{stats.calls})
              </p>
            ))
          )}
        </div>
      </div>

      <h2 className="h3-bold text-dark100_light900 mt-10">Recent calls</h2>
      {recent.length === 0 ? (
        <p className="body-regular mt-2 text-light-500">
          No AI calls today yet.
        </p>
      ) : (
        <div className="background-light900_dark300 light-border mt-4 overflow-x-auto rounded-md border">
          <table className="w-full text-left">
            <thead>
              <tr className="small-medium text-light-500 border-b">
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Task</th>
                <th className="px-4 py-2">Model</th>
                <th className="px-4 py-2">Prompt</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Tokens in/out</th>
                <th className="px-4 py-2">Latency</th>
                <th className="px-4 py-2">Cost</th>
                <th className="px-4 py-2">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((log) => (
                <tr
                  key={String(log._id)}
                  className="body-regular text-dark100_light900 border-b last:border-0"
                >
                  <td className="px-4 py-2">
                    {log.createdAt.toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2">{log.task}</td>
                  <td className="px-4 py-2">{log.modelName}</td>
                  <td className="px-4 py-2">
                    {log.promptId} v{log.promptVersion}
                  </td>
                  <td
                    className={`px-4 py-2 ${STATUS_STYLES[log.status] ?? ""}`}
                  >
                    {log.status}
                    {log.errorCode ? ` (${log.errorCode})` : ""}
                  </td>
                  <td className="px-4 py-2">
                    {log.inputTokens}/{log.outputTokens}
                  </td>
                  <td className="px-4 py-2">{log.latencyMs} ms</td>
                  <td className="px-4 py-2">${log.costUsd.toFixed(6)}</td>
                  <td className="px-4 py-2">{log.feedback ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminAiPage;
