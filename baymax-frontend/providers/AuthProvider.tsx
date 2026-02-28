"use client";

import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { authService, TOKEN_KEY, USER_ID_KEY } from "@/lib/api";
import type { UserProfile } from "@/types/api";

export interface AuthContextType {
    user: UserProfile | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (identifier: string, password: string) => Promise<void>;
    signup: (data: Record<string, any>) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export default function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const refreshUser = useCallback(async () => {
        try {
            const res = await authService.getMe();
            setUser(res as UserProfile);
        } catch {
            // Token invalid or expired — clear it
            authService.logout();
            setUser(null);
        }
    }, []);

    // On mount: check for existing token & fetch user
    useEffect(() => {
        if (typeof window === "undefined") {
            setIsLoading(false);
            return;
        }

        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) {
            setIsLoading(false);
            return;
        }

        refreshUser().finally(() => setIsLoading(false));
    }, [refreshUser]);

    const login = useCallback(async (identifier: string, password: string) => {
        const data = await authService.login(identifier, password);
        localStorage.setItem(TOKEN_KEY, data.access_token || data.token);
        if (data.user_id || data.user?.id) {
            localStorage.setItem(USER_ID_KEY, data.user_id || data.user.id);
        }
        // Fetch fresh profile after login
        const me = await authService.getMe();
        setUser(me as UserProfile);
    }, []);

    const signup = useCallback(async (data: Record<string, any>) => {
        const res = await authService.signup(data);
        localStorage.setItem(TOKEN_KEY, res.token || res.access_token);
        if (res.user?.id) localStorage.setItem(USER_ID_KEY, res.user.id);
        // Fetch fresh profile after signup
        const me = await authService.getMe();
        setUser(me as UserProfile);
    }, []);

    const logout = useCallback(async () => {
        await authService.logout();
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user,
            isLoading,
            login,
            signup,
            logout,
            refreshUser,
        }}>
            {children}
        </AuthContext.Provider>
    );
}
