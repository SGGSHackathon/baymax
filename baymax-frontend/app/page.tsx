"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Pill,
  FlaskConical,
  Stethoscope,
  Syringe,
  Thermometer,
  BriefcaseMedical,
  ChevronRight,
  ShieldCheck,
  Languages,
  Zap,
  Activity,
  HeartPulse,
  Database,
  Globe,
  Lock,
  MessageSquare,
  Microscope,
  Baby,
  Sticker,
} from "lucide-react";
import React from "react";

const FloatingDoodle = ({
  children,
  top,
  left,
  delay = 0,
  scale = 1,
}: {
  children: React.ReactNode;
  top: string;
  left: string;
  delay?: number;
  scale?: number;
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0 }}
    animate={{
      y: [0, -20, 0],
      x: [0, 10, 0],
      rotate: [0, 5, -5, 0],
      opacity: 0.5,
      scale: scale,
    }}
    transition={{
      duration: 8,
      repeat: Infinity,
      ease: "easeInOut",
      delay: delay,
      opacity: { duration: 1.5 },
    }}
    style={{ top, left }}
    className="absolute pointer-events-none z-0 text-emerald-400 select-none"
  >
    {children}
  </motion.div>
);

export default function Home() {
  const icons = [
    { Icon: Pill, top: "12%", left: "8%", delay: 0, scale: 1 },
    { Icon: FlaskConical, top: "18%", left: "82%", delay: 1, scale: 0.9 },
    { Icon: Stethoscope, top: "72%", left: "12%", delay: 2, scale: 1.1 },
    { Icon: Syringe, top: "78%", left: "78%", delay: 3, scale: 1 },
    { Icon: Thermometer, top: "8%", left: "55%", delay: 4, scale: 0.8 },
    { Icon: BriefcaseMedical, top: "58%", left: "88%", delay: 0.5, scale: 0.95 },
    { Icon: HeartPulse, top: "38%", left: "4%", delay: 1.5, scale: 1.1 },
    { Icon: Activity, top: "82%", left: "42%", delay: 2.5, scale: 0.85 },
    { Icon: Database, top: "48%", left: "84%", delay: 3.5, scale: 1 },
    { Icon: Globe, top: "4%", left: "28%", delay: 4.5, scale: 0.9 },
    { Icon: Lock, top: "88%", left: "22%", delay: 5, scale: 0.8 },
    { Icon: MessageSquare, top: "28%", left: "18%", delay: 5.5, scale: 1 },
    { Icon: Microscope, top: "45%", left: "92%", delay: 2.2, scale: 0.9 },
    { Icon: Baby, top: "62%", left: "6%", delay: 3.1, scale: 1 },
    { Icon: Sticker, top: "22%", left: "40%", delay: 1.8, scale: 0.8 },
  ];

  return (
    <main className="min-h-screen bg-transparent text-slate-900 font-sans selection:bg-emerald-100 relative overflow-hidden flex flex-col items-center justify-center p-6">
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/80 via-teal-50/40 to-white" />
        <div className="absolute top-[-20%] left-[10%] w-[60%] h-[50%] bg-emerald-100/50 rounded-full blur-[140px]" />
        <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] bg-teal-100/40 rounded-full blur-[120px]" />
        <div className="absolute bottom-[10%] left-[30%] w-[50%] h-[30%] bg-emerald-50/30 rounded-full blur-[100px]" />
      </div>

      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        {icons.map((item, idx) => (
          <FloatingDoodle key={idx} top={item.top} left={item.left} delay={item.delay} scale={item.scale}>
            <item.Icon size={32} strokeWidth={2} />
          </FloatingDoodle>
        ))}
      </div>

      <motion.nav
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="fixed top-0 left-0 right-0 z-50 h-20 px-8 md:px-16 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Image src="/baymax-logo.png" alt="Baymax" width={56} height={56} className="w-14 h-14 object-contain" />
          <span className="text-xl font-black tracking-tight text-slate-900 uppercase">Baymax</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/login" className="text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors hidden sm:block">
            Login
          </Link>
          <Link href="/signup" className="text-xs font-black bg-slate-900 text-white px-7 py-3 rounded-full hover:bg-emerald-600 transition-all shadow-xl shadow-slate-900/10 active:scale-95">
            START NOW
          </Link>
        </div>
      </motion.nav>

      <div className="relative z-10 max-w-4xl w-full flex flex-col items-center text-center mt-[110px]">

        <div className="mb-14">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-7xl md:text-[130px] font-black tracking-tighter leading-[0.8] text-slate-900 flex flex-col items-center"
          >
            <span style={{ fontFamily: "var(--font-gilroy)", fontWeight: 900, letterSpacing: "-2px", paddingBottom: "21px" }}>BAYMAX</span>
            <span
              className="text-emerald-600 md:-mt-4 text-5xl md:text-[85px]"
              style={{ fontFamily: "var(--font-poppins)", textTransform: "none", fontWeight: 500 }}
            >
              Autonoma Pharma OS
            </span>
          </motion.h1>

          <p className="text-slate-500 text-lg md:text-xl max-w-2xl mx-auto text-center font-medium mb-12 leading-relaxed">
            The production-ready clinical orchestrator. <br className="hidden md:block" />
            Empowering pharmacies with multi-agent AI.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex items-center justify-center w-full mb-24"
        >
          <Link
            href="/signup"
            className="group bg-slate-900 text-white font-black px-12 py-5 rounded-3xl hover:bg-emerald-600 transition-all text-xl flex items-center justify-center gap-3 shadow-2xl shadow-slate-900/20 active:scale-[0.97]"
          >
            Get Started <ChevronRight size={22} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full"
        >
          {[
            { icon: ShieldCheck, title: "CLINICAL", value: "Safety First" },
            { icon: Languages, title: "INDIAN", value: "12+ Dialects" },
            { icon: Zap, title: "ENGINE", value: "LangGraph V6" },
            { icon: Activity, title: "CARE", value: "Proactive" },
          ].map((item, idx) => (
            <div key={idx} className="flex flex-col items-center gap-2 p-6 rounded-[2rem] bg-white/60 border border-slate-100 shadow-sm backdrop-blur-sm hover:translate-y-[-4px] transition-transform cursor-default">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 mb-2">
                <item.icon size={22} strokeWidth={2.5} />
              </div>
              <h3 className="font-black text-[9px] uppercase tracking-widest text-slate-400">{item.title}</h3>
              <p className="font-bold text-slate-900 text-sm">{item.value}</p>
            </div>
          ))}
        </motion.div>
      </div>

      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-32 w-full max-w-5xl border-t border-slate-100 pt-10 flex flex-col md:flex-row justify-between items-center gap-6 text-slate-400 font-black text-[9px] tracking-[0.25em] uppercase"
      >
        <p>© 2026 BAYMAX PHARMACEUTICAL SYSTEMS</p>
        <div className="flex items-center gap-10">
          <span className="text-emerald-600/80">HIPAA COMPLIANT</span>
          <span className="hidden md:inline">NODE STATUS: ACTIVE</span>
        </div>
      </motion.footer>
    </main>
  );
}
