"use client";

import { useMemo } from "react";
import { AlertTriangle, Activity, Brain, Siren, ShieldAlert } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export type LogRow = Record<string, any>;

const RISK_KEYS = ["riskScore", "risk_score", "risk", "risk_score_value"];
const HALLUCINATION_KEYS = ["hallucination", "hallucinated", "isHallucination", "hallucinationDetected", "hallucination_detected"];
const ESCALATION_KEYS = ["escalationRequired", "escalation_required", "requiresEscalation", "requires_escalation"];
const PWI_KEYS = ["prescriptionWithoutIndication", "prescription_without_indication", "rx_without_indication"];
const AGE_KEYS = ["age", "patient_age"];
const FAILURE_KEYS = ["failureType", "failure_type", "error_type", "issue_type", "label"];
const PATTERN_KEYS = ["hallucinatedPattern", "hallucinated_pattern", "pattern", "claim_pattern"];
const TS_KEYS = ["created_at", "timestamp", "logged_at", "occurred_at", "updated_at"];

function getField<T>(row: LogRow, keys: string[]): T | undefined {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key] as T;
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function toTimestamp(row: LogRow): number | null {
  const raw = getField<any>(row, TS_KEYS);
  if (!raw) return null;
  const d = new Date(raw);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function riskOf(row: LogRow): number {
  return toNumber(getField(row, RISK_KEYS)) ?? 0;
}

function isHallucination(row: LogRow): boolean {
  return toBool(getField(row, HALLUCINATION_KEYS));
}

function isEscalation(row: LogRow): boolean {
  return toBool(getField(row, ESCALATION_KEYS));
}

function isPrescriptionWithoutIndication(row: LogRow): boolean {
  return toBool(getField(row, PWI_KEYS));
}

function ageOf(row: LogRow): number | null {
  return toNumber(getField(row, AGE_KEYS));
}

function failureTypeOf(row: LogRow): string {
  return String(getField(row, FAILURE_KEYS) ?? "none").trim() || "none";
}

function hallucinationPatternOf(row: LogRow): string {
  return String(getField(row, PATTERN_KEYS) ?? "none").trim() || "none";
}

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function isLikelyLogsDataset(rows: LogRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.some((r) => getField(r, RISK_KEYS) !== undefined || getField(r, HALLUCINATION_KEYS) !== undefined || getField(r, ESCALATION_KEYS) !== undefined);
}

export function matchesSmartFilter(row: LogRow, filter: SmartFilter): boolean {
  switch (filter) {
    case "high-risk":
      return riskOf(row) >= 7;
    case "escalations":
      return isEscalation(row);
    case "hallucinations":
      return isHallucination(row);
    case "pediatric": {
      const age = ageOf(row);
      return age !== null && age < 18;
    }
    default:
      return true;
  }
}

export function getRowRiskBadge(risk: number): { label: string; className: string } {
  if (risk >= 7) {
    return {
      label: String(risk),
      className: "bg-red-50 text-red-600 border-red-200",
    };
  }
  if (risk >= 4) {
    return {
      label: String(risk),
      className: "bg-amber-50 text-amber-600 border-amber-200",
    };
  }
  return {
    label: String(risk),
    className: "bg-emerald-50 text-emerald-600 border-emerald-200",
  };
}

export type SmartFilter = "all" | "high-risk" | "escalations" | "hallucinations" | "pediatric";

function useInsights(rows: LogRow[]) {
  return useMemo(() => {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;

    let highRisk24h = 0;
    let riskSum = 0;
    let riskCount = 0;
    let hallucinations = 0;
    let escalations = 0;
    let pwi = 0;

    for (const row of rows) {
      const risk = riskOf(row);
      const ts = toTimestamp(row);
      if (ts && ts >= last24h && risk >= 7) highRisk24h += 1;

      riskSum += risk;
      riskCount += 1;

      if (isHallucination(row)) hallucinations += 1;
      if (isEscalation(row)) escalations += 1;
      if (isPrescriptionWithoutIndication(row)) pwi += 1;
    }

    return {
      total: rows.length,
      highRisk24h,
      avgRisk: riskCount ? Math.round((riskSum / riskCount) * 100) / 100 : 0,
      hallucinationRate: percent(hallucinations, rows.length),
      escalationCount: escalations,
      pwiRate: percent(pwi, rows.length),
    };
  }, [rows]);
}

export function ProactiveInsights({ rows }: { rows: LogRow[] }) {
  const insights = useInsights(rows);

  const cards = [
    {
      label: "High-Risk (24h)",
      value: insights.highRisk24h,
      icon: AlertTriangle,
      tone: "text-red-600 bg-red-50 border-red-100",
    },
    {
      label: "Average Risk",
      value: insights.avgRisk.toFixed(2),
      icon: Activity,
      tone: "text-amber-600 bg-amber-50 border-amber-100",
    },
    {
      label: "Hallucination Rate",
      value: `${insights.hallucinationRate}%`,
      icon: Brain,
      tone: "text-violet-600 bg-violet-50 border-violet-100",
    },
    {
      label: "Escalations",
      value: insights.escalationCount,
      icon: Siren,
      tone: "text-rose-600 bg-rose-50 border-rose-100",
    },
    {
      label: "Rx Without Indication",
      value: `${insights.pwiRate}%`,
      icon: ShieldAlert,
      tone: "text-orange-600 bg-orange-50 border-orange-100",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
      {cards.map((card) => (
        <div key={card.label} className={`rounded-2xl border px-4 py-3 ${card.tone}`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] uppercase tracking-widest font-semibold">{card.label}</p>
            <card.icon size={14} />
          </div>
          <p className="text-2xl font-black leading-none">{card.value}</p>
        </div>
      ))}
    </div>
  );
}

export function SmartFilters({
  active,
  onChange,
  rows,
}: {
  active: SmartFilter;
  onChange: (f: SmartFilter) => void;
  rows: LogRow[];
}) {
  const counts = useMemo(() => {
    return {
      all: rows.length,
      "high-risk": rows.filter((r) => matchesSmartFilter(r, "high-risk")).length,
      escalations: rows.filter((r) => matchesSmartFilter(r, "escalations")).length,
      hallucinations: rows.filter((r) => matchesSmartFilter(r, "hallucinations")).length,
      pediatric: rows.filter((r) => matchesSmartFilter(r, "pediatric")).length,
    };
  }, [rows]);

  const items: { key: SmartFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "high-risk", label: "High Risk" },
    { key: "escalations", label: "Escalations" },
    { key: "hallucinations", label: "Hallucinations" },
    { key: "pediatric", label: "Pediatric Cases" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const selected = active === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
              selected
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-700"
            }`}
          >
            {item.label} ({counts[item.key]})
          </button>
        );
      })}
    </div>
  );
}

export function RiskTrendChart({ rows }: { rows: LogRow[] }) {
  const data = useMemo(() => {
    const buckets = new Map<string, { total: number; count: number }>();

    for (const row of rows) {
      const ts = toTimestamp(row);
      if (!ts) continue;
      const key = new Date(ts).toISOString().slice(0, 10);
      const prev = buckets.get(key) || { total: 0, count: 0 };
      prev.total += riskOf(row);
      prev.count += 1;
      buckets.set(key, prev);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({
        date,
        avgRisk: Math.round((value.total / Math.max(value.count, 1)) * 100) / 100,
      }));
  }, [rows]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 h-72">
      <div className="mb-2">
        <h3 className="text-sm font-bold text-slate-900">Risk Trend</h3>
        <p className="text-xs text-slate-400">Average risk score by day</p>
      </div>
      <ResponsiveContainer width="100%" height="88%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="avgRisk" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AISummaryWidget({ rows }: { rows: LogRow[] }) {
  const summary = useMemo(() => {
    const recent = rows.slice(0, 100);

    const failureCounts = new Map<string, number>();
    const patternCounts = new Map<string, number>();

    for (const row of recent) {
      const failure = failureTypeOf(row);
      if (failure !== "none") {
        failureCounts.set(failure, (failureCounts.get(failure) || 0) + 1);
      }

      if (isHallucination(row)) {
        const pattern = hallucinationPatternOf(row);
        if (pattern !== "none") {
          patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
        }
      }
    }

    const getTop = (m: Map<string, number>) => {
      const arr = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
      return arr.length ? `${arr[0][0]} (${arr[0][1]})` : "No dominant pattern";
    };

    const half = Math.max(1, Math.floor(recent.length / 2));
    const first = recent.slice(0, half);
    const second = recent.slice(half);

    const avg = (arr: LogRow[]) => arr.reduce((acc, row) => acc + riskOf(row), 0) / Math.max(arr.length, 1);
    const firstAvg = avg(first);
    const secondAvg = avg(second);

    const riskTrendInsight = secondAvg > firstAvg + 0.2
      ? "Risk trend is increasing in recent logs."
      : secondAvg < firstAvg - 0.2
      ? "Risk trend is decreasing in recent logs."
      : "Risk trend is stable across recent logs.";

    return {
      frequentFailure: getTop(failureCounts),
      commonHallucinationPattern: getTop(patternCounts),
      riskTrendInsight,
    };
  }, [rows]);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <h3 className="text-sm font-bold text-slate-900 mb-3">AI Summary (Last 100 Logs)</h3>
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Most frequent failure type</p>
          <p className="text-slate-700 mt-0.5">{summary.frequentFailure}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Most common hallucinated pattern</p>
          <p className="text-slate-700 mt-0.5">{summary.commonHallucinationPattern}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Risk trend insight</p>
          <p className="text-slate-700 mt-0.5">{summary.riskTrendInsight}</p>
        </div>
      </div>
    </div>
  );
}

export function shouldShowAlert(rows: LogRow[], threshold = 5): boolean {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const highRisk24h = rows.reduce((acc, row) => {
    const ts = toTimestamp(row);
    if (!ts || ts < cutoff) return acc;
    return riskOf(row) >= 7 ? acc + 1 : acc;
  }, 0);
  return highRisk24h > threshold;
}
