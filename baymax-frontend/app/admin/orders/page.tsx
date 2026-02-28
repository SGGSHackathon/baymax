"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
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

/* ── animation helpers ── */
const fadeUp = {
    hidden: { opacity: 0, y: 16 },
    show: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] },
    }),
};

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

    const statCards = [
        { label: "Pending", value: pendingCount, icon: Clock, color: "amber" },
        { label: "Processing", value: processingCount, icon: Truck, color: "blue" },
        { label: "Revenue", value: `₹${totalRevenue.toLocaleString("en-IN")}`, icon: IndianRupee, color: "emerald" },
    ] as const;

    return (
        <div className="space-y-6 max-w-[1200px]">
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
                    Orders
                </h1>
                <p
                    className="text-sm text-slate-500 mt-1.5"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                >
                    Track and manage patient medication orders.
                </p>
            </motion.div>

            {/* ── Quick Stats ── */}
            <div className="grid grid-cols-3 gap-4">
                {statCards.map((card, i) => {
                    const Icon = card.icon;
                    const colorMap: Record<string, { bg: string; icon: string; iconBg: string }> = {
                        amber: { bg: "bg-amber-50", icon: "text-amber-700", iconBg: "bg-amber-100" },
                        blue: { bg: "bg-blue-50", icon: "text-blue-700", iconBg: "bg-blue-100" },
                        emerald: { bg: "bg-emerald-50", icon: "text-emerald-700", iconBg: "bg-emerald-100" },
                    };
                    const c = colorMap[card.color];
                    return (
                        <motion.div
                            key={card.label}
                            initial={{ opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, delay: 0.08 + i * 0.06 }}
                            whileHover={{ y: -4, scale: 1.02 }}
                            className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[20px] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] cursor-default"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <span
                                    className="text-[10px] uppercase tracking-[0.18em] text-slate-400"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    {card.label}
                                </span>
                                <div className={`w-9 h-9 rounded-xl ${c.iconBg} flex items-center justify-center`}>
                                    <Icon size={14} className={c.icon} />
                                </div>
                            </div>
                            <div
                                className="text-2xl text-slate-900"
                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                            >
                                {card.value}
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* ── Filters ── */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="flex flex-col sm:flex-row gap-3"
            >
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by patient, drug, or order number..."
                        className="w-full h-11 bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-xl pl-10 pr-4 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-slate-900 placeholder:text-slate-300"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                    />
                </div>
                <div className="flex items-center gap-2 overflow-x-auto">
                    <Filter size={14} className="text-slate-400 shrink-0" />
                    {STATUS_FILTERS.map((s) => (
                        <motion.button
                            key={s}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setStatusFilter(s)}
                            className={`px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap border transition-all capitalize ${
                                statusFilter === s
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100 shadow-sm shadow-emerald-100/50"
                                    : "bg-white/60 text-slate-500 border-slate-200/60 hover:text-slate-900 hover:border-slate-300"
                            }`}
                            style={{ fontFamily: "var(--font-poppins)", fontWeight: statusFilter === s ? 700 : 600 }}
                        >
                            {s}
                        </motion.button>
                    ))}
                </div>
            </motion.div>

            {/* ── Table ── */}
            <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="bg-white/70 backdrop-blur-xl border border-slate-200/60 rounded-[28px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100/80">
                                {["Order #", "Patient", "Drug", "Qty", "Total (₹)", "Date", "Status", "Actions"].map((h, i) => (
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
                                                <ShoppingCart size={24} />
                                            </div>
                                            <span
                                                className="text-[10px] uppercase tracking-[0.2em]"
                                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                            >
                                                No orders found
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((order, i) => {
                                    const next = nextStatus(order.status);
                                    return (
                                        <motion.tr
                                            key={order.id}
                                            variants={fadeUp}
                                            custom={i}
                                            initial="hidden"
                                            animate="show"
                                            className="border-b border-slate-50 last:border-b-0 hover:bg-emerald-50/30 transition-colors"
                                        >
                                            <td
                                                className="px-5 py-4 text-slate-900 text-xs"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                            >
                                                {order.order_number}
                                            </td>
                                            <td
                                                className="px-5 py-4 text-slate-900"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                            >
                                                {order.patient_name}
                                            </td>
                                            <td
                                                className="px-5 py-4 text-slate-600"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                            >
                                                {order.drug_name}
                                            </td>
                                            <td
                                                className="px-5 py-4 text-slate-600"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                            >
                                                {order.quantity}
                                            </td>
                                            <td
                                                className="px-5 py-4 text-slate-900"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 700 }}
                                            >
                                                ₹{order.total_price.toLocaleString("en-IN")}
                                            </td>
                                            <td
                                                className="px-5 py-4 text-slate-500 text-xs"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                            >
                                                {new Date(order.ordered_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-5 py-4">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] uppercase tracking-[0.15em] border ${statusStyle(order.status)}`}
                                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                >
                                                    {statusIcon(order.status)} {order.status}
                                                </span>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center justify-end gap-2">
                                                    {next && (
                                                        <motion.button
                                                            whileHover={{ scale: 1.08 }}
                                                            whileTap={{ scale: 0.92 }}
                                                            onClick={() => handleStatusChange(order.id, next)}
                                                            disabled={updating === order.id}
                                                            className="h-8 px-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] uppercase tracking-[0.15em] hover:bg-emerald-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                        >
                                                            {updating === order.id ? (
                                                                <Loader2 className="animate-spin" size={12} />
                                                            ) : (
                                                                <>
                                                                    <Truck size={12} /> {nextStatusLabel(order.status)}
                                                                </>
                                                            )}
                                                        </motion.button>
                                                    )}
                                                    {(order.status === "pending" || order.status === "processing") && (
                                                        <motion.button
                                                            whileHover={{ scale: 1.08 }}
                                                            whileTap={{ scale: 0.92 }}
                                                            onClick={() => handleStatusChange(order.id, "cancelled")}
                                                            disabled={updating === order.id}
                                                            className="h-8 px-3 rounded-xl bg-red-50 border border-red-100 text-red-500 text-[10px] uppercase tracking-[0.15em] hover:bg-red-100 transition-colors disabled:opacity-50"
                                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                        >
                                                            Cancel
                                                        </motion.button>
                                                    )}
                                                    {(order.status === "delivered" || order.status === "cancelled") && (
                                                        <span
                                                            className="text-[10px] text-slate-300 uppercase tracking-[0.15em]"
                                                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                                        >
                                                            —
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </motion.tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-5 py-3.5 border-t border-slate-100/80 flex items-center justify-between">
                    <span
                        className="text-xs text-slate-400"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                    >
                        {filtered.length} of {orders.length} orders
                    </span>
                    <span
                        className="text-xs text-slate-400"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                    >
                        Total delivered: ₹{totalRevenue.toLocaleString("en-IN")}
                    </span>
                </div>
            </motion.div>
        </div>
    );
}
