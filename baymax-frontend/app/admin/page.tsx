"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dataService } from "@/lib/api";
import { adminMockService } from "@/lib/admin-mock";
import { useToast } from "@/hooks/useToast";
import {
    ShieldAlert,
    Package,
    AlertTriangle,
    Activity,
    FileText,
    Pill,
    IndianRupee,
} from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";

export default function AdminDashboardPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [abuseFlags, setAbuseFlags] = useState<any[]>([]);
    const [lowStock, setLowStock] = useState<any[]>([]);
    const [vitalTrends, setVitalTrends] = useState<any[]>([]);
    const [cdeLog, setCdeLog] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        const fetchAdminData = async () => {
            try {
                const [abuseRes, stockRes, trendsRes, cdeRes, statsRes] = await Promise.all([
                    dataService.getAdminAbuse().catch(() => []),
                    dataService.getLowStock().catch(() => []),
                    dataService.getVitalTrends().catch(() => []),
                    dataService.getCDELog().catch(() => []),
                    adminMockService.getDashboardStats(),
                ]);
                setAbuseFlags(Array.isArray(abuseRes) ? abuseRes : []);
                setLowStock(Array.isArray(stockRes) ? stockRes : []);
                setVitalTrends(Array.isArray(trendsRes) ? trendsRes : []);
                setCdeLog(Array.isArray(cdeRes) ? cdeRes : []);
                setStats(statsRes);
            } catch (err: any) {
                const msg = err.apiError?.message || "Unable to retrieve admin data.";
                setError(msg);
                toast(msg, "error");
            } finally {
                setLoading(false);
            }
        };

        fetchAdminData();
    }, []);

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <SkeletonCard key={i} />
                    ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </div>
        );
    }

    const statCards = stats
        ? [
              { label: "Total Medicines", value: stats.totalMedicines, icon: Pill, color: "emerald" as const },
              { label: "Low Stock Alerts", value: stats.lowStockCount, icon: Package, color: "amber" as const },
              { label: "Active Prescriptions", value: stats.activePrescriptions, icon: FileText, color: "blue" as const },
              { label: "Revenue", value: `₹${stats.totalRevenue.toLocaleString("en-IN")}`, icon: IndianRupee, color: "emerald" as const },
          ]
        : [];

    const colorMap = {
        emerald: { iconBg: "bg-emerald-100", text: "text-emerald-700" },
        amber: { iconBg: "bg-amber-100", text: "text-amber-700" },
        blue: { iconBg: "bg-blue-100", text: "text-blue-700" },
    };

    return (
        <div className="space-y-8 max-w-[1200px]">
            {/* Page Title */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
                <p className="text-sm text-slate-500 font-medium mt-1">
                    Overview of pharmacy operations and patient safety alerts.
                </p>
            </div>

            {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium flex items-center gap-3">
                    <AlertTriangle size={16} /> {error}
                </div>
            )}

            {/* Stat Cards */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {statCards.map((card, i) => {
                        const c = colorMap[card.color];
                        return (
                            <div
                                key={i}
                                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-lg hover:shadow-emerald-50 transition-all"
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                                        {card.label}
                                    </span>
                                    <div className={`w-8 h-8 rounded-xl ${c.iconBg} flex items-center justify-center`}>
                                        <card.icon size={14} className={c.text} />
                                    </div>
                                </div>
                                <div className="text-2xl font-black text-slate-900">{card.value}</div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Two-column panels */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Account Abuse Flags */}
                <div className="bg-white border border-slate-200 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col max-h-[600px] overflow-hidden">
                    <div className="p-5 border-b border-slate-100">
                        <h2 className="text-base font-bold flex items-center gap-2 text-slate-900">
                            <ShieldAlert size={16} className="text-amber-500" /> Abuse Flags
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5 font-medium">
                            Users flagged for controlled drug seeking behavior.
                        </p>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-3">
                        {abuseFlags.length === 0 ? (
                            <div className="h-48 flex flex-col items-center justify-center text-slate-400 space-y-2">
                                <ShieldAlert size={28} />
                                <span className="text-xs font-bold uppercase tracking-widest">No abuse flags</span>
                            </div>
                        ) : (
                            abuseFlags.map((flag, i) => (
                                <div key={i} className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex flex-col gap-2">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="font-bold text-sm text-slate-900">{flag.name}</div>
                                            <div className="text-xs text-slate-500 font-medium">{flag.phone}</div>
                                        </div>
                                        <span
                                            className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                                                flag.blocked
                                                    ? "bg-red-50 text-red-600 border-red-100"
                                                    : "bg-amber-50 text-amber-600 border-amber-100"
                                            }`}
                                        >
                                            Score: {flag.score}/10
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {flag.flags?.map((f: string, j: number) => (
                                            <span
                                                key={j}
                                                className="text-[10px] uppercase font-bold tracking-widest bg-red-50 border border-red-100 px-2 py-0.5 rounded-lg text-red-600"
                                            >
                                                {f.replace("_", " ")}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Inventory Alerts */}
                <div className="bg-white border border-slate-200 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col max-h-[600px] overflow-hidden">
                    <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                        <div>
                            <h2 className="text-base font-bold flex items-center gap-2 text-slate-900">
                                <Package size={16} className="text-emerald-500" /> Inventory Alerts
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5 font-medium">
                                Low-stock and expiring medication metrics.
                            </p>
                        </div>
                        <button
                            onClick={() => router.push("/admin/inventory")}
                            className="shrink-0 h-8 px-3 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 text-xs font-bold hover:bg-emerald-100 transition-colors"
                        >
                            View All
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-3">
                        {lowStock.length === 0 ? (
                            <div className="h-48 flex flex-col items-center justify-center text-slate-400 space-y-2">
                                <Package size={28} />
                                <span className="text-xs font-bold uppercase tracking-widest">Stock nominal</span>
                            </div>
                        ) : (
                            lowStock.map((item, i) => (
                                <div key={i} className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex items-center justify-between">
                                    <div>
                                        <div className="font-bold text-sm text-slate-900 capitalize">
                                            {item.drug_name || item.name}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5 font-medium">Below threshold</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-lg font-black text-red-500">{item.stock_left || 0}</div>
                                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                            units left
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Second Row — Vital Trends + CDE Log */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Vital Trends */}
                <div className="bg-white border border-slate-200 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col max-h-[450px] overflow-hidden">
                    <div className="p-5 border-b border-slate-100">
                        <h2 className="text-base font-bold flex items-center gap-2 text-slate-900">
                            <Activity size={16} className="text-emerald-500" /> Vital Trend Alerts
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5 font-medium">
                            Patients with sustained abnormal vital patterns.
                        </p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 space-y-3">
                        {vitalTrends.length === 0 ? (
                            <div className="h-36 flex flex-col items-center justify-center text-slate-400 space-y-2">
                                <Activity size={28} />
                                <span className="text-xs font-bold uppercase tracking-widest">No trend alerts</span>
                            </div>
                        ) : (
                            vitalTrends.map((t: any, i: number) => (
                                <div key={i} className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex items-center justify-between">
                                    <div>
                                        <div className="font-bold text-sm text-slate-900 capitalize">
                                            {t.vital_type || t.vital}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5 font-medium">
                                            {t.message || `Trend for user ${t.user_id}`}
                                        </div>
                                    </div>
                                    <span
                                        className={`text-[10px] px-2 py-0.5 rounded-lg font-black uppercase tracking-widest border ${
                                            t.alert_sent
                                                ? "text-emerald-600 bg-emerald-50 border-emerald-100"
                                                : "text-amber-600 bg-amber-50 border-amber-100"
                                        }`}
                                    >
                                        {t.alert_sent ? "Sent" : "Pending"}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* CDE Decision Log */}
                <div className="bg-white border border-slate-200 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col max-h-[450px] overflow-hidden">
                    <div className="p-5 border-b border-slate-100">
                        <h2 className="text-base font-bold flex items-center gap-2 text-slate-900">
                            <FileText size={16} className="text-emerald-500" /> CDE Decision Log
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5 font-medium">
                            Recent AI-powered clinical decisions.
                        </p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 space-y-3">
                        {cdeLog.length === 0 ? (
                            <div className="h-36 flex flex-col items-center justify-center text-slate-400 space-y-2">
                                <FileText size={28} />
                                <span className="text-xs font-bold uppercase tracking-widest">No records</span>
                            </div>
                        ) : (
                            cdeLog.map((entry: any, i: number) => (
                                <div key={i} className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                                    <div className="flex items-start justify-between mb-1.5">
                                        <div className="font-bold text-sm text-slate-900">
                                            {entry.decision_type || entry.action || "Decision"}
                                        </div>
                                        <time className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                            {new Date(entry.created_at).toLocaleString()}
                                        </time>
                                    </div>
                                    <div className="text-xs text-slate-500 leading-relaxed font-medium">
                                        {entry.reasoning || entry.details || JSON.stringify(entry).slice(0, 200)}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
