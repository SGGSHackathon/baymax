"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
    LayoutDashboard,
    Pill,
    Package,
    FileText,
    ShoppingCart,
    ArrowLeft,
    LogOut,
    UserCircle,
    ChevronRight,
} from "lucide-react";

const NAV_ITEMS = [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
    { label: "Medicines", href: "/admin/medicines", icon: Pill },
    { label: "Inventory", href: "/admin/inventory", icon: Package },
    { label: "Prescriptions", href: "/admin/prescriptions", icon: FileText },
    { label: "Orders", href: "/admin/orders", icon: ShoppingCart },
];

function AdminShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user: profile, logout } = useAuth();

    const handleLogout = () => {
        logout();
        router.push("/");
    };

    const isActive = (href: string) => {
        if (href === "/admin") return pathname === "/admin";
        return pathname.startsWith(href);
    };

    return (
        <div className="min-h-screen bg-transparent text-slate-900 flex flex-col font-sans relative selection:bg-emerald-100">
            {/* ── Gradient background (same as landing & chat) ── */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/80 via-teal-50/40 to-white" />
                <div className="absolute top-[-20%] left-[10%] w-[60%] h-[50%] bg-emerald-100/50 rounded-full blur-[140px]" />
                <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] bg-teal-100/40 rounded-full blur-[120px]" />
                <div className="absolute bottom-[10%] left-[30%] w-[50%] h-[30%] bg-emerald-50/30 rounded-full blur-[100px]" />
            </div>

            {/* ── Top Navbar (same as user dashboard) ── */}
            <motion.nav
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="h-20 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 flex items-center justify-between px-6 md:px-12 z-30 sticky top-0"
            >
                <div className="flex items-center gap-4">
                    <Link href="/admin" className="flex items-center gap-3">
                        <Image src="/baymax-logo.png" alt="Baymax" width={59} height={59} className="w-[59px] h-[59px] object-contain" />
                        <span
                            className="text-xl tracking-tight text-slate-900 uppercase"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Baymax
                        </span>
                    </Link>
                    <span className="px-2.5 py-1 rounded-full bg-red-50 border border-red-100 text-red-500 text-[10px] font-black uppercase tracking-widest">
                        Admin
                    </span>
                </div>

                <div className="flex items-center gap-3 md:gap-5">
                    <Link
                        href="/dashboard"
                        className="group flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors text-sm hover:bg-emerald-50/60 px-3 py-2 rounded-xl border border-transparent hover:border-emerald-100"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                    >
                        <ArrowLeft size={16} />
                        <span className="hidden sm:inline">Patient View</span>
                    </Link>

                    <button
                        onClick={() => router.push("/profile")}
                        className="group flex items-center gap-3 hover:bg-emerald-50/60 p-2 pr-4 rounded-2xl transition-all border border-transparent hover:border-emerald-100"
                    >
                        <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-sm group-hover:scale-105 transition-transform">
                            <UserCircle size={22} strokeWidth={1.5} />
                        </div>
                        <div className="hidden sm:flex flex-col items-start text-left">
                            <span
                                className="text-sm text-slate-900 leading-none mb-1 group-hover:text-emerald-600 transition-colors"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 600 }}
                            >
                                {profile?.name || "Admin"}
                            </span>
                            <span
                                className="text-[10px] text-slate-400 uppercase tracking-widest leading-none"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                            >
                                Super Admin
                            </span>
                        </div>
                    </button>

                    <button
                        onClick={handleLogout}
                        className="group h-10 w-10 hover:w-[110px] rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center gap-0 hover:gap-2 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200 transition-all duration-300 ease-in-out shadow-sm overflow-hidden"
                        title="Log out"
                    >
                        <LogOut size={16} className="flex-shrink-0" />
                        <span
                            className="whitespace-nowrap text-xs font-bold uppercase tracking-wider max-w-0 group-hover:max-w-[60px] overflow-hidden transition-all duration-300 ease-in-out opacity-0 group-hover:opacity-100"
                            style={{ fontFamily: "var(--font-poppins)" }}
                        >
                            Logout
                        </span>
                    </button>
                </div>
            </motion.nav>

            {/* Sidebar + Content */}
            <div className="flex flex-1">
                {/* ── Sidebar ── */}
                <motion.aside
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="w-64 shrink-0 bg-white/60 backdrop-blur-xl border-r border-slate-200/60 hidden md:flex flex-col py-8 sticky top-20 h-[calc(100vh-5rem)]"
                >
                    <div className="px-6 mb-6">
                        <span
                            className="text-[10px] uppercase tracking-[0.2em] text-slate-400"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Navigation
                        </span>
                    </div>

                    <nav className="flex-1 px-4 space-y-1.5">
                        {NAV_ITEMS.map((item, idx) => {
                            const active = isActive(item.href);
                            return (
                                <motion.div
                                    key={item.href}
                                    initial={{ opacity: 0, x: -12 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.35, delay: 0.15 + idx * 0.06 }}
                                >
                                    <Link
                                        href={item.href}
                                        className={`group flex items-center gap-3 px-4 py-3 rounded-2xl text-sm transition-all duration-200 ${
                                            active
                                                ? "bg-emerald-50 text-emerald-700 border border-emerald-100 shadow-sm shadow-emerald-100/50"
                                                : "text-slate-500 hover:text-slate-900 hover:bg-white/80 border border-transparent hover:border-slate-100 hover:shadow-sm"
                                        }`}
                                        style={{ fontFamily: "var(--font-poppins)", fontWeight: active ? 700 : 500 }}
                                    >
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                                            active
                                                ? "bg-emerald-100 text-emerald-600"
                                                : "bg-slate-50 text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-500"
                                        }`}>
                                            <item.icon size={16} />
                                        </div>
                                        <span className="flex-1">{item.label}</span>
                                        {active && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                className="text-emerald-400"
                                            >
                                                <ChevronRight size={14} />
                                            </motion.div>
                                        )}
                                    </Link>
                                </motion.div>
                            );
                        })}
                    </nav>

                    <div className="px-6 pt-6 border-t border-slate-200/60 mt-auto">
                        <p
                            className="text-[9px] uppercase tracking-[0.25em] text-slate-300"
                            style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                        >
                            Baymax Admin v2.0
                        </p>
                    </div>
                </motion.aside>

                {/* ── Mobile Nav ── */}
                <div className="md:hidden sticky top-20 z-20 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 flex items-center gap-1.5 px-4 py-2.5 overflow-x-auto">
                    {NAV_ITEMS.map((item) => {
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs whitespace-nowrap transition-all ${
                                    active
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100 shadow-sm"
                                        : "text-slate-400 hover:text-slate-700 border border-transparent"
                                }`}
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: active ? 700 : 500 }}
                            >
                                <item.icon size={14} />
                                {item.label}
                            </Link>
                        );
                    })}
                </div>

                {/* ── Main Content ── */}
                <main className="flex-1 p-6 lg:p-10 z-10 min-w-0 overflow-x-hidden">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={pathname}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        >
                            {children}
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>
        </div>
    );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <AdminShell>{children}</AdminShell>
    );
}
