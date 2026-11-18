import React, { useState } from 'react';
import {
  History,
  Cloud,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Layers,
  FileJson,
  FileSpreadsheet,
  FileText
} from 'lucide-react';
import { TimetableChangeLogEntry, TimetableChangeSource } from '../types';
import { ExternalSourceType } from '../utils/externalTimetableLoader';

interface TimetableChangeLogProps {
  latestLog: TimetableChangeLogEntry | null;
  currentSlotsCount: number;
  currentCohortsCount: number;
  kvStatus: 'checking' | 'connected' | 'local_only';
  activeSourceInfo?: { type: ExternalSourceType; label: string; url: string };
  onSyncFromKV: () => Promise<{ synced: boolean; message: string }>;
}

function formatDateTimeMY(iso: string): { dateStr: string; timeStr: string } {
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return { dateStr: iso, timeStr: '-' };
    return {
      dateStr: dt.toLocaleDateString('ms-MY', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }),
      timeStr: dt.toLocaleTimeString('ms-MY', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };
  } catch {
    return { dateStr: iso, timeStr: '-' };
  }
}

function getSourceBadge(source: TimetableChangeSource) {
  if (source === 'web_pdf_upload') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-indigo-100 text-indigo-800 border-indigo-200 text-[10px] font-bold">
        <FileText className="w-3 h-3" />
        <span>Muat Naik PDF Web -&gt; KV</span>
      </span>
    );
  }
  if (source === 'web_json_upload') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-sky-100 text-sky-800 border-sky-200 text-[10px] font-bold">
        <FileJson className="w-3 h-3" />
        <span>Muat Naik JSON Web -&gt; KV</span>
      </span>
    );
  }
  if (source === 'google_sheets_csv') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] font-bold">
        <FileSpreadsheet className="w-3 h-3" />
        <span>Google Sheets CSV (Live)</span>
      </span>
    );
  }
  if (source === 'external_json') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-blue-100 text-blue-800 border-blue-200 text-[10px] font-bold">
        <FileJson className="w-3 h-3" />
        <span>Fail Luaran (/data/jadual.json)</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] font-bold">
      <Cloud className="w-3 h-3" />
      <span>Muat Naik Web -&gt; Cloudflare KV</span>
    </span>
  );
}

export const TimetableChangeLog: React.FC<TimetableChangeLogProps> = ({
  latestLog,
  currentSlotsCount,
  currentCohortsCount,
  kvStatus,
  activeSourceInfo,
  onSyncFromKV
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncNotice(null);
    try {
      const res = await onSyncFromKV();
      setSyncNotice({ text: res.message, ok: res.synced });
    } finally {
      setIsSyncing(false);
    }
  };

  const latestTime = latestLog ? formatDateTimeMY(latestLog.timestamp) : null;
  const isPositive = (latestLog?.deltaSlots ?? 0) > 0;
  const isNegative = (latestLog?.deltaSlots ?? 0) < 0;

  const isSourceActive =
    (activeSourceInfo && activeSourceInfo.type !== 'none') || kvStatus === 'connected';

  const bannerHeadline =
    activeSourceInfo?.type === 'cloudflare_kv'
      ? 'Sumber Aktif: Cloudflare KV (jadual_induk_jkm)'
      : activeSourceInfo?.type === 'google_sheets_csv'
        ? 'Sumber Aktif: Google Sheets Diterbitkan sebagai CSV (Live)'
        : activeSourceInfo?.type === 'external_json'
          ? `Sumber Aktif: Fail Luaran (${activeSourceInfo.url})`
          : kvStatus === 'checking'
            ? 'Menyemak sumber data luaran (KV / Google Sheets CSV / jadual.json)...'
            : 'Tiada Sumber Data Luaran Aktif Dikesan';

  return (
    <div className="space-y-4 text-xs">
      {/* External Data Source Live Status Banner */}
      <div
        className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isSourceActive
            ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
            : 'bg-slate-50 border-slate-200 text-slate-800'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {isSourceActive ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="space-y-0.5">
            <div className="font-bold text-xs">{bannerHeadline}</div>
            <p className="text-[11px] opacity-85 leading-relaxed">
              Aplikasi mengambil data terkini tanpa cache (<code>no-store</code>) terus daripada <b>Cloudflare KV</b> (<code>/api/jadual</code>), Google Sheets CSV, atau <b>/data/jadual.json</b> supaya pelajar melihat pindaan jadual serta-merta.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-[11px] flex items-center justify-center gap-1.5 transition shadow-2xs shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Menyemak...' : 'Semak Data Terkini'}</span>
        </button>
      </div>

      {syncNotice && (
        <div
          className={`px-3.5 py-2 rounded-xl border text-[11px] font-semibold ${
            syncNotice.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {syncNotice.text}
        </div>
      )}

      {/* Latest Live Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
          <span className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-blue-600" /> Slot Aktif Terkini
          </span>
          <div className="text-lg font-black text-slate-900">{currentSlotsCount} slot</div>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
          <span className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide">
            Seksyen Aktif
          </span>
          <div className="text-lg font-black text-slate-900">{currentCohortsCount} seksyen</div>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
          <span className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide">
            Perbezaan Kemas Kini Terkini
          </span>
          <div className="text-lg font-black flex items-center gap-1">
            {!latestLog ? (
              <span className="text-slate-400">-</span>
            ) : isPositive ? (
              <span className="text-emerald-700 flex items-center">
                <ArrowUpRight className="w-4 h-4" />+{latestLog.deltaSlots} slot
              </span>
            ) : isNegative ? (
              <span className="text-rose-700 flex items-center">
                <ArrowDownRight className="w-4 h-4" />
                {latestLog.deltaSlots} slot
              </span>
            ) : (
              <span className="text-slate-700 flex items-center gap-1">
                <Minus className="w-4 h-4 text-slate-400" />0 slot
              </span>
            )}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1">
          <span className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-emerald-600" /> Masa Kemas Kini Terkini
          </span>
          <div className="text-xs font-bold text-slate-900 truncate">
            {latestTime ? `${latestTime.dateStr}, ${latestTime.timeStr}` : 'Belum diterima'}
          </div>
        </div>
      </div>

      {/* Latest Snapshot Only */}
      <div className="space-y-2">
        <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
          <History className="w-4 h-4 text-blue-600" />
          <span>Rekod Perubahan Terkini (Data Sumber Luaran)</span>
        </h4>

        {!latestLog ? (
          <div className="p-8 text-center rounded-2xl bg-slate-50 border border-dashed border-slate-300 space-y-2">
            <Cloud className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="font-bold text-slate-700 text-xs">Belum Ada Rekod Kemas Kini Dikesan</div>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
              Sebaik sahaja penyelaras memuat naik PDF Jadual Induk JKM atau fail JSON melalui tab <b>Muat Naik Jadual</b> (atau menolak data ke Cloudflare KV), maklumat perubahan terkini akan dipaparkan di sini.
            </p>
          </div>
        ) : (
          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-[10.5px] font-bold uppercase text-slate-600">
                    <th className="py-2.5 px-3">Tarikh &amp; Masa Kemas Kini</th>
                    <th className="py-2.5 px-3">Sumber / Fail Luaran</th>
                    <th className="py-2.5 px-3 text-center">Slot Sebelum</th>
                    <th className="py-2.5 px-3 text-center">Slot Selepas</th>
                    <th className="py-2.5 px-3 text-center">Perbezaan (Delta)</th>
                    <th className="py-2.5 px-3 text-center">Seksyen</th>
                  </tr>
                </thead>
                <tbody className="text-[11.5px]">
                  <tr className="bg-blue-50/30">
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="font-bold text-slate-900">{latestTime?.dateStr}</div>
                      <div className="text-[10.5px] font-mono text-slate-500">{latestTime?.timeStr}</div>
                    </td>

                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {getSourceBadge(latestLog.source)}
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-[9.5px] font-bold uppercase">
                          Terkini
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] font-semibold text-slate-700 break-all">
                        {latestLog.filename || 'jadual_induk_jkm'}
                        {latestLog.engineLabel ? (
                          <span className="text-slate-400 font-normal"> · {latestLog.engineLabel}</span>
                        ) : null}
                      </div>
                    </td>

                    <td className="py-3 px-3 text-center font-mono font-semibold text-slate-600">
                      {latestLog.previousSlots}
                    </td>

                    <td className="py-3 px-3 text-center font-mono font-bold text-slate-900">
                      {latestLog.newSlots}
                    </td>

                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      {isPositive ? (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[11px]">
                          <ArrowUpRight className="w-3.5 h-3.5" />+{latestLog.deltaSlots} slot
                        </span>
                      ) : isNegative ? (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg bg-rose-100 text-rose-800 border border-rose-200 font-bold text-[11px]">
                          <ArrowDownRight className="w-3.5 h-3.5" />
                          {latestLog.deltaSlots} slot
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-[11px]">
                          <Minus className="w-3 h-3" />0 (Kemaskini kandungan)
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-center font-semibold text-slate-700">
                      {latestLog.cohortsCount > 0 ? latestLog.cohortsCount : currentCohortsCount}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
