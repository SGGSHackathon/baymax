"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Bell,
    RefreshCw,
    AlertTriangle,
    Clock,
    Search,
    Loader2,
    User,
    Pill,
    Phone,
    Calendar,
    Package,
    ChevronDown,
    ChevronUp,
    ShieldAlert,
} from "lucide-react";
import {
    adminService,
    type RefillAlert,
    type RefillForecastResponse,
    type RefillForecastItem,
} from "@/lib/adminApi";
import { MOCK_REFILL_ALERTS, getMockRefillForecast } from "@/lib/adminMockData";

/* ── Urgency Badge ── */
function UrgencyBadge({ urgency }: { urgency: string }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        out_of_stock: { bg: "bg-red-50", text: "text-red-600", label: "Out of Stock" },
        critical: { bg: "bg-amber-50", text: "text-amber-600", label: "Critical" },
        low: { bg: "bg-yellow-50", text: "text-yellow-600", label: "Low" },
    };
    const c = config[urgency] || { bg: "bg-slate-50", text: "text-slate-500", label: urgency };
    return (
        <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs ${c.bg} ${c.text}`}
            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
        >
            {c.label}
        </span>
    );
}

/* ── Source Badge ── */
function SourceBadge({ source }: { source: string }) {
    return (
        <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                source === "reminder" ? "bg-blue-50 text-blue-500" : "bg-violet-50 text-violet-500"
            }`}
            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
        >
            {source}
        </span>
    );
}

export default function RefillAlertsPage() {
    // Active tab
    const [tab, setTab] = useState<"alerts" | "forecast">("alerts");

    // Alerts
    const [alerts, setAlerts] = useState<RefillAlert[]>([]);
    const [alertsLoading, setAlertsLoading] = useState(true);

    // Forecast
    const [forecast, setForecast] = useState<RefillForecastResponse | null>(null);
    const [forecastLoading, setForecastLoading] = useState(false);
    const [daysAhead, setDaysAhead] = useState(14);

    const [error, setError] = useState("");
    const [usingDemoData, setUsingDemoData] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    const fetchAlerts = async () => {
        setAlertsLoading(true);
        setError("");
        try {
            const data = await adminService.getRefillAlerts();
            const parsedAlerts = Array.isArray(data) ? data : [];
            if (!parsedAlerts.length) {
                setAlerts(MOCK_REFILL_ALERTS);
                setUsingDemoData(true);
            } else {
                setAlerts(parsedAlerts);
                setUsingDemoData(false);
            }
        } catch (e: any) {
            setAlerts(MOCK_REFILL_ALERTS);
            setUsingDemoData(true);
            setError("");
        } finally {
            setAlertsLoading(false);
        }
    };

    const fetchForecast = async () => {
        setForecastLoading(true);
        setError("");
        try {
            const data = await adminService.getRefillForecast(daysAhead);
            if (!data?.data?.length) {
                setForecast(getMockRefillForecast(daysAhead));
                setUsingDemoData(true);
            } else {
                setForecast(data);
            }
        } catch (e: any) {
            setForecast(getMockRefillForecast(daysAhead));
            setUsingDemoData(true);
            setError("");
        } finally {
            setForecastLoading(false);
        }
    };

    useEffect(() => {
        fetchAlerts();
    }, []);

    useEffect(() => {
        if (tab === "forecast") fetchForecast();
    }, [tab, daysAhead]);

    const filteredAlerts = alerts.filter(
        (a) =>
            !searchTerm ||
            a.drug_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            a.patient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            a.phone?.includes(searchTerm)
    );

    const filteredForecast = forecast?.data?.filter(
        (f) =>
            !searchTerm ||
            f.drug_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            f.patient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            f.phone?.includes(searchTerm)
    ) || [];

    const isLoading = tab === "alerts" ? alertsLoading : forecastLoading;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                    <h1
                        className="text-3xl lg:text-4xl tracking-tight text-slate-900"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Refill{" "}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-500">
                            Alerts
                        </span>
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                        Patients running low on medication
                    </p>
                </motion.div>

                <div className="flex items-center gap-3">
                    {tab === "forecast" && (
                        <select
                            value={daysAhead}
                            onChange={(e) => setDaysAhead(Number(e.target.value))}
                            className="px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-emerald-300"
                            style={{ fontFamily: "var(--font-poppins)" }}
                        >
                            <option value={7}>7 days ahead</option>
                            <option value={14}>14 days ahead</option>
                            <option value={30}>30 days ahead</option>
                            <option value={60}>60 days ahead</option>
                            <option value={90}>90 days ahead</option>
                        </select>
                    )}
                    <button
                        onClick={tab === "alerts" ? fetchAlerts : fetchForecast}
                        disabled={isLoading}
                        className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all"
                    >
                        <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* Tab Toggle */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex bg-white rounded-xl border border-slate-200 p-1 w-fit"
            >
                <button
                    onClick={() => setTab("alerts")}
                    className={`px-5 py-2 rounded-lg text-sm transition-all ${
                        tab === "alerts"
                            ? "bg-amber-500 text-white shadow-sm"
                            : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                    }`}
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                >
                    <Bell size={14} className="inline mr-1.5" />
                    Current Alerts
                    {alerts.length > 0 && (
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                            tab === "alerts" ? "bg-white/20" : "bg-amber-100 text-amber-600"
                        }`}>
                            {alerts.length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setTab("forecast")}
                    className={`px-5 py-2 rounded-lg text-sm transition-all ${
                        tab === "forecast"
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                    }`}
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                >
                    <Clock size={14} className="inline mr-1.5" />
                    Forecast
                </button>
            </motion.div>

            {/* Search */}
            <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder="Filter by patient, phone, or drug..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full md:w-80 pl-9 pr-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                    style={{ fontFamily: "var(--font-poppins)" }}
                />
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                    {error}
                </div>
            )}

            {usingDemoData && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-blue-700 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                    Showing demo Refill data (backend data unavailable or empty).
                </div>
            )}

            {/* Alerts Tab */}
            {tab === "alerts" && (
                <>
                    {/* Summary strip */}
                    {!alertsLoading && alerts.length > 0 && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-red-50 rounded-2xl border border-red-100 p-5">
                                <p className="text-xs text-red-400 uppercase tracking-widest mb-1" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>Out of Stock</p>
                                <p className="text-3xl text-red-600" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                    {alerts.filter((a) => a.urgency === "out_of_stock").length}
                                </p>
                            </div>
                            <div className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
                                <p className="text-xs text-amber-400 uppercase tracking-widest mb-1" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>Critical</p>
                                <p className="text-3xl text-amber-600" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                    {alerts.filter((a) => a.urgency === "critical").length}
                                </p>
                            </div>
                            <div className="bg-yellow-50 rounded-2xl border border-yellow-100 p-5">
                                <p className="text-xs text-yellow-500 uppercase tracking-widest mb-1" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>Low</p>
                                <p className="text-3xl text-yellow-600" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                    {alerts.filter((a) => a.urgency === "low").length}
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {/* Alert cards */}
                    {alertsLoading ? (
                        <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center">
                            <Loader2 size={24} className="animate-spin text-amber-400 mx-auto" />
                        </div>
                    ) : filteredAlerts.length === 0 ? (
                        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
                            <Bell size={40} className="text-slate-200 mx-auto mb-3" />
                            <p className="text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>
                                No refill alerts right now
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredAlerts.map((alert, i) => (
                                <motion.div
                                    key={alert.record_id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.03 }}
                                    className="bg-white rounded-xl border border-slate-200/80 px-5 py-4 hover:shadow-md transition-all"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                                alert.urgency === "out_of_stock" ? "bg-red-100" : alert.urgency === "critical" ? "bg-amber-100" : "bg-yellow-100"
                                            }`}>
                                                <Pill size={18} className={
                                                    alert.urgency === "out_of_stock" ? "text-red-500" : alert.urgency === "critical" ? "text-amber-500" : "text-yellow-500"
                                                } />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="text-sm text-slate-800" style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}>
                                                        {alert.drug_name}
                                                    </p>
                                                    <SourceBadge source={alert.source} />
                                                </div>
                                                <div className="flex items-center gap-4 text-xs text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>
                                                    <span className="flex items-center gap-1">
                                                        <User size={11} /> {alert.patient_name || "Unknown"}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Phone size={11} /> {alert.phone}
                                                    </span>
                                                    {alert.end_date && (
                                                        <span className="flex items-center gap-1">
                                                            <Calendar size={11} /> Ends: {alert.end_date}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="text-right">
                                                <p className="text-lg text-slate-900" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                                    {alert.qty_remaining}
                                                </p>
                                                <p className="text-[10px] text-slate-400" style={{ fontFamily: "var(--font-poppins)" }}>remaining</p>
                                            </div>
                                            <UrgencyBadge urgency={alert.urgency} />
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Forecast Tab */}
            {tab === "forecast" && (
                <>
                    {forecast && !forecastLoading && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-emerald-50 rounded-2xl border border-emerald-100 p-5">
                            <div className="flex items-center gap-3">
                                <Clock size={18} className="text-emerald-500" />
                                <div>
                                    <p className="text-sm text-emerald-700" style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}>
                                        {forecast.patients_needing_refill} patient{forecast.patients_needing_refill !== 1 ? "s" : ""} will need refills by {forecast.cutoff_date}
                                    </p>
                                    <p className="text-xs text-emerald-500" style={{ fontFamily: "var(--font-poppins)" }}>
                                        {daysAhead}-day forecast window
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {forecastLoading ? (
                        <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center">
                            <Loader2 size={24} className="animate-spin text-emerald-400 mx-auto" />
                        </div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden"
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100">
                                            {["Patient", "Phone", "Drug", "Source", "Remaining", "Daily Doses", "Days Left", "Runout Date"].map((h) => (
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
                                        {filteredForecast.map((item, i) => (
                                            <motion.tr
                                                key={item.record_id}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                transition={{ delay: i * 0.02 }}
                                                className="border-b border-slate-50 hover:bg-emerald-50/30 transition-colors"
                                            >
                                                <td className="px-4 py-3 text-slate-700" style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}>
                                                    {item.patient_name || "Unknown"}
                                                </td>
                                                <td className="px-4 py-3 text-slate-500" style={{ fontFamily: "var(--font-poppins)" }}>
                                                    {item.phone}
                                                </td>
                                                <td className="px-4 py-3 text-slate-700" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                                    {item.drug_name}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <SourceBadge source={item.source} />
                                                </td>
                                                <td className="px-4 py-3" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>
                                                    {item.qty_remaining}
                                                </td>
                                                <td className="px-4 py-3 text-slate-500">{item.daily_doses}</td>
                                                <td className="px-4 py-3">
                                                    <span
                                                        className={`${
                                                            item.remaining_days <= 3 ? "text-red-500" : item.remaining_days <= 7 ? "text-amber-500" : "text-emerald-600"
                                                        }`}
                                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                    >
                                                        {item.remaining_days}d
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-slate-600" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                                    {item.predicted_runout}
                                                </td>
                                            </motion.tr>
                                        ))}
                                        {filteredForecast.length === 0 && (
                                            <tr>
                                                <td colSpan={8} className="text-center py-16">
                                                    <Bell size={32} className="text-slate-200 mx-auto mb-3" />
                                                    <p className="text-slate-400 text-sm" style={{ fontFamily: "var(--font-poppins)" }}>
                                                        No refills predicted in this window
                                                    </p>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </motion.div>
                    )}
                </>
            )}
        </div>
    );
}
