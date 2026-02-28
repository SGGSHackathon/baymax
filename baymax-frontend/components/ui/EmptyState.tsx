import { FileQuestion } from "lucide-react";

export function EmptyState({ title, description, icon: Icon = FileQuestion }: { title: string, description: string, icon?: any }) {
    return (
        <div className="flex flex-col items-center justify-center p-8 text-center h-full min-h-[200px] bg-slate-50/50 rounded-2xl border border-slate-100 border-dashed">
            <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300 mb-4 shadow-sm">
                <Icon size={24} />
            </div>
            <h3 className="text-sm font-bold text-slate-700 mb-1">{title}</h3>
            <p className="text-xs text-slate-400 font-medium max-w-[200px]">{description}</p>
        </div>
    );
}
