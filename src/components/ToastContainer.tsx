import React from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  type: 'warning' | 'danger' | 'info' | 'success';
  actionBtnText?: string;
  onActionClick?: () => void;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container fixed bottom-24 lg:bottom-5 right-3 lg:right-5 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map(toast => {
        let wrapClass = 'bg-amber-50 border-amber-400 text-amber-950';
        let badgeClass = 'bg-amber-200 text-amber-900';
        let badgeText = 'Boleh Teruskan';
        let icon = <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />;

        if (toast.type === 'danger') {
          wrapClass = 'bg-rose-50 border-rose-400 text-rose-950';
          badgeClass = 'bg-rose-200 text-rose-900';
          badgeText = 'Perlu Kelulusan KJ';
          icon = <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />;
        } else if (toast.type === 'info') {
          wrapClass = 'bg-blue-50 border-blue-400 text-blue-950';
          badgeClass = 'bg-blue-200 text-blue-900';
          badgeText = 'Makluman';
          icon = <Info className="w-4 h-4 text-blue-600 shrink-0" />;
        } else if (toast.type === 'success') {
          wrapClass = 'bg-emerald-50 border-emerald-400 text-emerald-950';
          badgeClass = 'bg-emerald-200 text-emerald-900';
          badgeText = 'Berjaya';
          icon = <Info className="w-4 h-4 text-emerald-600 shrink-0" />;
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto border-2 ${wrapClass} p-3.5 rounded-2xl shadow-xl transition-all duration-300 text-xs space-y-2 animate-in slide-in-from-bottom-3`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {icon}
                <span className="font-black text-xs">{toast.title}</span>
                <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>
                  {badgeText}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="text-slate-500 hover:text-slate-800 font-bold text-xs p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p className="text-[11px] leading-relaxed opacity-90">{toast.message}</p>

            <div className="flex items-center justify-end gap-2 pt-1">
              {toast.actionBtnText && toast.onActionClick && (
                <button
                  type="button"
                  onClick={() => {
                    toast.onActionClick?.();
                    onDismiss(toast.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-800 font-bold text-[10.5px] hover:bg-slate-100 transition shadow-2xs"
                >
                  {toast.actionBtnText}
                </button>
              )}
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-bold text-[10.5px] hover:bg-slate-800 transition shadow-2xs"
              >
                Faham &amp; Teruskan
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
