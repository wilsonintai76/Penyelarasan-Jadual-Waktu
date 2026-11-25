import React, { useState, useEffect, useMemo } from 'react';
import {
  BookOpenCheck,
  CalendarClock,
  Layers,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Calendar,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Save,
  Undo,
  Clock,
  ShieldAlert,
  Zap,
  Flame,
  ArrowRight,
  Cloud
} from 'lucide-react';
import {
  SolverAnalysis,
  StudentInfo,
  RepeatSelection,
  MasterTimetableEntry
} from '../types';
import {
  WEEK_DAYS,
  TIME_SLOTS
} from '../data/timetableConstants';
import {
  parseTime,
  formatPackageSchedule,
  getPackageLecturers,
  isTimeClashing
} from '../utils/timetableSolver';
import { ExternalSourceType } from '../utils/externalTimetableLoader';
import { isBahasaKebangsaanA } from '../utils/bahasaKebangsaan';

interface PlannerViewProps {
  analysis: SolverAnalysis;
  student: StudentInfo;
  onUpdateStudent: (field: keyof StudentInfo, value: string) => void;
  availableCohorts: string[];
  timetable: MasterTimetableEntry[];
  selectedRepeatCourses: RepeatSelection[];
  onAddRepeatCourse: (code: string, status: 'C1' | 'C2' | 'D') => void;
  onRemoveRepeatCourse: (code: string) => void;
  onClearAllRepeat: () => void;
  onChangeRepeatPreferredCohort: (code: string, cohort: string) => void;
  manualDroppedCourseCodes: string[];
  onToggleManualDrop: (code: string) => void;
  onSelectElectiveCourse: (groupKey: string, courseCode: string) => void;
  bahasaKebangsaanPassed: boolean;
  onToggleBahasaKebangsaan: (passed: boolean) => void;
  undoHistoryCount?: number;
  onUndoRepeatCourse?: () => void;
  lastAutoSavedTime?: string;
  kvStatus?: 'checking' | 'connected' | 'local_only';
  activeSourceInfo?: { type: ExternalSourceType; label: string; url: string };
  onOpenKvLog?: () => void;
}

export const PlannerView: React.FC<PlannerViewProps> = ({
  analysis,
  student,
  onUpdateStudent,
  availableCohorts,
  timetable,
  selectedRepeatCourses,
  onAddRepeatCourse,
  onRemoveRepeatCourse,
  onClearAllRepeat,
  onChangeRepeatPreferredCohort,
  manualDroppedCourseCodes,
  onToggleManualDrop,
  onSelectElectiveCourse,
  bahasaKebangsaanPassed,
  onToggleBahasaKebangsaan,
  undoHistoryCount = 0,
  onUndoRepeatCourse,
  lastAutoSavedTime,
  kvStatus = 'checking',
  activeSourceInfo,
  onOpenKvLog
}) => {
  const [selectedRepeatCode, setSelectedRepeatCode] = useState<string>('');
  const [selectedRepeatStatus, setSelectedRepeatStatus] = useState<'C1' | 'C2' | 'D'>('C1');
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [timelineDayFilter, setTimelineDayFilter] = useState<string>('Isnin');
  const [showOnlyClashes, setShowOnlyClashes] = useState<boolean>(false);

  // Build dynamic course options straight from live Cloudflare KV timetable
  const dynamicCourseOptions = useMemo(() => {
    const map = new Map<string, { code: string; name: string; credit: number; cohorts: string[] }>();
    timetable.forEach(entry => {
      if (!entry.Course_Code) return;
      const existing = map.get(entry.Course_Code);
      if (existing) {
        if (entry.Cohort && !existing.cohorts.includes(entry.Cohort)) {
          existing.cohorts.push(entry.Cohort);
        }
      } else {
        map.set(entry.Course_Code, {
          code: entry.Course_Code,
          name: entry.Course_Name || `Course ${entry.Course_Code}`,
          credit: Number(entry.Credit || 3),
          cohorts: entry.Cohort ? [entry.Cohort] : []
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [timetable]);

  useEffect(() => {
    if (dynamicCourseOptions.length === 0) {
      setSelectedRepeatCode('');
      return;
    }
    if (!selectedRepeatCode || !dynamicCourseOptions.some(o => o.code === selectedRepeatCode)) {
      const altCourse = dynamicCourseOptions.find(o => o.cohorts.some(c => c !== student.currentCohort));
      setSelectedRepeatCode((altCourse || dynamicCourseOptions[0]).code);
    }
  }, [dynamicCourseOptions, selectedRepeatCode, student.currentCohort]);

  const {
    basePackages,
    keptBasePackages,
    sectionBPackages,
    rescuedBaseCourses,
    autoDroppedCourses,
    prereqDroppedCourses,
    repeatPrereqViolations,
    manualDroppedPackages,
    electiveGroups,
    unselectedElectivePackages,
    bahasaKebangsaanExemptPackages,
    creditsA,
    creditsB,
    totalCredits
  } = analysis;

  // Calculate day-by-day active events & clashes for Timeline Pertindihan
  const getDayEventsAndClashes = (dayName: string) => {
    const events: Array<{
      type: 'kept' | 'tumpang';
      code: string;
      name: string;
      credit: number;
      cohort: string;
      displayStatus?: string;
      start: string;
      end: string;
      venue: string;
      lecturer: string;
      startMin: number;
      endMin: number;
      hasClash?: boolean;
      clashedWith?: string[];
      rawPkg?: any;
    }> = [];

    keptBasePackages.forEach(pkg => {
      pkg.slots
        .filter(s => s.Day.toLowerCase() === dayName.toLowerCase())
        .forEach(s => {
          events.push({
            type: 'kept',
            code: pkg.Course_Code,
            name: pkg.Course_Name,
            credit: pkg.Credit,
            cohort: pkg.Cohort,
            start: s.Start_Time,
            end: s.End_Time,
            venue: s.Venue,
            lecturer: s.Lecturer,
            startMin: parseTime(s.Start_Time),
            endMin: parseTime(s.End_Time),
            rawPkg: pkg
          });
        });
    });

    sectionBPackages.forEach(pkg => {
      pkg.slots
        .filter(s => s.Day.toLowerCase() === dayName.toLowerCase())
        .forEach(s => {
          events.push({
            type: 'tumpang',
            code: pkg.Course_Code,
            name: pkg.Course_Name,
            credit: pkg.Credit,
            cohort: pkg.Cohort,
            displayStatus: (pkg as any).displayStatus || 'D',
            start: s.Start_Time,
            end: s.End_Time,
            venue: s.Venue,
            lecturer: s.Lecturer,
            startMin: parseTime(s.Start_Time),
            endMin: parseTime(s.End_Time),
            rawPkg: pkg
          });
        });
    });

    // Detect overlaps
    const clashBands: Array<{ startMin: number; endMin: number; courseCodes: string[]; startStr: string; endStr: string }> = [];

    events.forEach((evA, i) => {
      events.forEach((evB, j) => {
        if (i < j && isTimeClashing(evA.start, evA.end, evB.start, evB.end)) {
          evA.hasClash = true;
          evB.hasClash = true;

          if (!evA.clashedWith) evA.clashedWith = [];
          if (!evA.clashedWith.includes(evB.code)) evA.clashedWith.push(evB.code);

          if (!evB.clashedWith) evB.clashedWith = [];
          if (!evB.clashedWith.includes(evA.code)) evB.clashedWith.push(evA.code);

          const oStart = Math.max(evA.startMin, evB.startMin);
          const oEnd = Math.min(evA.endMin, evB.endMin);

          const formatMin = (m: number) => {
            const hrs = Math.floor(m / 60).toString().padStart(2, '0');
            const mins = (m % 60).toString().padStart(2, '0');
            return `${hrs}:${mins}`;
          };

          const exists = clashBands.some(cb => cb.startMin === oStart && cb.endMin === oEnd);
          if (!exists) {
            clashBands.push({
              startMin: oStart,
              endMin: oEnd,
              courseCodes: [evA.code, evB.code],
              startStr: formatMin(oStart),
              endStr: formatMin(oEnd)
            });
          }
        }
      });
    });

    events.sort((a, b) => a.startMin - b.startMin);

    return { events, clashBands };
  };

  const getLeftPct = (min: number) => {
    const pct = ((min - 480) / 540) * 100;
    return Math.max(0, Math.min(100, pct));
  };

  const getWidthPct = (startMin: number, endMin: number) => {
    const pct = ((endMin - startMin) / 540) * 100;
    return Math.max(2, Math.min(100 - getLeftPct(startMin), pct));
  };

  const handleAddRepeat = () => {
    if (!selectedRepeatCode) return;
    onAddRepeatCourse(selectedRepeatCode, selectedRepeatStatus);
  };

  const scrollToMobileDay = (day: string) => {
    const el = document.getElementById(`mobile-day-card-${day}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const hasClash = autoDroppedCourses.length > 0 || (sectionBPackages as any[]).some(p => p.clashesWithOtherRepeat);
  const hasRescued = rescuedBaseCourses.length > 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 1. Official Instructions Banner */}
      <div className="no-print bg-linear-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-4 sm:p-5 rounded-2xl shadow-lg border border-blue-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
        <div>
          <span className="inline-block bg-blue-500/20 text-blue-300 text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded-md mb-1.5 border border-blue-400/30">
            {student.session} · Panduan Rasmi MK &amp; BD
          </span>
          <h2 className="text-lg sm:text-xl md:text-2xl font-black tracking-tight leading-snug">
            Penyelarasan Jadual &amp; Penjanaan Borang PK01
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-3xl leading-relaxed">
            Utamakan pendaftaran kursus gagal (<b>C1/C2</b>) &amp; belum daftar (<b>BD - Status D</b>) dahulu di Bahagian B, diikuti kursus semasa yang tidak bertindih di Bahagian A.
          </p>
        </div>
        <div className="w-full md:w-auto bg-blue-800/40 p-3 rounded-xl border border-blue-700 text-xs flex md:flex-col justify-between items-center md:items-start shrink-0">
          <div className="text-blue-200 font-semibold flex items-center gap-1.5">
            <CalendarClock className="w-4 h-4 text-amber-300" /> Tarikh Akhir Hantar:
          </div>
          <div className="font-bold text-amber-300 text-sm">{student.deadline}</div>
        </div>
      </div>

      {/* 2. Official Registration Guide Accordion */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <button
          onClick={() => setIsGuideOpen(!isGuideOpen)}
          className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 cursor-pointer flex items-center justify-between text-xs font-bold text-slate-800 select-none transition text-left"
        >
          <span className="flex items-center gap-2">
            <BookOpenCheck className="w-4 h-4 text-blue-600 shrink-0" />
            Rujuk Panduan Rasmi Pendaftaran Pelajar MK &amp; BD (4 Langkah Utama)
          </span>
          <span className="text-[11px] text-blue-600 font-semibold flex items-center gap-1 shrink-0">
            {isGuideOpen ? (
              <>Tutup <ChevronUp className="w-3.5 h-3.5" /></>
            ) : (
              <>Klik untuk lihat <ChevronDown className="w-3.5 h-3.5" /></>
            )}
          </span>
        </button>

        {isGuideOpen && (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs border-t border-slate-200 bg-white">
            <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200">
              <div className="font-black text-amber-900 mb-1">1. Daftar MK / BD Dahulu</div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                Daftar kursus gagal (<b>C1</b> atau <b>C2</b>) dan/atau kursus belum daftar (<b>BD - status D</b>) dahulu. Isi dalam <b>Bahagian B (PK01)</b> &amp; dapatkan T/T pensyarah mengajar.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200">
              <div className="font-black text-blue-900 mb-1">2. Daftar Kursus Semasa</div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                Daftar kursus semasa yang <b>tidak bertindih</b> di <b>Bahagian A (status D)</b>. Jika kursus semasa menumpang seksyen lain, isi di <b>Bahagian B (status D)</b> beserta T/T pensyarah.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <div className="font-black text-emerald-900 mb-1">3. Semak Had 12–18 Kredit</div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                Jumlah jam kredit setiap semester mestilah antara <b>12 – 18 jam kredit</b>. Jika <b>&lt; 12</b> atau <b>&gt; 18 jam kredit</b>, kelulusan khas Ketua Jabatan (KJ) diperlukan.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div className="font-black text-slate-900 mb-1">4. Serahan Borang PK01</div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                Hantar Borang PK01 lengkap bertandatangan pensyarah kepada <b>Penasihat Akademik (PA)</b> &amp; seterusnya <b>Penyelaras Pendaftaran Kursus Jabatan</b> selewat-lewatnya <b>{student.deadline}</b>.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* External Timetable Empty / Loading State Banner */}
      {timetable.length === 0 && (
        <div className="no-print p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-2.5 text-xs">
            <Cloud className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-bold">
                {kvStatus === 'checking' || activeSourceInfo?.type === 'none'
                  ? 'Sedang memuatkan Jadual Induk terkini daripada sumber luaran...'
                  : 'Tiada Data Jadual Induk Ditemui daripada Sumber Luaran'}
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed">
                Aplikasi web ini membaca data jadual waktu terkini secara langsung (<code>no-store</code>) daripada <b>Cloudflare KV</b> (<code>/api/jadual</code>), <b>Google Sheets CSV</b>, atau fail luaran <code>/data/jadual.json</code>.
              </p>
            </div>
          </div>
          {onOpenKvLog && (
            <button
              type="button"
              onClick={onOpenKvLog}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] shrink-0 transition"
            >
              Semak Sumber Data
            </button>
          )}
        </div>
      )}

      {/* 3. Student Information Form */}
      <div className="no-print bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div>
          <label className="block text-[10px] sm:text-[11px] font-bold text-slate-600 uppercase mb-1">Nama Penuh Pelajar</label>
          <input
            type="text"
            value={student.name}
            placeholder="CONTOH: AHMAD BIN ALI"
            onChange={e => onUpdateStudent('name', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none uppercase"
          />
        </div>
        <div>
          <label className="block text-[10px] sm:text-[11px] font-bold text-slate-600 uppercase mb-1">No. Pendaftaran (Matrik)</label>
          <input
            type="text"
            value={student.regNum}
            placeholder="CONTOH: 05DKM24F1001"
            onChange={e => onUpdateStudent('regNum', e.target.value.toUpperCase())}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none uppercase font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] sm:text-[11px] font-bold text-slate-600 uppercase mb-1">No. Telefon</label>
          <input
            type="text"
            value={student.phone}
            placeholder="01X-XXXXXXX"
            onChange={e => onUpdateStudent('phone', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] sm:text-[11px] font-bold text-slate-600 uppercase mb-1">Penasihat Akademik (PA)</label>
          <input
            type="text"
            value={student.paName}
            placeholder="NAMA PENASIHAT AKADEMIK"
            onChange={e => onUpdateStudent('paName', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none uppercase"
          />
        </div>
      </div>

      {/* 4. Cohort Selector & Repeat Course Adder */}
      <div className="no-print bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h3 className="font-bold text-sm text-slate-800">Pemilihan Seksyen Semasa &amp; Kursus Mengulang</h3>
          </div>
          {lastAutoSavedTime && (
            <div className="flex items-center gap-1.5 text-[10.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full font-mono font-medium shadow-2xs">
              <Save className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
              <span>Auto-Save Aktif: {lastAutoSavedTime}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Seksyen Semasa Pelajar */}
          <div className="lg:col-span-5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <label className="text-xs font-bold text-slate-700 uppercase mb-1.5 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-600"></span> 1. Seksyen Semasa Pelajar (Kelas Asal)
            </label>
            <select
              value={student.currentCohort}
              onChange={e => onUpdateStudent('currentCohort', e.target.value)}
              disabled={availableCohorts.length === 0}
              className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none shadow-sm disabled:opacity-60"
            >
              {availableCohorts.length === 0 ? (
                <option value="">Tiada seksyen (menunggu sumber luaran)</option>
              ) : (
                <>
                  {availableCohorts.some(c => c.startsWith('DKM')) && (
                    <optgroup label="Diploma Kejuruteraan Mekanikal (DKM)">
                      {availableCohorts.filter(c => c.startsWith('DKM')).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  )}
                  {availableCohorts.some(c => c.startsWith('DAD')) && (
                    <optgroup label="Diploma Automotif (DAD)">
                      {availableCohorts.filter(c => c.startsWith('DAD')).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  )}
                  {availableCohorts.some(c => c.startsWith('DPU')) && (
                    <optgroup label="Diploma Pembuatan (DPU)">
                      {availableCohorts.filter(c => c.startsWith('DPU')).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  )}
                  {availableCohorts.some(c => c.startsWith('DTP')) && (
                    <optgroup label="Diploma Penyejukbekuan (DTP)">
                      {availableCohorts.filter(c => c.startsWith('DTP')).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  )}
                  {availableCohorts.filter(c => !c.startsWith('DKM') && !c.startsWith('DAD') && !c.startsWith('DPU') && !c.startsWith('DTP')).length > 0 && (
                    <optgroup label="Seksyen Lain">
                      {availableCohorts
                        .filter(c => !c.startsWith('DKM') && !c.startsWith('DAD') && !c.startsWith('DPU') && !c.startsWith('DTP'))
                        .map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                    </optgroup>
                  )}
                </>
              )}
            </select>
            <span className="text-[11px] text-slate-500 mt-1.5 block leading-tight">
              Jadual waktu penuh kelas ini dimuatkan sebagai asas.
            </span>

            {/* Kursus Pilihan (Ambil Satu) */}
            {electiveGroups.length > 0 && (
              <div className="mt-3.5 pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[11px] font-bold text-slate-700 uppercase">
                    Kursus Pilihan (Ambil Satu)
                  </label>
                  <span className="text-[9.5px] text-slate-500 font-medium">
                    {electiveGroups.length} slot pilihan
                  </span>
                </div>
                <div className="space-y-2">
                  {electiveGroups.map(group => (
                    <div key={group.key} className="p-2 rounded-xl border border-violet-200 bg-violet-50/60">
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <span className="text-[10px] font-bold text-violet-900 uppercase">
                          {group.day} {group.startTime}-{group.endTime}
                        </span>
                        <span className="text-[9.5px] text-violet-700 font-semibold">Pilih satu sahaja</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.options.map(option => {
                          const isActive = option.courseCode === group.selectedCourseCode;
                          return (
                            <button
                              key={option.courseCode}
                              type="button"
                              aria-pressed={isActive}
                              onClick={() => onSelectElectiveCourse(group.key, option.courseCode)}
                              className={`px-2 py-1 rounded-lg text-[10.5px] font-semibold border transition cursor-pointer ${
                                isActive
                                  ? 'bg-violet-700 text-white border-violet-700 shadow-xs'
                                  : 'bg-white text-violet-800 border-violet-300 hover:bg-violet-100'
                              }`}
                            >
                              {option.courseName}
                              <span className={`ml-1 ${isActive ? 'text-violet-200' : 'text-violet-500'}`}>
                                ({option.courseCode} ? {option.credit} kr)
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[9.5px] text-slate-500">
                  Hanya pilihan yang ditanda dimasukkan ke Bahagian A, jumlah kredit, jadual kuliah dan Borang PK01.
                </p>
              </div>
            )}

            {/* Kursus Kelas Asal (Gugur / Kekal) */}
            <div className="mt-3.5 pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[11px] font-bold text-slate-700 uppercase">
                  Kursus Kelas Asal (Pilihan Gugur)
                </label>
                <span className="text-[9.5px] text-slate-500 font-medium">Gugur prasyarat / had beban</span>
              </div>
              {basePackages.some(pkg => isBahasaKebangsaanA(pkg.Course_Code, pkg.Course_Name)) && (
                <label className="mb-2 flex items-start gap-2 p-2 rounded-xl border border-sky-200 bg-sky-50/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bahasaKebangsaanPassed}
                    onChange={e => onToggleBahasaKebangsaan(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-sky-700 cursor-pointer"
                  />
                  <span className="text-[10.5px] text-slate-700 leading-snug">
                    <span className="font-bold text-sky-900">Lulus Bahasa Melayu (SPM)</span>
                    <span className="block text-slate-600">
                      Bahasa Kebangsaan A dikecualikan. Nyahcentang jika anda tidak lulus Bahasa Melayu dan wajib
                      mendaftar kursus ini.
                    </span>
                  </span>
                </label>
              )}
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {basePackages.length === 0 ? (
                  <div className="text-[11px] text-slate-400 italic py-2">Tiada data kursus untuk seksyen ini.</div>
                ) : (
                  basePackages.map(pkg => {
                    const isManualDropped = manualDroppedCourseCodes.includes(pkg.Course_Code);
                    const bahasaKebangsaanExempt = bahasaKebangsaanExemptPackages.some(
                      p => p.Course_Code === pkg.Course_Code
                    );
                    const movedToSectionB = selectedRepeatCourses.find(r => r.code === pkg.Course_Code);
                    const unselectedElective = unselectedElectivePackages.find(p => p.Course_Code === pkg.Course_Code);
                    const rescueInfo = rescuedBaseCourses.find(r => r.originalPkg.Course_Code === pkg.Course_Code);
                    const prereqDropInfo = prereqDroppedCourses.find(p => p.pkg.Course_Code === pkg.Course_Code);
                    const autoDropInfo = autoDroppedCourses.find(a => a.pkg.Course_Code === pkg.Course_Code);

                    let rowStyle = 'bg-white border-slate-200';
                    let statusBadge = (
                      <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                        {pkg.Credit} Kredit
                      </span>
                    );

                    if (bahasaKebangsaanExempt) {
                      rowStyle = 'bg-sky-50/70 border-sky-200 opacity-85';
                      statusBadge = (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">
                          Dikecualikan (Lulus BM)
                        </span>
                      );
                    } else if (isManualDropped) {
                      rowStyle = 'bg-rose-50/70 border-rose-200 opacity-85';
                      statusBadge = (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                          Digugurkan Manual
                        </span>
                      );
                    } else if (movedToSectionB) {
                      rowStyle = 'bg-emerald-50/70 border-emerald-200';
                      statusBadge = (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Dipindah ke Bahagian B ({movedToSectionB.status})
                        </span>
                      );
                    } else if (unselectedElective) {
                      rowStyle = 'bg-violet-50/70 border-violet-200 opacity-85';
                      statusBadge = (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">
                          Pilihan Lain (Tidak Diambil)
                        </span>
                      );
                    } else if (rescueInfo) {
                      rowStyle = 'bg-emerald-50/70 border-emerald-200';
                      statusBadge = (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Auto-Tumpang {rescueInfo.rescuePkg.Cohort}
                        </span>
                      );
                    } else if (prereqDropInfo) {
                      rowStyle = 'bg-rose-50/70 border-rose-300';
                      statusBadge = (
                        <span
                          className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 cursor-help"
                          title={prereqDropInfo.reason}
                        >
                          Gugur Prasyarat
                        </span>
                      );
                    } else if (autoDropInfo) {
                      rowStyle = 'bg-amber-50/70 border-amber-300';
                      statusBadge = (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                          Syor Gugur (Clash)
                        </span>
                      );
                    }

                    return (
                      <div
                        key={pkg.Course_Code}
                        className={`p-2 rounded-xl border ${rowStyle} flex items-center justify-between gap-2 text-xs transition`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`font-bold text-slate-800 ${isManualDropped ? 'line-through text-slate-500' : ''}`}>
                              {pkg.Course_Code}
                            </span>
                            {statusBadge}
                          </div>
                          <div className={`text-[10.5px] text-slate-600 truncate ${isManualDropped ? 'line-through' : ''}`}>
                            {pkg.Course_Name}
                          </div>
                        </div>

                        {movedToSectionB ? (
                          <span className="text-[9.5px] font-bold text-emerald-700 shrink-0 px-1.5">
                            Seksyen B
                          </span>
                        ) : bahasaKebangsaanExempt ? (
                          <span className="text-[9.5px] font-bold text-sky-700 shrink-0 px-1.5">Tidak diambil</span>
                        ) : prereqDropInfo ? (
                          <span
                            className="text-[9.5px] font-bold text-rose-700 shrink-0 px-1.5 cursor-help"
                            title={prereqDropInfo.reason}
                          >
                            Auto (Prasyarat)
                          </span>
                        ) : isManualDropped ? (
                          <button
                            type="button"
                            onClick={() => onToggleManualDrop(pkg.Course_Code)}
                            className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] shrink-0 transition"
                          >
                            Ambil Semula
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onToggleManualDrop(pkg.Course_Code)}
                            className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-rose-600 text-slate-700 hover:text-white border border-slate-200 font-bold text-[10px] shrink-0 transition"
                          >
                            Gugur
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Bahagian B: Tambah Kursus Mengulang / Tumpang */}
          <div className="lg:col-span-7 bg-amber-50/70 p-3.5 rounded-xl border border-amber-200 flex flex-col justify-between">
            <div>
              <label className="text-xs font-bold text-amber-900 uppercase mb-1.5 flex items-center justify-between gap-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span> 2. Tambah Kursus Bahagian B (MK / BD / Tumpang)
                </span>
                <span className="text-[10px] bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full font-bold shrink-0">
                  Keutamaan No. 1
                </span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-6">
                  <select
                    value={selectedRepeatCode}
                    onChange={e => setSelectedRepeatCode(e.target.value)}
                    disabled={dynamicCourseOptions.length === 0}
                    className="w-full p-2 bg-white border border-amber-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-amber-500 outline-none disabled:opacity-60"
                  >
                    {dynamicCourseOptions.length === 0 ? (
                      <option value="">Tiada kursus (menunggu sumber luaran)</option>
                    ) : (
                      <>
                        <optgroup label="Senarai Kursus Terkini (MK / BD / Tumpang)">
                          {dynamicCourseOptions.map(opt => (
                            <option key={opt.code} value={opt.code}>
                              {opt.code} - {opt.name} ({opt.credit} Kr)
                            </option>
                          ))}
                        </optgroup>
                      </>
                    )}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <select
                    value={selectedRepeatStatus}
                    onChange={e => setSelectedRepeatStatus(e.target.value as any)}
                    className="w-full p-2 bg-white border border-amber-300 rounded-lg text-xs font-semibold focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    <option value="C1">C1 (Ulang 1 / MK1)</option>
                    <option value="C2">C2 (Ulang 2 / MK2)</option>
                    <option value="D">D (BD / Tumpang Semasa)</option>
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <button
                    type="button"
                    onClick={handleAddRepeat}
                    disabled={!selectedRepeatCode}
                    className="w-full p-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Tambah
                  </button>
                </div>
              </div>
            </div>

            {/* Selected Repeat Chips */}
            <div className="mt-3 pt-2 border-t border-amber-200">
              <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                <span className="text-[10px] font-bold text-amber-900 uppercase">
                  Senarai Kursus Tumpang Didaftarkan:
                </span>
                <div className="flex items-center gap-2">
                  {/* UNDO BUTTON for Repeat Courses */}
                  <button
                    type="button"
                    onClick={onUndoRepeatCourse}
                    disabled={!undoHistoryCount || undoHistoryCount === 0}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold flex items-center gap-1.5 transition shadow-2xs ${
                      undoHistoryCount && undoHistoryCount > 0
                        ? 'bg-amber-700 hover:bg-amber-800 text-white cursor-pointer active:scale-95 border border-amber-800'
                        : 'bg-amber-200/50 text-amber-800/40 border border-amber-300/40 cursor-not-allowed'
                    }`}
                    title={
                      undoHistoryCount && undoHistoryCount > 0
                        ? `Batal perubahan terakhir (Tekan Ctrl+Z). ${undoHistoryCount} langkah perubahan disimpan.`
                        : 'Tiada perubahan terkini untuk dibatalkan'
                    }
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Undo {undoHistoryCount > 0 ? `(${undoHistoryCount})` : ''}</span>
                  </button>

                  {selectedRepeatCourses.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearAllRepeat}
                      className="text-[10px] text-rose-600 hover:text-rose-800 font-bold underline flex items-center gap-1 transition"
                    >
                      <Trash2 className="w-3 h-3" /> Kosongkan Semua
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 min-h-7.5 items-center">
                {selectedRepeatCourses.length === 0 ? (
                  <span className="text-[11px] text-amber-800/70 italic">
                    Tiada kursus tumpang dipilih. Pilih kursus di atas dan klik "+ Tambah".
                  </span>
                ) : (
                  selectedRepeatCourses.map(item => {
                    const sample = timetable.find(r => r.Course_Code === item.code);
                    const courseTitle = sample ? sample.Course_Name : item.code;
                    return (
                      <span
                        key={item.code}
                        className="inline-flex items-center gap-1.5 bg-white border border-amber-300 text-amber-950 px-2.5 py-1 rounded-xl text-[11px] font-semibold shadow-xs"
                      >
                        <span className="font-bold text-amber-800 font-mono">{item.code}</span>
                        <span className="text-slate-600 truncate max-w-32.5 hidden sm:inline">
                          - {courseTitle}
                        </span>
                        <span className="bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold">
                          {item.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveRepeatCourse(item.code)}
                          title={`Buang ${item.code}`}
                          className="ml-0.5 px-1.5 py-0.5 rounded-md bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 text-[10px] font-bold transition flex items-center gap-0.5"
                        >
                          <span>Buang</span> ✕
                        </button>
                      </span>
                    );
                  })
                )}
              </div>

              {repeatPrereqViolations.length > 0 && (
                <div className="mt-2 space-y-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2">
                  {repeatPrereqViolations.map(v => (
                    <div key={`violation-${v.code}`} className="text-[10.5px] font-semibold text-rose-800">
                      <b>{v.code}</b> memerlukan <b>{v.prerequisiteCode}</b> ({v.prerequisiteName}) yang juga
                      sedang diulang. Pilih salah satu sahaja.
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Credit Hour Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
          <div className="flex items-center gap-3 sm:gap-4">
            <div>
              <span className="text-slate-500 block text-[9.5px] uppercase font-bold">Kredit Semasa (A)</span>
              <span className="font-bold text-slate-800 text-sm font-mono-tabular">{creditsA} Jam</span>
            </div>
            <div className="text-slate-300">|</div>
            <div>
              <span className="text-slate-500 block text-[9.5px] uppercase font-bold">Kredit Tumpang (B)</span>
              <span className="font-bold text-emerald-600 text-sm font-mono-tabular">+{creditsB} Jam</span>
            </div>
            <div className="text-slate-300">|</div>
            <div>
              <span className="text-slate-500 block text-[9.5px] uppercase font-bold">Jumlah (A + B)</span>
              <span className="font-black text-blue-600 text-sm font-mono-tabular">{totalCredits} Jam</span>
            </div>
          </div>

          <div>
            {totalCredits < 12 ? (
              <div className="px-2.5 sm:px-3 py-1.5 rounded-lg text-[10.5px] sm:text-[11px] font-bold border bg-rose-50 text-rose-800 border-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>Kurang Had (&lt; 12 Kredit) · Perlu Kebenaran KJ</span>
              </div>
            ) : totalCredits > 18 ? (
              <div className="px-2.5 sm:px-3 py-1.5 rounded-lg text-[10.5px] sm:text-[11px] font-bold border bg-amber-50 text-amber-900 border-amber-300 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Melebihi Had (&gt; 18 Kredit) · Perlu Kebenaran KJ</span>
              </div>
            ) : (
              <div className="px-2.5 sm:px-3 py-1.5 rounded-lg text-[10.5px] sm:text-[11px] font-bold border bg-emerald-50 text-emerald-800 border-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Beban Kredit Sah (12 – 18 Jam Kredit)</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5. Smart Recommendation & Clash Advisory Banner */}
      <div
        className={`no-print border-2 p-4 sm:p-5 rounded-2xl shadow-sm space-y-3 ${
          hasClash
            ? 'bg-amber-50/90 border-amber-300 text-amber-950'
            : hasRescued
            ? 'bg-blue-50/90 border-blue-300 text-blue-950'
            : 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {hasClash ? (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          ) : hasRescued ? (
            <Sparkles className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          )}
          <div>
            <h4 className="font-black text-sm sm:text-base">
              {hasClash
                ? 'Perhatian: Terdapat Pertindihan Masa (Tindakan Borang PK01 Disyorkan)'
                : hasRescued
                ? 'Penyelarasan Pintar Berjaya: Kursus Semasa Diselamatkan Melalui Tumpang Seksyen!'
                : 'Status Penyelarasan: Tiada Pertindihan Jadual (Sedia Dicetak)'}
            </h4>
            <p className="text-xs opacity-90 mt-0.5 leading-relaxed">
              {hasClash
                ? 'Mengikut garis panduan akademik JKM, kursus mengulang/BD diberi keutamaan dan kursus semasa yang berlanggar tanpa seksyen ganti disyorkan digugurkan.'
                : hasRescued
                ? 'Pertindihan jadual telah diselesaikan secara automatik dengan memindahkan kursus semasa yang berlanggar ke seksyen lain (Bahagian B - Status D).'
                : 'Semua kursus mengulang / tumpang berjaya ditempatkan pada slot masa kosong tanpa menggugurkan mana-mana kursus semasa.'}
            </p>
          </div>
        </div>

        <div className="bg-white/90 border border-black/10 rounded-xl p-3 sm:p-4 space-y-3">
          <div className="text-[11px] font-black uppercase tracking-wider text-slate-700">
            Cadangan Tindakan Borang PK01 (Bahagian B &amp; Pelarasan):
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Box 1: TAMBAH / TUMPANG (Bahagian B PK01) */}
            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3">
              <div className="text-[11px] font-black text-emerald-800 uppercase mb-2">
                1. Tambah / Tumpang (Bahagian B PK01):
              </div>
              {sectionBPackages.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Tiada kursus tumpang didaftarkan.</p>
              ) : (
                <div className="space-y-2">
                  {sectionBPackages.map((rp: any) => {
                    const scheduleStr = formatPackageSchedule(rp);
                    const lectStr = getPackageLecturers(rp);

                    return (
                      <div
                        key={rp.Course_Code}
                        className="pb-2 border-b border-emerald-200/70 last:border-b-0 last:pb-0 flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-xs">
                            {rp.Course_Code} - {rp.Course_Name} ({rp.Credit} Jam)
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-200/80 text-emerald-950 font-mono text-[10px]">
                              {rp.displayStatus}
                            </span>
                          </div>
                          <div className="text-[11px] text-emerald-800 font-medium mt-0.5">
                            {rp.isRescued ? (
                              <span>Dipindah dari {rp.originalCohort} ke <b>{rp.Cohort}</b></span>
                            ) : (
                              <span>Tumpang <b>{rp.Cohort}</b></span>
                            )}{' '}
                            [{scheduleStr}] · Pensyarah: {lectStr}
                          </div>

                          {/* Candidate alternative section switcher */}
                          {rp.scoredCandidates && rp.scoredCandidates.length > 1 && (
                            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-bold text-slate-600">Pilihan Seksyen:</span>
                              <select
                                value={rp.Cohort}
                                onChange={e => onChangeRepeatPreferredCohort(rp.Course_Code, e.target.value)}
                                className="px-2 py-0.5 bg-white border border-emerald-300 rounded-md text-[10.5px] font-semibold text-slate-800 outline-none"
                              >
                                {rp.scoredCandidates.map((sc: any) => {
                                  const clashTag =
                                    sc.clashedBase.length === 0 && !sc.clashesWithOtherRepeat
                                      ? '0 Terjejas ✓'
                                      : `Terjejas: ${sc.clashedBase.map((c: any) => c.Course_Code).join(', ') || 'MK berklash'}${sc.droppedCredits ? ` | gugur ${sc.droppedCredits} kr` : ''}`;
                                  return (
                                    <option key={sc.pkg.Cohort} value={sc.pkg.Cohort}>
                                      Tumpang {sc.pkg.Cohort} ({clashTag})
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                          )}

                          {rp.clashesWithOtherRepeat && (
                            <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100 border border-rose-300 px-2 py-0.5 rounded-md">
                              ⚠️ Bertindih dengan kursus MK/BD lain — sila tukar seksyen jika ada
                            </div>
                          )}
                        </div>

                        {!rp.isRescued && (
                          <button
                            type="button"
                            onClick={() => onRemoveRepeatCourse(rp.Course_Code)}
                            className="px-2 py-1 rounded-lg bg-white hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 text-[10px] font-bold shrink-0 transition flex items-center gap-1 shadow-2xs"
                          >
                            <Trash2 className="w-3 h-3" /> Buang
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Box 2: SYOR GUGUR (Kursus Semasa) */}
            <div className="bg-rose-50/80 border border-rose-200 rounded-xl p-3">
              <div className="text-[11px] font-black text-rose-800 uppercase mb-2">
                2. Kursus Semasa Digugurkan:
              </div>
              {autoDroppedCourses.length === 0 &&
              manualDroppedPackages.length === 0 &&
              prereqDroppedCourses.length === 0 ? (
                <p className="text-xs text-emerald-700 font-semibold">
                  Tiada kursus semasa perlu digugurkan. Semua subjek kelas asal kekal!
                </p>
              ) : (
                <div className="space-y-2">
                  {prereqDroppedCourses.map(pd => (
                    <div key={`prereq-${pd.pkg.Course_Code}`} className="pb-2 border-b border-rose-200/70 last:border-b-0 last:pb-0">
                      <div className="font-bold text-slate-900 text-xs">
                        {pd.pkg.Course_Code} - {pd.pkg.Course_Name} ({pd.pkg.Credit} Jam)
                      </div>
                      <div className="text-[11px] text-rose-700 font-medium mt-0.5">
                        {pd.reason}
                      </div>
                      {pd.chain.length > 2 && (
                        <div className="text-[10.5px] font-mono text-rose-600 mt-0.5">
                          {pd.chain.join(' → ')}
                        </div>
                      )}
                    </div>
                  ))}

                  {autoDroppedCourses.map(ad => (
                    <div key={ad.pkg.Course_Code} className="pb-2 border-b border-rose-200/70 last:border-b-0 last:pb-0">
                      <div className="font-bold text-slate-900 text-xs">
                        {ad.pkg.Course_Code} - {ad.pkg.Course_Name} ({ad.pkg.Credit} Jam)
                      </div>
                      <div className="text-[11px] text-rose-700 font-medium mt-0.5">
                        Berlanggar dengan: <b>{ad.clashedWithCodes.join(', ')}</b> (Tiada seksyen ganti kosong)
                      </div>
                    </div>
                  ))}

                  {manualDroppedPackages.map(mp => (
                    <div key={mp.Course_Code} className="pb-2 border-b border-rose-200/70 last:border-b-0 last:pb-0 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900 text-xs">
                          {mp.Course_Code} - {mp.Course_Name} ({mp.Credit} Jam)
                        </div>
                        <div className="text-[11px] text-rose-700 font-medium mt-0.5">
                          Digugurkan secara manual (Prasyarat / Had Beban)
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleManualDrop(mp.Course_Code)}
                        className="px-2 py-0.5 rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-600 hover:text-white text-[10px] font-bold shrink-0 transition"
                      >
                        Batal Gugur
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 5B. VISUALISASI TIMELINE PERTINDIHAN MASA (GRAPHIC CLASH TIMELINE) */}
      {(() => {
        const totalClashes = WEEK_DAYS.reduce((sum, day) => sum + getDayEventsAndClashes(day).clashBands.length, 0);

        return (
          <div className="no-print bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            {/* Timeline Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-xs">
                    <ShieldAlert className="w-4 h-4 text-white" />
                    <span>Visualisasi Timeline Pertindihan</span>
                  </span>
                  {totalClashes > 0 ? (
                    <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-xs font-bold flex items-center gap-1.5 animate-pulse">
                      <Flame className="w-3.5 h-3.5 text-rose-600" />
                      <span>{totalClashes} Konflik Masa Dikesan</span>
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Tiada Pertindihan Masa (100% Bebas Clash)</span>
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-slate-900 text-sm sm:text-base mt-1.5">
                  Grafik Slot Masa Berlanggar (8.00 Pagi – 5.00 Petang)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Sorotan jalur merah berjalur (<i>diagonal stripe overlay</i>) menunjukkan dengan jelas slot masa bertindih antara subjek semasa dan tumpang.
                </p>
              </div>

              {/* Day Selector Tabs */}
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold overflow-x-auto">
                  {WEEK_DAYS.map(d => {
                    const { clashBands, events } = getDayEventsAndClashes(d);
                    const isSelected = timelineDayFilter === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setTimelineDayFilter(d)}
                        className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1 whitespace-nowrap ${
                          isSelected
                            ? 'bg-blue-600 text-white font-bold shadow-xs'
                            : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                        }`}
                      >
                        <span>{d}</span>
                        {clashBands.length > 0 ? (
                          <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[9.5px] font-bold">
                            {clashBands.length} ⚠️
                          </span>
                        ) : events.length > 0 ? (
                          <span className="text-[10px] opacity-75 font-mono">({events.length})</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setShowOnlyClashes(!showOnlyClashes)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 whitespace-nowrap ${
                    showOnlyClashes
                      ? 'bg-rose-600 text-white border-rose-700 shadow-xs ring-2 ring-rose-300'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 text-rose-400" />
                  <span>{showOnlyClashes ? 'Tunjuk Semua Kursus' : 'Tapis Konflik Sahaja'}</span>
                </button>
              </div>
            </div>

            {/* Render Timeline Bars for selected timelineDayFilter */}
            {(() => {
              const { events, clashBands } = getDayEventsAndClashes(timelineDayFilter);
              const displayEvents = showOnlyClashes ? events.filter(e => e.hasClash) : events;

              return (
                <div className="space-y-3">
                  {/* Visual Bar Canvas Container */}
                  <div className="border border-slate-200 rounded-2xl p-3 sm:p-4 bg-slate-950 text-white shadow-inner overflow-x-auto space-y-3">
                    
                    {/* Time Header Scale Bar */}
                    <div className="min-w-180">
                      <div className="grid grid-cols-9 text-center font-mono text-[10.5px] font-bold text-slate-300 border-b border-slate-800 pb-2">
                        <div className="border-r border-slate-800">08:00 - 09:00</div>
                        <div className="border-r border-slate-800">09:00 - 10:00</div>
                        <div className="border-r border-slate-800">10:00 - 11:00</div>
                        <div className="border-r border-slate-800">11:00 - 12:00</div>
                        <div className="border-r border-slate-800 text-amber-300 bg-amber-950/40">12:00 - 13:00</div>
                        <div className="border-r border-slate-800">13:00 - 14:00</div>
                        <div className="border-r border-slate-800">14:00 - 15:00</div>
                        <div className="border-r border-slate-800">15:00 - 16:00</div>
                        <div>16:00 - 17:00</div>
                      </div>

                      {/* Course Row Bars */}
                      <div className="relative pt-3 space-y-2.5 min-h-35">
                        
                        {/* Render Overlap Red Bands (Highlighted Clash Window Overlay) */}
                        {clashBands.map((cb, cbIdx) => (
                          <div
                            key={cbIdx}
                            style={{
                              left: `${getLeftPct(cb.startMin)}%`,
                              width: `${getWidthPct(cb.startMin, cb.endMin)}%`
                            }}
                            className="absolute top-0 bottom-0 bg-rose-600/30 border-x-2 border-rose-500 pointer-events-none z-10 flex flex-col items-center justify-start pt-1 animate-pulse"
                          >
                            <span className="bg-rose-900 text-rose-100 font-mono font-black text-[9px] px-1.5 py-0.5 rounded border border-rose-400 shadow-sm">
                              ⚠️ BERTINDIH {cb.startStr}-{cb.endStr}
                            </span>
                          </div>
                        ))}

                        {displayEvents.length === 0 ? (
                          <div className="text-center text-slate-400 italic text-xs py-8 bg-slate-900/50 rounded-xl border border-slate-800">
                            {showOnlyClashes
                              ? `Tiada pertindihan masa dikesan pada hari ${timelineDayFilter}!`
                              : `Tiada subjek dijadualkan pada hari ${timelineDayFilter}.`}
                          </div>
                        ) : (
                          displayEvents.map((ev, eIdx) => {
                            const left = getLeftPct(ev.startMin);
                            const width = getWidthPct(ev.startMin, ev.endMin);

                            let barColor = 'bg-linear-to-r from-blue-600 to-indigo-700 border-blue-400 text-white shadow-md';
                            if (ev.hasClash) {
                              barColor = 'bg-linear-to-r from-rose-600 via-red-600 to-rose-700 border-2 border-rose-300 ring-2 ring-rose-500/50 text-white font-bold shadow-lg animate-pulse z-20';
                            } else if (ev.type === 'tumpang') {
                              barColor = 'bg-linear-to-r from-emerald-600 to-teal-700 border-emerald-400 text-white shadow-md';
                            }

                            return (
                              <div key={`${ev.code}-${eIdx}`} className="relative h-11 w-full bg-slate-900/80 rounded-xl border border-slate-800/80">
                                <div
                                  style={{
                                    left: `${left}%`,
                                    width: `${width}%`
                                  }}
                                  className={`absolute top-0 bottom-0 rounded-xl p-2 flex items-center justify-between gap-1 overflow-hidden transition-all ${barColor}`}
                                  title={`${ev.code} (${ev.start} - ${ev.end}) ${ev.venue} · ${ev.lecturer}${ev.hasClash ? ` [BERLANGGAR DENGAN ${ev.clashedWith?.join(', ')}]` : ''}`}
                                >
                                  <div className="min-w-0 truncate">
                                    <div className="flex items-center gap-1 truncate text-[11px] font-bold">
                                      {ev.hasClash && <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 animate-bounce" />}
                                      <span className="font-mono">{ev.code}</span>
                                      <span className="opacity-90 font-normal text-[10.5px] truncate">({ev.start} - {ev.end})</span>
                                    </div>
                                    <div className="text-[9.5px] opacity-85 truncate">
                                      {ev.type === 'tumpang' ? `Tumpang ${ev.cohort}` : ev.cohort} · {ev.venue}
                                    </div>
                                  </div>

                                  <div className="shrink-0 text-right">
                                    {ev.hasClash ? (
                                      <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-200 border border-rose-400 text-[9px] font-mono font-bold uppercase">
                                        CLASH
                                      </span>
                                    ) : (
                                      <span className="text-[9px] font-semibold opacity-80">
                                        {ev.credit} Kr
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Clash Detail Cards & One-Click Resolution Actions */}
                  {clashBands.length > 0 && (
                    <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl space-y-2.5">
                      <div className="flex items-center justify-between text-rose-900 font-bold text-xs border-b border-rose-200 pb-1.5">
                        <span className="flex items-center gap-1.5">
                          <ShieldAlert className="w-4 h-4 text-rose-600" />
                          Laporan Ralat Pertindihan Masa ({timelineDayFilter}):
                        </span>
                        <span className="text-[10.5px] text-rose-700 font-medium">
                          {clashBands.length} slot berlanggar
                        </span>
                      </div>

                      <div className="space-y-2">
                        {clashBands.map((cb, idx) => {
                          const clashedEvents = events.filter(e => e.hasClash && cb.courseCodes.includes(e.code));
                          return (
                            <div key={idx} className="p-3 bg-white border border-rose-200 rounded-xl space-y-2 text-xs shadow-2xs">
                              <div className="flex items-center justify-between text-rose-800 font-bold text-[11.5px]">
                                <span>Konflik Masa: Slot {cb.startStr} - {cb.endStr} ({timelineDayFilter})</span>
                                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-mono text-[10px]">
                                  {cb.courseCodes.join(' VS ')}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                                {clashedEvents.map((ce, cIdx) => (
                                  <div key={cIdx} className="p-2 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                                    <div className="font-bold text-slate-900 flex items-center justify-between">
                                      <span>{ce.code} - {ce.name}</span>
                                      <span className={`text-[9.5px] px-1.5 py-0.2 rounded font-bold ${
                                        ce.type === 'tumpang' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                                      }`}>
                                        {ce.type === 'tumpang' ? `Tumpang ${ce.cohort}` : `Asas (${ce.cohort})`}
                                      </span>
                                    </div>
                                    <div className="text-slate-600 text-[10.5px]">
                                      Masa: <b>{ce.start} - {ce.end}</b> · Bilik: <b>{ce.venue}</b> · Pensyarah: <b>{ce.lecturer}</b>
                                    </div>

                                    {/* Action Suggestions */}
                                    <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                                      {ce.type === 'kept' ? (
                                        <button
                                          type="button"
                                          onClick={() => onToggleManualDrop(ce.code)}
                                          className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-600 text-rose-800 hover:text-white border border-rose-300 font-bold text-[10px] transition"
                                        >
                                          Gugur Subjek Semasa ({ce.code})
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => onRemoveRepeatCourse(ce.code)}
                                          className="px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-600 text-amber-900 hover:text-white border border-amber-300 font-bold text-[10px] transition"
                                        >
                                          Buang Subjek Tumpang ({ce.code})
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* 6. TIMETABLE VISUALIZER: DUAL UI (MOBILE CARDS VS DESKTOP MATRIX) */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <h3 className="font-bold text-slate-800 text-sm md:text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" /> Visual Jadual Waktu Bersih Pelajar
            </h3>
            <p className="text-xs text-slate-500">
              Masa interaktif Isnin hingga Jumaat (8.00 pagi - 5.00 petang).
            </p>
          </div>

          {/* Color Legend */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10.5px] sm:text-[11px]">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md font-medium">
              <span className="w-2 h-2 bg-blue-600 rounded-xs"></span> Kekal
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-medium">
              <span className="w-2 h-2 bg-emerald-600 rounded-xs"></span> Tumpang
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-md font-medium">
              <span className="w-2 h-2 bg-rose-600 rounded-xs"></span> Digugurkan
            </span>
          </div>
        </div>

        {/* 6A. MOBILE & TABLET VIEW: DAY AGENDA CARDS */}
        <div className="block lg:hidden space-y-3">
          {/* Day Quick Jump Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {WEEK_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => scrollToMobileDay(day)}
                className="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-lg font-bold text-slate-700 text-[11px] shrink-0 transition"
              >
                {day}
              </button>
            ))}
          </div>

          {/* Cards Container */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            {WEEK_DAYS.map(day => {
              const dayEvents: any[] = [];

              keptBasePackages.forEach(pkg => {
                pkg.slots
                  .filter(s => s.Day.toLowerCase() === day.toLowerCase())
                  .forEach(s => {
                    dayEvents.push({
                      type: 'kept',
                      code: pkg.Course_Code,
                      name: pkg.Course_Name,
                      credit: pkg.Credit,
                      cohort: pkg.Cohort,
                      start: s.Start_Time,
                      end: s.End_Time,
                      venue: s.Venue,
                      lecturer: s.Lecturer,
                      statusLabel: 'KEKAL'
                    });
                  });
              });

              sectionBPackages.forEach(pkg => {
                pkg.slots
                  .filter(s => s.Day.toLowerCase() === day.toLowerCase())
                  .forEach(s => {
                    dayEvents.push({
                      type: 'tumpang',
                      code: pkg.Course_Code,
                      name: pkg.Course_Name,
                      credit: pkg.Credit,
                      cohort: pkg.Cohort,
                      start: s.Start_Time,
                      end: s.End_Time,
                      venue: s.Venue,
                      lecturer: s.Lecturer,
                      statusLabel: `TUMPANG [${pkg.Cohort} - ${(pkg as any).displayStatus}]`
                    });
                  });
              });

              autoDroppedCourses.forEach(ad => {
                ad.pkg.slots
                  .filter(s => s.Day.toLowerCase() === day.toLowerCase())
                  .forEach(s => {
                    dayEvents.push({
                      type: 'dropped',
                      code: ad.pkg.Course_Code,
                      name: ad.pkg.Course_Name,
                      credit: ad.pkg.Credit,
                      cohort: ad.pkg.Cohort,
                      start: s.Start_Time,
                      end: s.End_Time,
                      venue: s.Venue,
                      lecturer: s.Lecturer,
                      statusLabel: 'DIGUGURKAN (CLASH)'
                    });
                  });
              });

              manualDroppedPackages.forEach(mp => {
                mp.slots
                  .filter(s => s.Day.toLowerCase() === day.toLowerCase())
                  .forEach(s => {
                    dayEvents.push({
                      type: 'dropped',
                      code: mp.Course_Code,
                      name: mp.Course_Name,
                      credit: mp.Credit,
                      cohort: mp.Cohort,
                      start: s.Start_Time,
                      end: s.End_Time,
                      venue: s.Venue,
                      lecturer: s.Lecturer,
                      statusLabel: 'DIGUGURKAN (MANUAL)'
                    });
                  });
              });

              dayEvents.sort((a, b) => parseTime(a.start) - parseTime(b.start));

              // Internal clash detector
              dayEvents.forEach((ev, idx) => {
                if (ev.type === 'dropped') return;
                ev.hasInternalClash = dayEvents.some(
                  (other, oIdx) =>
                    idx !== oIdx &&
                    other.type !== 'dropped' &&
                    isTimeClashing(ev.start, ev.end, other.start, other.end)
                );
              });

              return (
                <div
                  key={day}
                  id={`mobile-day-card-${day}`}
                  className="border border-slate-200 rounded-2xl p-3 bg-white shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <span className="font-black text-xs uppercase tracking-wider text-slate-800">{day}</span>
                    <span className="text-[10px] font-semibold text-slate-500">
                      {dayEvents.filter(e => e.type !== 'dropped').length} Sesi Aktif
                    </span>
                  </div>

                  <div className="space-y-2">
                    {dayEvents.length === 0 ? (
                      <div className="text-xs text-slate-400 italic py-2 px-3 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        Tiada kuliah dijadualkan pada hari {day}.
                      </div>
                    ) : (
                      dayEvents.map((ev, eIdx) => {
                        let cardClass = 'bg-blue-50/70 border-blue-200';
                        let badgeClass = 'bg-blue-600 text-white';
                        let titleClass = 'text-slate-900';

                        if (ev.hasInternalClash) {
                          cardClass = 'bg-amber-50 border-rose-400 ring-1 ring-rose-300';
                          badgeClass = 'bg-rose-600 text-white';
                        } else if (ev.type === 'tumpang') {
                          cardClass = 'bg-emerald-50/80 border-emerald-300';
                          badgeClass = 'bg-emerald-600 text-white';
                        } else if (ev.type === 'dropped') {
                          cardClass = 'bg-rose-50/70 border-rose-200 opacity-75';
                          badgeClass = 'bg-rose-600 text-white';
                          titleClass = 'line-through text-slate-500';
                        }

                        const displayBadge = ev.hasInternalClash
                          ? `⚠️ BERTINDIH · ${ev.statusLabel}`
                          : ev.statusLabel;

                        return (
                          <div
                            key={`${ev.code}-${eIdx}`}
                            className={`p-3 rounded-xl border ${cardClass} space-y-1`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-black font-mono text-slate-700 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                {ev.start} - {ev.end}
                              </span>
                              <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>
                                {displayBadge}
                              </span>
                            </div>
                            <div className={`font-bold text-xs ${titleClass} pt-0.5`}>
                              {ev.code} - {ev.name}
                            </div>
                            <div className="flex items-center justify-between text-[10.5px] text-slate-600 pt-0.5">
                              <span>📍 {ev.venue}</span>
                              <span>👨‍🏫 {ev.lecturer} ({ev.credit} Kr)</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 6B. DESKTOP VIEW: 8.00 AM - 5.00 PM FULL MATRIX GRID */}
        <div className="hidden lg:block overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse text-xs min-w-190">
            <thead>
              <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 text-center font-bold">
                <th className="p-2.5 border-r border-slate-200 w-24">HARI</th>
                <th className="p-2 border-r border-slate-200 w-28">8.00 - 9.00</th>
                <th className="p-2 border-r border-slate-200 w-28">9.00 - 10.00</th>
                <th className="p-2 border-r border-slate-200 w-28">10.00 - 11.00</th>
                <th className="p-2 border-r border-slate-200 w-28">11.00 - 12.00</th>
                <th className="p-2 border-r border-slate-200 bg-amber-50/70 text-amber-900 w-24">12.00 - 1.00</th>
                <th className="p-2 border-r border-slate-200 w-28">1.00 - 2.00</th>
                <th className="p-2 border-r border-slate-200 w-28">2.00 - 3.00</th>
                <th className="p-2 border-r border-slate-200 w-28">3.00 - 4.00</th>
                <th className="p-2 w-28">4.00 - 5.00</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {WEEK_DAYS.map(day => {
                const activeEvents: any[] = [];
                keptBasePackages.forEach(pkg => {
                  pkg.slots
                    .filter(s => s.Day.toLowerCase() === day.toLowerCase())
                    .forEach(s => {
                      activeEvents.push({
                        type: 'kept',
                        code: pkg.Course_Code,
                        name: pkg.Course_Name,
                        cohort: pkg.Cohort,
                        day: s.Day,
                        start: s.Start_Time,
                        end: s.End_Time,
                        venue: s.Venue,
                        lecturer: s.Lecturer
                      });
                    });
                });

                sectionBPackages.forEach(pkg => {
                  pkg.slots
                    .filter(s => s.Day.toLowerCase() === day.toLowerCase())
                    .forEach(s => {
                      activeEvents.push({
                        type: 'tumpang',
                        code: pkg.Course_Code,
                        name: pkg.Course_Name,
                        cohort: pkg.Cohort,
                        displayStatus: (pkg as any).displayStatus,
                        day: s.Day,
                        start: s.Start_Time,
                        end: s.End_Time,
                        venue: s.Venue,
                        lecturer: s.Lecturer
                      });
                    });
                });

                const cells: React.ReactNode[] = [];
                let slotIdx = 0;

                while (slotIdx < TIME_SLOTS.length) {
                  const slot = TIME_SLOTS[slotIdx];
                  const slotStartMin = parseTime(slot.start);

                  const matchedEvents = activeEvents.filter(ev => {
                    const evStart = parseTime(ev.start);
                    const evEnd = parseTime(ev.end);
                    return evStart <= slotStartMin && evEnd > slotStartMin;
                  });

                  if (matchedEvents.length > 0) {
                    const maxEndMin = Math.max(...matchedEvents.map(ev => parseTime(ev.end)));
                    let span = 1;
                    while (
                      slotIdx + span < TIME_SLOTS.length &&
                      parseTime(TIME_SLOTS[slotIdx + span].start) < maxEndMin
                    ) {
                      span++;
                    }

                    if (matchedEvents.length === 1) {
                      const ev = matchedEvents[0];
                      const isTumpang = ev.type === 'tumpang';
                      const cellBg = isTumpang
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                        : 'bg-blue-50 border-blue-200 text-blue-950';

                      cells.push(
                        <td
                          key={`desktop-${day}-${slot.start}`}
                          colSpan={span}
                          className={`p-2 border-r border-slate-200 align-top ${cellBg}`}
                        >
                          {isTumpang ? (
                            <span className="inline-block bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded mb-0.5">
                              TUMPANG {ev.cohort} ({ev.displayStatus})
                            </span>
                          ) : (
                            <span className="inline-block bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded mb-0.5">
                              {ev.cohort}
                            </span>
                          )}
                          <div className="font-bold text-[11px] leading-tight font-mono">{ev.code}</div>
                          <div className="text-[10px] leading-tight opacity-90 line-clamp-1">{ev.name}</div>
                          <div className="text-[9.5px] font-semibold mt-1 opacity-75">
                            {ev.venue} · {ev.lecturer}
                          </div>
                        </td>
                      );
                    } else {
                      // Stacked cells when two MKs overlap
                      cells.push(
                        <td
                          key={`desktop-${day}-${slot.start}`}
                          colSpan={span}
                          className="p-1.5 border-r border-slate-200 align-top bg-rose-50/90"
                        >
                          {matchedEvents.map((ev, mIdx) => (
                            <div
                              key={mIdx}
                              className="p-1.5 rounded-lg bg-white/95 border border-rose-300 mb-1 last:mb-0 shadow-2xs"
                            >
                              <span className="inline-block bg-rose-600 text-white text-[8.5px] font-bold px-1.5 py-0.2 rounded mb-0.5">
                                ⚠️ BERTINDIH · {ev.cohort} ({ev.displayStatus || 'D'})
                              </span>
                              <div className="font-bold text-[10.5px] leading-tight text-rose-950 font-mono">
                                {ev.code} ({ev.start}-{ev.end})
                              </div>
                              <div className="text-[9px] text-slate-700">{ev.venue} · {ev.lecturer}</div>
                            </div>
                          ))}
                        </td>
                      );
                    }
                    slotIdx += span;
                  } else {
                    if (slot.isBreak) {
                      cells.push(
                        <td
                          key={`desktop-${day}-${slot.start}`}
                          className="p-2 border-r border-slate-200 bg-amber-50/50 text-center text-[10px] font-semibold text-amber-800/70"
                        >
                          REHAT
                        </td>
                      );
                    } else {
                      cells.push(
                        <td
                          key={`desktop-${day}-${slot.start}`}
                          className="p-2 border-r border-slate-200 text-center text-slate-300 text-[10px]"
                        >
                          -
                        </td>
                      );
                    }
                    slotIdx++;
                  }
                }

                return (
                  <tr key={day}>
                    <td className="p-2.5 border-r border-slate-200 font-bold text-slate-800 bg-slate-50 text-center">
                      {day}
                    </td>
                    {cells}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
