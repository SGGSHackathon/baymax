"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
    LayoutDashboard,
    Pill,
    Package,
    FileText,
    ShoppingCart,
    ArrowLeft,
    ShieldAlert,
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

    const isActive = (href: string) => {
        if (href === "/admin") return pathname === "/admin";
        return pathname.startsWith(href);
    };

    return (
        <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans relative selection:bg-emerald-100">
            {/* Soft background blurs */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-100/40 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-teal-100/40 rounded-full blur-[120px]" />
            </div>

            {/* Top Navigation Bar */}
            <nav className="h-16 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 flex items-center justify-between px-6 z-30 sticky top-0">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center text-red-500 border border-red-100">
                        <ShieldAlert size={16} />
                    </div>
                    <span
                        className="text-lg tracking-tight text-slate-900 uppercase"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Baymax
                    </span>
                    <span className="uppercase text-[10px] tracking-widest text-red-500 font-black">Admin</span>
                </div>

                <Link
                    href="/dashboard"
                    className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors text-sm font-bold"
                >
                    <ArrowLeft size={16} /> Patient View
                </Link>
            </nav>

            {/* Sidebar + Content */}
            <div className="flex flex-1">
                {/* Sidebar */}
                <aside className="w-60 shrink-0 bg-white/60 backdrop-blur-xl border-r border-slate-200/60 hidden md:flex flex-col py-6 sticky top-16 h-[calc(100vh-4rem)]">
                    <div className="px-5 mb-4">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                            Navigation
                        </span>
                    </div>

                    <nav className="flex-1 px-3 space-y-1">
                        {NAV_ITEMS.map((item) => {
                            const active = isActive(item.href);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                                        active
                                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                            : "text-slate-500 hover:text-slate-900 hover:bg-slate-50 border border-transparent"
                                    }`}
                                >
                                    <item.icon size={18} className={active ? "text-emerald-600" : "text-slate-400"} />
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="px-5 pt-4 border-t border-slate-200/60 mt-auto">
                        <div className="text-[10px] uppercase font-bold tracking-widest text-slate-300">
                            Baymax Health Admin v2
                        </div>
                    </div>
                </aside>

                {/* Mobile Nav */}
                <div className="md:hidden sticky top-16 z-20 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 flex items-center gap-1 px-4 py-2 overflow-x-auto">
                    {NAV_ITEMS.map((item) => {
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                                    active
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                        : "text-slate-400 hover:text-slate-700 border border-transparent"
                                }`}
                            >
                                <item.icon size={14} />
                                {item.label}
                            </Link>
                        );
                    })}
                </div>

                {/* Main Content */}
                <main className="flex-1 p-6 lg:p-8 z-10 min-w-0 overflow-x-hidden">
                    {children}
                </main>
            </div>
        </div>
    );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <ProtectedRoute>
            <AdminShell>{children}</AdminShell>
        </ProtectedRoute>
    );
}
