import { api } from "./api";

// ─── In-memory SWR cache ────────────────────────────────────
// Shows stale data instantly, refreshes in background.

interface CacheEntry<T = any> {
    data: T;
    timestamp: number;
}

const _cache = new Map<string, CacheEntry>();
const STALE_MS = 90_000; // 90 seconds — treat as fresh
const MAX_AGE_MS = 600_000; // 10 min hard expiry

function _cacheGet<T>(key: string): T | undefined {
    const entry = _cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > MAX_AGE_MS) {
        _cache.delete(key);
        return undefined;
    }
    return entry.data as T;
}

function _cacheSet<T>(key: string, data: T): void {
    _cache.set(key, { data, timestamp: Date.now() });
}

function _isFresh(key: string): boolean {
    const entry = _cache.get(key);
    if (!entry) return false;
    return Date.now() - entry.timestamp < STALE_MS;
}

/** Invalidate all admin cache entries (call after mutations). */
export function invalidateAdminCache(): void {
    _cache.clear();
}

/**
 * Fetch with SWR strategy:
 * - If cache is fresh → return cached, skip network
 * - If cache is stale → return cached immediately, refresh in background
 * - If no cache → await network
 */
async function _swr<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = _cacheGet<T>(key);

    if (cached !== undefined && _isFresh(key)) {
        return cached; // fresh — no network call
    }

    if (cached !== undefined) {
        // stale — return immediately, refresh in background
        fetcher().then((data) => _cacheSet(key, data)).catch(() => {});
        return cached;
    }

    // no cache — await network
    const data = await fetcher();
    _cacheSet(key, data);
    return data;
}

// ─── Types ──────────────────────────────────────────────────

export interface TableMeta {
    slug: string;
    table: string;
    pk: string;
    search_cols: string[];
}

export interface ColumnSchema {
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    is_generated: string;
}

export interface TableSchemaResponse {
    slug: string;
    table: string;
    columns: ColumnSchema[];
}

export interface PaginatedRows {
    table: string;
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
    data: Record<string, any>[];
}

export interface RefillAlert {
    record_id: string;
    source: string;
    user_id: string;
    phone: string;
    patient_name: string;
    drug_name: string;
    qty_remaining: number;
    refill_alert_at: number;
    end_date: string | null;
    is_active: boolean;
    urgency: string;
    updated_at: string;
}

export interface RefillForecastItem {
    record_id: string;
    source: string;
    user_id: string;
    phone: string;
    patient_name: string;
    drug_name: string;
    qty_remaining: number;
    daily_doses: number;
    remaining_days: number;
    predicted_runout: string;
    end_date: string | null;
    updated_at: string;
}

export interface RefillForecastResponse {
    days_ahead: number;
    cutoff_date: string;
    patients_needing_refill: number;
    data: RefillForecastItem[];
}

export interface StockPredictionItem {
    drug_name: string;
    brand_name: string;
    current_stock: number;
    reorder_level: number;
    hist_daily_demand: number;
    active_daily_demand: number;
    blended_daily_rate: number;
    predicted_stock: number;
    days_until_stockout: number | null;
    reorder_flag: string;
}

export interface StockPredictionResponse {
    days_ahead: number;
    reorder_now: number;
    reorder_soon: number;
    total_items: number;
    data: StockPredictionItem[];
}

export interface StockDrugDetail {
    drug_name: string;
    inventory_batches: any[];
    total_current_stock: number;
    demand: {
        historic_daily_avg: number;
        active_daily_consumption: number;
        blended_daily_rate: number;
    };
    forecast: {
        days_ahead: number;
        days_until_stockout: number | null;
        predicted_reorder_date: string | null;
        predicted_stock_at_end: number;
        daily: { day: number; date: string; predicted_stock: number }[];
    };
    active_patients: any[];
    active_patient_count: number;
    recent_orders: any[];
}

export interface ExpiryRiskItem {
    drug_name: string;
    brand_name: string;
    stock_qty: number;
    expiry_date: string;
    days_left: number;
    daily_demand: number;
    units_consumed_before_expiry: number;
    estimated_waste_units: number;
    estimated_waste_value: number;
    risk_level: string;
}

export interface ExpiryRiskResponse {
    days_ahead: number;
    cutoff_date: string;
    expiring_items: number;
    total_estimated_waste_value: number;
    data: ExpiryRiskItem[];
}

// ─── API Service ────────────────────────────────────────────

export const adminService = {
    // Tables meta
    getTables: async (): Promise<TableMeta[]> => {
        const res = await api.get("/admin/tables");
        return res.data;
    },

    getTableSchema: async (slug: string): Promise<TableSchemaResponse> => {
        const res = await api.get(`/admin/tables/${slug}/schema`);
        return res.data;
    },

    getStats: async (): Promise<Record<string, number>> => {
        return _swr("stats", async () => {
            const res = await api.get("/admin/stats");
            return res.data;
        });
    },

    // CRUD
    listRows: async (
        slug: string,
        params: { page?: number; per_page?: number; q?: string; sort?: string; order?: string; [key: string]: any }
    ): Promise<PaginatedRows> => {
        const res = await api.get(`/admin/crud/${slug}`, { params });
        return res.data;
    },

    getRow: async (slug: string, pk: string): Promise<Record<string, any>> => {
        const res = await api.get(`/admin/crud/${slug}/${pk}`);
        return res.data;
    },

    createRow: async (slug: string, body: Record<string, any>): Promise<Record<string, any>> => {
        const res = await api.post(`/admin/crud/${slug}`, body);
        invalidateAdminCache();
        return res.data;
    },

    updateRow: async (slug: string, pk: string, body: Record<string, any>): Promise<Record<string, any>> => {
        const res = await api.put(`/admin/crud/${slug}/${pk}`, body);
        invalidateAdminCache();
        return res.data;
    },

    deleteRow: async (slug: string, pk: string): Promise<any> => {
        const res = await api.delete(`/admin/crud/${slug}/${pk}`);
        invalidateAdminCache();
        return res.data;
    },

    bulkDelete: async (slug: string, ids: string[]): Promise<{ deleted: number }> => {
        const res = await api.post(`/admin/crud/${slug}/bulk-delete`, { ids });
        invalidateAdminCache();
        return res.data;
    },

    // Refill alerts
    getRefillAlerts: async (): Promise<RefillAlert[]> => {
        return _swr("refill-alerts", async () => {
            const res = await api.get("/admin/refill-alerts");
            return res.data;
        });
    },

    getRefillForecast: async (daysAhead: number = 14): Promise<RefillForecastResponse> => {
        return _swr(`refill-forecast:${daysAhead}`, async () => {
            const res = await api.get("/admin/refill-forecast", { params: { days_ahead: daysAhead } });
            return res.data;
        });
    },

    // Stock prediction
    getStockPrediction: async (daysAhead: number = 30, includeAll: boolean = false): Promise<StockPredictionResponse> => {
        return _swr(`stock-pred:${daysAhead}:${includeAll}`, async () => {
            const res = await api.get("/admin/stock-prediction", { params: { days_ahead: daysAhead, include_all: includeAll } });
            return res.data;
        });
    },

    getStockDrugDetail: async (drugName: string, daysAhead: number = 30): Promise<StockDrugDetail> => {
        const res = await api.get(`/admin/stock-prediction/${encodeURIComponent(drugName)}`, { params: { days_ahead: daysAhead } });
        return res.data;
    },

    // Expiry risk
    getExpiryRisk: async (daysAhead: number = 60): Promise<ExpiryRiskResponse> => {
        return _swr(`expiry-risk:${daysAhead}`, async () => {
            const res = await api.get("/admin/expiry-risk", { params: { days_ahead: daysAhead } });
            return res.data;
        });
    },
};
