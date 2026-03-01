"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
    AlertTriangle,
    RefreshCw,
    Search,
    Loader2,
    Clock,
    Package,
    DollarSign,
    Flame,
    ShieldAlert,
    CircleAlert,
    CheckCircle,
} from "lucide-react";
import { adminService, type ExpiryRiskResponse, type ExpiryRiskItem } from "@/lib/adminApi";
import { getMockExpiryRisk } from "@/lib/adminMockData";

/* ── Risk badge ── */
function RiskBadge({ level }: { level: string }) {
    const config: Record<string, { bg: string; text: string; icon: any; label: string }> = {
        critical: { bg: "bg-red-50", text: "text-red-600", icon: Flame, label: "Critical" },
        warning: { bg: "bg-amber-50", text: "text-amber-600", icon: CircleAlert, label: "Warning" },
        low: { bg: "bg-emerald-50", text: "text-emerald-600", icon: CheckCircle, label: "Low Risk" },
    };
    const c = config[level] || config.low;
    return (
        <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ${c.bg} ${c.text}`}
            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
        >
            <c.icon size={11} />
            {c.label}
        </span>
    );
}

export default function ExpiryRiskPage() {
    const [data, setData] = useState<ExpiryRiskResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [usingDemoData, setUsingDemoData] = useState(false);
    const [daysAhead, setDaysAhead] = useState(60);
    const [searchTerm, setSearchTerm] = useState("");

    const fetchData = async () => {
        setLoading(true);
        setError("");
        try {
            const result = await adminService.getExpiryRisk(daysAhead);
               if (!result?.data?.length) {
                   setData(getMockExpiryRisk(daysAhead));
                   setUsingDemoData(true);
               } else {
                   setData(result);
                   setUsingDemoData(false);
               }
        } catch (e: any) {
               setData(getMockExpiryRisk(daysAhead));
               setUsingDemoData(true);
               setError("");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [daysAhead]);

    const filteredItems = data?.data?.filter(
        (item) =>
            !searchTerm ||
            item.drug_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.brand_name?.toLowerCase().includes(searchTerm.toLowerCase())
    ) || [];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                    <h1
                        className="text-3xl lg:text-4xl tracking-tight text-slate-900"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Expiry{" "}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-rose-500">
                            Risk
                        </span>
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                        Inventory batches approaching expiration
                    </p>
                </motion.div>

                <div className="flex items-center gap-3">
                    <select
                        value={daysAhead}
                        onChange={(e) => setDaysAhead(Number(e.target.value))}
                        className="px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-emerald-300"
                        style={{ fontFamily: "var(--font-poppins)" }}
                    >
                        <option value={14}>14 days</option>
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                        <option value={90}>90 days</option>
                        <option value={180}>180 days</option>
                        <option value={365}>365 days</option>
                    </select>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all"
                    >
                        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                    {error}
                </div>
            )}

               {usingDemoData && (
                   <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-blue-700 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                       Showing demo Expiry Risk data (backend data unavailable or empty).
                   </div>
               )}

            {/* Summary Cards */}
            {data && !loading && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                    <div className="bg-red-50 rounded-2xl border border-red-100 p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle size={16} className="text-red-500" />
                            <span
                                className="text-xs text-red-400 uppercase tracking-widest"
                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                            >
                                Expiring Items
                            </span>
                        </div>
                        <p className="text-3xl text-red-600" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {data.expiring_items}
                        </p>
                        <p className="text-xs text-red-400 mt-1" style={{ fontFamily: "var(--font-poppins)" }}>
                            within {daysAhead} days (by {data.cutoff_date})
                        </p>
                    </div>

                    <div className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <DollarSign size={16} className="text-amber-500" />
                            <span
                                className="text-xs text-amber-400 uppercase tracking-widest"
                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                            >
                                Est. Waste Value
                            </span>
                        </div>
                        <p className="text-3xl text-amber-600" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            ₹{data.total_estimated_waste_value.toLocaleString()}
                        </p>
                        <p className="text-xs text-amber-400 mt-1" style={{ fontFamily: "var(--font-poppins)" }}>
                            potential loss if unsold
                        </p>
                    </div>

                    <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <Clock size={16} className="text-slate-400" />
                            <span
                                className="text-xs text-slate-400 uppercase tracking-widest"
                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                            >
                                Forecast Window
                            </span>
                        </div>
                        <p className="text-3xl text-slate-700" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {daysAhead}d
                        </p>
                        <p className="text-xs text-slate-400 mt-1" style={{ fontFamily: "var(--font-poppins)" }}>
                            cutoff: {data.cutoff_date}
                        </p>
                    </div>
                </motion.div>
            )}

            {/* Search */}
            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder="Filter expiring items..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full md:w-72 pl-9 pr-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                    style={{ fontFamily: "var(--font-poppins)" }}
                />
            </div>

            {/* Table */}
            {loading ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center">
                    <Loader2 size={24} className="animate-spin text-red-400 mx-auto" />
                </div>
            ) : filteredItems.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
                    <CheckCircle size={40} className="text-emerald-200 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                        No expiring items in this window
                    </p>
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-3"
                >
                    {filteredItems.map((item, i) => {
                        const wastePct = item.stock_qty > 0 ? (item.estimated_waste_units / item.stock_qty) * 100 : 0;
                        return (
                            <motion.div
                                key={`${item.drug_name}-${item.brand_name}-${i}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.03 }}
                                className="bg-white rounded-xl border border-slate-200/80 overflow-hidden hover:shadow-md transition-all"
                            >
                                <div className="px-5 py-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                                item.risk_level === "critical" ? "bg-red-100" : item.risk_level === "warning" ? "bg-amber-100" : "bg-emerald-100"
                                            }`}>
                                                <Package size={18} className={
                                                    item.risk_level === "critical" ? "text-red-500" : item.risk_level === "warning" ? "text-amber-500" : "text-emerald-500"
                                                } />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="text-sm text-slate-800" style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}>
                                                        {item.drug_name}
                                                    </p>
                                                    {item.brand_name && (
                                                        <span className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>
                                                            ({item.brand_name})
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-4 text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>
                                                    <span className="flex items-center gap-1">
                                                        <Clock size={11} /> Expires: {item.expiry_date}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Package size={11} /> Stock: {item.stock_qty}
                                                    </span>
                                                    <span>
                                                        Demand: {item.daily_demand.toFixed(1)}/day
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <p className="text-lg text-slate-900" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                                    {item.days_left}d
                                                </p>
                                                <p className="text-[10px] text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>remaining</p>
                                            </div>
                                            <RiskBadge level={item.risk_level} />
                                        </div>
                                    </div>

                                    {/* Waste bar */}
                                    <div className="mt-4">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[10px] text-slate-400 uppercase tracking-widest" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                                Consumption vs Waste
                                            </span>
                                            <span
                                                className="text-xs text-slate-500"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                            >
                                                ₹{item.estimated_waste_value.toLocaleString()} potential waste
                                            </span>
                                        </div>
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                                            <div
                                                className="bg-emerald-400 h-full rounded-l-full transition-all"
                                                style={{ width: `${Math.min(100, 100 - wastePct)}%` }}
                                            />
                                            <div
                                                className={`h-full rounded-r-full transition-all ${
                                                    item.risk_level === "critical" ? "bg-red-400" : "bg-amber-400"
                                                }`}
                                                style={{ width: `${Math.min(100, wastePct)}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between mt-1 text-[10px] text-slate-300" style={{ fontFamily: "var(--font-poppins)" }}>
                                            <span>{item.units_consumed_before_expiry} consumed</span>
                                            <span>{item.estimated_waste_units} wasted</span>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </motion.div>
            )}
        </div>
    );
}
