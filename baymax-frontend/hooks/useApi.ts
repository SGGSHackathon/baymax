"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface UseApiResult<T> {
    data: T | null;
    loading: boolean;
    error: string;
    refetch: () => Promise<void>;
}

export function useApi<T>(
    fetcher: () => Promise<T>,
    deps: React.DependencyList = []
): UseApiResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const refetch = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await fetcherRef.current();
            setData(result);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "An error occurred";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    return { data, loading, error, refetch };
}
