import React from 'react';
import { Sliders, FileCheck2, Calendar, Printer, Settings } from 'lucide-react';
import { triggerPrintDocument } from '../utils/printHelper';

interface HeaderProps {
  activeTab: 'planner' | 'pk01' | 'jadual';
  onTabChange: (tab: 'planner' | 'pk01' | 'jadual') => void;
  lastAutoSavedTime?: string;
  currentSession?: string;
  onOpenSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  lastAutoSavedTime,
  currentSession,
  onOpenSettings
}) => {
  return (
    <header className="no-print bg-slate-900 border-b border-slate-800 sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto px-2.5 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2 sm:gap-3">
        {/* Brand Zone */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <div className="bg-blue-600 text-white font-black px-2 sm:px-2.5 py-1 rounded-lg text-xs sm:text-sm tracking-wider shadow-inner shrink-0">
            JKM
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xs sm:text-sm md:text-base font-bold text-white leading-tight truncate">
                Sistem Penyelarasan Jadual &amp; Borang PK01
              </h1>
            </div>
            <div className="flex items-center gap-2 text-[10px] sm:text-xs text-blue-300 truncate">
              <span className="truncate">PKS · {currentSession || 'Sesi II: 2026/2027'}</span>
              {lastAutoSavedTime && (
                <span className="hidden xl:inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/70 border border-emerald-800/80 px-2 py-0.5 rounded-full font-mono shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Auto-Save: {lastAutoSavedTime}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls & Navigation Tabs */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Desktop Navigation Tabs */}
          <div className="hidden md:inline-flex bg-slate-800 p-1 rounded-xl text-xs font-medium border border-slate-700">
            <button
              onClick={() => onTabChange('planner')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition whitespace-nowrap ${
                activeTab === 'planner'
                  ? 'bg-blue-600 text-white font-semibold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Perancang Clash</span>
            </button>
            <button
              onClick={() => onTabChange('pk01')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition whitespace-nowrap ${
                activeTab === 'pk01'
                  ? 'bg-blue-600 text-white font-semibold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>Borang PK01</span>
            </button>
            <button
              onClick={() => onTabChange('jadual')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition whitespace-nowrap ${
                activeTab === 'jadual'
                  ? 'bg-blue-600 text-white font-semibold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Jadual Kuliah</span>
            </button>
          </div>

          {/* Desktop Print & Tetapan Actions */}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => triggerPrintDocument('pk01')}
              className="px-2.5 sm:px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs rounded-xl shadow-xs transition flex items-center gap-1 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak PK01</span>
            </button>
            <button
              onClick={() => triggerPrintDocument('jadual')}
              className="px-2.5 sm:px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs rounded-xl shadow-xs transition flex items-center gap-1 whitespace-nowrap"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Cetak Jadual</span>
            </button>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-2.5 sm:px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600 font-semibold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                title="Tetapan Penyelaras: Muat naik PDF Jadual Induk, Logo R2 & Sesi Semasa"
              >
                <Settings className="w-3.5 h-3.5 text-amber-300" />
                <span>Tetapan</span>
              </button>
            )}
          </div>

          {/* Mobile Quick Print & Tetapan Buttons */}
          <div className="flex sm:hidden items-center gap-1.5 shrink-0">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-xl shadow-xs transition shrink-0"
                title="Tetapan Penyelaras"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => triggerPrintDocument(activeTab === 'jadual' ? 'jadual' : 'pk01')}
              className="px-2.5 py-1.5 bg-blue-600 active:bg-blue-700 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1 transition shrink-0"
              title="Cetak Dokumen (A4)"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
