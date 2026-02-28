"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
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
    Phone,
    HeartPulse,
    FlaskConical,
    Syringe,
    Thermometer,
    BriefcaseMedical,
    Microscope,
} from "lucide-react";
import Link from "next/link";
import React from "react";

/* ── Floating medical doodles (same style as landing page) ── */
const FloatingDoodle = ({
    children, top, left, delay = 0, scale = 1,
}: {
    children: React.ReactNode; top: string; left: string; delay?: number; scale?: number;
}) => (
    <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{
            y: [0, -18, 0], x: [0, 8, 0], rotate: [0, 4, -4, 0],
            opacity: 0.25, scale,
        }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay, opacity: { duration: 2 } }}
        style={{ top, left }}
        className="absolute pointer-events-none z-0 text-emerald-300 select-none"
    >
        {children}
    </motion.div>
);

const doodles = [
    { Icon: Pill, top: "10%", left: "5%", delay: 0, scale: 0.9 },
    { Icon: FlaskConical, top: "15%", left: "90%", delay: 1.2, scale: 0.8 },
    { Icon: Stethoscope, top: "75%", left: "8%", delay: 2, scale: 1 },
    { Icon: Syringe, top: "80%", left: "85%", delay: 3, scale: 0.85 },
    { Icon: Thermometer, top: "6%", left: "50%", delay: 4, scale: 0.7 },
    { Icon: BriefcaseMedical, top: "55%", left: "92%", delay: 0.6, scale: 0.9 },
    { Icon: HeartPulse, top: "40%", left: "3%", delay: 1.8, scale: 1 },
    { Icon: Microscope, top: "85%", left: "40%", delay: 2.8, scale: 0.8 },
];

/* ── Card shimmer border on hover ── */
const cardVariants = {
    rest: { scale: 1, y: 0 },
    hover: { scale: 1.025, y: -6, transition: { type: "spring" as const, stiffness: 300, damping: 20 } },
};

const iconVariants = {
    rest: { rotate: 0 },
    hover: { rotate: [0, -8, 8, 0], transition: { duration: 0.5 } },
};

const arrowVariants = {
    rest: { x: 0 },
    hover: { x: 4, transition: { type: "spring" as const, stiffness: 400 } },
};

function DashboardContent() {
    const router = useRouter();
    const { user: profile, logout } = useAuth();

    const handleLogout = async () => {
        await logout();
        router.push("/");
    };

    const firstName = profile?.name?.split(" ")[0] || "there";

    const cards = [
        {
            title: "Web Assistant",
            icon: <MessageSquare size={32} strokeWidth={1.8} />,
            href: "/chat",
            gradient: "from-emerald-500 via-emerald-600 to-teal-600",
            lightBg: "bg-emerald-50",
            lightText: "text-emerald-600",
            shadow: "shadow-emerald-500/20",
            description: "Chat with our intelligent clinical assistant directly on the website.",
            features: [
                { icon: <Pill size={15} />, text: "Detailed medication insights" },
                { icon: <Stethoscope size={15} />, text: "Instant symptom triage" },
                { icon: <Globe size={15} />, text: "Full multilingual support" },
            ],
            isExternal: false,
        },
        {
            title: "Upload Prescription",
            icon: <UploadCloud size={32} strokeWidth={1.8} />,
            href: "/upload-prescription",
            gradient: "from-teal-500 via-teal-600 to-cyan-500",
            lightBg: "bg-teal-50",
            lightText: "text-teal-600",
            shadow: "shadow-teal-500/20",
            description: "Digitize and analyze your medical prescriptions instantly.",
            features: [
                { icon: <FileText size={15} />, text: "Auto-digitization of records" },
                { icon: <ShieldAlert size={15} />, text: "Contraindication safety checks" },
                { icon: <Activity size={15} />, text: "Automated dosage reminders" },
            ],
            isExternal: false,
        },
        {
            title: "WhatsApp Agent",
            icon: <MessageCircle size={32} strokeWidth={1.8} />,
            href: "https://wa.me/911234567890",
            gradient: "from-emerald-500 via-green-500 to-teal-500",
            lightBg: "bg-emerald-50",
            lightText: "text-emerald-600",
            shadow: "shadow-emerald-500/20",
            description: "Get 24/7 pharmaceutical support directly on WhatsApp.",
            features: [
                { icon: <Phone size={15} />, text: "Conversational voice notes" },
                { icon: <MessageSquare size={15} />, text: "Lightning fast instant replies" },
                { icon: <Stethoscope size={15} />, text: "Seamless emergency escalation" },
            ],
            isExternal: true,
        },
    ];

    return (
        <div className="min-h-screen bg-[#f8fafc] text-slate-900 relative flex flex-col selection:bg-emerald-100">
            {/* ── Soft background blurs (matches landing) ── */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-100/40 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-teal-100/40 rounded-full blur-[120px]" />
                <div className="absolute top-[30%] right-[10%] w-[25%] h-[25%] bg-teal-100/30 rounded-full blur-[100px]" />
            </div>

            {/* ── Floating doodles ── */}
            <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
                {doodles.map((d, i) => (
                    <FloatingDoodle key={i} top={d.top} left={d.left} delay={d.delay} scale={d.scale}>
                        <d.Icon size={28} strokeWidth={1.5} />
                    </FloatingDoodle>
                ))}
            </div>

            {/* ── Navbar ── */}
            <motion.nav
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="h-20 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 flex items-center justify-between px-6 md:px-12 z-30 sticky top-0"
            >
                <Link href="/dashboard" className="flex items-center gap-3">
                    <Image src="/baymax-logo.png" alt="Baymax" width={59} height={59} className="w-[59px] h-[59px] object-contain" />
                    <span
                        className="text-xl tracking-tight text-slate-900 uppercase"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Baymax
                    </span>
                </Link>

                <div className="flex items-center gap-3 md:gap-5">
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
                                {profile?.name || "User Profile"}
                            </span>
                            <span
                                className="text-[10px] text-slate-400 uppercase tracking-widest leading-none"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                            >
                                Settings & Details
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

            {/* ── Main content ── */}
            <main className="flex-1 flex flex-col items-center pt-14 md:pt-20 pb-20 px-6 relative z-10 w-full max-w-7xl mx-auto">
                {/* Greeting */}
                <motion.div
                    initial={{ opacity: 0, y: -25 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="text-center mb-14 md:mb-20"
                >
                    <h1
                        className="text-4xl md:text-6xl tracking-tight text-slate-900 mb-5"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Welcome back,{" "}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">
                            {firstName}
                        </span>
                    </h1>
                    <p
                        className="text-slate-500 text-lg md:text-xl max-w-xl mx-auto"
                        style={{ fontFamily: "var(--font-poppins)", fontWeight: 400 }}
                    >
                        How would you like to interact with <strong>Baymax</strong> today?
                    </p>
                </motion.div>

                {/* Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-7 w-full max-w-6xl">
                    {cards.map((card, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 40 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.55, delay: 0.15 + idx * 0.12, ease: [0.22, 1, 0.36, 1] }}
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

            {/* ── Footer ── */}
            <motion.footer
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="w-full max-w-5xl mx-auto border-t border-slate-100 py-8 flex flex-col md:flex-row justify-between items-center gap-4 px-6 z-10"
            >
                <p
                    className="text-slate-400 text-[9px] tracking-[0.25em] uppercase"
                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                >
                    © 2026 BAYMAX PHARMACEUTICAL SYSTEMS
                </p>
                <div className="flex items-center gap-8">
                    <span
                        className="text-emerald-500/80 text-[9px] tracking-[0.25em] uppercase"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        HIPAA COMPLIANT
                    </span>
                    <span
                        className="hidden md:inline text-slate-400 text-[9px] tracking-[0.25em] uppercase"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        NODE STATUS: ACTIVE
                    </span>
                </div>
            </motion.footer>
        </div>
    );
}

/* ── Card component with rich hover animations ── */
function CardContent({ card }: { card: any }) {
    return (
        <motion.div
            variants={cardVariants}
            initial="rest"
            whileHover="hover"
            className={`group h-full bg-white/80 backdrop-blur-sm rounded-[28px] border border-slate-200/80 shadow-lg ${card.shadow} hover:shadow-2xl transition-shadow duration-500 overflow-hidden flex flex-col relative cursor-pointer`}
        >
            {/* Gradient top accent */}
            <div className={`h-1.5 w-full bg-gradient-to-r ${card.gradient} opacity-70 group-hover:opacity-100 transition-opacity duration-300`} />

            {/* Hover shimmer overlay */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none">
                <div className={`absolute -inset-1 bg-gradient-to-br ${card.gradient} opacity-[0.04] rounded-[28px]`} />
            </div>

            <div className="p-7 md:p-8 flex-1 flex flex-col relative z-10">
                {/* Icon + Arrow row */}
                <div className="flex items-start justify-between mb-6">
                    <motion.div
                        variants={iconVariants}
                        className={`w-16 h-16 rounded-2xl flex items-center justify-center ${card.lightBg} ${card.lightText} shadow-sm`}
                    >
                        {card.icon}
                    </motion.div>
                    <motion.div
                        variants={arrowVariants}
                        className="w-10 h-10 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300 group-hover:bg-slate-900 group-hover:text-white group-hover:border-slate-900 transition-colors duration-300"
                    >
                        <ChevronRight size={18} />
                    </motion.div>
                </div>

                {/* Title */}
                <h3
                    className="text-2xl tracking-tight text-slate-900 mb-2"
                    style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                >
                    {card.title}
                </h3>

                {/* Description */}
                <p
                    className="text-slate-500 leading-relaxed mb-6 text-[15px]"
                    style={{ fontFamily: "var(--font-poppins)", fontWeight: 400 }}
                >
                    {card.description}
                </p>

                {/* Features */}
                <div className="mt-auto pt-5 border-t border-slate-100/80">
                    <h4
                        className="text-[10px] text-slate-400 uppercase tracking-[0.2em] mb-4"
                        style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900 }}
                    >
                        Core Features
                    </h4>
                    <ul className="space-y-2.5">
                        {card.features.map((feature: any, i: number) => (
                            <motion.li
                                key={i}
                                initial={{ opacity: 0.7, x: -4 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="flex items-center gap-3 text-sm text-slate-600 group-hover:text-slate-800 transition-colors duration-300"
                                style={{ fontFamily: "var(--font-poppins)", fontWeight: 500 }}
                            >
                                <span className={`p-1.5 rounded-lg ${card.lightBg} ${card.lightText}`}>
                                    {feature.icon}
                                </span>
                                {feature.text}
                            </motion.li>
                        ))}
                    </ul>
                </div>
            </div>
        </motion.div>
    );
}

export default function DashboardPage() {
    return (
        // <ProtectedRoute>
            <DashboardContent />
        // </ProtectedRoute>
    );
}
