"use client";

import { useEffect, useState, useCallback } from "react";
import { adminMockService, AdminOrder } from "@/lib/admin-mock";
import { useToast } from "@/hooks/useToast";
import {
    ShoppingCart,
    Loader2,
    Search,
    Filter,
    CheckCircle,
    XCircle,
    Clock,
    Truck,
    IndianRupee,
} from "lucide-react";

const STATUS_FILTERS = ["All", "pending", "processing", "delivered", "cancelled"] as const;

export default function OrdersPage() {
    const { toast } = useToast();
    const [orders, setOrders] = useState<AdminOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("All");
    const [updating, setUpdating] = useState<string | null>(null);

    const fetchOrders = useCallback(async () => {
        try {
            const data = await adminMockService.getOrders();
            setOrders(data);
        } catch {
            toast("Failed to load orders", "error");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const handleStatusChange = async (id: string, status: AdminOrder["status"]) => {
        setUpdating(id);
        try {
            await adminMockService.updateOrderStatus(id, status);
            toast(`Order ${status}`, "success");
            await fetchOrders();
        } catch {
            toast("Failed to update order", "error");
        } finally {
            setUpdating(null);
        }
    };

    const filtered = orders.filter((o) => {
        const matchSearch =
            o.patient_name.toLowerCase().includes(search.toLowerCase()) ||
            o.drug_name.toLowerCase().includes(search.toLowerCase()) ||
            o.order_number.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === "All" || o.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const statusStyle = (s: string) => {
        switch (s) {
            case "pending":
                return "bg-amber-50 text-amber-600 border-amber-100";
            case "processing":
                return "bg-blue-50 text-blue-600 border-blue-100";
            case "delivered":
                return "bg-emerald-50 text-emerald-600 border-emerald-100";
            case "cancelled":
                return "bg-red-50 text-red-500 border-red-100";
            default:
                return "bg-slate-50 text-slate-500 border-slate-200";
        }
    };

    const statusIcon = (s: string) => {
        switch (s) {
            case "pending":
                return <Clock size={12} />;
            case "processing":
                return <Loader2 size={12} />;
            case "delivered":
                return <CheckCircle size={12} />;
            case "cancelled":
                return <XCircle size={12} />;
            default:
                return null;
        }
    };

    // Next status transition map
    const nextStatus = (current: AdminOrder["status"]): AdminOrder["status"] | null => {
        switch (current) {
            case "pending":
                return "processing";
            case "processing":
                return "delivered";
            default:
                return null;
        }
    };

    const nextStatusLabel = (current: AdminOrder["status"]): string => {
        switch (current) {
            case "pending":
                return "Process";
            case "processing":
                return "Deliver";
            default:
                return "";
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-emerald-600" size={28} />
            </div>
        );
    }

    // Summary stats
    const totalRevenue = orders
        .filter((o) => o.status === "delivered")
        .reduce((s, o) => s + o.total_price, 0);
    const pendingCount = orders.filter((o) => o.status === "pending").length;
    const processingCount = orders.filter((o) => o.status === "processing").length;

    return (
        <div className="space-y-6 max-w-[1200px]">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Orders</h1>
                <p className="text-sm text-slate-500 font-medium mt-1">
                    Track and manage patient medication orders.
                </p>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Pending</span>
                        <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
                            <Clock size={12} className="text-amber-700" />
                        </div>
                    </div>
                    <div className="text-xl font-black text-slate-900">{pendingCount}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Processing</span>
                        <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                            <Truck size={12} className="text-blue-700" />
                        </div>
                    </div>
                    <div className="text-xl font-black text-slate-900">{processingCount}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Revenue</span>
                        <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                            <IndianRupee size={12} className="text-emerald-700" />
                        </div>
                    </div>
                    <div className="text-xl font-black text-slate-900">₹{totalRevenue.toLocaleString("en-IN")}</div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by patient, drug, or order number..."
                        className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all font-medium text-slate-900 placeholder:text-slate-300"
                    />
                </div>
                <div className="flex items-center gap-2 overflow-x-auto">
                    <Filter size={14} className="text-slate-400 shrink-0" />
                    {STATUS_FILTERS.map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors capitalize ${
                                statusFilter === s
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                    : "bg-white text-slate-500 border-slate-200 hover:text-slate-900 hover:border-slate-300"
                            }`}
                        >
                            {s}
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
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Order #</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Patient</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Drug</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Qty</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Total (₹)</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Date</th>
                                <th className="text-left px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Status</th>
                                <th className="text-right px-5 py-3.5 text-[10px] uppercase font-bold tracking-widest text-slate-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="text-center py-16 text-slate-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <ShoppingCart size={28} />
                                            <span className="text-xs font-bold uppercase tracking-widest">No orders found</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((order) => {
                                    const next = nextStatus(order.status);
                                    return (
                                        <tr key={order.id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                                            <td className="px-5 py-3.5 font-bold text-slate-900 text-xs">{order.order_number}</td>
                                            <td className="px-5 py-3.5 font-bold text-slate-900">{order.patient_name}</td>
                                            <td className="px-5 py-3.5 text-slate-600 font-medium">{order.drug_name}</td>
                                            <td className="px-5 py-3.5 text-slate-600 font-bold">{order.quantity}</td>
                                            <td className="px-5 py-3.5 font-bold text-slate-900">₹{order.total_price.toLocaleString("en-IN")}</td>
                                            <td className="px-5 py-3.5 text-slate-500 font-medium text-xs">
                                                {new Date(order.ordered_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${statusStyle(order.status)}`}>
                                                    {statusIcon(order.status)} {order.status}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <div className="flex items-center justify-end gap-2">
                                                    {next && (
                                                        <button
                                                            onClick={() => handleStatusChange(order.id, next)}
                                                            disabled={updating === order.id}
                                                            className="h-7 px-2.5 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                                                        >
                                                            {updating === order.id ? (
                                                                <Loader2 className="animate-spin" size={12} />
                                                            ) : (
                                                                <>
                                                                    <Truck size={12} /> {nextStatusLabel(order.status)}
                                                                </>
                                                            )}
                                                        </button>
                                                    )}
                                                    {(order.status === "pending" || order.status === "processing") && (
                                                        <button
                                                            onClick={() => handleStatusChange(order.id, "cancelled")}
                                                            disabled={updating === order.id}
                                                            className="h-7 px-2.5 rounded-lg bg-red-50 border border-red-100 text-red-500 text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-colors disabled:opacity-50"
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                    {(order.status === "delivered" || order.status === "cancelled") && (
                                                        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">—</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-bold">{filtered.length} of {orders.length} orders</span>
                    <span className="text-xs text-slate-400 font-bold">
                        Total delivered: ₹{totalRevenue.toLocaleString("en-IN")}
                    </span>
                </div>
            </div>
        </div>
    );
}
