import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Upload,
  FileText,
  FileJson,
  RotateCw,
  Sparkles,
  CloudUpload,
  Download,
  Trash2,
  Search,
  Settings,
  Image as ImageIcon,
  RotateCcw,
  History,
  Server,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  Layers,
  Calendar,
  GraduationCap
} from 'lucide-react';
import {
  CurriculumData,
  CurriculumLibrary,
  CurriculumSummary,
  CurriculumValidation,
  MasterTimetableEntry,
  SystemSettings,
  TimetableChangeLogEntry
} from '../types';
import { validateCurriculum } from '../utils/prerequisiteEngine';
import { buildCanonicalNameMap, validateTimetableSlots } from '../utils/timetableValidation';
import { ExternalSourceType } from '../utils/externalTimetableLoader';
import { APP_VERSION_LABEL } from '../version';
import {
  PdfPagePreview,
  inspectPdfPages,
  extractTimetableFromPdf,
  parseUploadedJsonTimetable
} from '../utils/pdfTimetableExtractor';
import { TimetableChangeLog } from './TimetableChangeLog';
import { PKSLogo } from './PKSLogo';

export type ModalSubTab =
  | 'upload_timetable'
  | 'settings_logo'
  | 'curriculum'
  | 'changelog'
  | 'cloudflare_setup';

export interface BindingsStatus {
  kvBound: boolean;
  r2Bound: boolean;
  aiBound: boolean;
  passcodeRequired: boolean;
  pinSource?: 'env' | 'kv' | 'default';
}

interface DataManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  timetable: MasterTimetableEntry[];
  latestChangeLog: TimetableChangeLogEntry | null;
  kvStatus: 'checking' | 'connected' | 'local_only';
  activeSourceInfo?: { type: ExternalSourceType; label: string; url: string };
  onSyncFromKV: () => Promise<{ synced: boolean; message: string }>;
  systemSettings: SystemSettings;
  bindingsStatus: BindingsStatus;
  onSettingsSaved: (settings: SystemSettings) => void;
  onTimetablePublished: () => Promise<void>;
  onCurriculumPublished?: () => void;
  availableProgrammes?: string[];
  curricula?: CurriculumLibrary | null;
  initialSubTab?: ModalSubTab;
}

const SESSION_PRESETS = [
  'Sesi I: 2026/2027',
  'Sesi II: 2026/2027',
  'Sesi I: 2027/2028',
  'Sesi II: 2027/2028'
];

const SESSION_STORAGE_PIN_KEY = 'pks_admin_pin_session';

export const DataManagementModal: React.FC<DataManagementModalProps> = ({
  isOpen,
  onClose,
  timetable,
  latestChangeLog,
  kvStatus,
  activeSourceInfo,
  onSyncFromKV,
  systemSettings,
  bindingsStatus,
  onSettingsSaved,
  onTimetablePublished,
  onCurriculumPublished,
  availableProgrammes = [],
  curricula = null,
  initialSubTab = 'upload_timetable'
}) => {
  const [activeSubTab, setActiveSubTab] = useState<ModalSubTab>(initialSubTab);

  // Admin PIN Authentication State
  const [adminPin, setAdminPin] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SESSION_STORAGE_PIN_KEY) || '';
    } catch {
      return '';
    }
  });
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState('');
  const [showPinText, setShowPinText] = useState(false);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Change PIN form (inside Tetapan)
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmNewPinInput, setConfirmNewPinInput] = useState('');
  const [isUpdatingPin, setIsUpdatingPin] = useState(false);

  // Banner feedback
  const [notice, setNotice] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Tab 1: Timetable Upload (PDF or JSON)
  const timetableFileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadKind, setUploadKind] = useState<'pdf' | 'json' | null>(null);
  const [pdfPreviews, setPdfPreviews] = useState<PdfPagePreview[]>([]);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
  const [isInspectingPdf, setIsInspectingPdf] = useState(false);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{
    completed: number;
    total: number;
    message: string;
  } | null>(null);
  const [extractedEngine, setExtractedEngine] = useState<string>('');
  const [stagedEntries, setStagedEntries] = useState<MasterTimetableEntry[]>([]);
  const [isPublishingKv, setIsPublishingKv] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cohortFilter, setCohortFilter] = useState<string>('ALL');

  // Tab 2: Settings & R2 Logo
  const [draftSession, setDraftSession] = useState(systemSettings.session);
  const [draftDeadline, setDraftDeadline] = useState(systemSettings.deadline);
  const [draftDepartment, setDraftDepartment] = useState(systemSettings.department);
  const [draftInstitution, setDraftInstitution] = useState(systemSettings.institutionName);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isResettingLogo, setIsResettingLogo] = useState(false);

  useEffect(() => {
    if (isOpen && initialSubTab) {
      setActiveSubTab(initialSubTab);
      setPinError(null);
    }
  }, [isOpen, initialSubTab]);

  // Verify stored session PIN silently whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cachedPin = '';
    try {
      cachedPin = sessionStorage.getItem(SESSION_STORAGE_PIN_KEY) || '';
    } catch {
      cachedPin = '';
    }
    if (!cachedPin) {
      setIsAdminUnlocked(false);
      return;
    }

    let cancelled = false;
    fetch('/api/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: cachedPin })
    })
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setAdminPin(cachedPin);
          setIsAdminUnlocked(true);
        } else {
          setAdminPin('');
          setIsAdminUnlocked(false);
          try {
            sessionStorage.removeItem(SESSION_STORAGE_PIN_KEY);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        if (!cancelled) setIsAdminUnlocked(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    setDraftSession(systemSettings.session);
    setDraftDeadline(systemSettings.deadline);
    setDraftDepartment(systemSettings.department);
    setDraftInstitution(systemSettings.institutionName);
  }, [systemSettings]);

  const cohortsCount = useMemo(
    () => new Set(timetable.map(t => t.Cohort).filter(Boolean)).size,
    [timetable]
  );

  const stagedCohorts = useMemo(() => {
    const counts = new Map<string, number>();
    stagedEntries.forEach(item => {
      const c = item.Cohort || '-';
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [stagedEntries]);

  const canonicalCourseNames = useMemo(() => buildCanonicalNameMap(curricula), [curricula]);

  const stagedValidation = useMemo(
    () => validateTimetableSlots(stagedEntries, { knownCourseNames: canonicalCourseNames }),
    [stagedEntries, canonicalCourseNames]
  );

  const filteredStagedEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return stagedEntries
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => {
        if (cohortFilter !== 'ALL' && entry.Cohort !== cohortFilter) return false;
        if (!q) return true;
        return (
          entry.Cohort.toLowerCase().includes(q) ||
          entry.Course_Code.toLowerCase().includes(q) ||
          entry.Course_Name.toLowerCase().includes(q) ||
          entry.Day.toLowerCase().includes(q) ||
          entry.Venue.toLowerCase().includes(q) ||
          entry.Lecturer.toLowerCase().includes(q)
        );
      });
  }, [stagedEntries, cohortFilter, searchQuery]);

  // Tab: Kurikulum & Prasyarat (per-programme JSON document, like the master timetable)
  const curriculumFileRef = useRef<HTMLInputElement>(null);
  const [curriculumProgramme, setCurriculumProgramme] = useState<string>('DKM');
  const [curriculumSummaries, setCurriculumSummaries] = useState<CurriculumSummary[]>([]);
  const [isLoadingCurriculum, setIsLoadingCurriculum] = useState(false);
  const [curriculumDraft, setCurriculumDraft] = useState<CurriculumData | null>(null);
  const [curriculumValidation, setCurriculumValidation] = useState<CurriculumValidation | null>(null);
  const [curriculumFileName, setCurriculumFileName] = useState('');
  const [isPublishingCurriculum, setIsPublishingCurriculum] = useState(false);
  const [pendingCurriculumOverwrite, setPendingCurriculumOverwrite] = useState<{
    existing: CurriculumSummary | null;
    fromServer?: boolean;
  } | null>(null);
  const [pendingCurriculumDelete, setPendingCurriculumDelete] = useState<boolean>(false);

  const loadCurriculumSummaries = async () => {
    setIsLoadingCurriculum(true);
    try {
      const res = await fetch('/api/curriculum', { cache: 'no-store' });
      const data = await res.json();
      if (Array.isArray(data?.programmes)) setCurriculumSummaries(data.programmes);
    } catch {
      // status summary is informational only
    } finally {
      setIsLoadingCurriculum(false);
    }
  };

  useEffect(() => {
    if (!isOpen || activeSubTab !== 'curriculum' || !isAdminUnlocked) return;
    loadCurriculumSummaries();
  }, [isOpen, activeSubTab, isAdminUnlocked]);

  if (!isOpen) return null;
  const isPrivilegedTab = activeSubTab !== 'changelog';
  const requiresPinGate = isPrivilegedTab && !isAdminUnlocked;

  const lockAdminSession = (msg?: string) => {
    setIsAdminUnlocked(false);
    setAdminPin('');
    setPinInput('');
    try {
      sessionStorage.removeItem(SESSION_STORAGE_PIN_KEY);
    } catch {
      // ignore
    }
    if (msg) {
      setPinError(msg);
      setNotice({ text: msg, type: 'error' });
    }
  };

  const handleVerifyPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = pinInput.trim();
    if (!candidate) {
      setPinError('Sila masukkan PIN Admin.');
      return;
    }

    setIsVerifyingPin(true);
    setPinError(null);
    try {
      const res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: candidate })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setPinError(data?.message || 'PIN Admin tidak sah. Sila cuba lagi.');
        return;
      }

      setAdminPin(candidate);
      setIsAdminUnlocked(true);
      setPinInput('');
      setPinError(null);
      try {
        sessionStorage.setItem(SESSION_STORAGE_PIN_KEY, candidate);
      } catch {
        // ignore
      }
      setNotice({
        text: 'Akses Penyelaras (Admin) dibuka untuk sesi ini.',
        type: 'success'
      });
    } catch {
      setPinError('Gagal menghubungi pelayan untuk pengesahan PIN.');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  const buildWriteHeaders = (): HeadersInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (adminPin.trim()) {
      headers['X-Admin-Passcode'] = adminPin.trim();
    }
    return headers;
  };

  // Handle PDF or JSON file selection
  const handleTimetableFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    setSelectedFile(file);
    setStagedEntries([]);
    setCohortFilter('ALL');
    setSearchQuery('');
    setExtractProgress(null);

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.pdf')) {
      setUploadKind('pdf');
      setPdfPreviews([]);
      setPageRotations({});
      setIsInspectingPdf(true);
      try {
        const res = await inspectPdfPages(file);
        setPdfPreviews(res.previews);
        setNotice({
          text: `PDF "${file.name}" dimuatkan (${res.pageCount} halaman). Semak orientasi halaman di bawah, kemudian klik "Ekstrak Jadual dari PDF".`,
          type: 'info'
        });
      } catch (err: any) {
        setNotice({
          text: `Gagal membaca fail PDF: ${err?.message || String(err)}`,
          type: 'error'
        });
      } finally {
        setIsInspectingPdf(false);
      }
    } else if (lower.endsWith('.json')) {
      setUploadKind('json');
      setPdfPreviews([]);
      try {
        const parsed = await parseUploadedJsonTimetable(file);
        if (parsed.length === 0) {
          setNotice({
            text: 'Fail JSON tidak mengandungi slot jadual yang sah.',
            type: 'error'
          });
          return;
        }
        setStagedEntries(parsed);
        setExtractedEngine('Muat Naik JSON Terus (Web)');
        setNotice({
          text: `Fail JSON "${file.name}" berjaya dibaca (${parsed.length} slot kuliah). Semak pratonton dan klik "Simpan & Terbitkan ke Cloudflare KV".`,
          type: 'success'
        });
      } catch (err: any) {
        setNotice({
          text: `Gagal membaca JSON: ${err?.message || String(err)}`,
          type: 'error'
        });
      }
    } else {
      setNotice({
        text: 'Format fail tidak disokong. Sila pilih fail .pdf atau .json sahaja.',
        type: 'error'
      });
    }
  };

  const handleRotatePage = (pageNumber: number) => {
    setPageRotations(prev => ({
      ...prev,
      [pageNumber]: ((prev[pageNumber] || 0) + 90) % 360
    }));
  };

  const handleRunPdfExtraction = async () => {
    if (!selectedFile || uploadKind !== 'pdf') return;
    setIsExtractingPdf(true);
    setNotice(null);
    setExtractProgress({
      completed: 0,
      total: pdfPreviews.length || 1,
      message: 'Memulakan pengecaman AI bagi Jadual Induk PDF...'
    });

    try {
      const result = await extractTimetableFromPdf(
        selectedFile,
        pageRotations,
        (completed, total, message) => {
          setExtractProgress({ completed, total, message });
        },
        adminPin
      );

      setStagedEntries(result.entries);
      setExtractedEngine(result.engineLabel);
      setCohortFilter('ALL');

      if (result.entries.length === 0) {
        setNotice({
          text: 'Tiada slot jadual berjaya diekstrak. Cuba putarkan halaman supaya tegak dan imbas semula.',
          type: 'error'
        });
      } else {
        const uniqueCohorts = new Set(result.entries.map(e => e.Cohort)).size;
        setNotice({
          text: `Ekstraksi berjaya! ${result.entries.length} slot kuliah merangkumi ${uniqueCohorts} seksyen sedia untuk diterbitkan ke Cloudflare KV.`,
          type: 'success'
        });
      }
    } catch (err: any) {
      const msg = err?.message || 'Ralat semasa mengekstrak PDF Jadual Induk.';
      if (msg.includes('401') || msg.toLowerCase().includes('pin admin')) {
        lockAdminSession('Sesi PIN Admin telah tamat atau tidak sah. Sila masukkan semula PIN Admin.');
      } else {
        setNotice({ text: msg, type: 'error' });
      }
    } finally {
      setIsExtractingPdf(false);
    }
  };

  const handleRemoveStagedRow = (indexToRemove: number) => {
    setStagedEntries(prev => prev.filter((_, i) => i !== indexToRemove));
  };

  const handlePublishToKV = async () => {
    if (stagedEntries.length === 0) return;
    setIsPublishingKv(true);
    setNotice(null);
    try {
      const res = await fetch('/api/jadual', {
        method: 'POST',
        headers: buildWriteHeaders(),
        body: JSON.stringify({
          entries: stagedEntries,
          source: uploadKind === 'pdf' ? 'web_pdf_upload' : 'web_json_upload',
          filename: selectedFile?.name || 'jadual_induk_jkm.json',
          engineLabel: extractedEngine || 'Cloudflare Web Upload'
        })
      });

      if (res.status === 401) {
        lockAdminSession('PIN Admin tidak sah atau telah tamat. Sila sahkan semula PIN.');
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || `Gagal menerbitkan jadual (HTTP ${res.status}).`);
      }

      await onTimetablePublished();
      const corrected = Number(data?.namesCorrected) || 0;
      setNotice({
        text: `Berjaya diterbitkan ke Cloudflare KV! ${data.slotsCount} slot kuliah (${data.cohortsCount} seksyen) kini aktif untuk semua pelajar.${corrected > 0 ? ` ${corrected} nama kursus diselaraskan dengan kurikulum.` : ''}`,
        type: 'success'
      });
    } catch (err: any) {
      setNotice({
        text: err?.message || 'Ralat semasa menyimpan ke Cloudflare KV.',
        type: 'error'
      });
    } finally {
      setIsPublishingKv(false);
    }
  };

  const handleDownloadBackupJson = () => {
    const sourceData = stagedEntries.length > 0 ? stagedEntries : timetable;
    if (sourceData.length === 0) return;
    const blob = new Blob([JSON.stringify(sourceData, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jadual_induk_jkm.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setNotice({
      text: `Fail sandaran jadual_induk_jkm.json (${sourceData.length} slot) berjaya dimuat turun.`,
      type: 'info'
    });
  };

  // ---- Tab: Kurikulum & Prasyarat handlers ----
  const handleCurriculumFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    setPendingCurriculumOverwrite(null);
    setPendingCurriculumDelete(false);
    setCurriculumFileName(file.name);
    setCurriculumDraft(null);
    setCurriculumValidation(null);

    if (!file.name.toLowerCase().endsWith('.json')) {
      setNotice({
        text: 'Format fail tidak disokong. Sila pilih fail .json kurikulum.',
        type: 'error'
      });
      return;
    }

    try {
      const parsed = JSON.parse(await file.text());
      const validation = validateCurriculum(parsed);
      setCurriculumDraft(parsed as CurriculumData);
      setCurriculumValidation(validation);

      const detected = (validation.programme || '').toUpperCase();
      if (detected && detected !== curriculumProgramme) {
        setCurriculumProgramme(detected);
        setNotice({
          text: `Fail dikesan untuk program ${detected}; pilihan program ditukar secara automatik.`,
          type: 'info'
        });
      } else if (!validation.ok) {
        setNotice({ text: validation.errors.join(' '), type: 'error' });
      } else {
        setNotice({
          text: `Fail "${file.name}" sah: ${validation.coursesCount} kursus, ${validation.prerequisitesCount} peraturan prasyarat.`,
          type: 'success'
        });
      }
    } catch (err: any) {
      setCurriculumFileName('');
      setNotice({
        text: `JSON tidak sah: ${err?.message || String(err)}`,
        type: 'error'
      });
    }
  };

  const handlePublishCurriculum = async (overwrite = false) => {
    if (!curriculumDraft || !curriculumValidation?.ok) return;

    // Existing document -> never replace silently: ask for confirmation first.
    if (!overwrite && selectedCurriculumSummary && selectedCurriculumSummary.source !== 'none') {
      setPendingCurriculumOverwrite({ existing: selectedCurriculumSummary });
      setPendingCurriculumDelete(false);
      return;
    }

    setIsPublishingCurriculum(true);
    setNotice(null);
    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: buildWriteHeaders(),
        body: JSON.stringify({
          programme: curriculumProgramme,
          curriculum: curriculumDraft,
          filename: curriculumFileName,
          overwrite
        })
      });

      if (res.status === 401) {
        lockAdminSession('PIN Admin tidak sah atau telah tamat. Sila sahkan semula PIN.');
        return;
      }

      if (res.status === 409) {
        const conflict = await res.json().catch(() => ({}));
        setPendingCurriculumOverwrite({
          existing: (conflict?.existing as CurriculumSummary) || selectedCurriculumSummary || null,
          fromServer: true
        });
        setNotice({
          text: conflict?.message || `Kurikulum ${curriculumProgramme} sudah wujud. Sahkan tindihan.`,
          type: 'info'
        });
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || `Gagal menerbitkan kurikulum (HTTP ${res.status}).`);
      }

      setPendingCurriculumOverwrite(null);
      setNotice({
        text: `Kurikulum ${curriculumProgramme} diterbitkan ke Cloudflare KV (${curriculumValidation.coursesCount} kursus, ${curriculumValidation.prerequisitesCount} prasyarat). Peraturan prasyarat kini berkuat kuasa.`,
        type: 'success'
      });
      setCurriculumDraft(null);
      setCurriculumValidation(null);
      setCurriculumFileName('');
      if (curriculumFileRef.current) curriculumFileRef.current.value = '';
      await loadCurriculumSummaries();
      onCurriculumPublished?.();
    } catch (err: any) {
      setNotice({
        text: err?.message || 'Ralat semasa menyimpan kurikulum ke Cloudflare KV.',
        type: 'error'
      });
    } finally {
      setIsPublishingCurriculum(false);
    }
  };

  const handleDownloadCurriculum = async () => {
    setNotice(null);
    try {
      const res = await fetch(`/api/curriculum?programme=${encodeURIComponent(curriculumProgramme)}`, {
        cache: 'no-store'
      });
      const data = await res.json();
      if (!data?.curriculum) {
        setNotice({
          text: `Tiada struktur kurikulum tersimpan untuk ${curriculumProgramme}. Muat naik fail JSON baharu untuk mencipta.`,
          type: 'info'
        });
        return;
      }
      const blob = new Blob([JSON.stringify(data.curriculum, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kurikulum_${curriculumProgramme.toLowerCase()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice({
        text: `kurikulum_${curriculumProgramme.toLowerCase()}.json dimuat turun untuk disunting.`,
        type: 'info'
      });
    } catch (err: any) {
      setNotice({ text: err?.message || String(err), type: 'error' });
    }
  };

  const handleDownloadCurriculumTemplate = () => {
    const template = {
      meta: {
        programme: curriculumProgramme,
        programmeName: `Program ${curriculumProgramme}`,
        version: '1',
        effective: 'Session I 2026/2027',
        source: 'Programme Information (Section 11)'
      },
      courses: {
        CONTOH1012: {
          name: 'Contoh Kursus',
          type: 'Common Core',
          semesters: [1],
          credit: 2,
          prerequisites: []
        },
        CONTOH1023: {
          name: 'Contoh Kursus Lanjutan',
          type: 'Discipline Core',
          semesters: [2],
          credit: 3,
          prerequisites: ['CONTOH1012']
        }
      }
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `templat_kurikulum_${curriculumProgramme.toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setNotice({
      text: `Templat kurikulum ${curriculumProgramme} dimuat turun. Isi senarai kursus dan prasyarat, kemudian muat naik semula.`,
      type: 'info'
    });
  };

  const handleDeleteCurriculumOverride = async (confirmed = false) => {
    setNotice(null);
    if (!confirmed) {
      setPendingCurriculumDelete(true);
      setPendingCurriculumOverwrite(null);
      return;
    }
    try {
      const res = await fetch(`/api/curriculum?programme=${encodeURIComponent(curriculumProgramme)}`, {
        method: 'DELETE',
        headers: buildWriteHeaders()
      });
      if (res.status === 401) {
        lockAdminSession('PIN Admin tidak sah atau telah tamat. Sila sahkan semula PIN.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `Gagal memadam override (HTTP ${res.status}).`);
      }
      setNotice({
        text: `Override KV ${curriculumProgramme} dipadam. Aset kurikulum terbina (jika ada) digunakan semula.`,
        type: 'success'
      });
      setPendingCurriculumDelete(false);
      await loadCurriculumSummaries();
      onCurriculumPublished?.();
    } catch (err: any) {
      setNotice({ text: err?.message || String(err), type: 'error' });
    }
  };

  // Save Session / Deadline / Department / Institution settings to KV
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setNotice(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: buildWriteHeaders(),
        body: JSON.stringify({
          session: draftSession,
          deadline: draftDeadline,
          department: draftDepartment,
          institutionName: draftInstitution
        })
      });

      if (res.status === 401) {
        lockAdminSession('PIN Admin tidak sah atau telah tamat. Sila sahkan semula PIN.');
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || `Gagal menyimpan tetapan (HTTP ${res.status}).`);
      }

      if (data?.settings) {
        onSettingsSaved(data.settings);
      }
      setNotice({
        text: `Tetapan rasmi berjaya disimpan ke Cloudflare KV (${data?.settings?.session || draftSession}). Paparan pelajar dan Borang PK01 dikemas kini serta-merta.`,
        type: 'success'
      });
    } catch (err: any) {
      setNotice({
        text: err?.message || 'Ralat semasa menyimpan tetapan.',
        type: 'error'
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Update Admin PIN in KV
  const handleChangeAdminPin = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextPin = newPinInput.trim();
    const confirmPin = confirmNewPinInput.trim();
    if (nextPin.length < 4 || nextPin.length > 12) {
      setNotice({
        text: 'PIN baharu mestilah antara 4 hingga 12 aksara/digit.',
        type: 'error'
      });
      return;
    }
    if (nextPin !== confirmPin) {
      setNotice({
        text: 'Pengesahan PIN baharu tidak sepadan.',
        type: 'error'
      });
      return;
    }

    setIsUpdatingPin(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin-pin', {
        method: 'POST',
        headers: buildWriteHeaders(),
        body: JSON.stringify({
          currentPin: adminPin,
          newPin: nextPin
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        lockAdminSession('PIN semasa tidak sah. Sila log masuk semula.');
        return;
      }
      if (!res.ok) {
        throw new Error(data?.message || 'Gagal mengemas kini PIN Admin.');
      }

      setAdminPin(nextPin);
      try {
        sessionStorage.setItem(SESSION_STORAGE_PIN_KEY, nextPin);
      } catch {
        // ignore
      }
      setNewPinInput('');
      setConfirmNewPinInput('');
      setNotice({
        text: 'PIN Admin baharu berjaya disimpan. Gunakan PIN baharu untuk log masuk akan datang.',
        type: 'success'
      });
    } catch (err: any) {
      setNotice({
        text: err?.message || 'Ralat semasa menukar PIN Admin.',
        type: 'error'
      });
    } finally {
      setIsUpdatingPin(false);
    }
  };

  // Upload Politeknik Logo to Cloudflare R2
  const handleLogoFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);

    if (file.size > 5 * 1024 * 1024) {
      setNotice({
        text: 'Saiz fail logo melebihi had 5MB. Sila pilih imej yang lebih kecil.',
        type: 'error'
      });
      return;
    }

    setIsUploadingLogo(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca fail imej.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/logo', {
        method: 'POST',
        headers: buildWriteHeaders(),
        body: JSON.stringify({
          dataUrl,
          filename: file.name,
          contentType: file.type || 'image/png'
        })
      });

      if (res.status === 401) {
        lockAdminSession('PIN Admin tidak sah atau telah tamat. Sila sahkan semula PIN.');
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || `Gagal memuat naik logo ke R2 (HTTP ${res.status}).`);
      }

      if (data?.settings) {
        onSettingsSaved(data.settings);
      }
      setNotice({
        text: `Logo rasmi "${file.name}" berjaya disimpan ke Cloudflare R2 dan dipaparkan terus pada Borang PK01 & Jadual Kuliah!`,
        type: 'success'
      });
    } catch (err: any) {
      setNotice({
        text: err?.message || 'Ralat semasa memuat naik logo ke Cloudflare R2.',
        type: 'error'
      });
    } finally {
      setIsUploadingLogo(false);
      if (logoFileRef.current) logoFileRef.current.value = '';
    }
  };

  const handleResetLogo = async () => {
    setIsResettingLogo(true);
    setNotice(null);
    try {
      const res = await fetch('/api/logo', {
        method: 'DELETE',
        headers: buildWriteHeaders()
      });

      if (res.status === 401) {
        lockAdminSession('PIN Admin tidak sah atau telah tamat. Sila sahkan semula PIN.');
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || 'Gagal mengembalikan logo lalai.');
      }

      if (data?.settings) {
        onSettingsSaved(data.settings);
      }
      setNotice({
        text: 'Logo telah dikembalikan kepada vektor lalai PKS.',
        type: 'info'
      });
    } catch (err: any) {
      setNotice({
        text: err?.message || 'Ralat semasa memadam logo R2.',
        type: 'error'
      });
    } finally {
      setIsResettingLogo(false);
    }
  };

  const selectedCurriculumSummary = curriculumSummaries.find(
    summary => summary.programme === curriculumProgramme
  );

  // Programme pills are data-driven: timetable programmes + any document already published.
  const programmeOptions = Array.from(
    new Set(
      [
        ...availableProgrammes,
        ...curriculumSummaries.map(summary => summary.programme),
        curriculumProgramme
      ]
        .map(code => String(code || '').toUpperCase())
        .filter(Boolean)
    )
  ).sort();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-900/65 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[93vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-3.5 sm:p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0 gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-blue-600 text-[10px] font-black uppercase shrink-0">
                Cloudflare KV + R2
              </span>
              {isAdminUnlocked ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 text-[10px] font-black uppercase shrink-0">
                  <Unlock className="w-3 h-3" />
                  <span>Admin Dibuka</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600 text-[10px] font-black uppercase shrink-0">
                  <Lock className="w-3 h-3" />
                  <span>PIN Diperlukan</span>
                </span>
              )}
              <h3 className="font-bold text-xs sm:text-base truncate">
                Tetapan Penyelaras &amp; Pengurusan Jadual Induk JKM
              </h3>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate hidden sm:block">
              Akses pentadbir dilindungi PIN untuk muat naik PDF Jadual Induk, tetapan sesi semasa, dan Logo Cloudflare R2.
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isAdminUnlocked && (
              <button
                type="button"
                onClick={() => lockAdminSession()}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-700 text-slate-200 hover:text-white text-[11px] font-bold flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
                title="Kunci semula akses Admin"
              >
                <Lock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Kunci Admin</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition shrink-0"
              title="Tutup Modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-2.5 bg-slate-100 border-b border-slate-200 shrink-0 text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('upload_timetable')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'upload_timetable'
                ? 'bg-white text-indigo-700 shadow-xs font-bold border border-indigo-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            {!isAdminUnlocked ? (
              <Lock className="w-3 h-3 text-amber-600" />
            ) : (
              <Upload className="w-3.5 h-3.5 text-indigo-600" />
            )}
            <span>Muat Naik Jadual (PDF / JSON)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('settings_logo')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'settings_logo'
                ? 'bg-white text-emerald-700 shadow-xs font-bold border border-emerald-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            {!isAdminUnlocked ? (
              <Lock className="w-3 h-3 text-amber-600" />
            ) : (
              <Settings className="w-3.5 h-3.5 text-emerald-600" />
            )}
            <span>Tetapan Sesi &amp; Logo (R2)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('curriculum')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'curriculum'
                ? 'bg-white text-purple-700 shadow-xs font-bold border border-purple-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            {!isAdminUnlocked ? (
              <Lock className="w-3 h-3 text-amber-600" />
            ) : (
              <GraduationCap className="w-3.5 h-3.5 text-purple-600" />
            )}
            <span>Kurikulum &amp; Prasyarat</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('changelog')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'changelog'
                ? 'bg-white text-blue-700 shadow-xs font-bold border border-blue-200'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5 text-blue-600" />
            <span>Log Perubahan Terkini</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('cloudflare_setup')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'cloudflare_setup'
                ? 'bg-white text-slate-900 shadow-xs font-bold border border-slate-300'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {!isAdminUnlocked ? (
              <Lock className="w-3 h-3 text-amber-600" />
            ) : (
              <Server className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span>Konfigurasi Cloudflare</span>
          </button>
        </div>

        {/* Notice Alert (only when unlocked or on changelog) */}
        {notice && !requiresPinGate && (
          <div
            className={`px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-2 shrink-0 border-b ${
              notice.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : notice.type === 'error'
                  ? 'bg-rose-50 text-rose-900 border-rose-200'
                  : 'bg-blue-50 text-blue-900 border-blue-200'
            }`}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-slate-500 hover:text-slate-800 px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* ========================================================== */}
          {/* ADMIN PIN GATE (BLOCKS UPLOAD / SETTINGS UNTIL PIN VERIFIED) */}
          {/* ========================================================== */}
          {requiresPinGate && (
            <div className="py-6 sm:py-10 flex items-center justify-center">
              <form
                onSubmit={handleVerifyPinSubmit}
                className="w-full max-w-md p-6 rounded-3xl bg-slate-50 border border-slate-200 shadow-sm space-y-4 text-center"
              >
                <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-300 flex items-center justify-center mx-auto shadow-md">
                  <KeyRound className="w-6 h-6" />
                </div>

                <div className="space-y-1">
                  <span className="inline-block px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-black uppercase tracking-wider">
                    Akses Penyelaras Sahaja
                  </span>
                  <h4 className="font-black text-slate-900 text-base sm:text-lg">
                    Masukkan PIN Admin
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Muat naik PDF Jadual Induk, tetapan sesi semasa, dan pengurusan Logo R2 memerlukan pengesahan PIN penyelaras.
                  </p>
                </div>

                {pinError && (
                  <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
                    {pinError}
                  </div>
                )}

                <div className="relative text-left">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    PIN Penyelaras
                  </label>
                  <div className="relative">
                    <input
                      type={showPinText ? 'text' : 'password'}
                      inputMode="numeric"
                      autoFocus
                      value={pinInput}
                      onChange={e => setPinInput(e.target.value)}
                      placeholder="Masukkan PIN Admin..."
                      className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-bold tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPinText(prev => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      title={showPinText ? 'Sembunyikan PIN' : 'Tunjukkan PIN'}
                    >
                      {showPinText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isVerifyingPin}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
                >
                  {isVerifyingPin ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Mengesahkan PIN...</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4 text-amber-300" />
                      <span>Sahkan PIN &amp; Buka Akses Admin</span>
                    </>
                  )}
                </button>

                <div className="pt-1 text-[11px] text-slate-500">
                  Pelajar hanya perlu menggunakan tab{' '}
                  <button
                    type="button"
                    onClick={() => setActiveSubTab('changelog')}
                    className="font-bold text-blue-700 hover:underline cursor-pointer"
                  >
                    Log Perubahan Terkini
                  </button>{' '}
                  untuk menyemak kemas kini jadual.
                </div>
              </form>
            </div>
          )}

          {/* ========================================================== */}
          {/* TAB 1: MUAT NAIK JADUAL INDUK (PDF / JSON)                */}
          {/* ========================================================== */}
          {!requiresPinGate && activeSubTab === 'upload_timetable' && (
            <div className="space-y-4 text-xs">
              {/* Upload Dropzone */}
              <div className="p-4 sm:p-5 rounded-2xl bg-linear-to-br from-indigo-50 via-blue-50 to-slate-50 border-2 border-dashed border-indigo-300 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="space-y-1 text-center sm:text-left">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-indigo-700 text-white text-[10px] font-bold uppercase">
                    <Sparkles className="w-3 h-3" /> Ekstraksi Pintar Web -&gt; Cloudflare KV
                  </div>
                  <h4 className="font-black text-slate-900 text-sm sm:text-base">
                    Muat Naik Jadual Induk JKM (PDF atau JSON)
                  </h4>
                  <p className="text-[11px] text-slate-600 max-w-2xl leading-relaxed">
                    Pilih fail PDF rasmi Jadual Induk JKM (walaupun PDF imbasan/raster) atau fail <code>jadual_induk_jkm.json</code> terus daripada pelayar. Semak pratonton slot dan terbitkan ke Cloudflare KV tanpa perlu aplikasi desktop.
                  </p>
                  {selectedFile && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-indigo-900 font-semibold text-[11px] mt-1">
                      {uploadKind === 'pdf' ? (
                        <FileText className="w-3.5 h-3.5 text-rose-600" />
                      ) : (
                        <FileJson className="w-3.5 h-3.5 text-blue-600" />
                      )}
                      <span>{selectedFile.name}</span>
                      <span className="text-slate-400">
                        ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <input
                    ref={timetableFileRef}
                    type="file"
                    accept=".pdf,.json,application/pdf,application/json"
                    className="hidden"
                    onChange={e => handleTimetableFileSelected(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => timetableFileRef.current?.click()}
                    disabled={isInspectingPdf || isExtractingPdf}
                    className="px-4 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Pilih Fail PDF / JSON</span>
                  </button>
                </div>
              </div>

              {/* PDF Page Inspection & Orientation Controls */}
              {uploadKind === 'pdf' && (
                <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-rose-600" />
                        <span>Pratonton Halaman PDF &amp; Kawalan Putaran</span>
                      </h5>
                      <p className="text-[11px] text-slate-500">
                        Pastikan jadual dalam kedudukan menegak/mendatar yang betul dibaca sebelum memulakan ekstraksi.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRunPdfExtraction}
                      disabled={isInspectingPdf || isExtractingPdf || pdfPreviews.length === 0}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer shrink-0"
                    >
                      {isExtractingPdf ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Mengekstrak PDF...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Ekstrak Jadual dari PDF ({pdfPreviews.length} hlm)</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Extraction Progress Bar */}
                  {extractProgress && (
                    <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-indigo-950">
                        <span>{extractProgress.message}</span>
                        <span>
                          {extractProgress.completed} / {extractProgress.total}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-indigo-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 transition-all duration-300"
                          style={{
                            width: `${Math.round(
                              (extractProgress.completed / Math.max(1, extractProgress.total)) * 100
                            )}%`
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {isInspectingPdf ? (
                    <div className="py-8 flex items-center justify-center gap-2 text-slate-500 font-semibold">
                      <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                      <span>Menjana pratonton halaman PDF...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {pdfPreviews.map(page => {
                        const rot = pageRotations[page.pageNumber] || 0;
                        return (
                          <div
                            key={page.pageNumber}
                            className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-2"
                          >
                            <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                              <span>Halaman {page.pageNumber}</span>
                              {rot !== 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">
                                  +{rot}°
                                </span>
                              )}
                            </div>
                            <div className="h-36 bg-white rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden p-1">
                              <img
                                src={page.thumbnailDataUrl}
                                alt={`Halaman ${page.pageNumber}`}
                                className="max-h-full max-w-full object-contain transition-transform duration-200"
                                style={{ transform: `rotate(${rot}deg)` }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRotatePage(page.pageNumber)}
                              disabled={isExtractingPdf}
                              className="w-full py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-semibold text-[11px] flex items-center justify-center gap-1 transition cursor-pointer"
                            >
                              <RotateCw className="w-3 h-3" />
                              <span>Putar 90°</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Staged Entries Preview & Publish Action */}
              {stagedEntries.length > 0 && (
                <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="space-y-0.5">
                      <h5 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-emerald-600" />
                        <span>
                          Pratonton Slot Disediakan ({stagedEntries.length} slot · {stagedCohorts.length} seksyen)
                        </span>
                      </h5>
                      <p className="text-[11px] text-slate-500">
                        Semak data yang diekstrak. Anda boleh memadam baris yang silap sebelum menerbitkan ke Cloudflare KV.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleDownloadBackupJson}
                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Muat Turun .json</span>
                      </button>
                      <button
                        type="button"
                        onClick={handlePublishToKV}
                        disabled={isPublishingKv || stagedValidation.errors.length > 0}
                        className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                      >
                        {isPublishingKv ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Menerbitkan...</span>
                          </>
                        ) : (
                          <>
                            <CloudUpload className="w-4 h-4" />
                            <span>Simpan &amp; Terbitkan ke Cloudflare KV</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Data quality report: errors block publishing, warnings ask for a review */}
                  {(stagedValidation.errors.length > 0 || stagedValidation.warnings.length > 0) && (
                    <div className="space-y-2">
                      {stagedValidation.errors.length > 0 && (
                        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3">
                          <p className="text-[11px] font-black uppercase tracking-wide text-rose-800">
                            Pengesahan gagal ? {stagedValidation.errors.reduce((total, issue) => total + issue.count, 0)} baris bermasalah, pembetulan diperlukan sebelum terbit
                          </p>
                          <ul className="mt-1.5 space-y-1 text-[11px] text-rose-900">
                            {stagedValidation.errors.slice(0, 4).map(issue => (
                              <li key={issue.code}>
                                <b>{issue.message}</b> ({issue.count}x)
                                {issue.samples.length > 0 ? ` ? cth. ${issue.samples.join(', ')}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {stagedValidation.warnings.length > 0 && (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                          <p className="text-[11px] font-black uppercase tracking-wide text-amber-800">
                            Amaran kualiti data ? semak sebelum menerbitkan
                          </p>
                          <ul className="mt-1.5 space-y-1 text-[11px] text-amber-900">
                            {stagedValidation.warnings.slice(0, 5).map(issue => (
                              <li key={issue.code}>
                                <b>{issue.message}</b>
                                {issue.samples.length > 0 ? ` ? cth. ${issue.samples.join(', ')}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 font-bold text-slate-700">
                      {stagedValidation.stats.cohorts} seksyen
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 font-bold text-slate-700">
                      {stagedValidation.stats.courses} kod kursus
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 font-bold text-slate-700">
                      min {stagedValidation.stats.minWeeklyHours.toFixed(1)} jam ? median {stagedValidation.stats.medianWeeklyHours.toFixed(1)} jam
                    </span>
                    <span className="text-slate-400">Nama kursus diselaraskan dengan kurikulum program semasa terbit.</span>
                  </div>

                  {/* Cohort Pills & Search */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setCohortFilter('ALL')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                          cohortFilter === 'ALL'
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        Semua ({stagedEntries.length})
                      </button>
                      {stagedCohorts.map(([cohort, count]) => (
                        <button
                          key={cohort}
                          type="button"
                          onClick={() => setCohortFilter(cohort)}
                          className={`px-2 py-1 rounded-lg text-[10.5px] font-bold border transition cursor-pointer ${
                            cohortFilter === cohort
                              ? 'bg-indigo-700 text-white border-indigo-700'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {cohort} ({count})
                        </button>
                      ))}
                    </div>

                    <div className="relative shrink-0">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Cari kod kursus, bilik..."
                        className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 text-xs w-full sm:w-52 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead className="bg-slate-100 border-b border-slate-200 sticky top-0 text-[10px] font-bold uppercase text-slate-600">
                        <tr>
                          <th className="py-2 px-2.5">Seksyen</th>
                          <th className="py-2 px-2.5">Kod &amp; Nama Kursus</th>
                          <th className="py-2 px-2.5 text-center">Kredit</th>
                          <th className="py-2 px-2.5">Hari</th>
                          <th className="py-2 px-2.5">Masa</th>
                          <th className="py-2 px-2.5">Bilik / Pensyarah</th>
                          <th className="py-2 px-2 text-center">Padam</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredStagedEntries.slice(0, 250).map(({ entry, idx }) => (
                          <tr key={`${entry.Cohort}-${entry.Course_Code}-${idx}`} className="hover:bg-slate-50">
                            <td className="py-1.5 px-2.5 font-bold text-indigo-800 whitespace-nowrap">
                              {entry.Cohort}
                            </td>
                            <td className="py-1.5 px-2.5">
                              <div className="font-mono font-bold text-slate-900">{entry.Course_Code}</div>
                              <div className="text-[10px] text-slate-500 truncate max-w-50">
                                {entry.Course_Name}
                              </div>
                            </td>
                            <td className="py-1.5 px-2.5 text-center font-mono">{entry.Credit}</td>
                            <td className="py-1.5 px-2.5 whitespace-nowrap">{entry.Day}</td>
                            <td className="py-1.5 px-2.5 font-mono whitespace-nowrap">
                              {entry.Start_Time}–{entry.End_Time}
                            </td>
                            <td className="py-1.5 px-2.5">
                              <span className="font-semibold text-slate-800">{entry.Venue}</span>
                              <span className="text-slate-400"> · {entry.Lecturer}</span>
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveStagedRow(idx)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded transition cursor-pointer"
                                title="Padam baris ini"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredStagedEntries.length > 250 && (
                    <p className="text-[10.5px] text-slate-500 text-right">
                      Memaparkan 250 daripada {filteredStagedEntries.length} baris yang sepadan. Gunakan penapis seksyen untuk semakan terperinci.
                    </p>
                  )}
                </div>
              )}

              {/* Quick download of active timetable */}
              {stagedEntries.length === 0 && timetable.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-600">
                    Jadual aktif semasa mempunyai <b>{timetable.length} slot kuliah</b> ({cohortsCount} seksyen). Anda boleh memuat turun salinan JSON semasa sebagai sandaran.
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadBackupJson}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold text-[11px] flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Eksport Jadual Semasa (.json)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ========================================================== */}
          {/* TAB 2: TETAPAN SESI SEMASA, LOGO R2 & TUKAR PIN ADMIN      */}
          {/* ========================================================== */}
          {!requiresPinGate && activeSubTab === 'settings_logo' && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Left Column: Session & Academic Metadata (KV) */}
                <form
                  onSubmit={handleSaveSettings}
                  className="lg:col-span-7 p-4 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-2xs"
                >
                  <div className="border-b border-slate-100 pb-2.5 flex items-center justify-between gap-2">
                    <div>
                      <h4 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-emerald-600" />
                        <span>Tetapan Sesi Semasa &amp; Maklumat Rasmi PK01</span>
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Disimpan terus di Cloudflare KV dan disegerakkan secara automatik kepada semua pelajar.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block font-bold text-slate-700 text-[11px] mb-1">
                        Sesi Akademik Semasa
                      </label>
                      <input
                        type="text"
                        value={draftSession}
                        onChange={e => setDraftSession(e.target.value)}
                        placeholder="cth: Sesi I: 2026/2027"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        required
                      />
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {SESSION_PRESETS.map(preset => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setDraftSession(preset)}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                              draftSession === preset
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 text-[11px] mb-1">
                        Tarikh Akhir Serahan Borang PK01
                      </label>
                      <input
                        type="text"
                        value={draftDeadline}
                        onChange={e => setDraftDeadline(e.target.value)}
                        placeholder="cth: 04 DIS 2026 (JUMAAT)"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 text-[11px] mb-1">
                        Nama Jabatan
                      </label>
                      <input
                        type="text"
                        value={draftDepartment}
                        onChange={e => setDraftDepartment(e.target.value)}
                        placeholder="JABATAN KEJURUTERAAN MEKANIKAL"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 text-[11px] mb-1">
                        Nama Politeknik / Institusi (Cetakan Rasmi)
                      </label>
                      <input
                        type="text"
                        value={draftInstitution}
                        onChange={e => setDraftInstitution(e.target.value)}
                        placeholder="POLITEKNIK KUCHING SARAWAK"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10.5px] text-slate-400">
                      {systemSettings.updatedAt
                        ? `Dikemas kini: ${new Date(systemSettings.updatedAt).toLocaleString('ms-MY')}`
                        : 'Menggunakan nilai lalai'}
                    </span>
                    <button
                      type="submit"
                      disabled={isSavingSettings}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                    >
                      {isSavingSettings ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Menyimpan...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Simpan Tetapan ke Cloudflare KV</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>

                {/* Right Column: Politeknik Logo Upload (Cloudflare R2) */}
                <div className="lg:col-span-5 p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                          <ImageIcon className="w-4 h-4 text-blue-600" />
                          <span>Logo Rasmi Politeknik</span>
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Disimpan di <b>Cloudflare R2</b> untuk cetakan PK01 &amp; Jadual Kuliah.
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${
                          systemSettings.logoStorage === 'r2'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-slate-200 text-slate-700 border-slate-300'
                        }`}
                      >
                        {systemSettings.logoStorage === 'r2' ? 'Cloudflare R2 Aktif' : 'Vektor Lalai PKS'}
                      </span>
                    </div>

                    <div className="p-5 rounded-2xl bg-white border border-slate-200 flex flex-col items-center justify-center gap-2 min-h-35">
                      <PKSLogo size="xl" customLogo={systemSettings.logoUrl} />
                      <div className="text-[11px] font-semibold text-slate-600 text-center">
                        {systemSettings.logoStorage === 'r2'
                          ? systemSettings.logoFilename || 'logo-politeknik (R2)'
                          : 'Menggunakan logo lalai (/assets/logo_pks.svg)'}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <input
                      ref={logoFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml,image/webp"
                      className="hidden"
                      onChange={e => handleLogoFileSelected(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => logoFileRef.current?.click()}
                      disabled={isUploadingLogo}
                      className="w-full py-2.5 px-3 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
                    >
                      {isUploadingLogo ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Memuat naik ke R2...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>Muat Naik Logo ke Cloudflare R2</span>
                        </>
                      )}
                    </button>

                    {systemSettings.logoStorage === 'r2' && (
                      <button
                        type="button"
                        onClick={handleResetLogo}
                        disabled={isResettingLogo}
                        className="w-full py-2 px-3 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[11px] flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{isResettingLogo ? 'Memulihkan...' : 'Kembalikan Logo Lalai'}</span>
                      </button>
                    )}

                    <p className="text-[10.5px] text-slate-500 text-center">
                      Format disokong: PNG, JPG, SVG, atau WEBP (maksimum 5MB).
                    </p>
                  </div>
                </div>
              </div>

              {/* Security: Change Admin PIN Card */}
              <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <h4 className="font-black text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                      <KeyRound className="w-4 h-4 text-amber-700" />
                      <span>Keselamatan &amp; Tukar PIN Admin Penyelaras</span>
                    </h4>
                    <p className="text-[11px] text-slate-600">
                      {bindingsStatus.pinSource === 'env'
                        ? 'PIN kini ditetapkan melalui Environment Secret (ADMIN_PIN / ADMIN_PASSCODE) di pelayan.'
                        : 'Kemas kini PIN Penyelaras (4–12 digit/aksara) yang disimpan dalam Cloudflare KV.'}
                    </p>
                  </div>
                </div>

                {bindingsStatus.pinSource !== 'env' && (
                  <form
                    onSubmit={handleChangeAdminPin}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end"
                  >
                    <div>
                      <label className="block font-bold text-slate-700 text-[10.5px] mb-1">
                        PIN Baharu (4–12 aksara)
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={newPinInput}
                        onChange={e => setNewPinInput(e.target.value)}
                        placeholder="cth: 882026"
                        className="w-full px-3 py-1.5 rounded-xl border border-amber-300 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 text-[10.5px] mb-1">
                        Sahkan PIN Baharu
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={confirmNewPinInput}
                        onChange={e => setConfirmNewPinInput(e.target.value)}
                        placeholder="Ulang PIN baharu"
                        className="w-full px-3 py-1.5 rounded-xl border border-amber-300 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isUpdatingPin}
                      className="py-2 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {isUpdatingPin ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="w-3.5 h-3.5 text-amber-300" />
                      )}
                      <span>Simpan PIN Baharu</span>
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* ========================================================== */}
          {/* TAB: KURIKULUM & PRASYARAT (JSON PER PROGRAM)              */}
          {/* ========================================================== */}
          {!requiresPinGate && activeSubTab === 'curriculum' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-4 shadow-2xs">
                <div className="border-b border-slate-100 pb-2.5 flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                      <GraduationCap className="w-4 h-4 text-purple-600" />
                      <span>Struktur Kurikulum &amp; Prasyarat (JSON per program)</span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Satu dokumen untuk setiap program (DKM / DAD / DPU / DTP). Peraturan prasyarat
                      digabungkan mengikut kod kursus merentas semua program, kerana kod kursus yang
                      sama (cth. DBM20173) dikongsi antara program.
                    </p>
                  </div>
                  {isLoadingCurriculum && (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />
                  )}
                </div>

                <div>
                  <label className="block font-bold text-slate-700 text-[11px] mb-1.5">
                    Pilih Program
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {programmeOptions.map(code => {
                      const summary = curriculumSummaries.find(item => item.programme === code);
                      const isActive = curriculumProgramme === code;
                      const statusLabel = !summary
                        ? '…'
                        : summary.source === 'none'
                          ? 'tiada struktur'
                          : `${summary.coursesCount} kursus`;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => {
                            setCurriculumProgramme(code);
                            setCurriculumDraft(null);
                            setCurriculumValidation(null);
                            setCurriculumFileName('');
                            setPendingCurriculumOverwrite(null);
                            setPendingCurriculumDelete(false);
                            if (curriculumFileRef.current) curriculumFileRef.current.value = '';
                          }}
                          className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                            isActive
                              ? 'bg-purple-700 text-white border-purple-700 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <span className="font-mono font-bold">{code}</span>
                          <span className={`text-[10px] ${isActive ? 'text-purple-100' : 'text-slate-500'}`}>
                            {statusLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-bold text-slate-700">
                    Status {curriculumProgramme}:
                  </span>
                  {selectedCurriculumSummary ? (
                    <>
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          selectedCurriculumSummary.source === 'kv'
                            ? 'bg-emerald-100 text-emerald-800'
                            : selectedCurriculumSummary.source === 'asset'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {selectedCurriculumSummary.source === 'kv'
                          ? 'KV (diterbitkan)'
                          : selectedCurriculumSummary.source === 'asset'
                            ? 'Aset terbina'
                            : 'Tiada struktur'}
                      </span>
                      {selectedCurriculumSummary.source !== 'none' && (
                        <>
                          <span className="font-mono text-slate-600">
                            {selectedCurriculumSummary.coursesCount} kursus ·{' '}
                            {selectedCurriculumSummary.prerequisitesCount} prasyarat
                          </span>
                          {selectedCurriculumSummary.version && (
                            <span className="text-slate-500">
                              versi {selectedCurriculumSummary.version}
                            </span>
                          )}
                          {selectedCurriculumSummary.updatedAt && (
                            <span className="text-slate-400">
                              dikemas kini {new Date(selectedCurriculumSummary.updatedAt).toLocaleString()}
                            </span>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-400">memuatkan…</span>
                  )}
                </div>

                <div className="rounded-xl border border-dashed border-purple-300 bg-purple-50/40 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-purple-900 text-[11px]">
                    <FileJson className="w-3.5 h-3.5 text-purple-600" />
                    <span>Muat Naik Fail JSON Kurikulum</span>
                  </div>
                  <input
                    ref={curriculumFileRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={e => handleCurriculumFileSelected(e.target.files?.[0])}
                    className="block w-full text-[11px] text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                  />
                  <p className="text-[10.5px] text-purple-800/80 leading-relaxed">
                    Format: <code className="font-mono">{'{ "meta": { "programme": "DKM" }, "courses": { "KOD": { "name", "semesters", "credit", "prerequisites": ["KOD_PRASYARAT"] } } }'}</code>.
                    Kod program dikesan daripada <code className="font-mono">meta.programme</code> jika tiada pilihan manual.
                  </p>
                </div>

                {curriculumValidation && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800 truncate max-w-60">
                        {curriculumFileName || 'Fail dipilih'}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          curriculumValidation.ok
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {curriculumValidation.ok ? 'SAH' : 'TIDAK SAH'}
                      </span>
                      <span className="font-mono text-[10.5px] text-slate-600">
                        {curriculumValidation.coursesCount} kursus ·{' '}
                        {curriculumValidation.prerequisitesCount} prasyarat
                      </span>
                      {curriculumValidation.programme && (
                        <span className="font-mono text-[10.5px] text-purple-700">
                          meta.programme = {curriculumValidation.programme}
                        </span>
                      )}
                    </div>
                    {curriculumValidation.errors.map(message => (
                      <div key={message} className="text-[11px] font-semibold text-rose-700">
                        • {message}
                      </div>
                    ))}
                    {curriculumValidation.warnings.map(message => (
                      <div key={message} className="text-[11px] text-amber-700">
                        • {message}
                      </div>
                    ))}
                  </div>
                )}

                {pendingCurriculumOverwrite && curriculumDraft && curriculumValidation?.ok && (
                  <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 font-black text-amber-900 text-[11px] uppercase">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      <span>Sahkan Tindihan Data — {curriculumProgramme}</span>
                    </div>
                    <p className="text-[11px] text-amber-900 leading-relaxed">
                      {curriculumProgramme} sudah mempunyai dokumen kurikulum
                      {pendingCurriculumOverwrite.existing
                        ? pendingCurriculumOverwrite.existing.source === 'asset'
                          ? ' (aset terbina)'
                          : ' (diterbitkan di KV)'
                        : ''}
                      {pendingCurriculumOverwrite.existing
                        ? `: ${pendingCurriculumOverwrite.existing.coursesCount} kursus · ${pendingCurriculumOverwrite.existing.prerequisitesCount} prasyarat`
                        : ''}
                      {pendingCurriculumOverwrite.existing?.version
                        ? ` · versi ${pendingCurriculumOverwrite.existing.version}`
                        : ''}
                      {pendingCurriculumOverwrite.existing?.updatedAt
                        ? ` · dikemas kini ${new Date(pendingCurriculumOverwrite.existing.updatedAt).toLocaleString()}`
                        : ''}
                      . Fail baharu ({curriculumValidation.coursesCount} kursus ·{' '}
                      {curriculumValidation.prerequisitesCount} prasyarat) akan{' '}
                      <b>MENGGANTIKAN</b> dokumen sedia ada.
                    </p>
                    {pendingCurriculumOverwrite.existing?.source === 'asset' && (
                      <p className="text-[10.5px] text-amber-800">
                        Aset terbina tidak dipadam — klik "Padam Override KV" untuk memulihkannya.
                      </p>
                    )}
                    {pendingCurriculumOverwrite.fromServer && (
                      <p className="text-[10.5px] text-amber-800">
                        Disahkan oleh pelayan: dokumen ini berubah selepas senarai dimuatkan.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handlePublishCurriculum(true)}
                        disabled={isPublishingCurriculum}
                        className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-[11px] flex items-center gap-1.5 transition shadow-xs"
                      >
                        {isPublishingCurriculum ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CloudUpload className="w-3.5 h-3.5" />
                        )}
                        <span>Ya, Ganti Dokumen {curriculumProgramme}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingCurriculumOverwrite(null)}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-[11px] transition"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}

                {pendingCurriculumDelete && (
                  <div className="rounded-xl border-2 border-rose-400 bg-rose-50 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 font-black text-rose-900 text-[11px] uppercase">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                      <span>Sahkan Padam Override — {curriculumProgramme}</span>
                    </div>
                    <p className="text-[11px] text-rose-900 leading-relaxed">
                      Override KV untuk {curriculumProgramme} akan dipadam dan{' '}
                      {selectedCurriculumSummary?.source === 'kv'
                        ? 'sistem akan kembali kepada aset terbina (jika ada) atau tiada prasyarat langsung.'
                        : 'tiada perubahan lain akan berlaku.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleDeleteCurriculumOverride(true)}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] flex items-center gap-1.5 transition shadow-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Ya, Padam</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingCurriculumDelete(false)}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-[11px] transition"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => handlePublishCurriculum()}
                    disabled={!curriculumValidation?.ok || isPublishingCurriculum}
                    className="px-3 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-[11px] flex items-center gap-1.5 transition shadow-xs"
                  >
                    {isPublishingCurriculum ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudUpload className="w-3.5 h-3.5" />
                    )}
                    <span>Terbitkan ke Cloudflare KV</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadCurriculum}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-[11px] flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Muat Turun Semasa</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadCurriculumTemplate}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-[11px] flex items-center gap-1.5 transition"
                  >
                    <FileJson className="w-3.5 h-3.5" />
                    <span>Templat Kosong</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCurriculumOverride()}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 font-bold text-[11px] flex items-center gap-1.5 transition ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Padam Override KV</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================== */}
          {/* TAB 3: LOG PERUBAHAN TERKINI (READ-ONLY FOR ALL)           */}
          {/* ========================================================== */}
          {activeSubTab === 'changelog' && (
            <TimetableChangeLog
              latestLog={latestChangeLog}
              currentSlotsCount={timetable.length}
              currentCohortsCount={cohortsCount}
              kvStatus={kvStatus}
              activeSourceInfo={activeSourceInfo}
              onSyncFromKV={onSyncFromKV}
            />
          )}

          {/* ========================================================== */}
          {/* TAB 4: KONFIGURASI CLOUDFLARE (KV, R2 & AI)                */}
          {/* ========================================================== */}
          {!requiresPinGate && activeSubTab === 'cloudflare_setup' && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-white border border-slate-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">KV Namespace (`JADUAL_KV`)</span>
                    {bindingsStatus.kvBound || kvStatus === 'connected' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Menyimpan data jadual (<code>jadual_induk_jkm</code>), log kemas kini terkini, tetapan sesi semasa, dan PIN admin (<code>admin_pin_config</code>).
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-slate-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">R2 Bucket (`JADUAL_R2`)</span>
                    {bindingsStatus.r2Bound ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Menyimpan fail binari Logo Rasmi Politeknik secara kekal dan dihidangkan melalui <code>/api/logo</code>.
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border border-slate-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">Enjin Ekstraksi PDF (AI)</span>
                    {bindingsStatus.aiBound ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Menggunakan binding Cloudflare Workers AI (<code>AI</code>) di <code>/api/extract-pdf</code>.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <h4 className="font-black text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                  <Server className="w-4 h-4 text-blue-600" />
                  <span>Panduan Pemasangan Penuh di Cloudflare Workers</span>
                </h4>
                <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-700 leading-relaxed">
                  <li>
                    Buka <b>Cloudflare Dashboard → Workers &amp; Pages → Worker Anda → Settings → Bindings</b>.
                  </li>
                  <li>
                    Tambah <b>KV Namespace binding</b> dengan nama pembolehubah tepat <code>JADUAL_KV</code>.
                  </li>
                  <li>
                    Tambah <b>R2 Bucket binding</b> dengan nama pembolehubah tepat <code>JADUAL_R2</code> (untuk simpanan logo Politeknik).
                  </li>
                  <li>
                    Untuk ekstraksi PDF Jadual Induk terus di web: pastikan <b>Workers AI binding</b> bernama <code>AI</code> tersedia.
                  </li>
                  <li>
                    Tetapkan Environment Secret <code>ADMIN_PIN</code> (pilihan) jika anda ingin mengunci PIN penyelaras di peringkat Cloudflare, atau tukar PIN terus melalui tab <b>Tetapan Sesi &amp; Logo (R2)</b>.
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            Sesi Semasa: <b>{systemSettings.session}</b> · {timetable.length} slot aktif · {APP_VERSION_LABEL}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition ml-auto cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
