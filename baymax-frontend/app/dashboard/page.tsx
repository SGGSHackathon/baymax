"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
    LogOut,
    ShieldAlert,
    UserCircle,
    MessageSquare,
    UploadCloud,
    MessageCircle,
    ChevronRight,
    Activity,
    Pill,
    Stethoscope,
    FileText,
    Globe,
    Phone
} from "lucide-react";
import Link from "next/link";

function DashboardContent() {
    const router = useRouter();
    const { user: profile, logout } = useAuth();

    const handleLogout = async () => {
        await logout();
        router.push("/");
    };

    const cards = [
        {
            title: "Web Assistant",
            icon: <MessageSquare size={36} />,
            href: "/chat",
            colorClass: "from-emerald-500 to-teal-500",
            lightClass: "bg-emerald-50 text-emerald-600",
            description: "Chat with our intelligent clinical assistant directly on the website.",
            features: [
                { icon: <Pill size={16} />, text: "Detailed medication insights" },
                { icon: <Stethoscope size={16} />, text: "Instant symptom triage" },
                { icon: <Globe size={16} />, text: "Full multilingual support" }
            ],
            isExternal: false
        },
        {
            title: "Upload Prescription",
            icon: <UploadCloud size={36} />,
            href: "/upload-prescription",
            colorClass: "from-blue-500 to-indigo-500",
            lightClass: "bg-blue-50 text-blue-600",
            description: "Digitize and analyze your medical prescriptions instantly.",
            features: [
                { icon: <FileText size={16} />, text: "Auto-digitization of records" },
                { icon: <ShieldAlert size={16} />, text: "Contraindication safety checks" },
                { icon: <Activity size={16} />, text: "Automated dosage reminders" }
            ],
            isExternal: false
        },
        {
            title: "WhatsApp Agent",
            icon: <MessageCircle size={36} />,
            href: "https://wa.me/919309480956",
            colorClass: "from-green-500 to-emerald-600",
            lightClass: "bg-green-50 text-green-600",
            description: "Get 24/7 pharmaceutical support directly on WhatsApp.",
            features: [
                { icon: <Phone size={16} />, text: "Conversational voice notes" },
                { icon: <MessageSquare size={16} />, text: "Lightning fast instant replies" },
                { icon: <Stethoscope size={16} />, text: "Seamless emergency escalation" }
            ],
            isExternal: true
        }
    ];

    return (
        <div className="min-h-screen bg-[#fafbfc] text-slate-900 font-sans relative flex flex-col">
            {/* Decorative */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50 rounded-full blur-[120px] opacity-60" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] bg-teal-50 rounded-full blur-[100px] opacity-40" />
            </div>

            {/* Top Navigation */}
            <nav className="h-20 border-b border-slate-200 bg-white/80 backdrop-blur-xl flex items-center justify-between px-6 md:px-12 z-20 sticky top-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white text-[12px] font-black shadow-sm">BX</div>
                    <span className="font-bold tracking-tight text-xl text-slate-900">Baymax <span className="text-emerald-600">Assistant</span></span>
                </div>

                <div className="flex items-center gap-4 md:gap-6">
                    {/* Profile Section on Navbar */}
                    <button
                        onClick={() => router.push('/profile')}
                        className="group flex items-center gap-3 hover:bg-slate-50 p-2 pr-4 rounded-2xl transition-all border border-transparent hover:border-slate-200"
                    >
                        <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shadow-sm group-hover:scale-105 transition-transform">
                            <UserCircle size={22} strokeWidth={1.5} />
                        </div>
                        <div className="hidden sm:flex flex-col items-start text-left">
                            <span className="text-sm font-bold text-slate-900 leading-none mb-1 group-hover:text-emerald-700 transition-colors">{profile?.name || "User Profile"}</span>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Settings & Details</span>
                        </div>
                    </button>

                    <button
                        onClick={handleLogout}
                        className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shadow-sm"
                        title="Log out"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </nav>

            {/* Main Layout - Centered 3 Cards */}
            <main className="flex-1 flex flex-col items-center py-16 px-6 relative z-10 w-full max-w-7xl mx-auto">

                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center mb-16"
                >
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 mb-4">
                        Welcome back, <span className="text-emerald-600">{profile?.name?.split(' ')[0] || "there"}</span>
                    </h1>
                    <p className="text-slate-500 text-lg font-medium max-w-xl mx-auto">
                        How would you like to interact with your AI Pharmacist today?
                    </p>
                </motion.div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 w-full max-w-6xl">
                    {cards.map((card, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: idx * 0.1 }}
                        >
                            {card.isExternal ? (
                                <a href={card.href} target="_blank" rel="noopener noreferrer" className="block h-full">
                                    <CardContent card={card} />
                                </a>
                            ) : (
                                <Link href={card.href} className="block h-full">
                                    <CardContent card={card} />
                                </Link>
                            )}
                        </motion.div>
                    ))}
                </div>
            </main>
        </div>
    );
}

function CardContent({ card }: { card: any }) {
    return (
        <div className="group h-full bg-white rounded-[32px] border border-slate-200 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_20px_50px_rgb(0,0,0,0.08)] transition-all duration-500 overflow-hidden flex flex-col relative">

            {/* Top color accent */}
            <div className={`h-2 w-full bg-gradient-to-r ${card.colorClass} opacity-80 group-hover:opacity-100 transition-opacity`} />

            <div className="p-8 flex-1 flex flex-col">
                <div className="flex items-start justify-between mb-6">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm ${card.lightClass} group-hover:scale-110 transition-transform duration-500`}>
                        {card.icon}
                    </div>
                    <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-slate-900 group-hover:text-white transition-colors duration-300">
                        <ChevronRight size={20} className="group-hover:translate-x-0.5 transition-transform" />
                    </div>
                </div>

                <h3 className="text-2xl font-bold tracking-tight text-slate-900 mb-3 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-slate-900 group-hover:to-slate-600 transition-colors">
                    {card.title}
                </h3>

                <p className="text-slate-500 font-medium leading-relaxed mb-6">
                    {card.description}
                </p>

                {/* Features dropdown on hover (mostly hidden initially or shown subtly) */}
                <div className="mt-auto pt-6 border-t border-slate-100 h-[140px]">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Core Features</h4>
                    <ul className="space-y-3">
                        {card.features.map((feature: any, i: number) => (
                            <li key={i} className="flex items-center gap-3 text-sm font-semibold text-slate-600 transform translate-y-2 opacity-80 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300" style={{ transitionDelay: `${i * 50}ms` }}>
                                <span className={`p-1.5 rounded-lg ${card.lightClass} bg-opacity-50`}>
                                    {feature.icon}
                                </span>
                                {feature.text}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default function DashboardPage() {
    return (
        <ProtectedRoute>
            <DashboardContent />
        </ProtectedRoute>
    );
}
