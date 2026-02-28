"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ShieldCheck, ChevronRight } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#fafbfc] text-[#1a1f24] selection:bg-emerald-100 font-sans relative flex flex-col">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50 rounded-full blur-[120px] opacity-60" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] bg-teal-50 rounded-full blur-[100px] opacity-40" />
      </div>

      {/* Navbar - Visible only on landing page */}
      <nav className="relative z-20 h-20 px-8 md:px-12 flex items-center justify-between border-b border-slate-200/50 bg-white/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white text-[12px] font-black shadow-md">BX</div>
          <span className="text-xl font-bold tracking-tight text-slate-900">Baymax <span className="text-emerald-600">Assistant</span></span>
        </div>
      </nav>

      {/* Centered Hero Section */}
      <div className="flex-1 relative z-10 flex flex-col items-center justify-center px-6 py-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-3xl mx-auto flex flex-col items-center"
        >
          <div className="inline-flex items-center gap-2 mb-8 px-4 py-2 rounded-full bg-emerald-100/50 text-emerald-800 text-xs font-semibold tracking-wider uppercase border border-emerald-200/50 shadow-sm">
            <ShieldCheck className="w-4 h-4" /> Clinical Safety Engine Active
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900 mb-6 leading-tight">
            Your personal <br />
            <span className="text-emerald-600">AI Pharmacist</span>
          </h1>

          <p className="text-slate-500 text-lg md:text-xl max-w-2xl font-medium mb-12 leading-relaxed">
            Experience next-generation healthcare with real-time proactive care, intelligent drug safety, and personalized clinical guidance.
          </p>

          {/* Centered Auth Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            <Link
              href="/signup"
              className="w-full sm:w-auto inline-flex justify-center items-center gap-2 bg-emerald-600 text-white font-bold px-10 py-4 rounded-2xl hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-600/20 active:scale-95 text-lg"
            >
              Sign Up <ChevronRight className="w-5 h-5" />
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex justify-center items-center gap-2 bg-white text-slate-900 font-bold px-10 py-4 rounded-2xl border-2 border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/50 transition-all shadow-sm active:scale-95 text-lg"
            >
              Log In
            </Link>
          </div>
        </motion.div>
      </div>

      <footer className="relative z-10 py-8 text-center text-slate-400 font-medium text-sm">
        <p>© 2026 Baymax Pharmaceutical Systems. HIPAA Compliant.</p>
      </footer>
    </main>
  );
}
