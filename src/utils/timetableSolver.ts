import {
  MasterTimetableEntry,
  CoursePackage,
  RepeatSelection,
  ElectiveChoiceGroup,
  SolverAnalysis,
  AllocatedRepeatPackage,
  RescuedCourse,
  AutoDroppedCourse,
  ScoredCandidate,
  CurriculumData,
  CurriculumLibrary
} from '../types';
import { buildPrerequisiteGraph, findPrerequisiteDrops, findRepeatPrerequisiteViolations } from './prerequisiteEngine';
import { findChoiceGroups, sharedChoiceSlot } from './choiceSchedule';
import { isBahasaKebangsaanA } from './bahasaKebangsaan';

export function parseTime(t: string): number {
  if (!t) return 0;
  const parts = t.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

export function isTimeClashing(startA: string, endA: string, startB: string, endB: string): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  return parseTime(startA) < parseTime(endB) && parseTime(endA) > parseTime(startB);
}

export function packagesClash(pkgA: CoursePackage | null, pkgB: CoursePackage | null): boolean {
  if (!pkgA || !pkgB) return false;
  for (const sA of pkgA.slots) {
    for (const sB of pkgB.slots) {
      if (
        sA.Day.toLowerCase() === sB.Day.toLowerCase() &&
        isTimeClashing(sA.Start_Time, sA.End_Time, sB.Start_Time, sB.End_Time)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function getAllCoursePackages(timetable: MasterTimetableEntry[]): CoursePackage[] {
  const map = new Map<string, CoursePackage>();
  timetable.forEach(row => {
    const key = `${row.Cohort}__${row.Course_Code}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        Cohort: row.Cohort,
        Program: (row.Cohort || "").substring(0, 3).toUpperCase(),
        Course_Code: row.Course_Code,
        Course_Name: row.Course_Name,
        Credit: Number(row.Credit || 0),
        slots: []
      });
    }
    map.get(key)!.slots.push({
      Day: row.Day,
      Start_Time: row.Start_Time,
      End_Time: row.End_Time,
      Venue: row.Venue,
      Lecturer: row.Lecturer,
      Status: row.Status
    });
  });
  return Array.from(map.values());
}

export function formatPackageSchedule(pkg: CoursePackage): string {
  if (!pkg || !pkg.slots || pkg.slots.length === 0) return "-";
  return pkg.slots
    .map(s => `${s.Day} ${s.Start_Time}-${s.End_Time} (${s.Venue})`)
    .join(", ");
}

export function getPackageLecturers(pkg: CoursePackage): string {
  if (!pkg || !pkg.slots) return "-";
  const unique = [...new Set(pkg.slots.map(s => s.Lecturer).filter(Boolean))];
  return unique.join(" / ") || "-";
}

const SOLVER_WEIGHTS = {
  dropPerCredit: 1000,          // penalty per credit of current course dropped
  repeatClash: 100000,          // MK/BD clashing between each other
  creditWindowPerCredit: 50,    // penalty per credit outside 12-18 range
  swapSection: 10,              // penalty for moving current course to alternate section
  otherProgram: 1               // penalty for picking another program section
};

export function getRepeatCandidates(code: string, currentCohort: string, allPackages: CoursePackage[]): CoursePackage[] {
  let cands = allPackages.filter(p => p.Course_Code === code && p.Cohort !== currentCohort);
  if (cands.length === 0) cands = allPackages.filter(p => p.Course_Code === code);
  return cands;
}

interface SolverVariable {
  isRepeat: boolean;
  code: string;
  status?: "C1" | "C2" | "D";
  credit: number;
  original?: CoursePackage;
  options: (CoursePackage | null)[];
}

interface SolveContext {
  currentCohort: string;
  studentProgram: string;
  allPackages: CoursePackage[];
  repeatList: RepeatSelection[];
  activeBase: CoursePackage[];
  forced?: Record<string, string>;
}

interface AssignmentItem {
  v: SolverVariable;
  pkg: CoursePackage | null;
}

export function solveOptimal(ctx: SolveContext): { assignment: AssignmentItem[]; cost: number } | null {
  const { currentCohort, studentProgram, allPackages, repeatList, activeBase, forced } = ctx;
  const W = SOLVER_WEIGHTS;
  const progRank = (p: CoursePackage) => (p.Program === studentProgram ? 0 : 1);
  const byPreference = (a: CoursePackage, b: CoursePackage) => progRank(a) - progRank(b) || a.Cohort.localeCompare(b.Cohort);
  const repeatCodes = new Set(repeatList.map(r => r.code));

  const repeatVars: SolverVariable[] = [];
  repeatList.forEach(r => {
    let cands = getRepeatCandidates(r.code, currentCohort, allPackages);
    const pref = (forced && forced[r.code]) || r.preferredCohort;
    if (pref) {
      const match = cands.filter(c => c.Cohort === pref);
      if (match.length) cands = match;
    }
    if (cands.length === 0) return;
    cands = cands.slice().sort(byPreference);
    repeatVars.push({ isRepeat: true, code: r.code, status: r.status, credit: cands[0].Credit, options: cands });
  });

  const baseVars: SolverVariable[] = activeBase
    .filter(b => !repeatCodes.has(b.Course_Code))
    .map(b => {
      const alts = allPackages
        .filter(p => p.Course_Code === b.Course_Code && p.Cohort !== currentCohort)
        .sort(byPreference);
      return { isRepeat: false, code: b.Course_Code, credit: b.Credit, original: b, options: [b, ...alts, null] };
    })
    .sort((a, b) => b.credit - a.credit || a.code.localeCompare(b.code));

  const vars: SolverVariable[] = [...repeatVars, ...baseVars];
  const chosen: AssignmentItem[] = [];
  let best: AssignmentItem[] | null = null;
  let bestCost = Infinity;
  let nodes = 0;

  function dfs(i: number, cost: number) {
    if (++nodes > 300000) return; // safeguard
    if (i === vars.length) {
      let total = 0;
      chosen.forEach(c => { if (c.pkg) total += c.pkg.Credit; });
      const outside = total < 12 ? 12 - total : (total > 18 ? total - 18 : 0);
      const finalCost = cost + outside * W.creditWindowPerCredit;
      if (finalCost < bestCost) {
        bestCost = finalCost;
        best = chosen.map(c => ({ v: c.v, pkg: c.pkg }));
      }
      return;
    }
    const v = vars[i];
    for (const opt of v.options) {
      let add = 0;
      if (opt === null) {
        add = W.dropPerCredit * v.credit;
      } else {
        const clashing = chosen.filter(c => c.pkg && packagesClash(c.pkg, opt));
        if (clashing.length) {
          if (!v.isRepeat) continue; // base courses cannot clash
          add += W.repeatClash * clashing.length; // unavoidable repeat clash
        }
        if (!v.isRepeat && opt.Cohort !== currentCohort) add += W.swapSection;
        if (opt.Program !== studentProgram) add += W.otherProgram;
      }
      if (cost + add >= bestCost) continue; // pruning
      chosen.push({ v, pkg: opt });
      dfs(i + 1, cost + add);
      chosen.pop();
    }
  }

  dfs(0, 0);
  return best ? { assignment: best, cost: bestCost } : null;
}


/**
 * Courses of one cohort that occupy the same class slot are registration alternatives
 * (Sukan / Kelab-Persatuan / Unit Beruniform, or Sains Teknologi Islam vs Nilai
 * Masyarakat Malaysia). A student registers only one, so the unselected options are
 * removed from the kept timetable and never counted twice.
 */
export function buildElectiveGroups(
  packages: CoursePackage[],
  selections: Record<string, string> = {}
): ElectiveChoiceGroup[] {
  const groups: ElectiveChoiceGroup[] = [];

  findChoiceGroups(packages).forEach(members => {
    const sharedSlot = sharedChoiceSlot(members) || members[0].slots[0];
    const key = `${members[0].Cohort}|${sharedSlot.Day}|${sharedSlot.Start_Time}|${sharedSlot.End_Time}`;
    const options = members
      .map(pkg => ({
        courseCode: pkg.Course_Code,
        courseName: pkg.Course_Name,
        credit: pkg.Credit
      }))
      .sort((a, b) => a.courseCode.localeCompare(b.courseCode));
    const selected = selections[key];
    const selectedCourseCode =
      selected && options.some(option => option.courseCode === selected)
        ? selected
        : options[0].courseCode;
    groups.push({
      key,
      day: sharedSlot.Day,
      startTime: sharedSlot.Start_Time,
      endTime: sharedSlot.End_Time,
      options,
      selectedCourseCode
    });
  });

  return groups.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.startTime.localeCompare(b.startTime) ||
      a.options[0].courseCode.localeCompare(b.options[0].courseCode)
  );
}

export function runFullAnalysis(
  currentCohort: string,
  timetable: MasterTimetableEntry[],
  selectedRepeatCourses: RepeatSelection[],
  manualDroppedCourseCodes: string[],
  curriculum?: CurriculumData | CurriculumLibrary | null,
  electiveSelections: Record<string, string> = {},
  bahasaKebangsaanPassed: boolean = true
): SolverAnalysis {
  const studentProgram = currentCohort.substring(0, 3).toUpperCase();
  const allPackages = getAllCoursePackages(timetable);
  const basePackages = allPackages.filter(p => p.Cohort === currentCohort);

  // Bahasa Kebangsaan A is only for students without an SPM credit in Bahasa Melayu.
  const bahasaKebangsaanExemptPackages = bahasaKebangsaanPassed
    ? basePackages.filter(pkg => isBahasaKebangsaanA(pkg.Course_Code, pkg.Course_Name))
    : [];
  const excludedCodes = new Set([
    ...manualDroppedCourseCodes,
    ...bahasaKebangsaanExemptPackages.map(pkg => pkg.Course_Code)
  ]);

  // Prerequisite pass: a base course is dropped when a prerequisite of it is being
  // repeated (not passed yet), cascading to every descendant course.
  const prerequisiteGraph = buildPrerequisiteGraph(curriculum);
  const prereqDroppedCourses = findPrerequisiteDrops(
    basePackages.filter(p => !excludedCodes.has(p.Course_Code)),
    selectedRepeatCourses,
    prerequisiteGraph
  );
  const prereqDroppedCodes = new Set(prereqDroppedCourses.map(d => d.pkg.Course_Code));
  const repeatPrereqViolations = findRepeatPrerequisiteViolations(
    selectedRepeatCourses.map(r => r.code),
    prerequisiteGraph
  );

  const manualDroppedPackages = basePackages.filter(p => manualDroppedCourseCodes.includes(p.Course_Code));
  const activeBasePackages = basePackages.filter(
    p => !excludedCodes.has(p.Course_Code) && !prereqDroppedCodes.has(p.Course_Code)
  );

  // "Pilih satu" courses: only the selected option of each slot-based group stays.
  const electiveGroups = buildElectiveGroups(activeBasePackages, electiveSelections);
  const unselectedElectiveCodes = new Set<string>();
  electiveGroups.forEach(group => {
    group.options.forEach(option => {
      if (option.courseCode !== group.selectedCourseCode) unselectedElectiveCodes.add(option.courseCode);
    });
  });
  const unselectedElectivePackages = activeBasePackages.filter(pkg =>
    unselectedElectiveCodes.has(pkg.Course_Code)
  );
  const effectiveBasePackages = activeBasePackages.filter(
    pkg => !unselectedElectiveCodes.has(pkg.Course_Code)
  );

  const solverCtx: SolveContext = {
    currentCohort,
    studentProgram,
    allPackages,
    repeatList: selectedRepeatCourses,
    activeBase: effectiveBasePackages
  };

  const solution = solveOptimal(solverCtx);
  const assignment = solution ? solution.assignment : [];
  const chosenPkgs = assignment.filter(a => a.pkg).map(a => a.pkg as CoursePackage);

  const allocatedRepeatPackages: AllocatedRepeatPackage[] = [];
  assignment.filter(a => a.v.isRepeat && a.pkg).forEach(a => {
    const pkg = a.pkg!;
    const scoredCandidates: ScoredCandidate[] = getRepeatCandidates(a.v.code, currentCohort, allPackages).map(cand => {
      const sol = solveOptimal({ ...solverCtx, forced: { [a.v.code]: cand.Cohort } });
      const asg = sol ? sol.assignment : [];
      const clashedBase = asg
        .filter(x => !x.v.isRepeat && x.v.original && x.pkg !== x.v.original)
        .map(x => x.v.original as CoursePackage);
      const droppedCredits = asg
        .filter(x => !x.v.isRepeat && !x.pkg)
        .reduce((s, x) => s + x.v.credit, 0);
      const clashesWithOtherRepeat = asg.some(
        x => x.v.isRepeat && x.v.code !== a.v.code && x.pkg && packagesClash(x.pkg, cand)
      );
      return {
        pkg: cand,
        clashedBase,
        droppedCredits,
        clashesWithOtherRepeat,
        sameProgram: cand.Program === studentProgram,
        penalty: sol ? sol.cost : Infinity
      };
    }).sort((x, y) => x.penalty - y.penalty);

    allocatedRepeatPackages.push({
      ...pkg,
      repeatStatus: a.v.status || "C1",
      displayStatus: a.v.status || "C1",
      scoredCandidates,
      clashedBasePackages: effectiveBasePackages.filter(bp => packagesClash(pkg, bp)),
      clashesWithOtherRepeat: assignment.some(
        x => x.v.isRepeat && x.v.code !== a.v.code && x.pkg && packagesClash(x.pkg, pkg)
      ),
      isRescued: false
    });
  });

  const rescuedBaseCourses: RescuedCourse[] = [];
  const autoDroppedCourses: AutoDroppedCourse[] = [];
  const keptCodes = new Set<string>();

  assignment.filter(a => !a.v.isRepeat).forEach(a => {
    const orig = a.v.original!;
    if (a.pkg === orig) {
      keptCodes.add(orig.Course_Code);
      return;
    }
    const clashedWithCodes = [...new Set(
      chosenPkgs
        .filter(p => p !== a.pkg && p.Course_Code !== orig.Course_Code && packagesClash(p, orig))
        .map(p => p.Course_Code)
    )];
    if (a.pkg) {
      rescuedBaseCourses.push({ originalPkg: orig, rescuePkg: a.pkg, status: "D", clashedWithCodes });
    } else {
      autoDroppedCourses.push({ pkg: orig, clashedWithCodes });
    }
  });

  const keptBasePackages = effectiveBasePackages.filter(bp => keptCodes.has(bp.Course_Code));

  const sectionBPackages = [
    ...allocatedRepeatPackages.map(rp => ({
      ...rp,
      displayStatus: rp.repeatStatus,
      isRescued: false
    })),
    ...rescuedBaseCourses.map(rc => ({
      ...rc.rescuePkg,
      displayStatus: "D" as const,
      isRescued: true,
      originalCohort: rc.originalPkg.Cohort
    }))
  ];

  const creditsA = keptBasePackages.reduce((sum, p) => sum + p.Credit, 0);
  const creditsB = sectionBPackages.reduce((sum, p) => sum + p.Credit, 0);
  const totalCredits = creditsA + creditsB;

  return {
    currentCohort,
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
  };
}
