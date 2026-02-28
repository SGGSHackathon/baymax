"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { dataService, authService } from "@/lib/api";
import ProtectedRoute from "@/components/ProtectedRoute";
import {
    UploadCloud, FileText, CheckCircle, AlertCircle, Loader2, ArrowLeft,
    Clock, Activity, Pill, ChevronRight, X, ChevronDown, Eye, ShoppingCart, Package
} from "lucide-react";
import Link from "next/link";

type UploadState = "idle" | "uploading" | "processing" | "completed" | "error";

// ── OCR helpers ──────────────────────────────────────────────

/** Extract the embedded base64 prescription image from Sarvam OCR markdown output */
function extractPrescriptionImage(rawText: string): string | null {
    if (!rawText) return null;
    const idx = rawText.indexOf('![');
    if (idx === -1) return null;
    const parenOpen = rawText.indexOf('(', idx);
    if (parenOpen === -1) return null;
    const dataStart = rawText.indexOf('data:image/', parenOpen);
    if (dataStart === -1 || dataStart - parenOpen > 10) return null;
    // base64 chars never contain ')' so indexOf is safe & fast
    const parenClose = rawText.indexOf(')', dataStart);
    if (parenClose === -1) return null;
    return rawText.slice(dataStart, parenClose);
}

interface RawMedicine {
    prefix: string;
    name: string;
    dosage: string;
    duration: string;
    source: "ocr_text" | "ocr_image_desc";
}

// Medicine abbreviation prefixes recognised across all strategies
const MED_PREFIXES = "T|Tab|Cap|Cp|Syp|Syr|Inj|Oint|Gel|Drop|Cream|Sus|Sol|Susp|Lotn|Lot";

/** Build a RawMedicine from a raw matched string + source tag */
function _buildMed(raw: string, source: RawMedicine["source"]): RawMedicine | null {
    const clean = raw.trim().replace(/[,;:\s]+$/, "").replace(/^[,;:\s]+/, "");
    if (clean.length < 3) return null;
    const prefix = clean.match(/^([A-Za-z]+\.?)/)?.[1] ?? "";
    const nums = clean.match(/\d+(?:\.\d+)?/g) ?? [];
    const dosageNum = nums[0] ? parseFloat(nums[0]) : 0;
    return {
        prefix,
        name: clean,
        dosage: nums[0] ? `${nums[0]}${dosageNum > 0 && dosageNum < 10000 ? " mg" : ""}` : "-",
        duration: nums.length > 1 ? `${nums[nums.length - 1]} days` : "-",
        source,
    };
}

/**
 * Multi-strategy OCR medicine extractor. Handles:
 *  S1 – Bold **T. Name 250** in LLM image descriptions
 *  S2 – Full-text standalone lines starting with T./Cap./Syp. etc. (no Rx gate)
 *  S3 – Comma/semicolon-separated inline lists of medicines in prose
 *  S4 – Inline mentions: "T. Azeel 250 and T. pacmol" inside sentences
 *  S5 – Strict Rx-gated lines (original fallback)
 */
function extractMedicinesFromOcrRaw(rawText: string): RawMedicine[] {
    if (!rawText) return [];
    const results: RawMedicine[] = [];
    const seen = new Set<string>();

    const addMed = (raw: string, src: RawMedicine["source"]) => {
        const m = _buildMed(raw, src);
        if (!m) return;
        const key = m.name.toLowerCase().replace(/\s+/g, " ").trim();
        if (seen.has(key)) return;
        seen.add(key);
        results.push(m);
    };

    // Strip large base64 blobs (avoids catastrophic backtracking)
    const cleanText = rawText.replace(/data:[A-Za-z0-9+/=]{50,}/g, "[BASE64]");

    // ── S1: Bold **T. Name 250** or **Tab. Name** in image descriptions ────────
    const boldRe = new RegExp(
        `\\*\\*((${MED_PREFIXES})\\s*\\.?\\s+[^*\\n]{2,60})\\*\\*`, "gi"
    );
    let m: RegExpExecArray | null;
    while ((m = boldRe.exec(cleanText)) !== null) addMed(m[1], "ocr_image_desc");

    // ── S2: Standalone whole-line medicine entries anywhere in the text ─────────
    //  e.g.  "T. Azeel 250" on its own line, "Cp. Migpan DSR" on its own line
    const lineRe = new RegExp(
        `^\\s*((?:${MED_PREFIXES})\\.?\\s+[A-Za-z][A-Za-z0-9 .\\-()]{1,55}?)\\s*$`, "gim"
    );
    while ((m = lineRe.exec(cleanText)) !== null) addMed(m[1], "ocr_text");

    // ── S3: Comma/semicolon-separated inline lists ──────────────────────────────
    //  Sarvam LLM desc often says: "T. Azeel 250, T. pacmol 650, cp. Migpan DSR"
    const listRe = new RegExp(
        `((?:${MED_PREFIXES})\\.?\\s+[A-Za-z][A-Za-z0-9 .\\-]{1,40}?)(?:[,;]|and\\s)`, "gi"
    );
    while ((m = listRe.exec(cleanText)) !== null) addMed(m[1], "ocr_image_desc");

    // ── S4: Inline medicine token anywhere in prose text ───────────────────────
    //  Catches "...transfer function T. Azeel 250 is prescribed..."
    const inlineRe = new RegExp(
        `\\b((?:${MED_PREFIXES})\\.\\s+[A-Za-z][A-Za-z0-9 .\\-]{1,40}?\\s+\\d[A-Za-z0-9 .]*?)(?=[,;.\\n\\)]|$)`, "gi"
    );
    while ((m = inlineRe.exec(cleanText)) !== null) addMed(m[1], "ocr_image_desc");

    // ── S5: Strict Rx-gated plain text lines (original strategy, last resort) ──
    const rxIdx = cleanText.search(/\bRx\.?\s*[\n:]/i);
    if (rxIdx !== -1) {
        const afterRx = cleanText.slice(rxIdx);
        const rxLineRe = new RegExp(
            `^((?:${MED_PREFIXES})\\.?)\\s+(.{2,60})$`, "gim"
        );
        while ((m = rxLineRe.exec(afterRx)) !== null) addMed(`${m[1]} ${m[2].trim()}`, "ocr_text");
    }

    return results;
}

export default function UploadPrescriptionPage() {
    return (
        <ProtectedRoute>
            <UploadContent />
        </ProtectedRoute>
    );
}

function UploadContent() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [file, setFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);

    const [status, setStatus] = useState<UploadState>("idle");
    const [errorMsg, setErrorMsg] = useState("");
    const [progress, setProgress] = useState(0);

    // Results
    const [prescriptionId, setPrescriptionId] = useState("");
    const [extractedData, setExtractedData] = useState<any>(null);
    const [processingStage, setProcessingStage] = useState("");
    const [showRawOcr, setShowRawOcr] = useState(false);

    // Order modal
    const [orderModal, setOrderModal] = useState<{ medicine: string; qty: number } | null>(null);
    const [orderResult, setOrderResult] = useState<{ loading: boolean; reply: string | null; error: string | null }>({ loading: false, reply: null, error: null });

    // Derived from extractedData
    const [prescriptionImage, setPrescriptionImage] = useState<string | null>(null);
    const [ocrMedicines, setOcrMedicines] = useState<RawMedicine[]>([]);

    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const STORAGE_KEY = "baymax_processing_rx";

    const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minute timeout for session key

    // Compute prescription image + OCR medicines whenever extractedData changes
    useEffect(() => {
        if (extractedData?.raw_extracted_text) {
            setPrescriptionImage(extractPrescriptionImage(extractedData.raw_extracted_text));
            setOcrMedicines(extractMedicinesFromOcrRaw(extractedData.raw_extracted_text));
        } else {
            setPrescriptionImage(null);
            setOcrMedicines([]);
        }
    }, [extractedData]);

    useEffect(() => {
        authService.getMe().then((u) => {
            setUser(u);
            // Check for in-progress prescription from before refresh
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (raw) {
                try {
                    const saved = JSON.parse(raw);
                    const elapsed = Date.now() - (saved.ts || 0);
                    if (saved.id && elapsed < SESSION_TTL_MS) {
                        setPrescriptionId(saved.id);
                        setStatus("processing");
                        setProgress(65);
                        setProcessingStage("Resuming — checking status...");
                        pollStatus(saved.id);
                    } else {
                        // Expired — clean up
                        sessionStorage.removeItem(STORAGE_KEY);
                    }
                } catch {
                    // Malformed — clean up
                    sessionStorage.removeItem(STORAGE_KEY);
                }
            }
        }).catch(() => { });
        return () => {
            // Cleanup polling on unmount
            if (pollRef.current) clearTimeout(pollRef.current);
        };
    }, []);

    const handleFile = (selectedFile: File) => {
        if (!selectedFile) return;

        const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'application/zip', 'application/x-zip-compressed'];
        if (!validTypes.includes(selectedFile.type)) {
            setErrorMsg("Unsupported file type. Please upload a PDF, PNG, JPG, or ZIP.");
            return;
        }

        if (selectedFile.size > 10 * 1024 * 1024) { // 10MB limit roughly
            setErrorMsg("File is too large. Maximum size is 10MB.");
            return;
        }

        setFile(selectedFile);
        setErrorMsg("");
        setStatus("idle");
        setExtractedData(null);
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const processUpload = async () => {
        if (!file || !user) return;

        setStatus("uploading");
        setProgress(10);
        setErrorMsg("");

        try {
            // 1. Get Presigned URL
            setProgress(20);
            const uploadParams = await dataService.getPrescriptionUploadUrl({
                user_id: user.id,
                file_name: file.name,
                content_type: file.type
            });

            // 2. Upload to S3
            setProgress(40);
            await dataService.uploadToS3(uploadParams.upload_url, file);

            // 3. Trigger Processing
            setProgress(60);
            setStatus("processing");
            const processRes = await dataService.processPrescription({
                prescription_id: uploadParams.prescription_id,
                s3_key: uploadParams.s3_key
            });

            setPrescriptionId(processRes.prescription_id);
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: processRes.prescription_id, ts: Date.now() }));
            pollStatus(processRes.prescription_id);

        } catch (err: any) {
            console.error(err);
            setStatus("error");
            setErrorMsg(err.response?.data?.detail || err.message || "Failed to process prescription.");
        }
    };

    const stageProgress: Record<string, { pct: number; label: string }> = {
        pending: { pct: 55, label: "Queued for processing..." },
        downloading: { pct: 60, label: "Downloading file from storage..." },
        processing: { pct: 65, label: "Processing document..." },
        ocr_running: { pct: 70, label: "Running Sarvam Vision OCR — this may take a minute..." },
        extracting: { pct: 85, label: "Extracting drugs & observations with AI..." },
        matching: { pct: 92, label: "Matching drugs against pharmacy database..." },
    };

    const pollStatus = (id: string) => {
        // Cancel any existing poll
        if (pollRef.current) clearTimeout(pollRef.current);

        let attempts = 0;
        const maxAttempts = 60;       // 60 polls max

        // Smart backoff: fast at first, slower during OCR, fast again at end
        const getDelay = (stage: string, n: number): number => {
            // OCR is the slow step — poll less often
            if (stage === "ocr_running") return 8000;
            // Extracting/matching are fast — poll more often
            if (stage === "extracting" || stage === "matching") return 3000;
            // First few polls: moderate
            if (n < 3) return 3000;
            // Default: 5 seconds
            return 5000;
        };

        let lastStage = "";

        const tick = async () => {
            attempts++;
            if (attempts > maxAttempts) {
                sessionStorage.removeItem(STORAGE_KEY);
                setStatus("error");
                setErrorMsg("Processing timed out. Please try again later.");
                return;
            }

            try {
                const res = await dataService.getPrescriptionStatus(id);

                // Map backend stage to progress
                const stage = stageProgress[res.ocr_status];
                if (stage) {
                    setProgress(stage.pct);
                    setProcessingStage(stage.label);
                    lastStage = res.ocr_status;
                } else {
                    setProgress(Math.min(60 + (attempts * 2), 95));
                }

                if (res.ocr_status === "completed") {
                    pollRef.current = null;
                    sessionStorage.removeItem(STORAGE_KEY);
                    setProgress(100);
                    setExtractedData(res);
                    setStatus("completed");
                    return;
                } else if (res.ocr_status === "failed") {
                    pollRef.current = null;
                    sessionStorage.removeItem(STORAGE_KEY);
                    setStatus("error");
                    setErrorMsg(res.error_message || "OCR Processing failed on the server.");
                    return;
                }
            } catch (err: any) {
                // 404 means prescription was deleted — stop polling and reset
                const status = err?.response?.status || err?.status;
                if (status === 404) {
                    pollRef.current = null;
                    sessionStorage.removeItem(STORAGE_KEY);
                    setStatus("error");
                    setErrorMsg("Prescription not found. It may have been deleted. Please upload again.");
                    return;
                }
                // Other transient errors — keep polling
                console.warn("Polling error...", err);
            }

            // Schedule next poll with smart delay
            pollRef.current = setTimeout(tick, getDelay(lastStage, attempts));
        };

        // Start first poll after a short initial delay
        pollRef.current = setTimeout(tick, 2000);
    };

    const placeOrder = async () => {
        if (!orderModal || !user) return;
        setOrderResult({ loading: true, reply: null, error: null });
        try {
            const sessionId = crypto.randomUUID();
            const res = await dataService.chat(
                user.phone,
                `order ${orderModal.medicine} ${orderModal.qty}`,
                sessionId
            );
            setOrderResult({ loading: false, reply: res.reply, error: null });
        } catch (err: any) {
            setOrderResult({ loading: false, reply: null, error: err?.apiError?.message || err?.message || "Order failed. Please try again." });
        }
    };

    const reset = () => {
        if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
        sessionStorage.removeItem(STORAGE_KEY);
        setFile(null);
        setStatus("idle");
        setProgress(0);
        setErrorMsg("");
        setExtractedData(null);
        setProcessingStage("");
        setShowRawOcr(false);
        setPrescriptionImage(null);
        setOcrMedicines([]);
        setOrderModal(null);
        setOrderResult({ loading: false, reply: null, error: null });
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div className="min-h-screen bg-[#fafbfc] text-slate-900 font-sans relative flex flex-col p-4 md:p-8">
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50 rounded-full blur-[120px] opacity-60" />
                <div className="absolute bottom-[-10%] left-[-10%] w-[30%] h-[30%] bg-teal-50 rounded-full blur-[100px] opacity-40" />
            </div>

            <div className="max-w-4xl mx-auto w-full relative z-10 flex flex-col">
                <div className="mb-8 flex items-center justify-between">
                    <Link href="/dashboard" className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors text-sm font-bold">
                        <ArrowLeft size={16} /> Back to Dashboard
                    </Link>
                </div>

                <div className="bg-white p-8 md:p-12 rounded-4xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-8">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <UploadCloud size={24} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Upload Prescription</h1>
                            <p className="text-slate-500 font-medium">Auto-digitize and check for clinical safety.</p>
                        </div>
                    </div>

                    <div className="mt-10">
                        {status === "idle" || status === "error" ? (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                className="flex flex-col items-center"
                            >
                                <div
                                    className={`w-full border-2 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center transition-all cursor-pointer ${dragActive ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-emerald-400 hover:bg-slate-50"
                                        }`}
                                    onDragEnter={() => setDragActive(true)}
                                    onDragLeave={() => setDragActive(false)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input
                                        ref={fileInputRef} type="file" className="hidden"
                                        accept=".pdf, .png, .jpg, .jpeg, .zip"
                                        onChange={handleChange}
                                    />

                                    <div className="w-16 h-16 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center text-emerald-600 mb-6 group-hover:scale-110 transition-transform">
                                        <FileText size={28} />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-800 mb-2">Drag & Drop your file here</h3>
                                    <p className="text-slate-400 text-sm mb-6 text-center max-w-sm">
                                        Supports PDF, PNG, JPG, JPEG, or ZIP up to 10MB
                                    </p>

                                    <button className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-emerald-800 transition-colors shadow-sm">
                                        Browse Files
                                    </button>
                                </div>

                                {errorMsg && (
                                    <div className="w-full mt-4 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl flex items-start gap-3">
                                        <AlertCircle size={20} className="shrink-0 mt-0.5" />
                                        <p className="text-sm font-medium">{errorMsg}</p>
                                    </div>
                                )}

                                {file && (
                                    <div className="w-full mt-6 p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                                <FileText size={20} />
                                            </div>
                                            <div className="overflow-hidden">
                                                <p className="text-sm font-bold text-slate-900 truncate">{file.name}</p>
                                                <p className="text-xs text-slate-500 font-medium">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button onClick={(e) => { e.stopPropagation(); reset(); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                                                <X size={18} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); processUpload(); }}
                                                className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-emerald-800 transition-colors shadow-sm"
                                            >
                                                Upload & Extract
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ) : status === "uploading" || status === "processing" ? (
                            <motion.div
                                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                className="w-full py-16 flex flex-col items-center justify-center text-center"
                            >
                                <div className="relative w-24 h-24 mb-8">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                        <circle cx="50" cy="50" r="45" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                                        <motion.circle
                                            cx="50" cy="50" r="45" fill="none" stroke="#059669" strokeWidth="8"
                                            strokeLinecap="round"
                                            initial={{ strokeDasharray: "0 283" }}
                                            animate={{ strokeDasharray: `${(progress / 100) * 283} 283` }}
                                            transition={{ duration: 0.5 }}
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center flex-col">
                                        {status === "uploading" ? (
                                            <UploadCloud size={24} className="text-emerald-600 animate-bounce" />
                                        ) : (
                                            <Loader2 size={24} className="text-emerald-600 animate-spin" />
                                        )}
                                    </div>
                                </div>

                                <h3 className="text-xl font-bold text-slate-900 mb-2">
                                    {status === "uploading" ? "Uploading Document..." : "Extracting Data..."}
                                </h3>
                                <p className="text-slate-500 text-sm font-medium max-w-sm text-center">
                                    {status === "processing"
                                        ? (processingStage || "Running Sarvam OCR & clinical intelligence...")
                                        : "Securely transferring to cloud storage..."}
                                </p>
                                {status === "processing" && (
                                    <div className="mt-6 w-full max-w-xs">
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                                            <Clock size={12} /> Pipeline Progress
                                        </div>
                                        <div className="space-y-2">
                                            {Object.entries(stageProgress).map(([key, val]) => {
                                                const isActive = val.pct <= progress + 5 && val.pct >= progress - 10;
                                                const isDone = val.pct < progress - 5;
                                                return (
                                                    <div key={key} className={`flex items-center gap-2 text-xs font-medium transition-all ${isDone ? "text-emerald-600" : isActive ? "text-blue-600" : "text-slate-300"}`}>
                                                        {isDone ? <CheckCircle size={12} /> : isActive ? <Loader2 size={12} className="animate-spin" /> : <div className="w-3 h-3 rounded-full border border-slate-200" />}
                                                        <span className="capitalize">{key.replace('_', ' ')}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ) : status === "completed" && extractedData ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                                className="w-full flex flex-col items-center text-center pt-6 pb-2"
                            >
                                <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-6">
                                    <CheckCircle size={40} />
                                </div>
                                <h3 className="text-2xl font-bold text-slate-900 mb-2">Extraction Complete</h3>
                                <p className="text-slate-500 font-medium mb-8 max-w-md">
                                    We've successfully digitized your prescription. Check the details below.
                                </p>

                                <button onClick={reset} className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors">
                                    Upload Another
                                </button>
                            </motion.div>
                        ) : null}
                    </div>
                </div>

                {/* Results View */}
                <AnimatePresence>
                    {status === "completed" && extractedData && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                            className="flex flex-col gap-6"
                        >                            {/* Original Prescription Image */}
                            {prescriptionImage && (
                                <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                    <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                        <Eye className="text-slate-500" size={24} /> Original Prescription
                                        <span className="ml-auto text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                                            For comparison
                                        </span>
                                    </h3>
                                    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 flex items-center justify-center">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={prescriptionImage}
                                            alt="Original prescription"
                                            className="max-h-150 w-auto object-contain"
                                        />
                                    </div>
                                </div>
                            )}
                            {/* Drugs Table */}
                            <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                    <Pill className="text-emerald-600" size={24} /> Prescribed Medications
                                </h3>

                                {extractedData.drugs && extractedData.drugs.length > 0 ? (
                                    <div className="flex flex-col gap-4">
                                        {extractedData.drugs.every((d: any) => d.pinecone_metadata?.ocr_fallback) && (
                                            <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-100 rounded-2xl">
                                                <span className="text-amber-600 text-xs font-bold">⚠ Medicines were written in a handwritten table — extracted directly from OCR image analysis and saved to your record.</span>
                                            </div>
                                        )}
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-100 text-slate-400">
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Medication</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Dosage</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Frequency</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Duration</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Notes</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Confidence</th>
                                                    <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Order</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {extractedData.drugs.map((drug: any, i: number) => {
                                                    const isOcr = drug.pinecone_metadata?.ocr_fallback === true;
                                                    const score = drug.match_score ? Math.round(drug.match_score * 100) : 0;
                                                    const scoreColor = score >= 80 ? "text-emerald-600 bg-emerald-50" : score >= 50 ? "text-amber-600 bg-amber-50" : "text-red-500 bg-red-50";
                                                    return (
                                                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                                        <td className="py-4 font-bold text-slate-900">
                                                            <div>{drug.drug_name_matched || drug.drug_name_raw}</div>
                                                            {drug.drug_name_matched && drug.drug_name_raw !== drug.drug_name_matched && (
                                                                <div className="text-[10px] text-slate-400 font-medium mt-0.5">OCR: {drug.drug_name_raw}</div>
                                                            )}
                                                            <div className="flex items-center gap-1 flex-wrap mt-1">
                                                                {drug.drug_name_matched && (
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase">Matched</span>
                                                                )}
                                                                {isOcr && (
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 uppercase">OCR Extracted</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-4 text-slate-600 font-medium">{drug.dosage || "-"}</td>
                                                        <td className="py-4 text-slate-600">
                                                            <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold">
                                                                {drug.frequency_raw || drug.frequency || "-"}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 text-slate-600 font-medium">{drug.duration || "-"}</td>
                                                        <td className="py-4 text-slate-500 text-xs leading-relaxed max-w-50">{drug.instructions || drug.meal_relation || "-"}</td>
                                                        <td className="py-4">
                                                            {score > 0 ? (
                                                                <span className={`px-2 py-1 rounded-lg text-xs font-bold ${scoreColor}`}>
                                                                    {score}%
                                                                </span>
                                                            ) : (
                                                                <span className="text-xs text-slate-300">-</span>
                                                            )}
                                                        </td>
                                                        <td className="py-4">
                                                            <button
                                                                onClick={() => { setOrderModal({ medicine: drug.drug_name_matched || drug.drug_name_raw, qty: 10 }); setOrderResult({ loading: false, reply: null, error: null }); }}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                                                            >
                                                                <ShoppingCart size={12} /> Order
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    </div>
                                ) : ocrMedicines.length > 0 ? (
                                    // Fallback: show regex-extracted medicines from OCR text/image descriptions
                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-100 rounded-2xl">
                                            <span className="text-amber-600 text-xs font-bold">⚠ AI extraction returned 0 drugs — showing medicines detected directly from OCR text.</span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left text-sm border-collapse">
                                                <thead>
                                                    <tr className="border-b border-slate-100 text-slate-400">
                                                        <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Type</th>
                                                        <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Medication (OCR)</th>
                                                        <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Dosage</th>
                                                        <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Duration</th>
                                                        <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Source</th>
                                                        <th className="pb-4 font-bold uppercase tracking-widest text-[10px]">Order</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {ocrMedicines.map((med, i) => (
                                                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                                            <td className="py-4">
                                                                <span className={`px-2 py-1 rounded-lg text-xs font-bold uppercase ${
                                                                    med.prefix.toLowerCase().startsWith('syp') ? 'bg-purple-50 text-purple-700' :
                                                                    med.prefix.toLowerCase().startsWith('inj') ? 'bg-red-50 text-red-700' :
                                                                    med.prefix.toLowerCase().startsWith('cp') || med.prefix.toLowerCase().startsWith('cap') ? 'bg-orange-50 text-orange-700' :
                                                                    'bg-blue-50 text-blue-700'
                                                                }`}>
                                                                    {med.prefix.toLowerCase().startsWith('syp') ? 'Syrup' :
                                                                     med.prefix.toLowerCase().startsWith('inj') ? 'Injection' :
                                                                     med.prefix.toLowerCase().startsWith('cp') || med.prefix.toLowerCase().startsWith('cap') ? 'Capsule' :
                                                                     'Tablet'}
                                                                </span>
                                                            </td>
                                                            <td className="py-4 font-bold text-slate-900">{med.name}</td>
                                                            <td className="py-4 text-slate-600 font-medium">{med.dosage}</td>
                                                            <td className="py-4 text-slate-600 font-medium">{med.duration}</td>
                                                            <td className="py-4">
                                                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                                                                    med.source === 'ocr_image_desc' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'
                                                                }`}>
                                                                    {med.source === 'ocr_image_desc' ? 'Image Block' : 'Text'}
                                                                </span>
                                                            </td>
                                                            <td className="py-4">
                                                                <button
                                                                    onClick={() => { setOrderModal({ medicine: med.name, qty: 10 }); setOrderResult({ loading: false, reply: null, error: null }); }}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                                                                >
                                                                    <ShoppingCart size={12} /> Order
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="py-8 text-center text-slate-500 font-medium bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                                        No medications detected in this document.
                                    </div>
                                )}
                            </div>

                            {/* Observations List */}
                            <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3 mb-6">
                                    <Activity className="text-emerald-600" size={24} /> Clinical Observations
                                </h3>

                                {extractedData.observations && extractedData.observations.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {extractedData.observations.map((obs: any, i: number) => (
                                            <div key={i} className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex flex-col gap-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                                                        {obs.observation_type.replace('_', ' ')}
                                                    </span>
                                                    {obs.severity && (
                                                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${obs.severity === 'severe' ? 'bg-red-100 text-red-600' :
                                                            obs.severity === 'moderate' ? 'bg-orange-100 text-orange-600' :
                                                                'bg-green-100 text-green-600'
                                                            }`}>
                                                            {obs.severity}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="font-semibold text-slate-800 text-sm">{obs.observation_text}</p>
                                                {obs.body_part && (
                                                    <p className="text-xs text-slate-500 font-medium mt-1">Area: {obs.body_part}</p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-8 text-center text-slate-500 font-medium bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                                        No clinical observations found.
                                    </div>
                                )}
                            </div>

                            {/* Raw OCR Output */}
                            {extractedData.raw_extracted_text && (
                                <div className="bg-white p-8 rounded-4xl border border-slate-200 shadow-sm">
                                    <button
                                        onClick={() => setShowRawOcr(!showRawOcr)}
                                        className="w-full flex items-center justify-between"
                                    >
                                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                                            <Eye className="text-slate-500" size={24} /> Raw OCR Output
                                            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                                                {extractedData.raw_extracted_text.length.toLocaleString()} chars
                                            </span>
                                        </h3>
                                        <ChevronDown
                                            size={20}
                                            className={`text-slate-400 transition-transform duration-200 ${showRawOcr ? "rotate-180" : ""}`}
                                        />
                                    </button>

                                    <AnimatePresence>
                                        {showRawOcr && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="mt-6 bg-slate-50 border border-slate-100 rounded-2xl p-6 max-h-125 overflow-y-auto">
                                                    <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap leading-relaxed">
                                                        {extractedData.raw_extracted_text}
                                                    </pre>
                                                </div>
                                                <p className="mt-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                    This is the raw text extracted by Sarvam Vision OCR from your prescription document.
                                                </p>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Order Modal ─────────────────────────────────── */}
            <AnimatePresence>
                {orderModal && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                        onClick={(e) => { if (e.target === e.currentTarget && !orderResult.loading) setOrderModal(null); }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.97 }}
                            className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
                        >
                            {/* Header */}
                            <div className="px-8 pt-8 pb-0 flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
                                        <Package size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-slate-900">Order Medicine</h2>
                                        <p className="text-xs text-slate-500 font-medium mt-0.5">via BAYMAX pharmacy</p>
                                    </div>
                                </div>
                                {!orderResult.loading && (
                                    <button onClick={() => setOrderModal(null)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors rounded-xl">
                                        <X size={18} />
                                    </button>
                                )}
                            </div>

                            <div className="p-8 pt-6 flex flex-col gap-5">
                                {/* Medicine name */}
                                <div>
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 block">Medicine</label>
                                    <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold text-sm">
                                        {orderModal.medicine}
                                    </div>
                                </div>

                                {/* Quantity stepper — hide once result is in */}
                                {!orderResult.reply && !orderResult.error && (
                                    <div>
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 block">Quantity</label>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => setOrderModal(m => m ? { ...m, qty: Math.max(1, m.qty - 1) } : m)}
                                                className="w-10 h-10 rounded-2xl border-2 border-slate-200 flex items-center justify-center text-slate-600 font-bold text-lg hover:border-blue-400 hover:text-blue-600 transition-colors"
                                            >−</button>
                                            <input
                                                type="number" min={1} max={200}
                                                value={orderModal.qty}
                                                onChange={e => setOrderModal(m => m ? { ...m, qty: Math.max(1, parseInt(e.target.value) || 1) } : m)}
                                                className="w-20 text-center font-bold text-slate-900 text-lg border-2 border-slate-200 rounded-2xl py-2 focus:outline-none focus:border-blue-400"
                                            />
                                            <button
                                                onClick={() => setOrderModal(m => m ? { ...m, qty: Math.min(200, m.qty + 1) } : m)}
                                                className="w-10 h-10 rounded-2xl border-2 border-slate-200 flex items-center justify-center text-slate-600 font-bold text-lg hover:border-blue-400 hover:text-blue-600 transition-colors"
                                            >+</button>
                                            <span className="text-sm text-slate-500 font-medium ml-1">units</span>
                                        </div>
                                    </div>
                                )}

                                {/* Success result */}
                                {orderResult.reply && (
                                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <CheckCircle size={16} className="text-emerald-600 shrink-0" />
                                            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">Order Placed</span>
                                        </div>
                                        <p className="text-sm text-emerald-900 font-medium leading-relaxed whitespace-pre-wrap">{orderResult.reply}</p>
                                        <p className="mt-3 text-[11px] text-emerald-600 font-medium">📱 You will also receive a WhatsApp confirmation.</p>
                                    </div>
                                )}

                                {/* Error result */}
                                {orderResult.error && (
                                    <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-2">
                                        <AlertCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                                        <p className="text-sm text-red-700 font-medium">{orderResult.error}</p>
                                    </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex gap-3 mt-1">
                                    {!orderResult.reply ? (
                                        <>
                                            <button
                                                onClick={() => setOrderModal(null)}
                                                disabled={orderResult.loading}
                                                className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-bold text-sm hover:bg-slate-200 transition-colors disabled:opacity-50"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={placeOrder}
                                                disabled={orderResult.loading}
                                                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
                                            >
                                                {orderResult.loading
                                                    ? <><Loader2 size={16} className="animate-spin" /> Placing Order...</>
                                                    : <><ShoppingCart size={16} /> Place Order</>}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => setOrderModal(null)}
                                            className="w-full px-4 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-sm"
                                        >
                                            Done
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
