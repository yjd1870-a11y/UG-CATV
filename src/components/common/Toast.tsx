import React from 'react';
import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const Toast: React.FC = () => {
  const { toast, hideToast } = useApp();

  if (!toast) return null;

  const typeConfig = {
    success: {
      bg: 'bg-emerald-800 text-white',
      icon: CheckCircle2,
    },
    info: {
      bg: 'bg-[#173B57] text-white',
      icon: Info,
    },
    warning: {
      bg: 'bg-amber-600 text-white',
      icon: AlertCircle,
    },
    error: {
      bg: 'bg-red-700 text-white',
      icon: XCircle,
    },
  };

  const config = typeConfig[toast.type] || typeConfig.info;
  const Icon = config.icon;

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-200">
      <div
        className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl shadow-xl border border-white/20 ${config.bg}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon className="w-5 h-5 shrink-0 text-white" />
          <span className="text-sm font-semibold tracking-tight text-white truncate">
            {toast.message}
          </span>
        </div>
        <button
          onClick={hideToast}
          className="p-1 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition"
          aria-label="닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
