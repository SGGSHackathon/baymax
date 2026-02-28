"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
    Database,
    TrendingUp,
    Bell,
    AlertTriangle,
    Package,
    Users,
    MessageSquare,
    Pill,
    Activity,
    FileText,
    RefreshCw,
    ChevronRight,
    ArrowUpRight,
    BarChart3,
    ShieldAlert,
    Clock,
} from "lucide-react";
import { adminService, type StockPredictionResponse, type ExpiryRiskResponse } from "@/lib/adminApi";

/* ── Stat card with animated counter ── */
function StatCard({
    label,
    value,
    icon: Icon,
    color,
    href,
    delay = 0,
}: {
    label: string;
    value: number | string;
    icon: any;
    color: string;
    href?: string;
    delay?: number;
}) {
    const colorClasses: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
        emerald: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100", iconBg: "bg-emerald-100" },
        teal: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-100", iconBg: "bg-teal-100" },
        amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-100", iconBg: "bg-amber-100" },
        red: { bg: "bg-red-50", text: "text-red-700", border: "border-red-100", iconBg: "bg-red-100" },
        blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-100", iconBg: "bg-blue-100" },
        slate: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-100", iconBg: "bg-slate-100" },
        violet: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-100", iconBg: "bg-violet-100" },
    };
    const c = colorClasses[color] || colorClasses.slate;

    const content = (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay }}
            whileHover={{ y: -2, boxShadow: "0 12px 40px rgba(0,0,0,0.06)" }}
            className={`group relative bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-slate-300/80 transition-all duration-300 cursor-pointer`}
        >
            <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${c.iconBg} flex items-center justify-center`}>
                    <Icon size={18} strokeWidth={1.8} className={c.text} />
                </div>
                {href && (
                    <ArrowUpRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                )}
            </div>
            <p
                className="text-2xl tracking-tight text-slate-900 mb-1"
                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
            >
                {typeof value === "number" ? value.toLocaleString() : value}
            </p>
            <p
                className="text-xs text-slate-400 uppercase tracking-widest"
                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
            >
                {label}
            </p>
        </motion.div>
    );

    return href ? <Link href={href}>{content}</Link> : content;
}

/* ── Quick Action Card ── */
function QuickAction({
    label,
    description,
    icon: Icon,
    href,
    gradient,
    delay = 0,
}: {
    label: string;
    description: string;
    icon: any;
    href: string;
    gradient: string;
    delay?: number;
}) {
    return (
        <Link href={href}>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay }}
                whileHover={{ y: -3, boxShadow: "0 16px 50px rgba(0,0,0,0.08)" }}
                className="group bg-white rounded-2xl border border-slate-200/80 p-6 hover:border-slate-300 transition-all duration-300 cursor-pointer"
            >
                <div className="flex items-start justify-between mb-4">
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm`}>
                        <Icon size={22} strokeWidth={1.8} className="text-white" />
                    </div>
                    <ChevronRight
                        size={16}
                        className="text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all"
                    />
                </div>
                <h3
                    className="text-base text-slate-900 mb-1"
                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                >
                    {label}
                </h3>
                <p
                    className="text-sm text-slate-400"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 400 }}
                >
                    {description}
                </p>
            </motion.div>
        </Link>
    );
}

export default function AdminDashboard() {
    const [stats, setStats] = useState<Record<string, number>>({});
    const [stockData, setStockData] = useState<StockPredictionResponse | null>(null);
    const [expiryData, setExpiryData] = useState<ExpiryRiskResponse | null>(null);
    const [refillCount, setRefillCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchAll = async () => {
        setLoading(true);
        setError("");
        try {
            const [s, stock, expiry, refills] = await Promise.all([
                adminService.getStats(),
                adminService.getStockPrediction(30).catch(() => null),
                adminService.getExpiryRisk(60).catch(() => null),
                adminService.getRefillAlerts().catch(() => []),
            ]);
            setStats(s);
            setStockData(stock);
            setExpiryData(expiry);
            setRefillCount(Array.isArray(refills) ? refills.length : 0);
        } catch (e: any) {
            setError(e?.apiError?.message || e?.message || "Failed to load dashboard");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAll();
    }, []);

    const totalTables = Object.keys(stats).length;
    const totalRows = Object.values(stats).reduce((a, b) => a + b, 0);

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <h1
                        className="text-3xl lg:text-4xl tracking-tight text-slate-900"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Admin{" "}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">
                            Dashboard
                        </span>
                    </h1>
                    <p
                        className="text-slate-400 mt-1 text-sm"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 400 }}
                    >
                        System overview and quick actions
                    </p>
                </motion.div>

                <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: 0.2 }}
                    onClick={fetchAll}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all text-sm disabled:opacity-50"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                >
                    <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    Refresh
                </motion.button>
            </div>

            {/* Error */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm"
                    style={{ fontFamily: "var(--font-poppins)" }}
                >
                    {error}
                </motion.div>
            )}

            {/* Loading skeleton */}
            {loading && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 animate-pulse">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 mb-3" />
                            <div className="h-7 w-16 bg-slate-100 rounded mb-2" />
                            <div className="h-3 w-20 bg-slate-50 rounded" />
                        </div>
                    ))}
                </div>
            )}

            {/* Stat cards */}
            {!loading && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard label="Total Tables" value={totalTables} icon={Database} color="emerald" href="/admin/tables" delay={0} />
                        <StatCard label="Total Rows" value={totalRows} icon={BarChart3} color="teal" delay={0.05} />
                        <StatCard label="Users" value={stats["users"] || 0} icon={Users} color="blue" href="/admin/tables/users" delay={0.1} />
                        <StatCard label="Conversations" value={stats["conversations"] || 0} icon={MessageSquare} color="violet" href="/admin/tables/conversations" delay={0.15} />
                        <StatCard label="Inventory Items" value={stats["inventory"] || 0} icon={Package} color="emerald" href="/admin/tables/inventory" delay={0.2} />
                        <StatCard label="Active Orders" value={stats["orders"] || 0} icon={FileText} color="teal" href="/admin/tables/orders" delay={0.25} />
                        <StatCard label="Prescriptions" value={stats["prescription-uploads"] || 0} icon={Pill} color="blue" href="/admin/tables/prescription-uploads" delay={0.3} />
                        <StatCard label="Vitals Logged" value={stats["vitals"] || 0} icon={Activity} color="violet" href="/admin/tables/vitals" delay={0.35} />
                    </div>

                    {/* Alert summary row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <StatCard
                            label="Reorder Now"
                            value={stockData?.reorder_now ?? "—"}
                            icon={ShieldAlert}
                            color="red"
                            href="/admin/stock"
                            delay={0.4}
                        />
                        <StatCard
                            label="Refill Alerts"
                            value={refillCount}
                            icon={Bell}
                            color="amber"
                            href="/admin/refills"
                            delay={0.45}
                        />
                        <StatCard
                            label="Expiring Batches"
                            value={expiryData?.expiring_items ?? "—"}
                            icon={Clock}
                            color="red"
                            href="/admin/expiry"
                            delay={0.5}
                        />
                    </div>
                </>
            )}

            {/* Quick actions */}
            <div>
                <motion.h2
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-4"
                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                >
                    Quick Actions
                </motion.h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <QuickAction
                        label="Browse Tables"
                        description="Full CRUD on all 37 database tables"
                        icon={Database}
                        href="/admin/tables"
                        gradient="from-emerald-500 to-teal-500"
                        delay={0.4}
                    />
                    <QuickAction
                        label="Stock Forecast"
                        description="Predict future inventory levels"
                        icon={TrendingUp}
                        href="/admin/stock"
                        gradient="from-teal-500 to-cyan-500"
                        delay={0.45}
                    />
                    <QuickAction
                        label="Refill Alerts"
                        description="Patients running low on medication"
                        icon={Bell}
                        href="/admin/refills"
                        gradient="from-amber-500 to-orange-500"
                        delay={0.5}
                    />
                    <QuickAction
                        label="Expiry Risk"
                        description="Batches expiring soon & waste estimate"
                        icon={AlertTriangle}
                        href="/admin/expiry"
                        gradient="from-red-500 to-rose-500"
                        delay={0.55}
                    />
                </div>
            </div>

            {/* Table row count breakdown */}
            {!loading && Object.keys(stats).length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5, duration: 0.4 }}
                    className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden"
                >
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <h3
                            className="text-sm text-slate-900"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Table Row Counts
                        </h3>
                        <Link
                            href="/admin/tables"
                            className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                        >
                            View All <ChevronRight size={12} />
                        </Link>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px bg-slate-100">
                        {Object.entries(stats)
                            .sort(([, a], [, b]) => b - a)
                            .map(([slug, count]) => (
                                <Link
                                    key={slug}
                                    href={`/admin/tables/${slug}`}
                                    className="bg-white px-4 py-3 hover:bg-emerald-50/50 transition-colors group"
                                >
                                    <p
                                        className="text-xs text-slate-400 truncate group-hover:text-emerald-600 transition-colors"
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                    >
                                        {slug}
                                    </p>
                                    <p
                                        className="text-lg text-slate-900"
                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                    >
                                        {count.toLocaleString()}
                                    </p>
                                </Link>
                            ))}
                    </div>
                </motion.div>
            )}
        </div>
    );
}
