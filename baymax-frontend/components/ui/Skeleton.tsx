import { cn } from "@/lib/utils";

interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
    return (
        <div className={cn("animate-pulse rounded-lg bg-slate-200/50", className)} />
    );
}

interface SkeletonTextProps {
    lines?: number;
    className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
    return (
        <div className={cn("space-y-2", className)}>
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton
                    key={i}
                    className={cn("h-3", i === lines - 1 ? "w-3/4" : "w-full")}
                />
            ))}
        </div>
    );
}

export function SkeletonCard({ className }: SkeletonProps) {
    return (
        <div className={cn("bg-white border border-slate-200 shadow-sm rounded-2xl p-6 space-y-4", className)}>
            <div className="flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded-xl" />
                <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                </div>
            </div>
            <SkeletonText lines={3} />
        </div>
    );
}
