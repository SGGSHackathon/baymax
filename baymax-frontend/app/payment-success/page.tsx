"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { dataService, authService } from "@/lib/api";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
    CheckCircle, Package, ArrowLeft, Mail, MessageSquare,
    Loader2, ShoppingBag, CreditCard, User, Phone,
    ChevronRight, ArrowRight, Clock
} from "lucide-react";
import Link from "next/link";

interface OrderInfo {
    razorpay_order_id: string;
    order_number: string | null;
    payment_id: string | null;
    payment_status: string | null;
    status: string | null;
    total_amount: number;
    user_name: string | null;
    user_email: string | null;
    user_phone: string | null;
    email_sent: boolean;
    sms_sent: boolean;
    items: Array<{
        id: string;
        order_number: string;
        drug_name: string;
        quantity: number;
        unit_price: number;
        total_price: number;
        ordered_at: string;
    }>;
}

export default function PaymentSuccessPage() {
    return (
        <ProtectedRoute>
            <PaymentSuccessContent />
        </ProtectedRoute>
    );
}

function PaymentSuccessContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [order, setOrder] = useState<OrderInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const razorpayOrderId = searchParams.get("razorpay_order_id") || searchParams.get("order_id") || "";
    const paymentId = searchParams.get("payment_id") || "";

    useEffect(() => {
        if (!razorpayOrderId) {
            setError("No order ID found");
            setLoading(false);
            return;
        }

        let attempts = 0;
        const maxAttempts = 8;

        const fetchOrder = async () => {
            attempts++;
            try {
                const data = await dataService.getOrderByRazorpayId(razorpayOrderId);
                setOrder(data);
                setLoading(false);
            } catch (err: any) {
                if (attempts < maxAttempts) {
                    // Retry — backend might still be processing notifications
                    setTimeout(fetchOrder, 2000);
                } else {
                    setError("Could not load order details");
                    setLoading(false);
                }
            }
        };

        fetchOrder();
    }, [razorpayOrderId]);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
                    <Loader2 size={40} className="animate-spin text-emerald-600 mx-auto mb-4" />
                    <p className="text-slate-600 font-medium">Loading order details...</p>
                </motion.div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[#fafbfc] flex items-center justify-center p-4">
                <div className="text-center max-w-md">
                    <div className="w-20 h-20 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-6">
                        <Package size={36} />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h2>
                    <p className="text-slate-500 mb-6">{error}</p>
                    <Link href="/upload-prescription" className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-emerald-800 transition-colors">
                        <ArrowLeft size={16} /> Back to Prescriptions
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#fafbfc] text-slate-900 font-sans relative">
            {/* Background blobs */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50 rounded-full blur-[120px] opacity-60" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] bg-teal-50 rounded-full blur-[100px] opacity-40" />
            </div>

            <div className="relative z-10 max-w-2xl mx-auto px-4 py-8 md:py-16">

                {/* Success Header */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className="text-center mb-10"
                >
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 12 }}
                        className="w-24 h-24 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-6"
                    >
                        <CheckCircle size={48} />
                    </motion.div>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 mb-3">
                        Payment Successful!
                    </h1>
                    <p className="text-lg text-slate-500 font-medium max-w-md mx-auto">
                        Your medicines have been ordered. We&apos;ll prepare and deliver them soon.
                    </p>
                </motion.div>

                {/* Order Details Card */}
                {order && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="bg-white rounded-[28px] border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden mb-6"
                    >
                        {/* Order header */}
                        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
                            <div className="flex items-center justify-between flex-wrap gap-3">
                                <div>
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">Order Number</span>
                                    <span className="text-lg font-bold text-slate-900">{order.order_number || "Processing..."}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold uppercase tracking-wide">
                                        {order.payment_status === "paid" ? "Paid" : order.payment_status || "Confirmed"}
                                    </span>
                                    <span className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-xl text-xs font-bold uppercase tracking-wide">
                                        {order.status || "Confirmed"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Order items */}
                        <div className="px-8 py-6">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Order Items</h3>
                            <div className="flex flex-col gap-3">
                                {order.items?.map((item, i) => (
                                    <div key={i} className="flex items-center justify-between py-3 px-4 rounded-2xl bg-slate-50 border border-slate-100">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                                                <Package size={18} />
                                            </div>
                                            <div>
                                                <p className="font-bold text-slate-900 text-sm">{item.drug_name}</p>
                                                <p className="text-xs text-slate-500 font-medium">
                                                    Qty: {item.quantity} × ₹{item.unit_price?.toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="font-bold text-slate-900 text-sm">
                                            ₹{(item.total_price || (item.quantity * item.unit_price))?.toFixed(2)}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Total */}
                            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                                <span className="text-sm font-bold text-slate-500 uppercase tracking-wide">Total Paid</span>
                                <span className="text-2xl font-bold text-emerald-600">₹{order.total_amount?.toFixed(2)}</span>
                            </div>
                        </div>

                        {/* Payment info */}
                        <div className="px-8 py-5 bg-slate-50/50 border-t border-slate-100">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="flex items-center gap-3">
                                    <CreditCard size={16} className="text-slate-400" />
                                    <div>
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Payment ID</span>
                                        <span className="text-xs font-mono text-slate-700">{order.payment_id || paymentId || "Processing..."}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <User size={16} className="text-slate-400" />
                                    <div>
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Ordered By</span>
                                        <span className="text-xs font-medium text-slate-700">{order.user_name}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Notification status */}
                        <div className="px-8 py-5 border-t border-slate-100">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Notifications</h4>
                            <div className="flex items-center gap-4 flex-wrap">
                                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${order.email_sent ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-400 border border-slate-200"}`}>
                                    <Mail size={14} />
                                    {order.email_sent ? "Email Sent" : "Email Sending..."}
                                </div>
                                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${order.sms_sent ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-400 border border-slate-200"}`}>
                                    <MessageSquare size={14} />
                                    {order.sms_sent ? "SMS Sent" : "SMS Sending..."}
                                </div>
                                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-green-50 text-green-700 border border-green-200">
                                    <Phone size={14} />
                                    WhatsApp Sent
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Delivery info */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-[28px] border border-blue-100 p-8 mb-6"
                >
                    <div className="flex items-center gap-3 mb-3">
                        <Clock size={20} className="text-blue-600" />
                        <h3 className="text-base font-bold text-blue-900">Estimated Delivery</h3>
                    </div>
                    <p className="text-sm text-blue-700 font-medium leading-relaxed">
                        Your medicines will be prepared and dispatched within <strong>2-4 hours</strong>.
                        You&apos;ll receive delivery updates via WhatsApp and SMS.
                    </p>
                </motion.div>

                {/* Action buttons */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="flex flex-col sm:flex-row gap-3"
                >
                    <Link href="/dashboard" className="flex-1 px-6 py-4 bg-slate-900 text-white rounded-2xl font-bold text-sm hover:bg-emerald-800 transition-colors shadow-sm flex items-center justify-center gap-2">
                        <ArrowRight size={16} /> Go to Dashboard
                    </Link>
                    <Link href="/upload-prescription" className="flex-1 px-6 py-4 bg-white text-slate-700 rounded-2xl font-bold text-sm hover:bg-slate-50 transition-colors border border-slate-200 flex items-center justify-center gap-2">
                        <ShoppingBag size={16} /> Upload Another Prescription
                    </Link>
                </motion.div>

                {/* Footer note */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.7 }}
                    className="text-center text-xs text-slate-400 font-medium mt-8"
                >
                    Need help? Chat with BayMax AI or contact us via WhatsApp.
                </motion.p>
            </div>
        </div>
    );
}
