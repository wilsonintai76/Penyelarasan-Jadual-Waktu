import React, { useState, useEffect, useLayoutEffect } from 'react';
import { Printer, Image as ImageIcon, Upload, RotateCcw, Check, X, Eye, EyeOff, FileCheck2 } from 'lucide-react';
import { SolverAnalysis, StudentInfo } from '../types';
import { getPackageLecturers } from '../utils/timetableSolver';
import { fitSheetToOnePage, triggerPrintDocument } from '../utils/printHelper';
import { MAX_CREDITS, MIN_CREDITS } from '../utils/creditRules';
import { PKSLogo } from './PKSLogo';

interface BorangPK01ViewProps {
  analysis: SolverAnalysis;
  student: StudentInfo;
  officialLogoUrl?: string;
  institutionName?: string;
  onOpenLogoSettings?: () => void;
}

export const BorangPK01View: React.FC<BorangPK01ViewProps> = ({
  analysis,
  student,
  officialLogoUrl = '',
  onOpenLogoSettings
}) => {
  const { keptBasePackages, sectionBPackages, creditsA, creditsB, totalCredits } = analysis;
  const programCode = (student.currentCohort || "").substring(0, 3).toUpperCase();
  const isCreditOutOfRange = totalCredits < MIN_CREDITS || totalCredits > MAX_CREDITS;

  // Custom logo state (Cloudflare R2 official logo takes precedence; falls back to local override)
  const [customLogo, setCustomLogo] = useState<string>(() => {
    return localStorage.getItem('pks_custom_logo') || '';
  });
  const effectiveLogo = officialLogoUrl || customLogo;
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [inputLogoUrl, setInputLogoUrl] = useState('');
  const [logoUploadNotice, setLogoUploadNotice] = useState<string | null>(null);
  const [isPrintPreview, setIsPrintPreview] = useState(false);
  const [isGrayscalePreview, setIsGrayscalePreview] = useState(false);

  // Keep the form on a single A4 page: adds a Bahagian B row and it is re-measured.
  useLayoutEffect(() => {
    const sheet = document.getElementById('printable-sheet-pk01');
    fitSheetToOnePage(sheet);
    // Web fonts change the text metrics, so measure again once they are ready.
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready?.then(() => {
      fitSheetToOnePage(document.getElementById('printable-sheet-pk01'));
    });
  }, [analysis, student, effectiveLogo, isPrintPreview]);

  useEffect(() => {
    if (customLogo) {
      localStorage.setItem('pks_custom_logo', customLogo);
    } else {
      localStorage.removeItem('pks_custom_logo');
    }
  }, [customLogo]);

  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLogoUploadNotice('Sila pilih fail imej yang sah (PNG, JPG, SVG).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      if (base64String) {
        setCustomLogo(base64String);
        setLogoUploadNotice('Imej berjaya dimuat naik sebagai format Base64!');
        setTimeout(() => setShowLogoModal(false), 800);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleApplyLogoUrl = () => {
    if (!inputLogoUrl.trim()) {
      setLogoUploadNotice('Sila masukkan URL imej yang sah.');
      return;
    }
    setCustomLogo(inputLogoUrl.trim());
    setLogoUploadNotice('URL logo berjaya disimpan!');
    setTimeout(() => setShowLogoModal(false), 800);
  };

  const handleResetDefaultLogo = () => {
    setCustomLogo('');
    setInputLogoUrl('');
    setLogoUploadNotice('Logo dikembalikan kepada vektor rasmi PKS.');
    setTimeout(() => setShowLogoModal(false), 800);
  };

  return (
    <div className="space-y-4">
      {/* Screen Toolbar */}
      <div className="no-print flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 bg-blue-50 border border-blue-200 p-3 sm:p-4 rounded-2xl">
        <div className="text-xs text-blue-900 leading-relaxed flex items-center gap-2 flex-wrap">
          {isPrintPreview ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 text-emerald-300 font-bold text-[11px] uppercase tracking-wide shadow-2xs">
              <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
              Mod Pratonton Cetak A4 Aktif
            </span>
          ) : null}
          <span>
            <span className="font-bold">Pratonton Rasmi Borang PK01 (A4):</span> Dokumen pendaftaran sah untuk simpanan fail pelajar, sokongan PA, dan kelulusan Penyelaras Pendaftaran Kursus Jabatan.
          </span>
        </div>
        <div className="flex items-center gap-2 w-full lg:w-auto flex-wrap shrink-0">
          {/* Print Preview Toggle Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={isPrintPreview}
            onClick={() => setIsPrintPreview(prev => !prev)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border shadow-xs flex items-center justify-center gap-2 transition flex-1 sm:flex-initial cursor-pointer ${
              isPrintPreview
                ? 'bg-slate-900 text-white border-slate-900 ring-2 ring-blue-400/60'
                : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300'
            }`}
            title="Togol paparan simulasi cetakan sebenar A4"
          >
            {isPrintPreview ? (
              <EyeOff className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            ) : (
              <Eye className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            )}
            <span>Pratonton Cetak</span>
            <span
              className={`inline-flex items-center w-7 h-4 rounded-full p-0.5 transition-colors ${
                isPrintPreview ? 'bg-emerald-500 justify-end' : 'bg-slate-300 justify-start'
              }`}
            >
              <span className="w-3 h-3 rounded-full bg-white shadow-2xs" />
            </span>
          </button>

          <button
            onClick={() => (onOpenLogoSettings ? onOpenLogoSettings() : setShowLogoModal(true))}
            className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-xl text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition flex-1 sm:flex-initial cursor-pointer"
            title="Urus logo Politeknik di Cloudflare R2"
          >
            <ImageIcon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>{officialLogoUrl ? 'Logo R2 Aktif' : customLogo ? 'Logo Kustom Aktif' : 'Logo R2'}</span>
          </button>
          <button
            onClick={() => triggerPrintDocument('pk01')}
            className="flex-1 sm:flex-initial px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-xs flex items-center justify-center gap-1.5 transition shrink-0"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>Cetak Borang PK01 (A4)</span>
          </button>
        </div>
      </div>

      {/* Modal / Dialog for Logo Customization */}
      {showLogoModal && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Tetapan Logo Politeknik (Borang PK01)</h3>
              </div>
              <button
                onClick={() => setShowLogoModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Anda boleh memuat naik fail imej tempatan (ditukar ke format <b>Base64</b>) atau memasukkan <b>pautan URL imej</b> logo rasmi. Logo ini dipaparkan pada kepala borang dan dicetak dengan tepat pada cetakan A4.
            </p>

            {/* Current Logo Preview */}
            <div className="flex items-center justify-center p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="w-20 h-16 flex items-center justify-center">
                <PKSLogo size="md" customLogo={effectiveLogo} />
              </div>
            </div>

            {logoUploadNotice && (
              <div className="p-2 bg-blue-50 text-blue-900 text-xs rounded-lg font-medium">
                {logoUploadNotice}
              </div>
            )}

            {/* Option 1: File Upload (Base64) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">1. Muat Naik Fail Imej (Base64)</label>
              <label className="flex items-center justify-center gap-2 w-full p-2.5 bg-blue-50 hover:bg-blue-100 border border-dashed border-blue-300 rounded-xl cursor-pointer text-xs font-semibold text-blue-800 transition">
                <Upload className="w-4 h-4" />
                <span>Pilih Fail Imej (PNG / JPG / SVG)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Option 2: Image URL */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">2. Atau Masukkan URL Imej</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={inputLogoUrl}
                  onChange={(e) => setInputLogoUrl(e.target.value)}
                  placeholder="https://.../logo.png"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleApplyLogoUrl}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" /> Guna
                </button>
              </div>
            </div>

            {/* Reset Option */}
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
              <button
                onClick={handleResetDefaultLogo}
                className="text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> Kembalikan Logo Lalai PKS
              </button>
              <button
                onClick={() => setShowLogoModal(false)}
                className="px-4 py-1.5 bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Stage / Scaled Preview Wrapper */}
      <div className={isPrintPreview ? 'print-preview-stage rounded-2xl overflow-hidden border border-slate-700 shadow-2xl bg-slate-800' : ''}>
        {isPrintPreview && (
          <div className="no-print bg-slate-900 text-slate-100 px-4 py-2.5 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono text-[10.5px] font-bold">
                A4 PORTRAIT · 210mm × 297mm
              </span>
              <span className="text-slate-300 text-[11px]">
                Menunjukkan susun atur kertas, sempadan hitam, dan cop tarikh akhir seperti hasil cetakan sebenar.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setIsGrayscalePreview(prev => !prev)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                  isGrayscalePreview
                    ? 'bg-slate-100 text-slate-900 border-white'
                    : 'bg-slate-800 text-slate-300 border-slate-600 hover:text-white'
                }`}
              >
                {isGrayscalePreview ? 'Mod Hitam-Putih: ON' : 'Simulasi Hitam-Putih'}
              </button>
              <button
                type="button"
                onClick={() => triggerPrintDocument('pk01')}
                className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer transition"
              >
                <Printer className="w-3.5 h-3.5" /> Cetak Sekarang
              </button>
              <button
                type="button"
                onClick={() => setIsPrintPreview(false)}
                className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-[11px] cursor-pointer transition"
              >
                Tutup Pratonton
              </button>
            </div>
          </div>
        )}

        <div className={`overflow-x-auto ${isPrintPreview ? 'p-4 sm:p-8' : 'pb-4'}`}>
          <div
            id="printable-sheet-pk01"
            style={{ fontFamily: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" }}
            className={`print-sheet bg-white p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-300 text-black w-full max-w-[210mm] min-w-198.5 mx-auto text-[8.5pt] leading-normal relative page-break transition-all ${
              isPrintPreview ? `print-preview-sheet ${isGrayscalePreview ? 'grayscale' : ''}` : ''
            }`}
          >
          {/* Page frame — mirrors the official Borang PK01 border */}
          <div className="border border-black px-[9mm] pt-[4mm] pb-[4mm]">
            {/* Submission-deadline stamp, top-left as on the official printed form */}
            <div className="absolute left-[3mm] top-[2mm] rotate-[-30deg] border-2 border-dashed border-red-600 bg-red-50/90 px-2 py-1 text-center text-[7pt] font-extrabold uppercase leading-tight text-red-600">
              Sila kembalikan<br />borang ini pada<br />selewat-lewatnya
              <br />
              <span className="text-[8.5pt] font-black">{student.deadline}</span>
            </div>

            {/* Header: centred official logo + document title + Borang PK01 tag */}
            <div className="relative">
              <div className="flex justify-center">
                <PKSLogo customLogo={effectiveLogo} boxClassName="w-[50mm] h-[19mm]" />
              </div>
              <h1 className="mt-[2.5mm] text-center text-[13pt] font-bold uppercase leading-tight">
                Borang Pendaftaran Kursus
              </h1>
              <p className="text-center text-[8.5pt] font-bold italic leading-tight text-red-600">
                (*Bagi kes pelajar menumpang seksyen)
              </p>
              <div className="absolute right-0 top-[4mm] border border-black px-2 py-[0.5mm] text-[10pt] font-bold">
                Borang PK01
              </div>
            </div>

            {/* Student particulars, laid out like the official form */}
            <div className="mt-[5mm] space-y-[1.2mm] text-[9.5pt]">
              <div className="flex items-center gap-1">
                <span className="w-[32mm] font-bold">JABATAN</span>
                <span>:</span>
                <span className="min-w-[60mm] border-b border-black px-1 font-semibold uppercase">{student.department}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-[32mm] font-bold">SESI</span>
                <span>:</span>
                <span className="min-w-[60mm] border-b border-black px-1 font-semibold">{student.session}</span>
              </div>
              <div className="flex items-center gap-1 pt-[2mm]">
                <span className="w-[32mm] font-bold">NAMA.</span>
                <span>:</span>
                <span className="flex-1 border border-black px-1.5 py-[0.7mm] font-bold uppercase">{student.name}</span>
              </div>
              <div className="flex items-center gap-1 pt-[1mm]">
                <span className="w-[32mm] font-bold">NO. PENDAFTARAN</span>
                <span>:</span>
                <span className="w-[50mm] border border-black px-1.5 py-[0.7mm] font-bold uppercase">{student.regNum}</span>
                <span className="ml-auto font-bold">PROGRAM</span>
                <span>:</span>
                <span className="w-[33mm] border border-black px-1.5 py-[0.7mm] font-bold uppercase">{programCode}</span>
              </div>
              <div className="flex items-center gap-1 pt-[1mm]">
                <span className="w-[32mm] font-bold">NO. TEL</span>
                <span>:</span>
                <span className="w-[50mm] border border-black px-1.5 py-[0.7mm] font-semibold">{student.phone}</span>
                <span className="ml-auto font-bold">KELAS</span>
                <span>:</span>
                <span className="w-[33mm] border border-black px-1.5 py-[0.7mm] font-bold">{student.currentCohort}</span>
              </div>
            </div>

          {/* Special Credit Warning Notice (If < 12 or > 20 credits) */}
          {isCreditOutOfRange && (
            <div className="mt-[4mm] border border-black bg-amber-50 px-2 py-1 text-[8.5pt]">
              <b>PERHATIAN BEBAN KREDIT KHAS:</b> Jumlah jam kredit semasa ialah <b>{totalCredits} jam kredit</b> {totalCredits < MIN_CREDITS ? `(kurang daripada had minimum ${MIN_CREDITS} jam kredit)` : `(melebihi had maksimum ${MAX_CREDITS} jam kredit)`}. Sila dapatkan kelulusan khas Ketua Jabatan (KJ) di ruangan pengesahan di bawah.
            </div>
          )}

          {/* (A) SENARAI KURSUS (SEKSYEN SEMASA) */}
          <div className="mt-[4mm]">
            <div className="mb-[1mm] pl-[4mm] text-[9pt] font-bold uppercase">(A) SENARAI KURSUS (SEKSYEN SEMASA) :</div>
            <table className="w-full table-fixed border border-black border-collapse text-[8.5pt]">
              <colgroup>
                <col style={{ width: '5.2%' }} />
                <col style={{ width: '10.8%' }} />
                <col style={{ width: '47.9%' }} />
                <col style={{ width: '13.5%' }} />
                <col style={{ width: '10.4%' }} />
                <col style={{ width: '12.2%' }} />
              </colgroup>
              <thead>
                <tr className="text-center align-middle font-bold">
                  <th className="border border-black py-[1mm]">BIL</th>
                  <th className="border border-black">KOD<br />KURSUS</th>
                  <th className="border border-black">NAMA KURSUS</th>
                  <th className="border border-black py-[0.5mm]">
                    SEKSYEN<br />
                    <span className="text-[7pt] font-normal italic">(Contoh : DKA3-S2)</span>
                  </th>
                  <th className="border border-black">STATUS</th>
                  <th className="border border-black">JAM<br />KREDIT</th>
                </tr>
              </thead>
              <tbody>
                {keptBasePackages.length === 0 ? (
                  <tr className="h-[6mm]">
                    <td colSpan={6} className="border border-black px-2 text-center italic">
                      Tiada kursus didaftarkan di Seksyen Semasa.
                    </td>
                  </tr>
                ) : (
                  keptBasePackages.map((pkg, idx) => (
                    <tr key={pkg.Course_Code} className="h-[6mm]">
                      <td className="border border-black text-center">{idx + 1}</td>
                      <td className="border border-black text-center font-bold">{pkg.Course_Code}</td>
                      <td className="border border-black px-[1.5mm] uppercase leading-tight">{pkg.Course_Name}</td>
                      <td className="border border-black text-center">{pkg.Cohort}</td>
                      <td className="border border-black text-center font-bold">D</td>
                      <td className="border border-black text-center font-bold">{pkg.Credit}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="h-[5.5mm] font-bold">
                  <td colSpan={3} className="border border-black pr-[2mm] text-right">JUMLAH JAM KREDIT</td>
                  <td className="border border-black bg-[#cfcfcf]"></td>
                  <td className="border border-black bg-[#cfcfcf]"></td>
                  <td className="border border-black bg-[#cfcfcf] text-center font-black">{creditsA}</td>
                </tr>
              </tfoot>
            </table>
          </div>


          {/* (B) SENARAI KURSUS (SEKSYEN TUMPANG) */}
          <div className="mt-[4mm]">
            <div className="mb-[1mm] pl-[4mm] text-[9pt] font-bold uppercase">(B) SENARAI KURSUS (SEKSYEN TUMPANG) :</div>
            <table className="w-full table-fixed border border-black border-collapse text-[8.5pt]">
              <colgroup>
                <col style={{ width: '5.1%' }} />
                <col style={{ width: '10.9%' }} />
                <col style={{ width: '35.9%' }} />
                <col style={{ width: '13.2%' }} />
                <col style={{ width: '12.3%' }} />
                <col style={{ width: '10.3%' }} />
                <col style={{ width: '12.3%' }} />
              </colgroup>
              <thead>
                <tr className="text-center align-middle font-bold">
                  <th className="border border-black py-[1mm]">BIL</th>
                  <th className="border border-black">KOD<br />KURSUS</th>
                  <th className="border border-black">NAMA KURSUS</th>
                  <th className="border border-black py-[0.5mm]">
                    SEKSYEN<br />TUMPANG<br />
                    <span className="text-[7pt] font-normal italic">(Contoh : DKA3-S2)</span>
                  </th>
                  <th className="border border-black">NAMA DAN<br />T/T<br />PENYARAH</th>
                  <th className="border border-black">STATUS</th>
                  <th className="border border-black">JAM<br />KREDIT</th>
                </tr>
              </thead>
              <tbody>
                {sectionBPackages.length === 0 ? (
                  <tr className="h-[6mm]">
                    <td colSpan={7} className="border border-black px-2 text-center italic">
                      Tiada kursus tumpang / mengulang didaftarkan.
                    </td>
                  </tr>
                ) : (
                  sectionBPackages.map((pkg, idx) => {
                    const lect = getPackageLecturers(pkg);
                    return (
                      <tr key={`${pkg.Course_Code}-${idx}`} className="h-[7.5mm]">
                        <td className="border border-black text-center">{idx + 1}</td>
                        <td className="border border-black text-center font-bold">{pkg.Course_Code}</td>
                        <td className="border border-black px-[1.5mm] uppercase leading-tight">{pkg.Course_Name}</td>
                        <td className="border border-black text-center font-semibold">{pkg.Cohort}</td>
                        <td className="border border-black px-[1mm] text-center leading-tight">
                          <div className="font-bold">{lect}</div>
                          <div className="text-[7pt]">T/T: ______________</div>
                        </td>
                        <td className="border border-black text-center font-bold">{pkg.displayStatus}</td>
                        <td className="border border-black text-center font-bold">{pkg.Credit}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="h-[5.5mm] font-bold">
                  <td colSpan={3} className="border border-black pr-[2mm] text-right">JUMLAH JAM KREDIT</td>
                  <td className="border border-black"></td>
                  <td className="border border-black bg-[#cfcfcf]"></td>
                  <td className="border border-black bg-[#cfcfcf]"></td>
                  <td className="border border-black bg-[#cfcfcf] text-center font-black">{creditsB}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Grand total box, right aligned as on the official form */}
          <div className="mt-[3mm] ml-auto flex w-[120mm] items-center justify-center gap-[6mm] border border-black py-[2mm] text-[10.5pt] font-bold">
            <span>JUMLAH JAM KREDIT KESELURUHAN</span>
            <span className="text-[13pt] font-black">{totalCredits}</span>
          </div>

          {/* Signature & endorsement block, laid out like the official form */}
          <div className="mt-[7mm] flex justify-between gap-[6mm] text-[8pt]">
            <div className="w-[47mm]">
              <div className="h-[13mm]"></div>
              <div className="border-t border-black pt-[1mm]">
                <p className="font-bold">Nama Pelajar : <span className="font-normal uppercase">{student.name}</span></p>
                <p className="mt-[3mm]">T a r i k h &nbsp;: ____________________</p>
              </div>
            </div>

            <div className="w-[52mm]">
              <p className="text-center text-[9pt] font-bold">Disokong Penasihat Akademik</p>
              <div className="mt-[11mm] border-t border-black pt-[1mm]">
                <p className="font-semibold uppercase leading-tight">{student.paName}</p>
                <p>Tandatangan &amp; Cop</p>
                <p className="mt-[3mm]">Tarikh : ____________________</p>
              </div>
            </div>

            <div className="w-[69mm]">
              <p className="text-center text-[9pt] font-bold">Diluluskan KJ/ PKJ / Kpro / KK</p>
              {isCreditOutOfRange && (
                <p className="mt-[1mm] text-center text-[7.5pt] font-bold italic">
                  Kebenaran Beban Khas ({totalCredits} Kr): [ &nbsp; ] Diluluskan &nbsp; [ &nbsp; ] Tidak Diluluskan
                </p>
              )}
              <div className={`${isCreditOutOfRange ? 'mt-[7mm]' : 'mt-[11mm]'} border-t border-black pt-[1mm]`}>
                <p>Tandatangan &amp; Cop</p>
                <p className="mt-[3mm]">Tarikh : _______________________________</p>
              </div>
            </div>
          </div>

          {/* NOTA — official wording from Borang PK01 */}
          <div className="mt-[5mm] text-[7.5pt] leading-[1.3]">
            <p className="font-bold">NOTA :</p>
            <ul className="list-disc space-y-[0.8mm] pl-[7mm]">
              <li>
                Borang ini perlu diisi oleh pelajar yang menumpang seksyen selain daripada seksyen semasanya selewat-lewatnya pada minggu pertama Perkuliahan.
              </li>
              <li>
                Jika jumlah jam kredit kurang dari 12 jam kredit atau melebihi 20 jam kredit, pelajar perlu mendapat kebenaran Ketua Jabatan.
              </li>
              <li>
                Sila kembalikan borang ini yang telah lengkap di isi berserta salinan Slip Pengesahan Pendaftan Kursus selewat-lewatnya pada Minggu Pertama Perkuliahan kepada Penasihat Akademik (PA) atau Pegawai Pendaftaran Kursus Jabatan (PPKJ).
              </li>
              <li>
                Salinan asal borang ini perlu disimpan oleh PPKJ di sepanjang sesi pengajian.
              </li>
            </ul>
          </div>

          {/* Status legend, centred at the foot of the official form */}
          <div className="mt-[3mm] text-center text-[7.5pt] text-slate-500">
            Status : D – Daftar kali pertama; MK1 (C1) – Mengulang Kursus kali pertama; MK2 (C2) – Mengulang Kursus kali kedua.
          </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
