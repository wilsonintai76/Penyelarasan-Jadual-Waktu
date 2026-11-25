import React, { useState } from 'react';
import { Printer, Eye, EyeOff, FileCheck2 } from 'lucide-react';
import { SolverAnalysis, StudentInfo } from '../types';
import { WEEK_DAYS, TIME_SLOTS } from '../data/timetableConstants';
import { parseTime } from '../utils/timetableSolver';
import { triggerPrintDocument } from '../utils/printHelper';
import { PKSLogo } from './PKSLogo';

interface JadualKuliahViewProps {
  analysis: SolverAnalysis;
  student: StudentInfo;
  officialLogoUrl?: string;
  institutionName?: string;
}

export const JadualKuliahView: React.FC<JadualKuliahViewProps> = ({
  analysis,
  student,
  officialLogoUrl = ''
}) => {
  const { keptBasePackages, sectionBPackages, totalCredits } = analysis;
  const programCode = (student.currentCohort || "").substring(0, 3).toUpperCase();
  const customLogo =
    officialLogoUrl ||
    (typeof window !== 'undefined' ? localStorage.getItem('pks_custom_logo') || '' : '');
  const [isPrintPreview, setIsPrintPreview] = useState(false);
  const [isGrayscalePreview, setIsGrayscalePreview] = useState(false);

  const allActiveCourses = [
    ...keptBasePackages.map(p => ({ ...p, isTumpang: false })),
    ...sectionBPackages.map(p => ({ ...p, isTumpang: true }))
  ];

  interface FlatEvent {
    code: string;
    name: string;
    cohort: string;
    isTumpang: boolean;
    displayStatus: string;
    day: string;
    start: string;
    end: string;
    venue: string;
    lecturer: string;
  }

  const flatEvents: FlatEvent[] = [];
  allActiveCourses.forEach(pkg => {
    pkg.slots.forEach(s => {
      flatEvents.push({
        code: pkg.Course_Code,
        name: pkg.Course_Name,
        cohort: pkg.Cohort,
        isTumpang: pkg.isTumpang,
        displayStatus: (pkg as any).displayStatus || 'D',
        day: s.Day,
        start: s.Start_Time,
        end: s.End_Time,
        venue: s.Venue,
        lecturer: s.Lecturer
      });
    });
  });

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
            <span className="font-bold">Pratonton Jadual Kuliah Bersih (A4 Landskap):</span> Format jadual waktu rasmi Politeknik Kuching Sarawak berpandukan slot masa Isnin – Jumaat (8.00 pagi - 5.00 petang).
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
                ? 'bg-slate-900 text-white border-slate-900 ring-2 ring-emerald-400/60'
                : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-300'
            }`}
            title="Togol paparan simulasi cetakan sebenar A4"
          >
            {isPrintPreview ? (
              <EyeOff className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            ) : (
              <Eye className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
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
            onClick={() => triggerPrintDocument('jadual')}
            className="flex-1 sm:flex-initial px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow flex items-center justify-center gap-1.5 transition shrink-0"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>Cetak Jadual Kuliah (A4)</span>
          </button>
        </div>
      </div>

      {/* Print Preview Stage / Scaled Preview Wrapper */}
      <div className={isPrintPreview ? 'print-preview-stage rounded-2xl overflow-hidden border border-slate-700 shadow-2xl bg-slate-800' : ''}>
        {isPrintPreview && (
          <div className="no-print bg-slate-900 text-slate-100 px-4 py-2.5 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono text-[10.5px] font-bold">
                A4 LANDSCAPE · 297mm × 210mm
              </span>
              <span className="text-slate-300 text-[11px]">
                Menunjukkan susun atur kertas, jadual waktu matriks, dan sempadan hitam seperti hasil cetakan sebenar.
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
                onClick={() => triggerPrintDocument('jadual')}
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer transition"
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
            id="printable-sheet-jadual"
            style={{ fontFamily: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" }}
            className={`print-sheet bg-white p-6 sm:p-8 rounded-2xl shadow-xl border border-slate-300 text-black w-full min-w-[1123px] max-w-[297mm] mx-auto text-[8.5pt] leading-normal page-break transition-all ${
              isPrintPreview ? `print-preview-sheet print-preview-sheet--landscape ${isGrayscalePreview ? 'grayscale' : ''}` : ''
            }`}
          >
          {/* Page frame — mirrors the official Jadual Waktu Kuliah border */}
          <div className="border border-black px-[13mm] pt-[7mm] pb-[6mm]">
            {/* Header: centred official logo + document title */}
            <div className="flex justify-center">
              <PKSLogo customLogo={customLogo} boxClassName="w-[56mm] h-[20mm]" />
            </div>
            <h1 className="mt-[2mm] text-center text-[14pt] font-bold uppercase underline decoration-1 underline-offset-[2px]">
              Jadual Waktu Kuliah
            </h1>

            {/* Department / session, as on the official form */}
            <div className="mt-[4mm] flex justify-center">
              <div className="w-[92mm] space-y-[1.5mm] text-[9.5pt]">
                <div className="flex items-center gap-1">
                  <span className="w-[24mm] font-bold">JABATAN</span>
                  <span>:</span>
                  <span className="ml-1 flex-1 border-b border-black px-1 font-semibold uppercase">{student.department}</span>
                </div>
                <div className="flex items-center gap-1 pl-[10mm]">
                  <span className="w-[16mm] font-bold">SESI</span>
                  <span>:</span>
                  <span className="ml-1 w-[34mm] border-b border-black px-1 font-semibold">{student.session}</span>
                </div>
              </div>
            </div>

            {/* Student particulars */}
            <div className="mt-[5mm] space-y-[1.5mm] text-[9.5pt]">
              <div className="flex items-center">
                <span className="w-[52mm] font-bold">Nama</span>
                <span className="pr-1">:</span>
                <span className="flex-1 border-b border-black px-1 font-semibold uppercase">{student.name}</span>
              </div>
              <div className="flex items-center">
                <span className="w-[52mm] font-bold">Program</span>
                <span className="pr-1">:</span>
                <span className="flex-1 border-b border-black px-1 font-semibold uppercase">{programCode}</span>
              </div>
              <div className="flex items-center">
                <span className="w-[52mm] font-bold">Penasihat Akademik</span>
                <span className="pr-1">:</span>
                <span className="flex-1 border-b border-black px-1 font-semibold uppercase">{student.paName}</span>
              </div>
            </div>

          {/* Official matrix grid — column set matches the printed jadual waktu */}
          <table className="mt-[4mm] w-full table-fixed border border-black border-collapse text-center text-[8.5pt]">
            <colgroup>
              <col style={{ width: '9.9%' }} />
              <col style={{ width: '9.3%' }} />
              <col style={{ width: '9.3%' }} />
              <col style={{ width: '10.2%' }} />
              <col style={{ width: '11.7%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9.9%' }} />
              <col style={{ width: '9.9%' }} />
              <col style={{ width: '9.9%' }} />
              <col style={{ width: '9.9%' }} />
            </colgroup>
            <thead>
              <tr className="font-bold">
                <th className="border border-black py-[1.2mm] text-left pl-[1.5mm]">HARI/MASA</th>
                <th className="border border-black">8.00 – 9.00am</th>
                <th className="border border-black">9.00 – 10.00am</th>
                <th className="border border-black">10.00 – 11.00am</th>
                <th className="border border-black">11.00am – 12.00pm</th>
                <th className="border border-black">12.00 – 1.00pm</th>
                <th className="border border-black">1.00 – 2.00pm</th>
                <th className="border border-black">2.00 – 3.00pm</th>
                <th className="border border-black">3.00 – 4.00pm</th>
                <th className="border border-black">4.00 – 5.00pm</th>
              </tr>
            </thead>
            <tbody>
              {WEEK_DAYS.map(day => {
                const dayEvents = flatEvents.filter(e => e.day.toLowerCase() === day.toLowerCase());
                const cells: React.ReactNode[] = [];
                let slotIdx = 0;

                while (slotIdx < TIME_SLOTS.length) {
                  const slot = TIME_SLOTS[slotIdx];
                  const slotStartMin = parseTime(slot.start);

                  const matchedEvent = dayEvents.find(ev => {
                    const evStart = parseTime(ev.start);
                    const evEnd = parseTime(ev.end);
                    return evStart <= slotStartMin && evEnd > slotStartMin;
                  });

                  if (matchedEvent) {
                    const evEndMin = parseTime(matchedEvent.end);
                    let span = 1;
                    while (
                      slotIdx + span < TIME_SLOTS.length &&
                      parseTime(TIME_SLOTS[slotIdx + span].start) < evEndMin
                    ) {
                      span++;
                    }

                    const tag = matchedEvent.isTumpang
                      ? `[${matchedEvent.cohort} - ${matchedEvent.displayStatus}]`
                      : `[${matchedEvent.cohort}]`;

                    cells.push(
                      <td
                        key={`cell-${day}-${slot.start}`}
                        colSpan={span}
                        className={`border border-black p-1 text-center leading-tight ${
                          matchedEvent.isTumpang ? 'bg-slate-100 font-semibold' : ''
                        }`}
                      >
                        <div className="font-bold text-[10px]">{matchedEvent.code}</div>
                        <div className="text-[8.5px] font-bold">{tag}</div>
                        <div className="text-[8.5px]">{matchedEvent.venue} ({matchedEvent.lecturer})</div>
                      </td>
                    );
                    slotIdx += span;
                  } else {
                    if (slot.isBreak) {
                      cells.push(
                        <td
                          key={`break-${day}-${slot.start}`}
                          className="border border-black p-1 text-[8pt] font-bold text-slate-400"
                        >
                          REHAT
                        </td>
                      );
                    } else {
                      cells.push(
                        <td
                          key={`empty-${day}-${slot.start}`}
                          className="border border-black p-1"
                        >
                          &nbsp;
                        </td>
                      );
                    }
                    slotIdx++;
                  }
                }

                return (
                  <tr key={day} className="h-[12mm]">
                    <td className="border border-black px-1 py-[1mm] font-bold uppercase align-middle">{day}</td>
                    {cells}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Registered Courses Summary List */}
          <div className="mt-[3mm] border border-black px-[2mm] py-[1mm]">
            <div className="flex items-center justify-between border-b border-black pb-[1mm] mb-[1mm]">
              <span className="font-bold text-xs uppercase">Senarai Kursus Didaftarkan Pada Sesi Ini:</span>
              <span className="font-black text-xs">Jumlah Jam Kredit: {totalCredits} Jam</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-[0.6mm] text-[7.5pt] leading-tight">
              {allActiveCourses.length === 0 ? (
                <div className="italic text-slate-600">Tiada kursus didaftarkan.</div>
              ) : (
                allActiveCourses.map((pkg, idx) => {
                  const tag = pkg.isTumpang
                    ? `Tumpang ${pkg.Cohort} (${(pkg as any).displayStatus || 'D'})`
                    : `Seksyen Asal ${pkg.Cohort} (D)`;
                  return (
                    <div key={`${pkg.Course_Code}-${idx}`} className="flex justify-between border-b border-dotted border-slate-300 pb-0.5">
                      <span className="truncate pr-2">
                        <b>{idx + 1}. {pkg.Course_Code}</b> - {pkg.Course_Name}
                      </span>
                      <span className="font-semibold shrink-0">
                        {tag} · {pkg.Credit} Kr
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Endorsements & Signatures */}
          <div className="mt-[3mm] flex justify-between items-center text-[8pt] pt-[1.5mm] border-t border-black">
            <div>Tarikh Akhir Serahan PK01: <b>{student.deadline}</b></div>
            <div>Tandatangan Pelajar: ________________________</div>
            <div>Disahkan Oleh PA: ________________________</div>
          </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
