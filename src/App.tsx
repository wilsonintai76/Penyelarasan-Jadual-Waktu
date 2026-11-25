import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { PlannerView } from './components/PlannerView';
import { BorangPK01View } from './components/BorangPK01View';
import { JadualKuliahView } from './components/JadualKuliahView';
import { BottomNav } from './components/BottomNav';
import { DataManagementModal, ModalSubTab, BindingsStatus } from './components/DataManagementModal';
import { ToastContainer, ToastItem } from './components/ToastContainer';
import { runFullAnalysis } from './utils/timetableSolver';
import { APP_VERSION_LABEL, formatBuildStamp } from './version';
import {
  fetchLatestExternalTimetable,
  fetchSystemSettings,
  DEFAULT_SYSTEM_SETTINGS,
  ExternalSourceType
} from './utils/externalTimetableLoader';
import {
  StudentInfo,
  RepeatSelection,
  MasterTimetableEntry,
  TimetableChangeLogEntry,
  TimetableChangeSource,
  SystemSettings,
  CurriculumData,
  CurriculumLibrary
} from './types';

const INITIAL_STUDENT_INFO: StudentInfo = {
  name: '',
  regNum: '',
  phone: '',
  paName: '',
  currentCohort: '',
  session: 'Sesi II: 2026/2027',
  department: 'JABATAN KEJURUTERAAN MEKANIKAL',
  deadline: '04 DIS 2026 (JUMAAT)'
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'planner' | 'pk01' | 'jadual'>('planner');
  const [student, setStudent] = useState<StudentInfo>(() => {
    try {
      const saved = localStorage.getItem('pks_student_info');
      return saved ? JSON.parse(saved) : INITIAL_STUDENT_INFO;
    } catch {
      return INITIAL_STUDENT_INFO;
    }
  });

  const [timetable, setTimetable] = useState<MasterTimetableEntry[]>(() => {
    try {
      const saved = localStorage.getItem('pks_master_timetable');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [selectedRepeatCourses, setSelectedRepeatCourses] = useState<RepeatSelection[]>(() => {
    try {
      const saved = localStorage.getItem('pks_repeat_courses');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [manualDroppedCourseCodes, setManualDroppedCourseCodes] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('pks_manual_dropped_courses');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Curriculum prerequisites for every programme, merged by course code at runtime.
  const [curricula, setCurricula] = useState<CurriculumLibrary | null>(null);
  const [curriculumRefreshKey, setCurriculumRefreshKey] = useState(0);

  // Undo History Stack for course selection changes
  const [undoHistory, setUndoHistory] = useState<
    Array<{
      repeatCourses: RepeatSelection[];
      manualDroppedCourses: string[];
    }>
  >([]);

  // Auto-save timestamp tracking
  const [lastAutoSavedTime, setLastAutoSavedTime] = useState<string>(() => {
    return new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState<ModalSubTab>('upload_timetable');
  const [kvStatus, setKvStatus] = useState<'checking' | 'connected' | 'local_only'>('checking');
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(() => {
    try {
      const saved = localStorage.getItem('pks_system_settings');
      return saved ? { ...DEFAULT_SYSTEM_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SYSTEM_SETTINGS;
    } catch {
      return DEFAULT_SYSTEM_SETTINGS;
    }
  });
  const [bindingsStatus, setBindingsStatus] = useState<BindingsStatus>({
    kvBound: false,
    r2Bound: false,
    aiBound: false,
    passcodeRequired: true,
    pinSource: 'default'
  });
  const [activeSourceInfo, setActiveSourceInfo] = useState<{
    type: ExternalSourceType;
    label: string;
    url: string;
  }>({
    type: 'none',
    label: 'Menyemak sumber luaran...',
    url: '/data/jadual.json'
  });
  const [latestChangeLog, setLatestChangeLog] = useState<TimetableChangeLogEntry | null>(() => {
    try {
      const saved = localStorage.getItem('pks_latest_kv_changelog');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const prevCreditState = useRef<'normal' | 'under' | 'over'>('normal');

  // Push snapshot to Undo History before modifying selections
  const saveUndoSnapshot = () => {
    setUndoHistory(prev => {
      const next = [
        ...prev,
        {
          repeatCourses: JSON.parse(JSON.stringify(selectedRepeatCourses)),
          manualDroppedCourses: [...manualDroppedCourseCodes]
        }
      ];
      // Keep max 25 steps in undo stack
      return next.length > 25 ? next.slice(next.length - 25) : next;
    });
  };

  // Auto-Save System: Saves student, timetable, repeat courses, & manual drops to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('pks_student_info', JSON.stringify(student));
      localStorage.setItem('pks_repeat_courses', JSON.stringify(selectedRepeatCourses));
      localStorage.setItem('pks_manual_dropped_courses', JSON.stringify(manualDroppedCourseCodes));
      setLastAutoSavedTime(
        new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    } catch (e) {
      console.error('Ralat Auto-Save ke localStorage:', e);
    }
  }, [student, selectedRepeatCourses, manualDroppedCourseCodes]);

  // Periodic Auto-Save Timer (Periodic background check every 15 seconds)
  useEffect(() => {
    const timer = setInterval(() => {
      try {
        localStorage.setItem('pks_student_info', JSON.stringify(student));
        localStorage.setItem('pks_repeat_courses', JSON.stringify(selectedRepeatCourses));
        localStorage.setItem('pks_manual_dropped_courses', JSON.stringify(manualDroppedCourseCodes));
        if (timetable && timetable.length > 0) {
          localStorage.setItem('pks_master_timetable', JSON.stringify(timetable));
        }
      } catch (e) {
        console.error('Ralat Periodic Auto-Save:', e);
      }
    }, 15000);

    return () => clearInterval(timer);
  }, [student, selectedRepeatCourses, manualDroppedCourseCodes, timetable]);

  // Persist only the latest KV change log entry
  useEffect(() => {
    try {
      if (latestChangeLog) {
        localStorage.setItem('pks_latest_kv_changelog', JSON.stringify(latestChangeLog));
      }
    } catch {
      // ignore storage quota errors
    }
  }, [latestChangeLog]);

  const activeTimetableCountRef = useRef<number>(timetable.length);
  useEffect(() => {
    activeTimetableCountRef.current = timetable.length;
  }, [timetable]);

  // Helper to compute deterministic signature for any timetable array
  const computeTimetableSignature = (entries: MasterTimetableEntry[]): string => {
    const raw = JSON.stringify(
      entries.map(e => `${e.Cohort}|${e.Course_Code}|${e.Day}|${e.Start_Time}|${e.End_Time}|${e.Venue}|${e.Lecturer}`)
    );
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${entries.length}-${(hash >>> 0).toString(16)}`;
  };

  const activeTimetableSigRef = useRef<string>(computeTimetableSignature(timetable));
  const lastKvCheckRef = useRef<number>(0);

  useEffect(() => {
    activeTimetableSigRef.current = computeTimetableSignature(timetable);
  }, [timetable]);

  const syncExternalTimetable = async (
    isBackgroundPoll: boolean,
    forceCheck = false
  ): Promise<{ synced: boolean; message: string }> => {
    const now = Date.now();
    if (isBackgroundPoll && !forceCheck && now - lastKvCheckRef.current < 15000) {
      return { synced: false, message: 'Semakan terbaharu baru sahaja dijalankan.' };
    }
    lastKvCheckRef.current = now;

    try {
      const result = await fetchLatestExternalTimetable();

      setKvStatus(result.kvBound || result.activeSource === 'cloudflare_kv' ? 'connected' : 'local_only');
      setActiveSourceInfo({
        type: result.activeSource,
        label: result.sourceLabel,
        url: result.sourceUrl
      });

      if (result.activeSource === 'cloudflare_kv' && result.latestRemoteLog) {
        setLatestChangeLog(result.latestRemoteLog);
      }

      if (result.entries.length > 0) {
        const externalData = result.entries;
        const newSig = computeTimetableSignature(externalData);
        const prevSig = activeTimetableSigRef.current;
        const prevCount = activeTimetableCountRef.current;
        const prevSavedSig =
          localStorage.getItem('pks_external_signature') ||
          localStorage.getItem('pks_kv_signature');
        const hasChanged = newSig !== prevSig;
        const cohorts = Array.from(new Set(externalData.map(r => r.Cohort).filter(Boolean))).sort();

        const mappedSource: TimetableChangeSource =
          result.activeSource === 'cloudflare_kv'
            ? 'desktop_kv'
            : result.activeSource === 'google_sheets_csv'
              ? 'google_sheets_csv'
              : 'external_json';

        if (hasChanged) {
          activeTimetableSigRef.current = newSig;
          activeTimetableCountRef.current = externalData.length;
          setTimetable(externalData);
          setStudent(prev => {
            if (cohorts.length > 0 && (!prev.currentCohort || !cohorts.includes(prev.currentCohort))) {
              return { ...prev, currentCohort: cohorts[0] };
            }
            return prev;
          });
          try {
            localStorage.setItem('pks_master_timetable', JSON.stringify(externalData));
            localStorage.setItem('pks_external_signature', newSig);
            localStorage.setItem('pks_kv_signature', newSig);
          } catch {
            // ignore storage quota errors
          }

          if (!(result.activeSource === 'cloudflare_kv' && result.latestRemoteLog)) {
            setLatestChangeLog({
              id: `${mappedSource}_${now}`,
              timestamp: new Date().toISOString(),
              source: mappedSource,
              filename: result.sourceLabel,
              previousSlots: prevCount,
              newSlots: externalData.length,
              deltaSlots: externalData.length - prevCount,
              cohortsCount: cohorts.length,
              engineLabel: result.sourceUrl,
              signature: newSig
            });
          }

          if (isBackgroundPoll || (prevSavedSig && prevSavedSig !== newSig)) {
            setToasts(prev => [
              ...prev.filter(t => !t.id.startsWith('kv-update-')),
              {
                id: `kv-update-${Date.now()}`,
                title: 'Pindaan Jadual Baharu Dikesan',
                message: `Data jadual terkini (${externalData.length} slot kuliah · ${cohorts.length} seksyen) telah dimuatkan terus daripada ${result.sourceLabel}.`,
                type: 'success',
                actionBtnText: 'Lihat Log Terkini',
                onActionClick: () => {
                  setModalInitialTab('changelog');
                  setIsDataModalOpen(true);
                }
              }
            ]);
          }

          return {
            synced: true,
            message: `Berjaya segerak data terkini daripada ${result.sourceLabel} (${externalData.length} slot, ${cohorts.length} seksyen).`
          };
        } else {
          if (!prevSavedSig) {
            try {
              localStorage.setItem('pks_external_signature', newSig);
              localStorage.setItem('pks_kv_signature', newSig);
            } catch {
              // ignore
            }
          }
          if (!latestChangeLog && !(result.activeSource === 'cloudflare_kv' && result.latestRemoteLog)) {
            setLatestChangeLog({
              id: `${mappedSource}_${now}`,
              timestamp: new Date().toISOString(),
              source: mappedSource,
              filename: result.sourceLabel,
              previousSlots: externalData.length,
              newSlots: externalData.length,
              deltaSlots: 0,
              cohortsCount: cohorts.length,
              engineLabel: result.sourceUrl,
              signature: newSig
            });
          }
          return {
            synced: true,
            message: `Sumber aktif (${result.sourceLabel}): Data terkini (${externalData.length} slot) sudah pun disegerakkan.`
          };
        }
      }

      return {
        synced: false,
        message:
          result.errorMessage ||
          'Tiada data ditemui daripada Cloudflare KV, Google Sheets CSV, atau fail luaran /data/jadual.json.'
      };
    } catch {
      setKvStatus('local_only');
      return {
        synced: false,
        message: 'Ralat semasa membaca fail data jadual luaran.'
      };
    }
  };

  const applySystemSettings = (nextSettings: SystemSettings) => {
    setSystemSettings(nextSettings);
    try {
      localStorage.setItem('pks_system_settings', JSON.stringify(nextSettings));
    } catch {
      // ignore storage quota errors
    }
    setStudent(prev => ({
      ...prev,
      session: nextSettings.session,
      deadline: nextSettings.deadline,
      department: nextSettings.department
    }));
  };

  const syncSystemSettings = async () => {
    try {
      const res = await fetchSystemSettings();
      setBindingsStatus({
        kvBound: res.kvBound,
        r2Bound: res.r2Bound,
        aiBound: res.aiBound,
        passcodeRequired: res.passcodeRequired,
        pinSource: res.pinSource
      });
      if (res.kvBound || res.settings.updatedAt) {
        applySystemSettings(res.settings);
      }
    } catch {
      // keep existing settings
    }
  };

  // Dynamically fetch latest timetable & system settings from Cloudflare KV / R2
  useEffect(() => {
    syncExternalTimetable(false);
    syncSystemSettings();

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        syncExternalTimetable(true);
        syncSystemSettings();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    const pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncExternalTimetable(true);
        syncSystemSettings();
      }
    }, 45000);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      clearInterval(pollTimer);
    };
  }, []);

  // Keyboard shortcuts: Ctrl+Z (Undo) and Ctrl+Shift+D (Open Data & Change Log Modal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setModalInitialTab('changelog');
        setIsDataModalOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          return;
        }
        if (undoHistory.length > 0) {
          e.preventDefault();
          handleUndoRepeat();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoHistory, selectedRepeatCourses, manualDroppedCourseCodes]);

  // Compute available cohorts dynamically from Cloudflare KV timetable
  const availableCohorts = useMemo(() => {
    return Array.from(new Set(timetable.map(t => t.Cohort))).sort();
  }, [timetable]);

  // Load every available programme curriculum: prerequisite rules are course-level, and
  // course codes are shared across programmes (a DAD student taking DBM20173 is still
  // bound by the DBM10163 prerequisite). KV override first, bundled asset as fallback.
  const activeProgramme = (student.currentCohort || '').substring(0, 3).toUpperCase();
  const timetableProgrammes = useMemo(
    () =>
      Array.from(
        new Set(timetable.map(entry => (entry.Cohort || '').substring(0, 3).toUpperCase()).filter(Boolean))
      )
        .sort()
        .join(','),
    [timetable]
  );

  useEffect(() => {
    let cancelled = false;

    const readCurriculum = async (url: string): Promise<CurriculumData | null> => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return null;
        const payload = await res.json();
        const data = payload && payload.curriculum ? payload.curriculum : payload;
        return data && data.courses ? (data as CurriculumData) : null;
      } catch {
        return null;
      }
    };

    (async () => {
      const codes = new Set(timetableProgrammes.split(',').filter(Boolean));
      if (activeProgramme) codes.add(activeProgramme);

      if (codes.size === 0) {
        if (!cancelled) setCurricula(null);
        return;
      }

      const library: CurriculumLibrary = {};
      await Promise.all(
        Array.from(codes).map(async code => {
          const fromApi = await readCurriculum(`/api/curriculum?programme=${encodeURIComponent(code)}`);
          const data = fromApi || (await readCurriculum(`/assets/curriculum/${code.toLowerCase()}.json`));
          if (data) library[code] = data;
        })
      );

      if (!cancelled) setCurricula(Object.keys(library).length > 0 ? library : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [timetableProgrammes, activeProgramme, curriculumRefreshKey]);

  // Solver analysis run
  const analysis = useMemo(() => {
    return runFullAnalysis(
      student.currentCohort,
      timetable,
      selectedRepeatCourses,
      manualDroppedCourseCodes,
      curricula
    );
  }, [
    student.currentCohort,
    timetable,
    selectedRepeatCourses,
    manualDroppedCourseCodes,
    curricula
  ]);

  // Credit rule toast alerts
  useEffect(() => {
    let currentState: 'normal' | 'under' | 'over' = 'normal';
    if (analysis.totalCredits < 12) {
      currentState = 'under';
    } else if (analysis.totalCredits > 18) {
      currentState = 'over';
    }

    if (currentState !== prevCreditState.current) {
      if (currentState === 'under') {
        addToast({
          id: `credit-under-${Date.now()}`,
          title: `Jumlah Kredit Kurang (${analysis.totalCredits} Jam < 12 Jam)`,
          message:
            'Jumlah jam kredit anda kurang daripada 12 jam kredit. Anda masih boleh meneruskan perancangan jadual, namun kebenaran bertulis Ketua Jabatan (KJ) diperlukan semasa serahan Borang PK01.',
          type: 'danger',
          actionBtnText: 'Semak PK01',
          onActionClick: () => setActiveTab('pk01')
        });
      } else if (currentState === 'over') {
        addToast({
          id: `credit-over-${Date.now()}`,
          title: `Jumlah Kredit Melebihi Had (${analysis.totalCredits} Jam > 18 Jam)`,
          message:
            'Jumlah jam kredit anda melebihi 18 jam kredit. Anda masih boleh meneruskan perancangan jadual, namun kebenaran bertulis Ketua Jabatan (KJ) diperlukan semasa serahan Borang PK01.',
          type: 'warning',
          actionBtnText: 'Semak PK01',
          onActionClick: () => setActiveTab('pk01')
        });
      }
      prevCreditState.current = currentState;
    }
  }, [analysis.totalCredits]);

  // Prerequisite enforcement notices: auto-dropped base courses and invalid repeat combinations
  const prevPrereqSignature = useRef<string>('');
  useEffect(() => {
    const dropped = analysis.prereqDroppedCourses;
    const violations = analysis.repeatPrereqViolations;
    const signature = [
      dropped.map(d => `${d.pkg.Course_Code}<-${d.blockedBy}`).sort().join('|'),
      violations.map(v => `${v.code}<-${v.prerequisiteCode}`).sort().join('|')
    ].join('#');

    if (signature === prevPrereqSignature.current) return;
    prevPrereqSignature.current = signature;

    if (dropped.length > 0) {
      addToast({
        id: `prereq-drop-${Date.now()}`,
        title: `Kursus Digugurkan Automatik (Prasyarat) — ${dropped.length}`,
        message: dropped
          .map(d => `${d.pkg.Course_Code} ${d.pkg.Course_Name} digugurkan. ${d.reason}`)
          .join(' '),
        type: 'warning',
        actionBtnText: 'Semak PK01',
        onActionClick: () => setActiveTab('pk01')
      });
    }

    if (violations.length > 0) {
      addToast({
        id: `prereq-violation-${Date.now()}`,
        title: 'Pilihan Tumpang Tidak Sah (Prasyarat)',
        message: violations
          .map(
            v =>
              `${v.code} tidak boleh diulang serentak dengan prasyaratnya ${v.prerequisiteCode} (${v.chain.join(' → ')}).`
          )
          .join(' '),
        type: 'danger'
      });
    }
  }, [analysis.prereqDroppedCourses, analysis.repeatPrereqViolations]);

  const addToast = (toast: ToastItem) => {
    setToasts(prev => [...prev.filter(t => !t.title.includes('Jumlah Kredit')), toast]);
  };

  const handleDismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleUpdateStudent = (field: keyof StudentInfo, value: string) => {
    setStudent(prev => {
      const updated = { ...prev, [field]: value };
      if (field === 'currentCohort') {
        saveUndoSnapshot();
        // Reset manual drops when changing cohort
        setManualDroppedCourseCodes([]);
      }
      return updated;
    });
  };

  const handleAddRepeatCourse = (code: string, status: 'C1' | 'C2' | 'D') => {
    if (selectedRepeatCourses.some(c => c.code === code)) {
      addToast({
        id: `repeat-exists-${Date.now()}`,
        title: 'Kursus Sudah Dipilih',
        message: `${code} sudah berada dalam senarai kursus tumpang anda.`,
        type: 'info'
      });
      return;
    }
    saveUndoSnapshot();
    setSelectedRepeatCourses(prev => [...prev, { code, status, preferredCohort: null }]);
  };

  const handleRemoveRepeatCourse = (code: string) => {
    saveUndoSnapshot();
    setSelectedRepeatCourses(prev => prev.filter(c => c.code !== code));
  };

  const handleClearAllRepeat = () => {
    if (selectedRepeatCourses.length === 0) return;
    saveUndoSnapshot();
    setSelectedRepeatCourses([]);
    addToast({
      id: `repeat-cleared-${Date.now()}`,
      title: 'Senarai Dikosongkan',
      message: 'Semua kursus tumpang di Bahagian B telah dibuang. Klik Undo jika ingin mengembalikan.',
      type: 'info'
    });
  };

  const handleChangeRepeatPreferredCohort = (code: string, cohort: string) => {
    saveUndoSnapshot();
    setSelectedRepeatCourses(prev =>
      prev.map(c => (c.code === code ? { ...c, preferredCohort: cohort } : c))
    );
  };

  const handleToggleManualDrop = (code: string) => {
    saveUndoSnapshot();
    setManualDroppedCourseCodes(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  // Undo Handler: Reverts to previous selection state from history stack
  const handleUndoRepeat = () => {
    if (undoHistory.length === 0) return;

    setUndoHistory(prev => {
      const copy = [...prev];
      const previousState = copy.pop();
      if (previousState) {
        setSelectedRepeatCourses(previousState.repeatCourses);
        setManualDroppedCourseCodes(previousState.manualDroppedCourses);
        addToast({
          id: `undo-success-${Date.now()}`,
          title: 'Batal Perubahan (Undo)',
          message: 'Perubahan terakhir pada senarai kursus tumpang telah dibatalkan.',
          type: 'success'
        });
      }
      return copy;
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-800">
      {/* Top Navigation Bar */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        lastAutoSavedTime={lastAutoSavedTime}
        currentSession={systemSettings.session}
        onOpenSettings={() => {
          setModalInitialTab('settings_logo');
          setIsDataModalOpen(true);
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-6 pb-28 lg:pb-8">
        
        {/* Screen View: Planner */}
        <section className={`view-screen-planner ${activeTab === 'planner' ? 'block' : 'hidden'}`}>
          <PlannerView
            analysis={analysis}
            student={student}
            onUpdateStudent={handleUpdateStudent}
            availableCohorts={availableCohorts}
            timetable={timetable}
            selectedRepeatCourses={selectedRepeatCourses}
            onAddRepeatCourse={handleAddRepeatCourse}
            onRemoveRepeatCourse={handleRemoveRepeatCourse}
            onClearAllRepeat={handleClearAllRepeat}
            onChangeRepeatPreferredCohort={handleChangeRepeatPreferredCohort}
            manualDroppedCourseCodes={manualDroppedCourseCodes}
            onToggleManualDrop={handleToggleManualDrop}
            undoHistoryCount={undoHistory.length}
            onUndoRepeatCourse={handleUndoRepeat}
            lastAutoSavedTime={lastAutoSavedTime}
            kvStatus={kvStatus}
            activeSourceInfo={activeSourceInfo}
            onOpenKvLog={() => {
              setModalInitialTab('changelog');
              setIsDataModalOpen(true);
            }}
          />
        </section>

        {/* Screen & Print View: Borang PK01 */}
        <section className={`view-screen-pk01 ${activeTab === 'pk01' ? 'block' : 'hidden print:block'}`}>
          <BorangPK01View
            analysis={analysis}
            student={student}
            officialLogoUrl={systemSettings.logoUrl}
            institutionName={systemSettings.institutionName}
            onOpenLogoSettings={() => {
              setModalInitialTab('settings_logo');
              setIsDataModalOpen(true);
            }}
          />
        </section>

        {/* Screen & Print View: Jadual Kuliah */}
        <section className={`view-screen-jadual ${activeTab === 'jadual' ? 'block' : 'hidden print:block'}`}>
          <JadualKuliahView
            analysis={analysis}
            student={student}
            officialLogoUrl={systemSettings.logoUrl}
            institutionName={systemSettings.institutionName}
          />
        </section>

        {/* Subtle Footer Info */}
        <footer className="no-print mt-8 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-center text-center gap-1 sm:gap-2 text-[11px] text-slate-500">
          <span>
            JKM {systemSettings.institutionName} · {systemSettings.session} · {activeSourceInfo.type !== 'none' ? activeSourceInfo.label : 'Sumber Luaran'} ({timetable.length} slot aktif)
          </span>
          <span className="text-slate-400" title={`Bina: ${formatBuildStamp()}`}>
            · {APP_VERSION_LABEL}
          </span>
        </footer>
      </main>

      {/* Mobile Bottom Navigation */}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Coordinator Settings, Web PDF Upload & R2 Logo Modal */}
      <DataManagementModal
        isOpen={isDataModalOpen}
        onClose={() => setIsDataModalOpen(false)}
        timetable={timetable}
        latestChangeLog={latestChangeLog}
        kvStatus={kvStatus}
        activeSourceInfo={activeSourceInfo}
        onSyncFromKV={() => syncExternalTimetable(false, true)}
        systemSettings={systemSettings}
        bindingsStatus={bindingsStatus}
        onSettingsSaved={applySystemSettings}
        onTimetablePublished={async () => {
          await syncExternalTimetable(false, true);
        }}
        onCurriculumPublished={() => setCurriculumRefreshKey(key => key + 1)}
        availableProgrammes={timetableProgrammes.split(',').filter(Boolean)}
        initialSubTab={modalInitialTab}
      />

      {/* Toast Alert System */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
