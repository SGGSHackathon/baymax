"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
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
    ArrowUpRight,
    TrendingUp,
} from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";

/* ── animation helpers ── */
const fadeUp = {
    hidden: { opacity: 0, y: 18 },
    show: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { duration: 0.45, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] },
    }),
};

const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07 } },
};

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
              { label: "Total Medicines", value: stats.totalMedicines, icon: Pill, color: "emerald" as const, trend: "+12%" },
              { label: "Low Stock Alerts", value: stats.lowStockCount, icon: Package, color: "amber" as const, trend: "-3" },
              { label: "Active Prescriptions", value: stats.activePrescriptions, icon: FileText, color: "blue" as const, trend: "+8" },
              { label: "Revenue", value: `₹${stats.totalRevenue.toLocaleString("en-IN")}`, icon: IndianRupee, color: "emerald" as const, trend: "+18%" },
          ]
        : [];

    const colorMap = {
        emerald: { iconBg: "bg-emerald-100", iconBorder: "border-emerald-200/60", text: "text-emerald-700", glow: "group-hover:shadow-emerald-100/60" },
        amber: { iconBg: "bg-amber-100", iconBorder: "border-amber-200/60", text: "text-amber-700", glow: "group-hover:shadow-amber-100/60" },
        blue: { iconBg: "bg-blue-100", iconBorder: "border-blue-200/60", text: "text-blue-700", glow: "group-hover:shadow-blue-100/60" },
    };

    return (
        <div className="space-y-8 max-w-[1200px]">
            {/* ── Page Title ── */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <h1
                    className="text-3xl tracking-tight text-slate-900"
                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                >
                    Dashboard
                </h1>
                <p
                    className="text-sm text-slate-500 mt-1.5"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                >
                    Overview of pharmacy operations and patient safety alerts.
                </p>
            </motion.div>

            {error && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 bg-red-50/80 backdrop-blur border border-red-100 rounded-2xl text-red-600 text-sm flex items-center gap-3"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                >
                    <AlertTriangle size={16} /> {error}
                </motion.div>
            )}

            {/* ── Stat Cards ── */}
            {stats && (
                <motion.div
                    variants={stagger}
                    initial="hidden"
                    animate="show"
                    className="grid grid-cols-2 lg:grid-cols-4 gap-4"
                >
                    {statCards.map((card, i) => {
                        const c = colorMap[card.color];
                        return (
                            <motion.div
                                key={i}
                                variants={fadeUp}
                                custom={i}
                                whileHover={{ y: -4, scale: 1.02 }}
                                className={`group bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[22px] p-5 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-xl ${c.glow} transition-all cursor-default`}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <span
                                        className="text-[10px] uppercase tracking-[0.18em] text-slate-400"
                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                    >
                                        {card.label}
                                    </span>
                                    <div className={`w-9 h-9 rounded-xl ${c.iconBg} border ${c.iconBorder} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                                        <card.icon size={15} className={c.text} />
                                    </div>
                                </div>
                                <div
                                    className="text-2xl text-slate-900 mb-1"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    {card.value}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <TrendingUp size={11} className="text-emerald-500" />
                                    <span
                                        className="text-[11px] text-emerald-600"
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                                    >
                                        {card.trend}
                                    </span>
                                    <span
                                        className="text-[11px] text-slate-400 ml-0.5"
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                    >
                                        vs last week
                                    </span>
                                </div>
                            </motion.div>
                        );
                    })}
                </motion.div>
            )}

            {/* ── Two-column panels ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Account Abuse Flags */}
                <motion.div
                    variants={fadeUp}
                    custom={0}
                    initial="hidden"
                    animate="show"
                    className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col max-h-[600px] overflow-hidden"
                >
                    <div className="p-6 border-b border-slate-100/80">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200/60 flex items-center justify-center">
                                <ShieldAlert size={15} className="text-amber-600" />
                            </div>
                            <div>
                                <h2
                                    className="text-base text-slate-900"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    Abuse Flags
                                </h2>
                                <p
                                    className="text-xs text-slate-500 mt-0.5"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                >
                                    Controlled drug seeking behavior.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-3">
                        {abuseFlags.length === 0 ? (
                            <div className="h-48 flex flex-col items-center justify-center text-slate-400 space-y-3">
                                <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center"><ShieldAlert size={24} /></div>
                                <span
                                    className="text-[10px] uppercase tracking-[0.2em]"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    No abuse flags
                                </span>
                            </div>
                        ) : (
                            abuseFlags.map((flag, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.06, duration: 0.35 }}
                                    className="bg-white/60 border border-slate-200/60 p-4 rounded-2xl flex flex-col gap-2 hover:shadow-md hover:shadow-slate-100/60 transition-all"
                                >
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="text-sm text-slate-900" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>{flag.name}</div>
                                            <div className="text-xs text-slate-500" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>{flag.phone}</div>
                                        </div>
                                        <span
                                            className={`px-2.5 py-0.5 rounded-lg text-[10px] uppercase tracking-[0.15em] border ${
                                                flag.blocked
                                                    ? "bg-red-50 text-red-600 border-red-100"
                                                    : "bg-amber-50 text-amber-600 border-amber-100"
                                            }`}
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            Score: {flag.score}/10
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {flag.flags?.map((f: string, j: number) => (
                                            <span
                                                key={j}
                                                className="text-[10px] uppercase tracking-[0.15em] bg-red-50 border border-red-100 px-2 py-0.5 rounded-lg text-red-600"
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                {f.replace("_", " ")}
                                            </span>
                                        ))}
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </motion.div>

                {/* Inventory Alerts */}
                <motion.div
                    variants={fadeUp}
                    custom={1}
                    initial="hidden"
                    animate="show"
                    className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col max-h-[600px] overflow-hidden"
                >
                    <div className="p-6 border-b border-slate-100/80 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200/60 flex items-center justify-center">
                                <Package size={15} className="text-emerald-600" />
                            </div>
                            <div>
                                <h2
                                    className="text-base text-slate-900"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    Inventory Alerts
                                </h2>
                                <p
                                    className="text-xs text-slate-500 mt-0.5"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                >
                                    Low-stock and expiring metrics.
                                </p>
                            </div>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => router.push("/admin/inventory")}
                            className="shrink-0 h-9 px-4 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 text-xs hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                        >
                            View All <ArrowUpRight size={13} />
                        </motion.button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-3">
                        {lowStock.length === 0 ? (
                            <div className="h-48 flex flex-col items-center justify-center text-slate-400 space-y-3">
                                <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center"><Package size={24} /></div>
                                <span
                                    className="text-[10px] uppercase tracking-[0.2em]"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    Stock nominal
                                </span>
                            </div>
                        ) : (
                            lowStock.map((item, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.06, duration: 0.35 }}
                                    className="bg-white/60 border border-slate-200/60 p-4 rounded-2xl flex items-center justify-between hover:shadow-md hover:shadow-slate-100/60 transition-all"
                                >
                                    <div>
                                        <div
                                            className="text-sm text-slate-900 capitalize"
                                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                        >
                                            {item.drug_name || item.name}
                                        </div>
                                        <div
                                            className="text-xs text-slate-500 mt-0.5"
                                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                        >
                                            Below threshold
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div
                                            className="text-lg text-red-500"
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            {item.stock_left || 0}
                                        </div>
                                        <div
                                            className="text-[10px] text-slate-400 uppercase tracking-[0.15em]"
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            units left
                                        </div>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </motion.div>
            </div>

            {/* ── Second Row — Vital Trends + CDE Log ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Vital Trends */}
                <motion.div
                    variants={fadeUp}
                    custom={2}
                    initial="hidden"
                    animate="show"
                    className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col max-h-[450px] overflow-hidden"
                >
                    <div className="p-6 border-b border-slate-100/80">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200/60 flex items-center justify-center">
                                <Activity size={15} className="text-emerald-600" />
                            </div>
                            <div>
                                <h2
                                    className="text-base text-slate-900"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    Vital Trend Alerts
                                </h2>
                                <p
                                    className="text-xs text-slate-500 mt-0.5"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                >
                                    Sustained abnormal vital patterns.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 space-y-3">
                        {vitalTrends.length === 0 ? (
                            <div className="h-36 flex flex-col items-center justify-center text-slate-400 space-y-3">
                                <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center"><Activity size={24} /></div>
                                <span
                                    className="text-[10px] uppercase tracking-[0.2em]"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    No trend alerts
                                </span>
                            </div>
                        ) : (
                            vitalTrends.map((t: any, i: number) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.06, duration: 0.35 }}
                                    className="bg-white/60 border border-slate-200/60 p-4 rounded-2xl flex items-center justify-between hover:shadow-md hover:shadow-slate-100/60 transition-all"
                                >
                                    <div>
                                        <div className="text-sm text-slate-900 capitalize" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>
                                            {t.vital_type || t.vital}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                            {t.message || `Trend for user ${t.user_id}`}
                                        </div>
                                    </div>
                                    <span
                                        className={`text-[10px] px-2.5 py-0.5 rounded-lg uppercase tracking-[0.15em] border ${
                                            t.alert_sent
                                                ? "text-emerald-600 bg-emerald-50 border-emerald-100"
                                                : "text-amber-600 bg-amber-50 border-amber-100"
                                        }`}
                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                    >
                                        {t.alert_sent ? "Sent" : "Pending"}
                                    </span>
                                </motion.div>
                            ))
                        )}
                    </div>
                </motion.div>

                {/* CDE Decision Log */}
                <motion.div
                    variants={fadeUp}
                    custom={3}
                    initial="hidden"
                    animate="show"
                    className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col max-h-[450px] overflow-hidden"
                >
                    <div className="p-6 border-b border-slate-100/80">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200/60 flex items-center justify-center">
                                <FileText size={15} className="text-emerald-600" />
                            </div>
                            <div>
                                <h2
                                    className="text-base text-slate-900"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    CDE Decision Log
                                </h2>
                                <p
                                    className="text-xs text-slate-500 mt-0.5"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                >
                                    Recent AI-powered clinical decisions.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 space-y-3">
                        {cdeLog.length === 0 ? (
                            <div className="h-36 flex flex-col items-center justify-center text-slate-400 space-y-3">
                                <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center"><FileText size={24} /></div>
                                <span
                                    className="text-[10px] uppercase tracking-[0.2em]"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    No records
                                </span>
                            </div>
                        ) : (
                            cdeLog.map((entry: any, i: number) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.06, duration: 0.35 }}
                                    className="bg-white/60 border border-slate-200/60 p-4 rounded-2xl hover:shadow-md hover:shadow-slate-100/60 transition-all"
                                >
                                    <div className="flex items-start justify-between mb-1.5">
                                        <div className="text-sm text-slate-900" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>
                                            {entry.decision_type || entry.action || "Decision"}
                                        </div>
                                        <time
                                            className="text-[10px] text-slate-400 uppercase tracking-[0.15em]"
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            {new Date(entry.created_at).toLocaleString()}
                                        </time>
                                    </div>
                                    <div className="text-xs text-slate-500 leading-relaxed" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                        {entry.reasoning || entry.details || JSON.stringify(entry).slice(0, 200)}
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
