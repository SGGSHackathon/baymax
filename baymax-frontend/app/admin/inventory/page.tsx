"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { dataService } from "@/lib/api";
import { adminMockService, InventoryItem } from "@/lib/admin-mock";
import { useToast } from "@/hooks/useToast";
import {
    Loader2,
    Package,
    Search,
    AlertTriangle,
    CheckCircle,
    Clock,
    Plus,
    Pencil,
    X,
    Filter,
    ArrowUpRight,
} from "lucide-react";

const STATUS_FILTERS = ["All", "in_stock", "low_stock", "out_of_stock"] as const;

/* ── animation helpers ── */
const fadeUp = {
    hidden: { opacity: 0, y: 16 },
    show: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] },
    }),
};

export default function InventoryDashboardPage() {
    const { toast } = useToast();
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("All");

    const [apiQuery, setApiQuery] = useState("");
    const [apiResults, setApiResults] = useState<any[]>([]);
    const [apiLoading, setApiLoading] = useState(false);
    const [recallActive, setRecallActive] = useState<{ [key: string]: any }>({});
    const [recallLoading, setRecallLoading] = useState<{ [key: string]: boolean }>({});

    const [expiring, setExpiring] = useState<any[]>([]);
    const [expiringLoading, setExpiringLoading] = useState(true);

    const [editItem, setEditItem] = useState<InventoryItem | null>(null);
    const [editStock, setEditStock] = useState(0);
    const [saving, setSaving] = useState(false);

    const fetchInventory = useCallback(async () => {
        try {
            const data = await adminMockService.getInventory();
            setInventory(data);
        } catch {
            toast("Failed to load inventory", "error");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInventory();
        dataService
            .getExpiringMeds()
            .then((res) => setExpiring(Array.isArray(res) ? res : []))
            .catch(() => setExpiring([]))
            .finally(() => setExpiringLoading(false));
    }, [fetchInventory]);

    const handleApiSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (apiQuery.trim().length < 2) return;
        setApiLoading(true);
        try {
            const res = await dataService.searchInventory(apiQuery);
            setApiResults(Array.isArray(res) ? res : []);
        } catch {
            toast("Search failed", "error");
        } finally {
            setApiLoading(false);
        }
    };

    const checkRecall = async (drugName: string) => {
        setRecallLoading((prev) => ({ ...prev, [drugName]: true }));
        try {
            const res = await dataService.checkRecall(drugName);
            setRecallActive((prev) => ({ ...prev, [drugName]: res }));
        } catch {
            toast("Recall check failed", "error");
        } finally {
            setRecallLoading((prev) => ({ ...prev, [drugName]: false }));
        }
    };

    const openEdit = (item: InventoryItem) => {
        setEditItem(item);
        setEditStock(item.stock_left);
    };

    const handleSaveStock = async () => {
        if (!editItem) return;
        setSaving(true);
        try {
            const newStatus: InventoryItem["status"] =
                editStock === 0 ? "out_of_stock" : editStock <= editItem.reorder_level ? "low_stock" : "in_stock";
            await adminMockService.updateInventory(editItem.id, { stock_left: editStock, status: newStatus });
            toast("Stock updated", "success");
            await fetchInventory();
            setEditItem(null);
        } catch {
            toast("Failed to update stock", "error");
        } finally {
            setSaving(false);
        }
    };

    const filtered = inventory.filter((i) => {
        const matchSearch = i.drug_name.toLowerCase().includes(search.toLowerCase()) || i.brand.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === "All" || i.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const statusStyle = (s: string) => {
        switch (s) {
            case "in_stock":
                return "bg-emerald-50 text-emerald-600 border-emerald-100";
            case "low_stock":
                return "bg-amber-50 text-amber-600 border-amber-100";
            case "out_of_stock":
                return "bg-red-50 text-red-500 border-red-100";
            default:
                return "bg-slate-50 text-slate-500 border-slate-200";
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-emerald-600" size={28} />
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-[1200px]">
            {/* ── Header ── */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <h1
                    className="text-3xl tracking-tight text-slate-900"
                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                >
                    Inventory
                </h1>
                <p
                    className="text-sm text-slate-500 mt-1.5"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                >
                    Track stock levels, expiration dates, and FDA recall status.
                </p>
            </motion.div>

            {/* ── Inventory Table Section ── */}
            <div className="space-y-4">
                {/* Filters */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    className="flex flex-col sm:flex-row gap-3"
                >
                    <div className="relative flex-1 max-w-md">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search inventory..."
                            className="w-full h-11 bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter size={14} className="text-slate-400 shrink-0" />
                        {STATUS_FILTERS.map((s) => (
                            <motion.button
                                key={s}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setStatusFilter(s)}
                                className={`px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap border transition-all ${
                                    statusFilter === s
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm shadow-emerald-100/50"
                                        : "bg-white/60 text-slate-500 border-slate-200/60 hover:text-slate-900 hover:border-slate-300"
                                }`}
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: statusFilter === s ? 700 : 600 }}
                            >
                                {s === "All" ? "All" : statusLabel(s)}
                            </motion.button>
                        ))}
                    </div>
                </motion.div>

                {/* Table */}
                <motion.div
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.15 }}
                    className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100/80">
                                    {["Drug Name", "Brand", "Category", "Stock", "Batch", "Expiry", "Status", "Actions"].map((h, i) => (
                                        <th
                                            key={h}
                                            className={`${i === 7 ? "text-right" : "text-left"} px-5 py-4 text-[10px] uppercase tracking-[0.18em] text-slate-400`}
                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="text-center py-16 text-slate-400">
                                            <div className="flex flex-col items-center gap-3">
                                                <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                                                    <Package size={24} />
                                                </div>
                                                <span
                                                    className="text-[10px] uppercase tracking-[0.2em]"
                                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                >
                                                    No items found
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map((item, i) => (
                                        <motion.tr
                                            key={item.id}
                                            variants={fadeUp}
                                            custom={i}
                                            initial="hidden"
                                            animate="show"
                                            className="border-b border-slate-50 last:border-b-0 hover:bg-emerald-50/30 transition-colors"
                                        >
                                            <td className="px-5 py-4 text-slate-900" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>{item.drug_name}</td>
                                            <td className="px-5 py-4 text-slate-600" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>{item.brand}</td>
                                            <td className="px-5 py-4">
                                                <span
                                                    className="px-2.5 py-0.5 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-600"
                                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                                                >
                                                    {item.category}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 text-slate-900" style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}>{item.stock_left}</td>
                                            <td className="px-5 py-4 text-slate-500 text-xs" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>{item.batch_no}</td>
                                            <td className="px-5 py-4 text-slate-500 text-xs" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>{new Date(item.expiry_date).toLocaleDateString()}</td>
                                            <td className="px-5 py-4">
                                                <span
                                                    className={`px-2.5 py-0.5 rounded-lg text-[10px] uppercase tracking-[0.15em] border ${statusStyle(item.status)}`}
                                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                >
                                                    {statusLabel(item.status)}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center justify-end">
                                                    <motion.button
                                                        whileHover={{ scale: 1.12 }}
                                                        whileTap={{ scale: 0.92 }}
                                                        onClick={() => openEdit(item)}
                                                        className="w-9 h-9 rounded-xl bg-white/80 border border-slate-200/60 flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50/50 transition-all shadow-sm"
                                                        title="Edit Stock"
                                                    >
                                                        <Pencil size={14} />
                                                    </motion.button>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="px-5 py-3.5 border-t border-slate-100/80 flex items-center justify-between">
                        <span
                            className="text-xs text-slate-400"
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                        >
                            {filtered.length} of {inventory.length} items
                        </span>
                    </div>
                </motion.div>
            </div>

            {/* ── FDA Recall Check ── */}
            <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="bg-white/70 backdrop-blur-xl p-6 rounded-[28px] border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden"
            >
                <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-100/30 blur-[100px] rounded-full pointer-events-none" />

                <div className="flex items-center gap-3 mb-1">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200/60 flex items-center justify-center">
                        <AlertTriangle size={15} className="text-emerald-600" />
                    </div>
                    <div>
                        <h2
                            className="text-base text-slate-900"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            FDA Recall Check
                        </h2>
                        <p
                            className="text-xs text-slate-500 mt-0.5"
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                        >
                            Search master database and verify real-time recall status.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleApiSearch} className="relative flex items-center max-w-xl mt-4">
                    <Search size={16} className="absolute left-4 text-slate-400" />
                    <input
                        type="text"
                        value={apiQuery}
                        onChange={(e) => setApiQuery(e.target.value)}
                        placeholder="Search medicines (e.g. Paracetamol)..."
                        className="w-full h-12 bg-white/70 border border-slate-200/60 rounded-xl pl-11 pr-24 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                    />
                    <motion.button
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.97 }}
                        type="submit"
                        disabled={apiLoading || apiQuery.length < 2}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 px-4 flex items-center justify-center bg-slate-900 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors text-xs shadow-sm"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                    >
                        {apiLoading ? <Loader2 className="animate-spin" size={14} /> : "Search"}
                    </motion.button>
                </form>

                {apiResults.length > 0 && (
                    <div className="mt-5 space-y-3">
                        <h3
                            className="text-[10px] uppercase tracking-[0.18em] text-slate-400"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Results ({apiResults.length})
                        </h3>
                        {apiResults.map((item, i) => {
                            const drugName = item.drug_name || item.name;
                            const recallData = recallActive[drugName];
                            const isValidating = recallLoading[drugName];

                            return (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.06, duration: 0.35 }}
                                    className="bg-white/60 p-4 rounded-2xl border border-slate-200/60 flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center hover:shadow-md hover:shadow-slate-100/60 transition-all"
                                >
                                    <div>
                                        <div className="text-sm capitalize text-slate-900" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>{drugName}</div>
                                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                            <span className="bg-white border border-slate-100 px-2 py-0.5 rounded-lg text-xs" style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}>Stock: {item.stock_left || "N/A"}</span>
                                            <span className="capitalize">{item.category || "General"}</span>
                                        </div>
                                    </div>

                                    <div className="shrink-0">
                                        {!recallData && !isValidating ? (
                                            <motion.button
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => checkRecall(drugName)}
                                                className="h-8 px-3 rounded-xl bg-white/80 border border-slate-200/60 text-xs hover:text-emerald-600 hover:border-emerald-200 transition-all text-slate-600 shadow-sm"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                            >
                                                Check Recall
                                            </motion.button>
                                        ) : isValidating ? (
                                            <div className="h-8 px-3 flex items-center gap-2 text-xs text-slate-500" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                                <Loader2 className="animate-spin" size={14} /> Checking...
                                            </div>
                                        ) : recallData.recall_detected ? (
                                            <span
                                                className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-xl border border-red-100"
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                <AlertTriangle size={14} /> Recall Active
                                            </span>
                                        ) : (
                                            <span
                                                className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100"
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                <CheckCircle size={14} /> Cleared
                                            </span>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </motion.div>

            {/* ── Expiring Medications ── */}
            <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.25 }}
                className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
            >
                <div className="p-6 border-b border-slate-100/80">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200/60 flex items-center justify-center">
                            <Clock size={15} className="text-amber-600" />
                        </div>
                        <div>
                            <h2
                                className="text-base text-slate-900"
                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                            >
                                Expiring Medications
                            </h2>
                            <p
                                className="text-xs text-slate-500 mt-0.5"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                            >
                                Medications nearing expiration.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="p-5">
                    {expiringLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="animate-spin text-emerald-600" size={24} />
                        </div>
                    ) : expiring.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-slate-400 space-y-3">
                            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                                <Clock size={24} />
                            </div>
                            <span
                                className="text-[10px] uppercase tracking-[0.2em]"
                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                            >
                                No expiring medications
                            </span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {expiring.map((med: any, i: number) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.06, duration: 0.35 }}
                                    className="bg-white/60 border border-slate-200/60 p-4 rounded-2xl flex items-center justify-between hover:shadow-md hover:shadow-slate-100/60 transition-all"
                                >
                                    <div>
                                        <div className="text-sm text-slate-900 capitalize" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>{med.drug_name || med.name}</div>
                                        <div className="text-xs text-slate-500 mt-0.5" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>
                                            Expires: {new Date(med.expiry_date || med.expires_at).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <span
                                        className="text-xs bg-amber-50 text-amber-600 px-2.5 py-0.5 rounded-lg border border-amber-100"
                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                    >
                                        {med.stock_qty || med.stock_left || 0} units
                                    </span>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </motion.div>

            {/* ── Edit Stock Modal ── */}
            <AnimatePresence>
                {editItem && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                            className="bg-white/95 backdrop-blur-xl rounded-[28px] border border-slate-200/60 shadow-xl w-full max-w-sm"
                        >
                            <div className="flex items-center justify-between p-6 border-b border-slate-100/80">
                                <h2
                                    className="text-base text-slate-900"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    Update Stock
                                </h2>
                                <motion.button
                                    whileHover={{ scale: 1.1, rotate: 90 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => setEditItem(null)}
                                    className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors"
                                >
                                    <X size={14} />
                                </motion.button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div>
                                    <div className="text-slate-900" style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}>{editItem.drug_name}</div>
                                    <div className="text-xs text-slate-500" style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}>{editItem.brand} &middot; Batch: {editItem.batch_no}</div>
                                </div>
                                <div>
                                    <label
                                        className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5 block"
                                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                    >
                                        Stock Quantity
                                    </label>
                                    <input
                                        type="number"
                                        value={editStock}
                                        onChange={(e) => setEditStock(parseInt(e.target.value) || 0)}
                                        className="w-full h-11 bg-white/70 border border-slate-200/60 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900"
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                    />
                                </div>
                            </div>
                            <div className="p-6 border-t border-slate-100/80 flex justify-end gap-3">
                                <motion.button
                                    whileHover={{ scale: 1.03 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={() => setEditItem(null)}
                                    className="h-10 px-5 rounded-xl border border-slate-200/60 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                >
                                    Cancel
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.04, y: -1 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={handleSaveStock}
                                    disabled={saving}
                                    className="h-10 px-5 bg-slate-900 text-white rounded-xl text-sm hover:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center gap-2 shadow-lg shadow-slate-900/10"
                                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                >
                                    {saving && <Loader2 className="animate-spin" size={14} />} Save
                                </motion.button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
