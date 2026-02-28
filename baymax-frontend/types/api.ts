// ─── User & Auth ────────────────────────────────────────────

export interface UserProfile {
    id: string;
    name: string;
    email: string;
    phone: string;
    age?: number | null;
    gender?: string | null;
    pincode?: string | null;
    city?: string | null;
    country?: string | null;
    preferred_language?: string | null;
    blood_group?: string | null;
    weight_kg?: number | null;
    height_cm?: number | null;
    bmi?: number | null;
    overall_adherence?: number;
    risk_tier?: number;
    onboarded?: boolean;
    allergies?: string[];
    chronic_conditions?: string[];
}

export interface AuthResponse {
    token: string;
    user: UserProfile;
}

export interface Language {
    code: string;
    name: string;
}

// ─── Chat ───────────────────────────────────────────────────

export interface ChatResponse {
    reply: string;
    session_id: string;
    agent_used: string;
    emergency: boolean;
    safety_flags: string[];
    triage_level: string;
    requires_action: string | null;
    risk_tier: number;
    channel: string;
    dfe_triggered: boolean;
    web_search_used: boolean;
}

export interface VoiceResponse {
    transcript: string;
    detected_language: string;
    reply: string;
    reply_english: string;
    audio_base64: string;
    session_id: string;
    agent_used: string;
    emergency: boolean;
}

// ─── Vitals ─────────────────────────────────────────────────

export interface VitalsPayload {
    phone: string;
    bp_systolic?: number;
    bp_diastolic?: number;
    blood_sugar?: number;
    spo2_pct?: number;
    temp_celsius?: number;
    heart_rate?: number;
    weight_kg?: number;
}

export interface VitalsResponse {
    status: string;
    alerts: string[];
}

// ─── Profile Tabs ───────────────────────────────────────────

export interface TimelineEvent {
    event_type: string;
    timestamp: string;
    details: Record<string, unknown>;
}

export interface AdherenceRecord {
    drug_name: string;
    score: number;
    risk_flag: string;
    week_start: string;
    total_taken: number;
    total_skipped: number;
}

export interface AdherenceData {
    overall: number;
    records: AdherenceRecord[];
}

export interface EpisodeData {
    primary_symptom: string;
    severity: string;
    start_date: string;
    related_symptoms: string[];
}

export interface RiskData {
    risk_tier: number;
    tier_constraints: Record<string, boolean>;
    abuse_score: number;
    abuse_flags: string[];
    abuse_blocked: boolean;
}

export interface DFEQuestion {
    question?: string;
    dfe_question?: string;
    answer?: string;
    context?: string;
    created_at: string;
}

// ─── Admin ──────────────────────────────────────────────────

export interface AbuseFlag {
    phone: string;
    name: string;
    score: number;
    flags: string[];
    review_required: boolean;
    blocked: boolean;
}

export interface LowStockItem {
    drug_name?: string;
    name?: string;
    stock_left: number;
}

// ─── Error ──────────────────────────────────────────────────

export interface ApiError {
    message: string;
    status: number;
    detail?: string | Record<string, unknown>[];
}

export interface ActiveMedication {
    id: string;
    drug_name: string;
    dosage?: string;
    dose_per_intake?: string;
    frequency?: string;
    start_date?: string;
    end_date?: string;
    prescribed_by?: string;
    is_active: boolean;
}

export interface Order {
    id: string;
    order_number: string;
    drug_name: string;
    quantity: number;
    total_price: number;
    status: string;
    ordered_at: string;
}

export interface HealthEvent {
    id: string;
    event_type: string;
    title: string;
    description?: string;
    occurred_at: string;
}

export interface AdherenceScore {
    week_start: string;
    drug_name: string;
    score: number;
    risk_flag: string;
    total_taken: number;
    total_scheduled: number;
}

export interface AdverseReaction {
    id: string;
    drug_name: string;
    reaction: string;
    severity: string;
    reported_at: string;
}

export interface FullHistory {
    user: UserProfile;
    active_medications: ActiveMedication[];
    orders: Order[];
    health_timeline: HealthEvent[];
    adherence_scores: AdherenceScore[];
    adverse_reactions: AdverseReaction[];
    generated_at: string;
}
