import {
  CoursePackage,
  CurriculumCourse,
  CurriculumData,
  CurriculumLibrary,
  CurriculumValidation,
  PrereqDroppedCourse,
  RepeatPrereqViolation,
  RepeatSelection
} from '../types';

/**
 * Curriculum prerequisites (DKM v3) are curriculum rules, not schedule data:
 * they live in `public/assets/dkm_curriculum.json` (mirrored in KV `dkm_curriculum`)
 * so a timetable upload can never overwrite them.
 */

export function normalizeCourseCode(code?: string | null): string {
  return String(code || '').toUpperCase().replace(/\s+/g, '');
}

export interface PrerequisiteGraph {
  courses: Map<string, CurriculumCourse>;
  prerequisites: Map<string, string[]>;
  /** Timetable code -> official curriculum code (e.g. DBS10082 -> DBS10042). */
  aliases: Map<string, string>;
}

/**
 * Accepts a single programme document or a library keyed by programme code.
 * Course codes are shared across programmes, so every available document is merged:
 * a DAD student taking DBM20173 is still bound by DBM10163 from the DKM document.
 */
export type CurriculumInput = CurriculumData | CurriculumLibrary | null | undefined;

/** Accepts either one programme document or the library map (programme -> document). */
export function toCurriculumDocuments(input: CurriculumInput): CurriculumData[] {
  if (!input) return [];
  const asDocument = input as CurriculumData;
  if (asDocument.courses && typeof asDocument.courses === 'object') return [asDocument];
  return Object.values(input as CurriculumLibrary).filter(
    doc => doc && doc.courses && typeof doc.courses === 'object'
  );
}

export function buildPrerequisiteGraph(curriculum?: CurriculumInput): PrerequisiteGraph {
  const courses = new Map<string, CurriculumCourse>();
  const prerequisites = new Map<string, string[]>();
  const aliases = new Map<string, string>();

  toCurriculumDocuments(curriculum).forEach(document => {
    Object.entries(document.meta?.codeAliases || {}).forEach(([alias, official]) => {
      const aliasCode = normalizeCourseCode(alias);
      const officialCode = normalizeCourseCode(official);
      if (aliasCode && officialCode && aliasCode !== officialCode && !aliases.has(aliasCode)) {
        aliases.set(aliasCode, officialCode);
      }
    });

    Object.keys(document.courses).forEach(rawCode => {
      const code = normalizeCourseCode(rawCode);
      if (!code) return;

      if (!courses.has(code)) courses.set(code, document.courses[rawCode]);

      // Union across programmes: a programme that omits a prerequisite must not
      // erase the rule declared by the programme that owns the course.
      const merged = new Set(prerequisites.get(code) || []);
      (document.courses[rawCode].prerequisites || [])
        .map(normalizeCourseCode)
        .filter(prereq => prereq && prereq !== code)
        .forEach(prereq => merged.add(prereq));
      if (merged.size > 0) prerequisites.set(code, Array.from(merged));
    });
  });

  return { courses, prerequisites, aliases };
}

/**
 * Maps a timetable code onto the curriculum code that carries its name and rules
 * (`DBS10082` on the sheet is `DBS10042` in the Programme Information).
 */
export function resolveCourseCode(graph: PrerequisiteGraph, code?: string | null): string {
  let current = normalizeCourseCode(code);
  for (let hop = 0; hop < 4 && current && graph.aliases.has(current); hop += 1) {
    const next = graph.aliases.get(current) as string;
    if (next === current) break;
    current = next;
  }
  return current;
}

export function getCourseName(graph: PrerequisiteGraph, code: string, fallback?: string): string {
  return graph.courses.get(resolveCourseCode(graph, code))?.name || fallback || code;
}

/** All ancestor codes of `code` (transitive), cycle-safe. */
export function getPrerequisiteClosure(code: string, graph: PrerequisiteGraph, limit = 32): string[] {
  const seen = new Set<string>();
  const queue = [...(graph.prerequisites.get(resolveCourseCode(graph, code)) || [])];

  while (queue.length > 0 && seen.size < limit) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(graph.prerequisites.get(next) || []));
  }
  return Array.from(seen);
}

interface PrerequisiteBlock {
  code: string;
  blockedPrereq: string;
  chain: string[];
}

/** Shortest path from an unsatisfied (repeated) ancestor down to `code`, else null. */
function findUnsatisfiedAncestorPath(
  code: string,
  notPassed: Set<string>,
  graph: PrerequisiteGraph
): string[] | null {
  const queue = (graph.prerequisites.get(resolveCourseCode(graph, code)) || []).map(prereq => ({
    code: prereq,
    path: [code, prereq]
  }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift() as { code: string; path: string[] };
    if (visited.has(node.code)) continue;
    visited.add(node.code);

    if (notPassed.has(node.code)) {
      // path is [course, ..., repeatedAncestor]; present it as repeated -> ... -> course
      return [...node.path].reverse();
    }

    (graph.prerequisites.get(node.code) || []).forEach(prereq =>
      queue.push({ code: prereq, path: [...node.path, prereq] })
    );
  }

  return null;
}

/**
 * Base (Bahagian A) courses that cannot be taken because a prerequisite is not
 * passed yet. Repeated courses (C1/C2/D) are "not passed", and the block cascades
 * through the full prerequisite chain (e.g. repeat DBM10163 -> block DBM20173 and
 * DBM30183, even when DBM20173 is not part of this cohort's timetable).
 */
export function findPrerequisiteBlocks(
  basePackages: CoursePackage[],
  notPassedCodes: Iterable<string>,
  graph: PrerequisiteGraph
): PrerequisiteBlock[] {
  if (graph.prerequisites.size === 0) return [];

  const notPassed = new Set(
    Array.from(notPassedCodes, code => resolveCourseCode(graph, code)).filter(Boolean)
  );
  if (notPassed.size === 0) return [];

  const blocks: PrerequisiteBlock[] = [];
  const seen = new Set<string>();

  basePackages.forEach(pkg => {
    const code = resolveCourseCode(graph, pkg.Course_Code);
    if (!code || seen.has(code) || notPassed.has(code)) return;

    const chain = findUnsatisfiedAncestorPath(code, notPassed, graph);
    if (!chain) return;

    seen.add(code);
    blocks.push({ code, blockedPrereq: chain[0], chain });
  });

  return blocks;
}

/** Repeated courses that depend on another repeated course (invalid registration). */
export function findRepeatPrerequisiteViolations(
  repeatCodes: Iterable<string>,
  graph: PrerequisiteGraph
): RepeatPrereqViolation[] {
  const repeatSet = new Set(
    Array.from(repeatCodes, code => resolveCourseCode(graph, code)).filter(Boolean)
  );
  const violations: RepeatPrereqViolation[] = [];

  repeatSet.forEach(code => {
    const directPrereqs = graph.prerequisites.get(code);
    if (!directPrereqs || directPrereqs.length === 0) return;

    const queue = directPrereqs.map(prereq => ({ code: prereq, path: [code, prereq] }));
    const visited = new Set<string>();

    while (queue.length > 0) {
      const node = queue.shift() as { code: string; path: string[] };
      if (visited.has(node.code)) continue;
      visited.add(node.code);

      if (repeatSet.has(node.code)) {
        violations.push({
          code,
          prerequisiteCode: node.code,
          prerequisiteName: getCourseName(graph, node.code),
          chain: node.path
        });
        break;
      }

      (graph.prerequisites.get(node.code) || []).forEach(prereq =>
        queue.push({ code: prereq, path: [...node.path, prereq] })
      );
    }
  });

  return violations;
}

/** Base courses to auto-drop, with the reason shown to the advisor. */export function findPrerequisiteDrops(
  basePackages: CoursePackage[],
  repeatSelections: RepeatSelection[],
  graph: PrerequisiteGraph
): PrereqDroppedCourse[] {
  const statusByCode = new Map<string, string>();
  repeatSelections.forEach(sel =>
    statusByCode.set(resolveCourseCode(graph, sel.code), sel.status)
  );

  const blocks = findPrerequisiteBlocks(
    basePackages,
    repeatSelections.map(sel => sel.code),
    graph
  );

  return blocks.map(block => {
    const pkg = basePackages.find(
      p => resolveCourseCode(graph, p.Course_Code) === block.code
    ) as CoursePackage;
    const prereqStatus = statusByCode.get(block.blockedPrereq);
    const chainLabel = block.chain.join(' → ');
    const reason =
      block.chain.length > 2
        ? `Rantaian prasyarat belum selesai (${chainLabel}).`
        : `Prasyarat ${block.blockedPrereq} sedang diulang${prereqStatus ? ` (${prereqStatus})` : ''} — kursus ini tidak boleh diambil serentak.`;

    return {
      pkg,
      blockedBy: block.blockedPrereq,
      blockedByName: getCourseName(graph, block.blockedPrereq),
      chain: block.chain,
      reason
    };
  });
}

/**
 * Validates an uploaded curriculum document before it is published to KV, so a
 * bad file cannot silently disable prerequisite enforcement.
 */
export function validateCurriculum(input: unknown): CurriculumValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data = input as CurriculumData | null | undefined;
  const programme = String((data && data.meta && data.meta.programme) || '').trim().toUpperCase();

  if (!data || typeof data !== 'object' || !data.courses || typeof data.courses !== 'object') {
    return {
      ok: false,
      programme,
      coursesCount: 0,
      prerequisitesCount: 0,
      errors: ['Medan "courses" tiada. Fail mesti mengandungi objek courses: { "KOD": { ... } }.'],
      warnings
    };
  }

  const rawCodes = Object.keys(data.courses);
  const normalized = new Map<string, string>();
  rawCodes.forEach(rawCode => normalized.set(normalizeCourseCode(rawCode), rawCode));

  if (rawCodes.length === 0) errors.push('Senarai "courses" kosong.');

  let prerequisitesCount = 0;
  const unknownPrerequisites: string[] = [];
  const selfReferences: string[] = [];
  const missingNames: string[] = [];

  rawCodes.forEach(rawCode => {
    const course = data.courses[rawCode] || ({} as CurriculumCourse);
    const code = normalizeCourseCode(rawCode);

    if (code !== rawCode) {
      warnings.push(`Kod "${rawCode}" mengandungi ruang/aksara tidak standard; sistem menormalkannya kepada "${code}".`);
    }
    if (!course.name) missingNames.push(rawCode);

    if (course.prerequisites !== undefined && !Array.isArray(course.prerequisites)) {
      errors.push(`${rawCode}: medan "prerequisites" mesti array.`);
      return;
    }

    (course.prerequisites || []).forEach(prereq => {
      const prereqCode = normalizeCourseCode(prereq);
      prerequisitesCount += 1;
      if (prereqCode === code) {
        selfReferences.push(rawCode);
      } else if (!normalized.has(prereqCode)) {
        unknownPrerequisites.push(`${rawCode} → ${prereqCode}`);
      }
    });
  });

  if (missingNames.length > 0) {
    warnings.push(`${missingNames.length} kursus tiada medan "name": ${missingNames.slice(0, 6).join(', ')}.`);
  }
  if (selfReferences.length > 0) {
    warnings.push(`Prasyarat yang merujuk kod sendiri diabaikan: ${[...new Set(selfReferences)].join(', ')}.`);
  }
  if (unknownPrerequisites.length > 0) {
    warnings.push(
      `${unknownPrerequisites.length} prasyarat merujuk kod yang tiada dalam senarai, jadi peraturan itu tidak akan berkuat kuasa: ` +
        `${unknownPrerequisites.slice(0, 6).join(', ')}${unknownPrerequisites.length > 6 ? '…' : ''}`
    );
  }

  const graph = buildPrerequisiteGraph(data);
  const cyclic: string[] = [];
  graph.courses.forEach((_course, code) => {
    if (getPrerequisiteClosure(code, graph).includes(code)) cyclic.push(code);
  });
  if (cyclic.length > 0) {
    warnings.push(`Kitaran prasyarat dikesan dan akan diabaikan: ${cyclic.join(', ')}.`);
  }

  return {
    ok: errors.length === 0,
    programme,
    coursesCount: rawCodes.length,
    prerequisitesCount,
    errors,
    warnings
  };
}
