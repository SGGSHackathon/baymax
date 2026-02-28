"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
    LayoutDashboard,
    Database,
    TrendingUp,
    Bell,
    AlertTriangle,
    ArrowLeft,
    ChevronRight,
    Menu,
    X,
} from "lucide-react";
import { useState } from "react";

const NAV_ITEMS = [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
    { label: "Tables", href: "/admin/tables", icon: Database },
    { label: "Stock Forecast", href: "/admin/stock", icon: TrendingUp },
    { label: "Refill Alerts", href: "/admin/refills", icon: Bell },
    { label: "Expiry Risk", href: "/admin/expiry", icon: AlertTriangle },
];

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
    const pathname = usePathname();

    return (
        <aside
            className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-white/80 backdrop-blur-xl border-r border-slate-200/60 transition-all duration-300 ${
                collapsed ? "w-[72px]" : "w-[260px]"
            }`}
        >
            {/* Header */}
            <div className="h-20 flex items-center px-4 border-b border-slate-100 gap-3">
                <Link href="/admin" className="flex items-center gap-3 min-w-0">
                    <Image
                        src="/baymax-logo.png"
                        alt="Baymax"
                        width={42}
                        height={42}
                        className="w-[42px] h-[42px] object-contain flex-shrink-0"
                    />
                    {!collapsed && (
                        <motion.div
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex flex-col min-w-0"
                        >
                            <span
                                className="text-base tracking-tight text-slate-900 uppercase leading-none"
                                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                            >
                                Baymax
                            </span>
                            <span
                                className="text-[9px] text-emerald-600 uppercase tracking-[0.2em] mt-0.5"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                            >
                                Admin Panel
                            </span>
                        </motion.div>
                    )}
                </Link>
            </div>

            {/* Nav */}
            <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
                {NAV_ITEMS.map((item) => {
                    const isActive =
                        item.href === "/admin"
                            ? pathname === "/admin"
                            : pathname.startsWith(item.href);
                    return (
                        <Link key={item.href} href={item.href}>
                            <motion.div
                                whileHover={{ x: 2 }}
                                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                                    isActive
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-transparent"
                                }`}
                            >
                                <item.icon
                                    size={20}
                                    strokeWidth={isActive ? 2 : 1.5}
                                    className={`flex-shrink-0 ${isActive ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-600"}`}
                                />
                                {!collapsed && (
                                    <span
                                        className="text-sm truncate"
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: isActive ? 600 : 500 }}
                                    >
                                        {item.label}
                                    </span>
                                )}
                                {!collapsed && isActive && (
                                    <ChevronRight size={14} className="ml-auto text-emerald-400" />
                                )}
                            </motion.div>
                        </Link>
                    );
                })}
            </nav>

            {/* Back to app */}
            <div className="px-3 pb-4 border-t border-slate-100 pt-3">
                <Link href="/dashboard">
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all">
                        <ArrowLeft size={18} strokeWidth={1.5} className="flex-shrink-0" />
                        {!collapsed && (
                            <span
                                className="text-xs uppercase tracking-widest"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                            >
                                Back to App
                            </span>
                        )}
                    </div>
                </Link>
            </div>

            {/* Toggle */}
            <button
                onClick={onToggle}
                className="absolute -right-3 top-24 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-all z-50"
            >
                <ChevronRight size={12} className={`transition-transform ${collapsed ? "" : "rotate-180"}`} />
            </button>
        </aside>
    );
}

/* ── Mobile top bar ── */
function MobileHeader({ onOpen }: { onOpen: () => void }) {
    return (
        <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-16 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 flex items-center px-4 gap-3">
            <button onClick={onOpen} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
                <Menu size={20} />
            </button>
            <Image src="/baymax-logo.png" alt="Baymax" width={32} height={32} className="w-8 h-8 object-contain" />
            <span
                className="text-sm tracking-tight text-slate-900 uppercase"
                style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
            >
                Admin
            </span>
        </div>
    );
}

/* ── Mobile drawer ── */
function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const pathname = usePathname();

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/30 z-50 lg:hidden"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ x: -280 }}
                        animate={{ x: 0 }}
                        exit={{ x: -280 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-y-0 left-0 w-[280px] bg-white z-50 lg:hidden shadow-2xl"
                    >
                        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                                <Image src="/baymax-logo.png" alt="Baymax" width={32} height={32} className="w-8 h-8" />
                                <span
                                    className="text-sm text-slate-900 uppercase"
                                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                                >
                                    Admin
                                </span>
                            </div>
                            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100">
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>
                        <nav className="py-4 px-3 space-y-1">
                            {NAV_ITEMS.map((item) => {
                                const isActive =
                                    item.href === "/admin"
                                        ? pathname === "/admin"
                                        : pathname.startsWith(item.href);
                                return (
                                    <Link key={item.href} href={item.href} onClick={onClose}>
                                        <div
                                            className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${
                                                isActive
                                                    ? "bg-emerald-50 text-emerald-700"
                                                    : "text-slate-500 hover:bg-slate-50"
                                            }`}
                                        >
                                            <item.icon size={20} strokeWidth={isActive ? 2 : 1.5} />
                                            <span
                                                className="text-sm"
                                                style={{ fontFamily: "var(--font-poppins)", fontWeight: isActive ? 600 : 500 }}
                                            >
                                                {item.label}
                                            </span>
                                        </div>
                                    </Link>
                                );
                            })}
                        </nav>
                        <div className="px-3 border-t border-slate-100 pt-3">
                            <Link href="/dashboard" onClick={onClose}>
                                <div className="flex items-center gap-3 px-3 py-3 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-600">
                                    <ArrowLeft size={18} />
                                    <span
                                        className="text-xs uppercase tracking-widest"
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                                    >
                                        Back to App
                                    </span>
                                </div>
                            </Link>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <div className="min-h-screen bg-[#f8fafc] text-slate-900">
            {/* Soft bg blurs */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-100/30 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-teal-100/30 rounded-full blur-[120px]" />
            </div>

            {/* Desktop sidebar */}
            <div className="hidden lg:block">
                <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
            </div>

            {/* Mobile */}
            <MobileHeader onOpen={() => setMobileOpen(true)} />
            <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />

            {/* Main content */}
            <main
                className={`transition-all duration-300 min-h-screen ${
                    collapsed ? "lg:ml-[72px]" : "lg:ml-[260px]"
                } pt-16 lg:pt-0`}
            >
                <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
