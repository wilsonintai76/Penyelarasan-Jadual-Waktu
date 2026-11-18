import React from 'react';
import { Sliders, FileCheck2, Calendar } from 'lucide-react';

interface BottomNavProps {
  activeTab: 'planner' | 'pk01' | 'jadual';
  onTabChange: (tab: 'planner' | 'pk01' | 'jadual') => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav
      id="bottomNav"
      className="no-print fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 z-50 lg:hidden shadow-[0_-4px_16px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)] md:bottom-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[420px] md:rounded-2xl md:border md:shadow-xl md:pb-0"
    >
      <div className="flex items-center justify-around px-2 py-1.5">
        <button
          onClick={() => onTabChange('planner')}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition ${
            activeTab === 'planner' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div
            className={`p-1 rounded-full mb-0.5 ${
              activeTab === 'planner' ? 'bg-blue-50 text-blue-600' : ''
            }`}
          >
            <Sliders className="w-5 h-5" />
          </div>
          <span className={`text-[10px] tracking-tight ${activeTab === 'planner' ? 'font-bold' : 'font-medium'}`}>
            Perancang
          </span>
        </button>

        <button
          onClick={() => onTabChange('pk01')}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition ${
            activeTab === 'pk01' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div
            className={`p-1 rounded-full mb-0.5 ${
              activeTab === 'pk01' ? 'bg-blue-50 text-blue-600' : ''
            }`}
          >
            <FileCheck2 className="w-5 h-5" />
          </div>
          <span className={`text-[10px] tracking-tight ${activeTab === 'pk01' ? 'font-bold' : 'font-medium'}`}>
            Borang PK01
          </span>
        </button>

        <button
          onClick={() => onTabChange('jadual')}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 transition ${
            activeTab === 'jadual' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <div
            className={`p-1 rounded-full mb-0.5 ${
              activeTab === 'jadual' ? 'bg-blue-50 text-blue-600' : ''
            }`}
          >
            <Calendar className="w-5 h-5" />
          </div>
          <span className={`text-[10px] tracking-tight ${activeTab === 'jadual' ? 'font-bold' : 'font-medium'}`}>
            Jadual Kuliah
          </span>
        </button>
      </div>
    </nav>
  );
};
