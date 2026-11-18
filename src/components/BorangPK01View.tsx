import React, { useState, useEffect } from 'react';
import { Printer, Image as ImageIcon, Upload, RotateCcw, Check, X, Eye, EyeOff, FileCheck2 } from 'lucide-react';
import { SolverAnalysis, StudentInfo } from '../types';
import { getPackageLecturers } from '../utils/timetableSolver';
import { triggerPrintDocument } from '../utils/printHelper';
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
  institutionName = 'Politeknik Kuching Sarawak',
  onOpenLogoSettings
}) => {
  const { keptBasePackages, sectionBPackages, creditsA, creditsB, totalCredits } = analysis;
  const programCode = (student.currentCohort || "").substring(0, 3).toUpperCase();
  const isCreditOutOfRange = totalCredits < 12 || totalCredits > 18;

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
            className={`print-sheet bg-white p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-300 font-official text-black w-full min-w-[794px] max-w-[210mm] mx-auto text-xs leading-normal relative page-break transition-all ${
              isPrintPreview ? `print-preview-sheet ${isGrayscalePreview ? 'grayscale' : ''}` : ''
            }`}
          >
          {/* Diagonal Red Official Submission Deadline Stamp */}
          <div className="diagonal-stamp">
            SILA KEMBALIKAN<br />
            BORANG INI PADA<br />
            SELEWAT-LEWATNYA<br />
            <span className="text-xs uppercase font-black text-black">
              {student.deadline}
            </span>
          </div>

          {/* Official Document Header with Guaranteed Print Display */}
          <div className="flex items-center gap-4 border-b border-black pb-3 mb-3">
            {/* Image Placeholder supporting Base64 / URL */}
            <div
              className="w-20 shrink-0 flex items-center justify-center text-center overflow-hidden"
              style={{
                width: '80px',
                minWidth: '80px',
                height: '64px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                printColorAdjust: 'exact',
                WebkitPrintColorAdjust: 'exact'
              }}
            >
              <PKSLogo
                size="md"
                customLogo={effectiveLogo}
                className="w-16 h-16 object-contain"
              />
            </div>
            <div className="flex-1 text-center pr-12">
              <h2 className="text-sm font-bold uppercase tracking-wider">{institutionName}</h2>
              <h1 className="text-base font-black uppercase tracking-normal mt-0.5">Borang Pendaftaran Kursus</h1>
              <p className="text-[11px] italic font-semibold">
                (*Bagi kes pelajar mengulang kursus [MK], belum daftar [BD] &amp; menumpang seksyen)
              </p>
            </div>
            <div className="shrink-0 self-start">
              <span className="font-bold text-xs border border-black px-2 py-0.5">Borang PK01</span>
            </div>
          </div>

          {/* Student & Department Information Grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
            <div className="flex"><span className="w-32 font-bold">JABATAN:</span> <span className="font-semibold">{student.department}</span></div>
            <div className="flex"><span className="w-32 font-bold">PROGRAM:</span> <span className="font-semibold uppercase">{programCode}</span></div>
            <div className="flex"><span className="w-32 font-bold">SESI:</span> <span className="font-semibold">{student.session}</span></div>
            <div className="flex"><span className="w-32 font-bold">NO. TEL:</span> <span className="font-semibold">{student.phone}</span></div>
            <div className="flex"><span className="w-32 font-bold">NAMA PELAJAR:</span> <span className="font-bold uppercase">{student.name}</span></div>
            <div className="flex"><span className="w-32 font-bold">NO. PENDAFTARAN:</span> <span className="font-bold font-mono uppercase">{student.regNum}</span></div>
            <div className="flex"><span className="w-32 font-bold">KELAS ASAL:</span> <span className="font-semibold">{student.currentCohort}</span></div>
          </div>

          {/* Special Credit Warning Notice (If < 12 or > 18 credits) */}
          {isCreditOutOfRange && (
            <div className="mb-3 p-2 border border-black bg-amber-50 text-[10.5px]">
              <b>PERHATIAN BEBAN KREDIT KHAS:</b> Jumlah jam kredit semasa ialah <b>{totalCredits} jam kredit</b> {totalCredits < 12 ? '(kurang daripada had minimum 12 jam kredit)' : '(melebihi had maksimum 18 jam kredit)'}. Sila dapatkan kelulusan khas Ketua Jabatan (KJ) di ruangan pengesahan di bawah.
            </div>
          )}

          {/* (A) SENARAI KURSUS (SEKSYEN SEMASA) */}
          <div className="mb-3">
            <h3 className="font-bold text-xs uppercase mb-1">(A) SENARAI KURSUS (SEKSYEN SEMASA):</h3>
            <table className="w-full text-xs border border-black border-collapse">
              <thead>
                <tr className="bg-slate-100 text-center font-bold">
                  <th className="border border-black p-1 w-8">BIL</th>
                  <th className="border border-black p-1 w-24">KOD KURSUS</th>
                  <th className="border border-black p-1 text-left px-2">NAMA KURSUS</th>
                  <th className="border border-black p-1 w-24">SEKSYEN</th>
                  <th className="border border-black p-1 w-16">STATUS</th>
                  <th className="border border-black p-1 w-20">JAM KREDIT</th>
                </tr>
              </thead>
              <tbody>
                {keptBasePackages.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="border border-black p-2 text-center italic text-slate-600">
                      Tiada kursus didaftarkan di Seksyen Semasa.
                    </td>
                  </tr>
                ) : (
                  keptBasePackages.map((pkg, idx) => (
                    <tr key={pkg.Course_Code}>
                      <td className="border border-black p-1 text-center">{idx + 1}</td>
                      <td className="border border-black p-1 text-center font-bold font-mono">{pkg.Course_Code}</td>
                      <td className="border border-black p-1 px-2 uppercase">{pkg.Course_Name}</td>
                      <td className="border border-black p-1 text-center">{pkg.Cohort}</td>
                      <td className="border border-black p-1 text-center font-bold">D</td>
                      <td className="border border-black p-1 text-center font-bold font-mono">{pkg.Credit}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td colSpan={5} className="border border-black p-1 text-right px-2">JUMLAH JAM KREDIT (A):</td>
                  <td className="border border-black p-1 text-center font-black font-mono">{creditsA}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* (B) SENARAI KURSUS (SEKSYEN TUMPANG) */}
          <div className="mb-3">
            <h3 className="font-bold text-xs uppercase mb-1">(B) SENARAI KURSUS (SEKSYEN TUMPANG):</h3>
            <table className="w-full text-xs border border-black border-collapse">
              <thead>
                <tr className="bg-slate-100 text-center font-bold">
                  <th className="border border-black p-1 w-8">BIL</th>
                  <th className="border border-black p-1 w-24">KOD KURSUS</th>
                  <th className="border border-black p-1 text-left px-2">NAMA KURSUS</th>
                  <th className="border border-black p-1 w-24">SEKSYEN TUMPANG</th>
                  <th className="border border-black p-1 w-36">
                    NAMA &amp; T/T PENSYARAH<br />
                    <span className="text-[9px] font-normal">(Yang Ditumpang)</span>
                  </th>
                  <th className="border border-black p-1 w-16">STATUS</th>
                  <th className="border border-black p-1 w-20">JAM KREDIT</th>
                </tr>
              </thead>
              <tbody>
                {sectionBPackages.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="border border-black p-2 text-center italic text-slate-600">
                      Tiada kursus tumpang / mengulang didaftarkan.
                    </td>
                  </tr>
                ) : (
                  sectionBPackages.map((pkg, idx) => {
                    const lect = getPackageLecturers(pkg);
                    return (
                      <tr key={`${pkg.Course_Code}-${idx}`}>
                        <td className="border border-black p-1 text-center">{idx + 1}</td>
                        <td className="border border-black p-1 text-center font-bold font-mono">{pkg.Course_Code}</td>
                        <td className="border border-black p-1 px-2 uppercase">{pkg.Course_Name}</td>
                        <td className="border border-black p-1 text-center font-semibold">{pkg.Cohort}</td>
                        <td className="border border-black p-1 px-1.5 text-[10px]">
                          <div className="font-bold leading-tight">{lect}</div>
                          <div className="text-[9px] text-slate-700 mt-1">T/T: _______________</div>
                        </td>
                        <td className="border border-black p-1 text-center font-bold font-mono">{pkg.displayStatus}</td>
                        <td className="border border-black p-1 text-center font-bold font-mono">{pkg.Credit}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td colSpan={6} className="border border-black p-1 text-right px-2">JUMLAH JAM KREDIT (B):</td>
                  <td className="border border-black p-1 text-center font-black font-mono">{creditsB}</td>
                </tr>
                <tr className="font-black bg-slate-100 text-sm">
                  <td colSpan={6} className="border border-black p-1.5 text-right px-2">
                    JUMLAH JAM KREDIT KESELURUHAN (A + B):
                  </td>
                  <td className="border border-black p-1.5 text-center font-black font-mono">{totalCredits}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Signatures Section */}
          <div className="grid grid-cols-3 gap-3 text-xs mt-4 pt-2 border-t border-black">
            <div className="border border-black p-2 flex flex-col justify-between h-28">
              <div>
                <p className="font-bold">Nama Pelajar:</p>
                <p className="font-semibold uppercase mt-0.5 truncate">{student.name}</p>
              </div>
              <div className="text-[10px]">
                <div className="border-b border-dotted border-black mb-1"></div>
                <p>Tandatangan: ___________________</p>
                <p>Tarikh: ________________________</p>
              </div>
            </div>

            <div className="border border-black p-2 flex flex-col justify-between h-28">
              <div>
                <p className="font-bold">Disokong Penasihat Akademik:</p>
                <p className="font-semibold uppercase mt-0.5 truncate">{student.paName}</p>
              </div>
              <div className="text-[10px]">
                <div className="border-b border-dotted border-black mb-1"></div>
                <p>Tandatangan &amp; Cop: _____________</p>
                <p>Tarikh: ________________________</p>
              </div>
            </div>

            <div className="border border-black p-2 flex flex-col justify-between h-28">
              <div>
                <p className="font-bold">Diluluskan KJ / PKJ / KPro:</p>
                {isCreditOutOfRange ? (
                  <p className="text-[9.5px] italic mt-0.5 font-bold">
                    Kebenaran Beban Khas ({totalCredits} Kr):<br />
                    [ &nbsp; ] Diluluskan &nbsp; [ &nbsp; ] Tidak Diluluskan
                  </p>
                ) : (
                  <p className="text-[9.5px] italic mt-0.5">
                    Kebenaran Beban Kredit Khas: [ &nbsp; ] Ya &nbsp; [ &nbsp; ] Tidak
                  </p>
                )}
              </div>
              <div className="text-[10px]">
                <div className="border-b border-dotted border-black mb-1"></div>
                <p>Tandatangan &amp; Cop: _____________</p>
                <p>Tarikh: ________________________</p>
              </div>
            </div>
          </div>

          {/* Official Footnotes & Status Descriptions */}
          <div className="mt-3 pt-1 border-t border-slate-300 text-[9.5px] text-slate-700 leading-tight space-y-0.5">
            <p>1. Borang ini perlu diisi oleh pelajar mengulang kursus (MK), belum daftar (BD) dan yang menumpang seksyen lain selewat-lewatnya pada <b>{student.deadline}</b>.</p>
            <p>2. Jumlah jam kredit setiap semester adalah <b>12 – 18 jam kredit</b>. Jika jumlah jam kredit kurang dari 12 jam kredit atau melebihi 18 jam kredit, pelajar perlu mendapat kebenaran Ketua Jabatan.</p>
            <p>3. Sila kembalikan borang ini berserta salinan Slip Pengesahan Pendaftaran Kursus kepada Penasihat Akademik (PA) dan seterusnya Penyelaras Pendaftaran Kursus Jabatan (PPKJ).</p>
            <p className="font-semibold text-slate-900">
              Status: D - Daftar kali pertama / Belum Daftar (BD) / Tumpang Semasa; C1 - Mengulang Kursus kali pertama (MK1); C2 - Mengulang Kursus kali kedua (MK2).
            </p>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
