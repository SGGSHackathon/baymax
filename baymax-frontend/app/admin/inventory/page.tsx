"use client";

import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";

const STATUS_FILTERS = ["All", "in_stock", "low_stock", "out_of_stock"] as const;

export default function InventoryDashboardPage() {
    const { toast } = useToast();
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("All");

    // API search (original functionality)
    const [apiQuery, setApiQuery] = useState("");
    const [apiResults, setApiResults] = useState<any[]>([]);
    const [apiLoading, setApiLoading] = useState(false);
    const [recallActive, setRecallActive] = useState<{ [key: string]: any }>({});
    const [recallLoading, setRecallLoading] = useState<{ [key: string]: boolean }>({});

    // Expiring meds
    const [expiring, setExpiring] = useState<any[]>([]);
    const [expiringLoading, setExpiringLoading] = useState(true);

    // Edit modal
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

    // API search
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

    // Edit stock
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

    // Filtering
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
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inventory</h1>
                <p className="text-sm text-slate-500 font-medium mt-1">Track stock levels, expiration dates, and FDA recall status.</p>
            </div>

            {/* Inventory Table Section */}
            <div className="space-y-4">
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1 max-w-md">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search inventory..."
                            className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter size={14} className="text-slate-400 shrink-0" />
                        {STATUS_FILTERS.map((s) => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors ${
                                    statusFilter === s
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                        : "bg-white text-slate-500 border-slate-200 hover:text-slate-900 hover:border-slate-300"
                                }`}
                            >
                                {s === "All" ? "All" : statusLabel(s)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Drug Name</th>
                                    <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Brand</th>
                                    <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Category</th>
                                    <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Stock</th>
                                    <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Batch</th>
                                    <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Expiry</th>
                                    <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Status</th>
                                    <th className="text-right px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="text-center py-16 text-slate-400">
                                            <div className="flex flex-col items-center gap-2">
                                                <Package size={28} />
                                                <span className="text-xs font-bold uppercase tracking-widest">No items found</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map((item) => (
                                        <tr key={item.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                                            <td className="px-5 py-3.5 font-bold text-slate-900">{item.drug_name}</td>
                                            <td className="px-5 py-3.5 text-slate-600 font-medium">{item.brand}</td>
                                            <td className="px-5 py-3.5">
                                                <span className="px-2 py-0.5 bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold text-slate-600">{item.category}</span>
                                            </td>
                                            <td className="px-5 py-3.5 font-bold text-slate-900">{item.stock_left}</td>
                                            <td className="px-5 py-3.5 text-slate-500 font-medium text-xs">{item.batch_no}</td>
                                            <td className="px-5 py-3.5 text-slate-500 font-medium text-xs">{new Date(item.expiry_date).toLocaleDateString()}</td>
                                            <td className="px-5 py-3.5">
                                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${statusStyle(item.status)}`}>
                                                    {statusLabel(item.status)}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <div className="flex items-center justify-end">
                                                    <button
                                                        onClick={() => openEdit(item)}
                                                        className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-200 transition-colors"
                                                        title="Edit Stock"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs text-slate-400 font-bold">{filtered.length} of {inventory.length} items</span>
                    </div>
                </div>
            </div>

            {/* API Search Section */}
            <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-50/50 blur-[100px] rounded-full pointer-events-none" />

                <h2 className="text-lg font-bold tracking-tight mb-1 text-slate-900">FDA Recall Check</h2>
                <p className="text-slate-500 text-sm mb-5 font-medium">Search the master database and verify real-time FDA recall status.</p>

                <form onSubmit={handleApiSearch} className="relative flex items-center max-w-xl">
                    <Search size={16} className="absolute left-4 text-slate-400" />
                    <input
                        type="text"
                        value={apiQuery}
                        onChange={(e) => setApiQuery(e.target.value)}
                        placeholder="Search medicines (e.g. Paracetamol)..."
                        className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-24 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                    />
                    <button
                        type="submit"
                        disabled={apiLoading || apiQuery.length < 2}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 px-4 flex items-center justify-center bg-slate-900 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors text-xs font-bold"
                    >
                        {apiLoading ? <Loader2 className="animate-spin" size={14} /> : "Search"}
                    </button>
                </form>

                {apiResults.length > 0 && (
                    <div className="mt-5 space-y-3">
                        <h3 className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Results ({apiResults.length})</h3>
                        {apiResults.map((item, i) => {
                            const drugName = item.drug_name || item.name;
                            const recallData = recallActive[drugName];
                            const isValidating = recallLoading[drugName];

                            return (
                                <div key={i} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
                                    <div>
                                        <div className="font-bold text-sm capitalize text-slate-900">{drugName}</div>
                                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3 font-medium">
                                            <span className="bg-white border border-slate-100 px-2 py-0.5 rounded-lg text-xs font-bold">Stock: {item.stock_left || "N/A"}</span>
                                            <span className="capitalize">{item.category || "General"}</span>
                                        </div>
                                    </div>

                                    <div className="shrink-0">
                                        {!recallData && !isValidating ? (
                                            <button
                                                onClick={() => checkRecall(drugName)}
                                                className="h-8 px-3 rounded-lg bg-white border border-slate-200 text-xs font-bold hover:text-emerald-600 hover:border-emerald-200 transition-colors text-slate-600"
                                            >
                                                Check Recall
                                            </button>
                                        ) : isValidating ? (
                                            <div className="h-8 px-3 flex items-center gap-2 text-xs text-slate-500 font-medium">
                                                <Loader2 className="animate-spin" size={14} /> Checking...
                                            </div>
                                        ) : recallData.recall_detected ? (
                                            <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 font-bold">
                                                <AlertTriangle size={14} /> Recall Active
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100 font-bold">
                                                <CheckCircle size={14} /> Cleared
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Expiring Medications */}
            <div className="bg-white border border-slate-200 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                    <h2 className="text-base font-bold flex items-center gap-2 text-slate-900">
                        <Clock size={16} className="text-amber-500" /> Expiring Medications
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5 font-medium">Medications nearing expiration.</p>
                </div>
                <div className="p-5">
                    {expiringLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="animate-spin text-emerald-600" size={24} />
                        </div>
                    ) : expiring.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-slate-400 space-y-2">
                            <Clock size={28} />
                            <span className="text-xs font-bold uppercase tracking-widest">No expiring medications</span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {expiring.map((med: any, i: number) => (
                                <div key={i} className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex items-center justify-between">
                                    <div>
                                        <div className="font-bold text-sm text-slate-900 capitalize">{med.drug_name || med.name}</div>
                                        <div className="text-xs text-slate-500 mt-0.5 font-medium">
                                            Expires: {new Date(med.expiry_date || med.expires_at).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <span className="text-xs font-black bg-amber-50 text-amber-600 px-2 py-0.5 rounded-lg border border-amber-100">
                                        {med.stock_qty || med.stock_left || 0} units
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Stock Modal */}
            {editItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-[24px] border border-slate-200 shadow-xl w-full max-w-sm">
                        <div className="flex items-center justify-between p-5 border-b border-slate-100">
                            <h2 className="text-base font-bold text-slate-900">Update Stock</h2>
                            <button onClick={() => setEditItem(null)} className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
                                <X size={14} />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <div className="font-bold text-slate-900">{editItem.drug_name}</div>
                                <div className="text-xs text-slate-500 font-medium">{editItem.brand} &middot; Batch: {editItem.batch_no}</div>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1.5 block">Stock Quantity</label>
                                <input
                                    type="number"
                                    value={editStock}
                                    onChange={(e) => setEditStock(parseInt(e.target.value) || 0)}
                                    className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900"
                                />
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setEditItem(null)} className="h-9 px-4 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">Cancel</button>
                            <button onClick={handleSaveStock} disabled={saving} className="h-9 px-5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center gap-2">
                                {saving && <Loader2 className="animate-spin" size={14} />} Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
