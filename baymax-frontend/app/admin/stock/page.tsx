"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
    TrendingUp,
    AlertTriangle,
    Package,
    RefreshCw,
    ChevronDown,
    ArrowUpRight,
    ArrowDownRight,
    BarChart3,
    Search,
    X,
    Loader2,
    CheckCircle,
    Clock,
    ShieldAlert,
} from "lucide-react";
import {
    adminService,
    type StockPredictionResponse,
    type StockPredictionItem,
    type StockDrugDetail,
} from "@/lib/adminApi";
import { getMockStockPrediction, getMockStockDrugDetail } from "@/lib/adminMockData";

/* ── Badge component ── */
function ReorderBadge({ flag }: { flag: string }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        reorder_now: { bg: "bg-red-50", text: "text-red-600", label: "Reorder Now" },
        reorder_soon: { bg: "bg-amber-50", text: "text-amber-600", label: "Reorder Soon" },
        sufficient: { bg: "bg-emerald-50", text: "text-emerald-600", label: "Sufficient" },
    };
    const c = config[flag] || config.sufficient;
    return (
        <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs ${c.bg} ${c.text}`}
            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
        >
            {c.label}
        </span>
    );
}

/* ── Drug Detail Panel ── */
function DrugDetailPanel({
    detail,
    onClose,
}: {
    detail: StockDrugDetail;
    onClose: () => void;
}) {
    const { demand, forecast } = detail;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden"
        >
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                    <h3
                        className="text-xl text-slate-900"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        {detail.drug_name}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5" style={{ fontFamily: "var(--font-poppins)" }}>
                        {detail.total_current_stock} units in stock &middot; {detail.active_patient_count} active patients
                    </p>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
                    <X size={18} />
                </button>
            </div>

            <div className="p-6 space-y-6">
                {/* Demand metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-slate-50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 mb-1" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>Historic Daily Avg</p>
                        <p className="text-2xl text-slate-900" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {demand.historic_daily_avg.toFixed(1)}
                        </p>
                        <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>units/day (90d)</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                        <p className="text-xs text-slate-400 mb-1" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>Active Consumption</p>
                        <p className="text-2xl text-slate-900" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {demand.active_daily_consumption.toFixed(1)}
                        </p>
                        <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>units/day (live)</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                        <p className="text-xs text-emerald-600 mb-1" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>Blended Rate</p>
                        <p className="text-2xl text-emerald-700" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {demand.blended_daily_rate.toFixed(1)}
                        </p>
                        <p className="text-xs text-emerald-500" style={{ fontFamily: "var(--font-poppins)" }}>units/day (conservative)</p>
                    </div>
                </div>

                {/* Forecast summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                        <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>Days Until Stockout</p>
                        <p
                            className={`text-3xl mt-1 ${
                                (forecast.days_until_stockout ?? Infinity) < 14
                                    ? "text-red-500"
                                    : (forecast.days_until_stockout ?? Infinity) < 30
                                    ? "text-amber-500"
                                    : "text-emerald-600"
                            }`}
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            {forecast.days_until_stockout !== null ? Math.round(forecast.days_until_stockout) : "∞"}
                        </p>
                    </div>
                    <div className="text-center">
                        <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>Predicted Stock ({forecast.days_ahead}d)</p>
                        <p className="text-3xl text-slate-900 mt-1" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {Math.round(forecast.predicted_stock_at_end)}
                        </p>
                    </div>
                    <div className="text-center">
                        <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>Reorder Date</p>
                        <p className="text-lg text-slate-700 mt-2" style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}>
                            {forecast.predicted_reorder_date || "Not needed"}
                        </p>
                    </div>
                    <div className="text-center">
                        <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>Active Patients</p>
                        <p className="text-3xl text-slate-900 mt-1" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {detail.active_patient_count}
                        </p>
                    </div>
                </div>

                {/* Stock curve chart (simple bar visualization) */}
                {forecast.daily && forecast.daily.length > 0 && (
                    <div>
                        <h4
                            className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-3"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Daily Stock Projection
                        </h4>
                        <div className="flex items-end gap-px h-32 bg-slate-50 rounded-xl p-3">
                            {forecast.daily.map((d, i) => {
                                const maxStock = detail.total_current_stock || 1;
                                const pct = Math.max(0, Math.min(100, (d.predicted_stock / maxStock) * 100));
                                const isLow = d.predicted_stock <= 0;

                                return (
                                    <div
                                        key={i}
                                        className="flex-1 flex flex-col items-center justify-end"
                                        title={`Day ${d.day}: ${Math.round(d.predicted_stock)} units`}
                                    >
                                        <div
                                            style={{ height: `${Math.max(2, pct)}%` }}
                                            className={`w-full rounded-t transition-all ${
                                                isLow ? "bg-red-400" : pct < 25 ? "bg-amber-400" : "bg-emerald-400"
                                            } hover:opacity-80 min-h-[2px]`}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex justify-between mt-1 text-[10px] text-slate-300" style={{ fontFamily: "var(--font-poppins)" }}>
                            <span>Day 1</span>
                            <span>Day {forecast.daily.length}</span>
                        </div>
                    </div>
                )}

                {/* Inventory Batches */}
                {detail.inventory_batches && detail.inventory_batches.length > 0 && (
                    <div>
                        <h4
                            className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-3"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Inventory Batches (FEFO)
                        </h4>
                        <div className="space-y-2">
                            {detail.inventory_batches.map((batch: any, i: number) => (
                                <div
                                    key={i}
                                    className="flex items-center gap-4 bg-slate-50 rounded-xl px-4 py-3"
                                >
                                    <div className="flex-1">
                                        <p className="text-sm text-slate-700" style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}>
                                            {batch.brand_name || detail.drug_name}
                                        </p>
                                        <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>
                                            Expires: {batch.expiry_date || "N/A"}
                                        </p>
                                    </div>
                                    <p className="text-lg text-slate-900" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                        {batch.stock_qty}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Active patients */}
                {detail.active_patients && detail.active_patients.length > 0 && (
                    <div>
                        <h4
                            className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-3"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Active Patients
                        </h4>
                        <div className="flex flex-wrap gap-2">
                            {detail.active_patients.map((p: any, i: number) => (
                                <span
                                    key={i}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs border border-blue-100"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                >
                                    {p.name || p.phone}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

/* ── Main Page ── */
export default function StockPredictionPage() {
    const [data, setData] = useState<StockPredictionResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [usingDemoData, setUsingDemoData] = useState(false);
    const [daysAhead, setDaysAhead] = useState(30);
    const [includeAll, setIncludeAll] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    // Drug detail
    const [selectedDrug, setSelectedDrug] = useState<string | null>(null);
    const [drugDetail, setDrugDetail] = useState<StockDrugDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        setError("");
        try {
            const result = await adminService.getStockPrediction(daysAhead, includeAll);
            if (!result?.data?.length) {
                setData(getMockStockPrediction(daysAhead));
                setUsingDemoData(true);
            } else {
                setData(result);
                setUsingDemoData(false);
            }
        } catch (e: any) {
            setData(getMockStockPrediction(daysAhead));
            setUsingDemoData(true);
            setError("");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [daysAhead, includeAll]);

    const loadDrugDetail = async (drugName: string) => {
        setSelectedDrug(drugName);
        setDetailLoading(true);
        try {
            const detail = await adminService.getStockDrugDetail(drugName, daysAhead);
            if (detail) {
                setDrugDetail(detail);
            } else {
                setDrugDetail(getMockStockDrugDetail(drugName, daysAhead));
            }
        } catch {
            setDrugDetail(getMockStockDrugDetail(drugName, daysAhead));
        } finally {
            setDetailLoading(false);
        }
    };

    const filteredItems = data?.data?.filter(
        (item) =>
            searchTerm === "" ||
            item.drug_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
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
                        Stock{" "}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">
                            Forecast
                        </span>
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                        Predictive inventory demand analysis
                    </p>
                </motion.div>

                <div className="flex items-center gap-3">
                    {/* Days ahead selector */}
                    <select
                        value={daysAhead}
                        onChange={(e) => setDaysAhead(Number(e.target.value))}
                        className="px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-emerald-300"
                        style={{ fontFamily: "var(--font-poppins)" }}
                    >
                        <option value={7}>7 days</option>
                        <option value={14}>14 days</option>
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                        <option value={90}>90 days</option>
                        <option value={180}>180 days</option>
                    </select>

                    <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm cursor-pointer">
                        <input
                            type="checkbox"
                            checked={includeAll}
                            onChange={(e) => setIncludeAll(e.target.checked)}
                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="text-slate-600" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>Show All</span>
                    </label>

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
                    Showing demo Stock Forecast data (backend data unavailable or empty).
                </div>
            )}

            {/* Summary Cards */}
            {data && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                    <div className="bg-red-50 rounded-2xl border border-red-100 p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <ShieldAlert size={16} className="text-red-500" />
                            <span className="text-xs text-red-500 uppercase tracking-widest" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                Reorder Now
                            </span>
                        </div>
                        <p className="text-3xl text-red-600" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {data.reorder_now}
                        </p>
                    </div>
                    <div className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <Clock size={16} className="text-amber-500" />
                            <span className="text-xs text-amber-500 uppercase tracking-widest" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                Reorder Soon
                            </span>
                        </div>
                        <p className="text-3xl text-amber-600" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {data.reorder_soon}
                        </p>
                    </div>
                    <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <CheckCircle size={16} className="text-emerald-500" />
                            <span className="text-xs text-emerald-500 uppercase tracking-widest" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                Total Items
                            </span>
                        </div>
                        <p className="text-3xl text-emerald-600" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                            {data.total_items}
                        </p>
                    </div>
                </motion.div>
            )}

            {/* Search */}
            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder="Filter drugs..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full md:w-72 pl-9 pr-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                    style={{ fontFamily: "var(--font-poppins)" }}
                />
            </div>

            {/* Drug detail panel */}
            {selectedDrug && (
                <div>
                    {detailLoading ? (
                        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                            <Loader2 size={24} className="animate-spin text-emerald-400 mx-auto" />
                        </div>
                    ) : drugDetail ? (
                        <DrugDetailPanel
                            detail={drugDetail}
                            onClose={() => {
                                setSelectedDrug(null);
                                setDrugDetail(null);
                            }}
                        />
                    ) : null}
                </div>
            )}

            {/* Stock table */}
            {loading ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center">
                    <Loader2 size={24} className="animate-spin text-emerald-400 mx-auto" />
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden"
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    {["Drug", "Brand", "Current Stock", "Reorder Lvl", "Daily Rate", "Predicted Stock", "Days Left", "Status"].map((h) => (
                                        <th
                                            key={h}
                                            className="px-4 py-3 text-left text-xs text-slate-400 uppercase tracking-widest whitespace-nowrap"
                                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredItems.map((item, i) => (
                                    <motion.tr
                                        key={`${item.drug_name}-${item.brand_name || "na"}-${i}`}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: i * 0.02 }}
                                        onClick={() => loadDrugDetail(item.drug_name)}
                                        className="border-b border-slate-50 hover:bg-emerald-50/30 cursor-pointer transition-colors"
                                    >
                                        <td className="px-4 py-3 text-slate-800" style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}>
                                            {item.drug_name}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500" style={{ fontFamily: "var(--font-poppins)" }}>
                                            {item.brand_name || "—"}
                                        </td>
                                        <td className="px-4 py-3" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                            {item.current_stock}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500">{item.reorder_level}</td>
                                        <td className="px-4 py-3">
                                            <span className="text-slate-700" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                                {item.blended_daily_rate.toFixed(1)}
                                            </span>
                                            <span className="text-slate-300 text-xs ml-1">/day</span>
                                        </td>
                                        <td className={`px-4 py-3 ${item.predicted_stock <= 0 ? "text-red-500" : "text-slate-700"}`} style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                            {Math.round(item.predicted_stock)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`${
                                                    (item.days_until_stockout ?? Infinity) < 14
                                                        ? "text-red-500"
                                                        : (item.days_until_stockout ?? Infinity) < 30
                                                        ? "text-amber-500"
                                                        : "text-emerald-600"
                                                }`}
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                {item.days_until_stockout !== null ? Math.round(item.days_until_stockout) : "∞"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <ReorderBadge flag={item.reorder_flag} />
                                        </td>
                                    </motion.tr>
                                ))}
                                {filteredItems.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="text-center py-16">
                                            <Package size={32} className="text-slate-200 mx-auto mb-3" />
                                            <p className="text-slate-400 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                                                No stock items found
                                            </p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
