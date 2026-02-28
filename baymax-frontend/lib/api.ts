import axios from "axios";
import type {
    UserProfile,
    AuthResponse,
    Language,
    ChatResponse,
    VoiceResponse,
    VitalsPayload,
    VitalsResponse,
    AdherenceData,
    TimelineEvent,
    EpisodeData,
    RiskData,
    DFEQuestion,
    AbuseFlag,
    LowStockItem,
    ApiError,
    FullHistory,
} from "@/types/api";

// ─── Constants ──────────────────────────────────────────────

export const TOKEN_KEY = "baymax_token";
export const USER_ID_KEY = "baymax_user_id";

// ─── Axios Instance ─────────────────────────────────────────

export const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
    headers: {
        "Content-Type": "application/json",
    },
});

// ─── Request Interceptor: Attach Bearer Token ──────────────

api.interceptors.request.use(
    (config) => {
        if (typeof window !== "undefined") {
            const token = localStorage.getItem(TOKEN_KEY);
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// ─── Response Interceptor: Normalize Errors ────────────────

api.interceptors.response.use(
    (response) => response,
    (error) => {
        const normalized: ApiError = {
            message: "An unexpected error occurred",
            status: error.response?.status || 0,
        };

        if (error.response?.data) {
            const data = error.response.data;
            if (typeof data.detail === "string") {
                normalized.message = data.detail;
                normalized.detail = data.detail;
            } else if (Array.isArray(data.detail) && data.detail.length > 0) {
                normalized.message = data.detail[0].msg?.replace("Value error, ", "") || "Validation error";
                normalized.detail = data.detail;
            } else if (data.message) {
                normalized.message = data.message;
            }
        } else if (error.message === "Network Error") {
            normalized.message = "Unable to connect to server. Is it running?";
        } else if (error.message) {
            normalized.message = error.message;
        }

        // Attach normalized error for easy access
        error.apiError = normalized;
        return Promise.reject(error);
    }
);

// ─── Retry Utility (safe GET endpoints only) ───────────────

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries) throw err;
            await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        }
    }
    throw new Error("Retry exhausted");
}

// ─── Auth Service ───────────────────────────────────────────

export const authService = {
    login: async (identifier: string, password: string): Promise<any> => {
        const res = await api.post("/auth/login", { identifier, password });
        return res.data; // { token, user } or { access_token, user_id }
    },

    signup: async (data: Record<string, any>): Promise<any> => {
        const res = await api.post("/auth/signup", data);
        return res.data;
    },

    logout: () => {
        if (typeof window !== "undefined") {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_ID_KEY);
        }
    },

    isAuthenticated: (): boolean => {
        if (typeof window !== "undefined") {
            return !!localStorage.getItem(TOKEN_KEY);
        }
        return false;
    },

    getMe: async (): Promise<UserProfile> => {
        const res = await api.get("/auth/me");
        return res.data;
    },

    updateProfile: async (data: Record<string, any>): Promise<{ message: string; updated_fields: string[] }> => {
        const res = await api.put("/auth/profile", data);
        return res.data;
    },
};

// ─── Data Service ───────────────────────────────────────────

export const dataService = {
    getProfile: async (phone: string): Promise<UserProfile> => {
        const res = await withRetry(() => api.get(`/user/${encodeURIComponent(phone)}`));
        return res.data;
    },

    getFullHistory: async (phone: string): Promise<FullHistory> => {
        const res = await withRetry(() => api.get(`/user/${encodeURIComponent(phone)}/full-history`));
        return res.data;
    },

    chat: async (phone: string, message: string, session_id: string): Promise<ChatResponse> => {
        const res = await api.post("/chat", { phone, message, channel: "web", session_id });
        return res.data;
    },

    getClinicalReport: async (phone: string): Promise<any> => {
        const res = await withRetry(() => api.get(`/user/${encodeURIComponent(phone)}/clinical-report`));
        return res.data;
    },

    getTimeline: async (phone: string, limit: number = 20): Promise<TimelineEvent[]> => {
        const res = await withRetry(() => api.get(`/user/${encodeURIComponent(phone)}/timeline?limit=${limit}`));
        return res.data.events || [];
    },

    getAdherence: async (phone: string): Promise<AdherenceData> => {
        const res = await withRetry(() => api.get(`/user/${encodeURIComponent(phone)}/adherence`));
        return res.data;
    },

    getEpisodes: async (phone: string): Promise<EpisodeData[]> => {
        const res = await withRetry(() => api.get(`/user/${encodeURIComponent(phone)}/episodes`));
        return res.data.episodes || [];
    },

    getRisk: async (phone: string): Promise<RiskData> => {
        const res = await withRetry(() => api.get(`/user/${encodeURIComponent(phone)}/risk`));
        return res.data;
    },

    logVitals: async (data: VitalsPayload): Promise<VitalsResponse> => {
        const res = await api.post("/vitals", data);
        return res.data;
    },

    sendVoice: async (phone: string, audioBlob: Blob, session_id: string): Promise<VoiceResponse> => {
        const formData = new FormData();
        formData.append("file", audioBlob, "voice.webm");
        formData.append("phone", phone);
        formData.append("channel", "web");
        formData.append("session_id", session_id);

        const res = await api.post("/voice", formData, {
            headers: { "Content-Type": "multipart/form-data" }
        });
        return res.data;
    },

    playTTS: async (formData: FormData): Promise<{ audio_base64: string; language: string }> => {
        const res = await api.post("/tts", formData, {
            headers: { "Content-Type": "multipart/form-data" }
        });
        return res.data;
    },

    getAdminAbuse: async (): Promise<AbuseFlag[]> => {
        const res = await withRetry(() => api.get("/admin/abuse-risk"));
        return res.data;
    },

    getLowStock: async (): Promise<LowStockItem[]> => {
        const res = await withRetry(() => api.get("/inventory/low-stock"));
        return res.data;
    },

    searchInventory: async (query: string): Promise<any[]> => {
        const res = await api.get(`/inventory/search?q=${encodeURIComponent(query)}`);
        return res.data;
    },

    checkRecall: async (drugName: string): Promise<any> => {
        const res = await api.get(`/recall-check/${encodeURIComponent(drugName)}`);
        return res.data;
    },

    getVitalTrends: async (): Promise<any[]> => {
        const res = await withRetry(() => api.get("/admin/vital-trend-alerts"));
        return res.data;
    },

    getCDELog: async (limit: number = 50): Promise<any[]> => {
        const res = await withRetry(() => api.get(`/admin/cde-log?limit=${limit}`));
        return res.data;
    },

    getExpiringMeds: async (): Promise<any[]> => {
        const res = await withRetry(() => api.get("/inventory/expiring"));
        return res.data;
    },

    getDFEHistory: async (phone: string): Promise<DFEQuestion[]> => {
        const res = await withRetry(() => api.get(`/user/${encodeURIComponent(phone)}/dfe-history`));
        return res.data.dfe_questions || [];
    },

    getLanguages: async (): Promise<Language[]> => {
        const res = await withRetry(() => api.get("/auth/languages"));
        return res.data;
    },

    // ── Prescriptions OCR ──
    getPrescriptionUploadUrl: async (payload: { user_id: string; file_name: string; content_type?: string }) => {
        const res = await api.post("/prescriptions/upload", payload);
        return res.data;
    },

    uploadToS3: async (uploadUrl: string, file: File) => {
        // Direct PUT to S3 bypassing our axios interceptor
        const res = await fetch(uploadUrl, {
            method: "PUT",
            body: file,
            headers: {
                "Content-Type": file.type
            }
        });
        if (!res.ok) throw new Error("Failed to upload file to S3");
        return true;
    },

    processPrescription: async (payload: { prescription_id: string; s3_key: string }) => {
        const res = await api.post("/prescriptions/process", payload);
        return res.data;
    },

    getPrescriptionStatus: async (prescriptionId: string) => {
        const res = await api.get(`/prescriptions/status/${encodeURIComponent(prescriptionId)}`);
        return res.data;
    }
};
