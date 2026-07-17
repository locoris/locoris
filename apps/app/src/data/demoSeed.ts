import { translateInline } from "../localization/translateInline";
import { getResolvedTimeZone } from "../localization/formatters";
import type {
  AppLanguage,
  CanvasContent,
  Folder,
  Goal,
  Habit,
  HabitLog,
  Note,
  NoteContent,
  Project,
  StoredBlock,
  Tag,
  Task,
  TaskLink,
  TimeBlock
} from "../types";
import { buildCanvasExcerpt, extractCanvasPlainText, getCanvasRuntimeAppStateDefaults } from "../lib/canvas";
import { buildExcerpt, extractPlainText } from "../lib/notes";
import { COLOR_PALETTE, DEFAULT_NOTE_COLOR, DEFAULT_PROJECT_COLOR } from "../lib/palette";

const SORT_ORDER_STEP = 1024;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type DemoFolderKey = "start" | "notes" | "canvases" | "planner";
type DemoTagKey = "start" | "demo" | "idea" | "plan" | "local";

type DemoStrings = {
  projectName: string;
  folders: Record<DemoFolderKey, string>;
  tags: Record<DemoTagKey, string>;
  notes: {
    welcome: string;
    editor: string;
    vault: string;
    dailyReview: string;
    canvas: string;
  };
  planner: {
    readDemo: string;
    firstNote: string;
    sketchCanvas: string;
    weeklyReview: string;
    habitTitle: string;
    habitDescription: string;
    habitUnit: string;
    goalTitle: string;
    goalDescription: string;
    goalMetric: string;
    focusBlock: string;
    focusBlockDescription: string;
    habitLogNote: string;
  };
  canvas: {
    title: string;
    subtitle: string;
    notes: string;
    notesBody: string;
    canvas: string;
    canvasBody: string;
    planner: string;
    plannerBody: string;
    sync: string;
    syncBody: string;
  };
};

export type InitialDemoVaultSeed = {
  project: Project;
  folders: Folder[];
  tags: Tag[];
  notes: Note[];
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  goals: Goal[];
  timeBlocks: TimeBlock[];
  activeNoteId: string;
};

const DEMO_STRING_TEMPLATE: DemoStrings = {
    projectName: "Locoris Demo Space",
    folders: {
      start: "Start",
      notes: "Notes",
      canvases: "Canvases",
      planner: "Planner"
    },
    tags: {
      start: "start",
      demo: "demo",
      idea: "idea",
      plan: "plan",
      local: "local"
    },
    notes: {
      welcome: "Welcome to Locoris",
      editor: "Sample note: editor capabilities",
      vault: "How the vault is organized",
      dailyReview: "Daily work review",
      canvas: "Locoris capability map"
    },
    planner: {
      readDemo: "Read the demo note",
      firstNote: "Create the first working note",
      sketchCanvas: "Sketch an idea map on canvas",
      weeklyReview: "Run the first weekly review",
      habitTitle: "Daily review",
      habitDescription: "A short check-in for notes, tasks, and the next focus step.",
      habitUnit: "review",
      goalTitle: "Build a personal knowledge system",
      goalDescription: "A sample goal that connects a project, notes, planner, and progress review.",
      goalMetric: "%",
      focusBlock: "Review the demo space",
      focusBlockDescription: "Look at notes, canvas, and planner as one working loop.",
      habitLogNote: "Demo check-in from yesterday: habits show rhythm, not ordinary tasks."
    },
    canvas: {
      title: "Locoris as a system",
      subtitle: "One local base for notes, canvases, planner, sync, and backups.",
      notes: "Notes",
      notesBody: "Ideas, documents,\nstructure, and tags",
      canvas: "Canvases",
      canvasBody: "Diagrams, links,\nvisual thinking",
      planner: "Planner",
      plannerBody: "Tasks, habits,\ncalendar, and review",
      sync: "Sync and backup",
      syncBody: "Local-first data,\nportability,\ncontrol"
    }
  };

function buildDemoStrings(language: AppLanguage): DemoStrings {
  const visit = (value: unknown, pathParts: string[]): unknown => {
    if (typeof value === "string") {
      return translateInline(language, `demoSeed.strings.${pathParts.join(".")}`);
    }
    if (Array.isArray(value)) {
      return value.map((entry, index) => visit(entry, [...pathParts, String(index)]));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry, [...pathParts, key])]));
    }
    return value;
  };
  return visit(DEMO_STRING_TEMPLATE, []) as DemoStrings;
}

function createColor(seedIndex: number) {
  return COLOR_PALETTE[seedIndex % COLOR_PALETTE.length].hex;
}

function sortOrder(index: number) {
  return SORT_ORDER_STEP * index;
}

function text(value: string, styles: Record<string, unknown> = {}) {
  return {
    type: "text",
    text: value,
    styles
  };
}

function link(value: string, href: string) {
  return {
    type: "link",
    href,
    content: [text(value)]
  };
}

function block(
  type: string,
  content?: unknown,
  props: Record<string, unknown> = {},
  children: StoredBlock[] = []
): StoredBlock {
  return {
    id: crypto.randomUUID(),
    type,
    props,
    ...(typeof content === "undefined" ? {} : { content }),
    children
  };
}

function paragraph(content: unknown, props: Record<string, unknown> = {}) {
  return block("paragraph", content, { textColor: "default", ...props });
}

function heading(level: number, value: string) {
  return block("heading", [text(value)], { level });
}

function quote(value: string) {
  return block("quote", [text(value)], { textColor: "default" });
}

function bullet(value: string) {
  return block("bulletListItem", [text(value)], { textColor: "default" });
}

function numbered(value: string, start: number) {
  return block("numberedListItem", [text(value)], { textColor: "default", start });
}

function checklist(value: string, checked = false) {
  return block("checkListItem", [text(value)], { textColor: "default", checked });
}

function code(value: string, language = "markdown") {
  return block("codeBlock", [text(value)], { language });
}

function divider() {
  return block("divider");
}

function tableCell(value: string, styles: Record<string, unknown> = {}): StoredBlock {
  return {
    type: "tableCell",
    props: {
      textColor: "default",
      backgroundColor: "default",
      textAlignment: "left"
    },
    content: [text(value, styles)]
  };
}

function table(rows: string[][], headerRows = 1): StoredBlock {
  return block(
    "table",
    {
      type: "tableContent",
      columnWidths: rows[0]?.map(() => undefined) ?? [],
      headerRows,
      headerCols: 0,
      rows: rows.map((row, rowIndex) => ({
        cells: row.map((cell) =>
          tableCell(cell, rowIndex < headerRows ? { bold: true } : {})
        )
      }))
    },
    {}
  );
}

function buildWelcomeContent(language: AppLanguage, strings: DemoStrings): NoteContent {
  return [
    heading(1, translateInline(language, "demoSeed.buildWelcomeContent.locorisDemoSpace")),
    paragraph([
      text(translateInline(language, "demoSeed.buildWelcomeContent.thisCompactStarterVaultShowsLocorisAs")),
      text(translateInline(language, "demoSeed.buildWelcomeContent.localWorkingSystem"), { bold: true }),
      text(translateInline(language, "demoSeed.buildWelcomeContent.notesCanvasesPlannerTagsSyncAndBackups"))
    ]),
    quote(translateInline(language, "demoSeed.buildWelcomeContent.everythingIsLocalYouCanEditRename")),
    heading(2, translateInline(language, "demoSeed.buildWelcomeContent.startHere")),
    checklist(translateInline(language, "demoSeed.buildWelcomeContent.openTheEditorCapabilityNote"), false),
    checklist(translateInline(language, "demoSeed.buildWelcomeContent.viewTheCapabilityMapCanvas"), false),
    checklist(translateInline(language, "demoSeed.buildWelcomeContent.openThePlannerAndSeeTasksHabit"), false),
    divider(),
    heading(2, translateInline(language, "demoSeed.buildWelcomeContent.demoStructure")),
    table([
      [translateInline(language, "demoSeed.buildWelcomeContent.section"), translateInline(language, "demoSeed.buildWelcomeContent.whatItShows")],
      [strings.folders.start, translateInline(language, "demoSeed.buildWelcomeContent.theFirstRouteAndTheProductIdea")],
      [strings.folders.notes, translateInline(language, "demoSeed.buildWelcomeContent.editorFormattingTagsAndKnowledgeStructure")],
      [strings.folders.canvases, translateInline(language, "demoSeed.buildWelcomeContent.visualLinksBetweenNotesTasksAndIdeas")],
      [strings.folders.planner, translateInline(language, "demoSeed.buildWelcomeContent.tasksHabitsGoalCalendarFocusAndReview")]
    ]),
    heading(2, translateInline(language, "demoSeed.buildWelcomeContent.quickRoute")),
    numbered(translateInline(language, "demoSeed.buildWelcomeContent.createYourFirstNoteNextToThe"), 1),
    numbered(translateInline(language, "demoSeed.buildWelcomeContent.connectAnImportantIdeaToAPlanner"), 2),
    numbered(translateInline(language, "demoSeed.buildWelcomeContent.createABackupBeforeALargeImport"), 3)
  ];
}

function buildEditorDemoContent(language: AppLanguage): NoteContent {
  return [
    heading(1, translateInline(language, "demoSeed.buildEditorDemoContent.editorCapabilities")),
    paragraph([
      text(translateInline(language, "demoSeed.buildEditorDemoContent.locorisStoresNotesAsStructuredBlocks")),
      text(translateInline(language, "demoSeed.buildEditorDemoContent.text"), { bold: true }),
      text(", "),
      text(translateInline(language, "demoSeed.buildEditorDemoContent.emphasis"), { italic: true }),
      text(", "),
      text(translateInline(language, "demoSeed.buildEditorDemoContent.underline"), { underline: true }),
      text(", "),
      text(translateInline(language, "demoSeed.buildEditorDemoContent.removedOption"), { strike: true }),
      text(", "),
      text("inline code", { code: true }),
      text(translateInline(language, "demoSeed.buildEditorDemoContent.and")),
      link(translateInline(language, "demoSeed.buildEditorDemoContent.links"), "https://locoris.local/demo"),
      text(".")
    ]),
    heading(2, translateInline(language, "demoSeed.buildEditorDemoContent.blocks")),
    bullet(translateInline(language, "demoSeed.buildEditorDemoContent.bulletListsAreUsefulForIdeasAnd")),
    numbered(translateInline(language, "demoSeed.buildEditorDemoContent.numberedListsAreGoodForProcesses"), 1),
    numbered(translateInline(language, "demoSeed.buildEditorDemoContent.eachBlockCanBeMovedAndExpanded"), 2),
    checklist(translateInline(language, "demoSeed.buildEditorDemoContent.aChecklistCanBecomeAWorkingRoute"), false),
    checklist(translateInline(language, "demoSeed.buildEditorDemoContent.completedStepsStayInTheNoteContext"), true),
    quote(translateInline(language, "demoSeed.buildEditorDemoContent.aGoodNoteDoesNotHaveTo")),
    code(translateInline(language, "demoSeed.buildEditorDemoContent.planShapeTheIdeaLinkItTo"), "markdown"),
    heading(2, translateInline(language, "demoSeed.buildEditorDemoContent.table")),
    table([
      [translateInline(language, "demoSeed.buildEditorDemoContent.object"), translateInline(language, "demoSeed.buildEditorDemoContent.whenToUse"), translateInline(language, "demoSeed.buildEditorDemoContent.signal")],
      [translateInline(language, "demoSeed.buildEditorDemoContent.note"), translateInline(language, "demoSeed.buildEditorDemoContent.captureAThoughtOrDocument"), translateInline(language, "demoSeed.buildEditorDemoContent.context")],
      [translateInline(language, "demoSeed.buildEditorDemoContent.canvas"), translateInline(language, "demoSeed.buildEditorDemoContent.seeRelationships"), translateInline(language, "demoSeed.buildEditorDemoContent.structure")],
      [translateInline(language, "demoSeed.buildEditorDemoContent.task"), translateInline(language, "demoSeed.buildEditorDemoContent.trackACommitment"), translateInline(language, "demoSeed.buildEditorDemoContent.nextAction")]
    ]),
    heading(2, translateInline(language, "demoSeed.buildEditorDemoContent.typography")),
    paragraph([
      text(translateInline(language, "demoSeed.buildEditorDemoContent.auto"), { bold: true }),
      text(translateInline(language, "demoSeed.buildEditorDemoContent.isTheAdaptiveNoteStyleItFollows"))
    ]),
    paragraph([text(translateInline(language, "demoSeed.buildEditorDemoContent.onestWorksWellForCompactInterfaceLike"), { font: "onest" })]),
    paragraph([text(translateInline(language, "demoSeed.buildEditorDemoContent.ibmPlexSansStaysCrispInWorking"), { font: "ibmPlexSans" })]),
    paragraph([text(translateInline(language, "demoSeed.buildEditorDemoContent.golosTextFeelsCalmForLongReading"), { font: "golosText" })]),
    paragraph([text(translateInline(language, "demoSeed.buildEditorDemoContent.ibmPlexSerifAddsAnEditorialTone"), { font: "ibmPlexSerif" })]),
    paragraph([text(translateInline(language, "demoSeed.buildEditorDemoContent.ibmPlexMonoIsUsefulForTechnical"), { font: "ibmPlexMono" })]),
    paragraph([text(translateInline(language, "demoSeed.buildEditorDemoContent.unboundedIsBestForShortExpressiveAccents"), { font: "unbounded" })])
  ];
}

function buildVaultGuideContent(language: AppLanguage): NoteContent {
  return [
    heading(1, translateInline(language, "demoSeed.buildVaultGuideContent.howTheVaultIsOrganized")),
    paragraph(translateInline(language, "demoSeed.buildVaultGuideContent.aProjectKeepsFoldersNotesCanvasesTasks")),
    bullet(translateInline(language, "demoSeed.buildVaultGuideContent.foldersProvideCalmHierarchy")),
    bullet(translateInline(language, "demoSeed.buildVaultGuideContent.tagsCrossFolderBoundariesAndHelpCollect")),
    bullet(translateInline(language, "demoSeed.buildVaultGuideContent.favoritesAndPinnedNotesLiftActiveItems")),
    bullet(translateInline(language, "demoSeed.buildVaultGuideContent.backupCreatesAPreciseRestoreFileAnd")),
    heading(2, translateInline(language, "demoSeed.buildVaultGuideContent.practice")),
    checklist(translateInline(language, "demoSeed.buildVaultGuideContent.keepTheDemoAsASandboxFor"), false),
    checklist(translateInline(language, "demoSeed.buildVaultGuideContent.orDeleteTheProjectAfterTheTour"), false)
  ];
}

function buildDailyReviewContent(language: AppLanguage): NoteContent {
  return [
    heading(1, translateInline(language, "demoSeed.buildDailyReviewContent.dailyWorkReview")),
    paragraph(translateInline(language, "demoSeed.buildDailyReviewContent.thisNoteShowsHowACalmReview")),
    heading(2, translateInline(language, "demoSeed.buildDailyReviewContent.today")),
    checklist(translateInline(language, "demoSeed.buildDailyReviewContent.chooseOneMainFocus"), false),
    checklist(translateInline(language, "demoSeed.buildDailyReviewContent.checkOverdueTasks"), false),
    checklist(translateInline(language, "demoSeed.buildDailyReviewContent.closeTheDayWithAShortNote"), false),
    heading(2, translateInline(language, "demoSeed.buildDailyReviewContent.questions")),
    bullet(translateInline(language, "demoSeed.buildDailyReviewContent.whatMovesTheProjectForwardToday")),
    bullet(translateInline(language, "demoSeed.buildDailyReviewContent.whereDoINeedARhythmInstead")),
    bullet(translateInline(language, "demoSeed.buildDailyReviewContent.whatBelongsOnACanvasSoRelationships"))
  ];
}

async function buildDemoCanvasContent(strings: DemoStrings): Promise<CanvasContent> {
  const cardStyle = {
    fillStyle: "solid",
    roughness: 0,
    opacity: 96,
    roundness: { type: 3 },
    strokeWidth: 2
  };
  const skeletonElements = [
    {
      type: "text",
      x: -480,
      y: -190,
      width: 640,
      height: 44,
      text: strings.canvas.title,
      fontSize: 36,
      strokeColor: "#f8fafc"
    },
    {
      type: "text",
      x: -478,
      y: -136,
      width: 760,
      height: 30,
      text: strings.canvas.subtitle,
      fontSize: 18,
      strokeColor: "#b8c7dd"
    },
    {
      ...cardStyle,
      type: "rectangle",
      id: "demo-notes",
      x: -500,
      y: -40,
      width: 220,
      height: 132,
      strokeColor: "#73f7ff",
      backgroundColor: "#102b34",
      label: {
        text: `${strings.canvas.notes}\n${strings.canvas.notesBody}`,
        fontSize: 18,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#f8fafc"
      }
    },
    {
      ...cardStyle,
      type: "rectangle",
      id: "demo-canvas",
      x: -130,
      y: -40,
      width: 220,
      height: 132,
      strokeColor: "#d189ff",
      backgroundColor: "#261c35",
      label: {
        text: `${strings.canvas.canvas}\n${strings.canvas.canvasBody}`,
        fontSize: 18,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#f8fafc"
      }
    },
    {
      ...cardStyle,
      type: "rectangle",
      id: "demo-planner",
      x: 240,
      y: -40,
      width: 220,
      height: 132,
      strokeColor: "#ffe08a",
      backgroundColor: "#332813",
      label: {
        text: `${strings.canvas.planner}\n${strings.canvas.plannerBody}`,
        fontSize: 18,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#f8fafc"
      }
    },
    {
      ...cardStyle,
      type: "rectangle",
      id: "demo-sync",
      x: -130,
      y: 180,
      width: 270,
      height: 142,
      strokeColor: "#66f0a4",
      backgroundColor: "#143126",
      label: {
        text: `${strings.canvas.sync}\n${strings.canvas.syncBody}`,
        fontSize: 18,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#f8fafc"
      }
    },
    {
      type: "arrow",
      x: -270,
      y: 26,
      points: [
        [0, 0],
        [130, 0]
      ],
      strokeColor: "#8edcff",
      strokeWidth: 2,
      roughness: 0,
      endArrowhead: "arrow"
    },
    {
      type: "arrow",
      x: 100,
      y: 26,
      points: [
        [0, 0],
        [130, 0]
      ],
      strokeColor: "#d9b8ff",
      strokeWidth: 2,
      roughness: 0,
      endArrowhead: "arrow"
    },
    {
      type: "arrow",
      x: 350,
      y: 104,
      points: [
        [0, 0],
        [-116, 130],
        [-205, 130]
      ],
      strokeColor: "#ffe08a",
      strokeWidth: 2,
      roughness: 0,
      endArrowhead: "arrow"
    },
    {
      type: "arrow",
      x: -140,
      y: 250,
      points: [
        [0, 0],
        [-248, 0],
        [-248, -146]
      ],
      strokeColor: "#66f0a4",
      strokeWidth: 2,
      roughness: 0,
      endArrowhead: "arrow"
    }
  ];

  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");

  return {
    elements: convertToExcalidrawElements(skeletonElements as any, {
      regenerateIds: true
    }) as unknown as CanvasContent["elements"],
    appState: {
      ...getCanvasRuntimeAppStateDefaults("#05070d"),
      scrollX: 578,
      scrollY: 260,
      zoom: {
        value: 0.88
      }
    }
  };
}

function createNote(input: {
  title: string;
  projectId: string;
  folderId: string;
  sortOrder: number;
  tagIds: string[];
  content: NoteContent;
  timestamp: number;
  pinned?: boolean;
  favorite?: boolean;
}): Note {
  return {
    id: crypto.randomUUID(),
    title: input.title,
    contentType: "note",
    projectId: input.projectId,
    folderId: input.folderId,
    color: DEFAULT_NOTE_COLOR,
    sortOrder: input.sortOrder,
    tagIds: input.tagIds,
    content: input.content,
    canvasContent: null,
    excerpt: buildExcerpt(input.content),
    plainText: extractPlainText(input.content),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    pinned: Boolean(input.pinned),
    favorite: Boolean(input.favorite),
    archived: false,
    trashedAt: null,
    syncState: "local",
    conflictOriginId: null
  };
}

function createCanvasNote(input: {
  title: string;
  projectId: string;
  folderId: string;
  sortOrder: number;
  tagIds: string[];
  canvasContent: CanvasContent;
  timestamp: number;
  favorite?: boolean;
}): Note {
  return {
    id: crypto.randomUUID(),
    title: input.title,
    contentType: "canvas",
    projectId: input.projectId,
    folderId: input.folderId,
    color: DEFAULT_NOTE_COLOR,
    sortOrder: input.sortOrder,
    tagIds: input.tagIds,
    content: [],
    canvasContent: input.canvasContent,
    excerpt: buildCanvasExcerpt(input.canvasContent),
    plainText: extractCanvasPlainText(input.canvasContent),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    pinned: false,
    favorite: Boolean(input.favorite),
    archived: false,
    trashedAt: null,
    syncState: "local",
    conflictOriginId: null
  };
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function atLocalTime(baseTimestamp: number, dayOffset: number, hours: number, minutes = 0) {
  const date = new Date(startOfDay(baseTimestamp) + dayOffset * DAY);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function nextHalfHour(timestamp: number) {
  const date = new Date(timestamp);
  const minutes = date.getMinutes();
  const nextMinutes = minutes <= 30 ? 30 : 60;
  date.setMinutes(nextMinutes, 0, 0);
  return date.getTime();
}

function createTaskLink(input: {
  kind: TaskLink["kind"];
  label: string;
  projectId: string | null;
  folderId: string | null;
  noteId?: string | null;
  canvasId?: string | null;
  createdAt: number;
}): TaskLink {
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    label: input.label,
    projectId: input.projectId,
    folderId: input.folderId,
    noteId: input.noteId ?? null,
    canvasId: input.canvasId ?? null,
    sourceBlockId: null,
    canvasElementId: null,
    url: null,
    createdAt: input.createdAt
  };
}

function createTask(input: {
  title: string;
  description?: string;
  kind?: Task["kind"];
  status?: Task["status"];
  priority?: Task["priority"];
  projectId: string | null;
  folderId: string | null;
  noteId?: string | null;
  canvasId?: string | null;
  tagIds: string[];
  links?: TaskLink[];
  dueAt?: number | null;
  scheduledStartAt?: number | null;
  scheduledEndAt?: number | null;
  estimateMinutes?: number | null;
  sortOrder: number;
  timestamp: number;
}): Task {
  return {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description ?? "",
    kind: input.kind ?? "task",
    status: input.status ?? "todo",
    priority: input.priority ?? "none",
    projectId: input.projectId,
    folderId: input.folderId,
    noteId: input.noteId ?? null,
    canvasId: input.canvasId ?? null,
    sourceBlockId: null,
    canvasElementId: null,
    tagIds: input.tagIds,
    links: input.links ?? [],
    reminders: [],
    startAt: null,
    dueAt: input.dueAt ?? null,
    scheduledStartAt: input.scheduledStartAt ?? null,
    scheduledEndAt: input.scheduledEndAt ?? null,
    completedAt: null,
    canceledAt: null,
    recurrenceRule: null,
    recurrenceTimezone: null,
    recurrenceAnchorAt: null,
    recurrenceUntilAt: null,
    recurrenceExceptionDates: [],
    recurrenceCompletedDates: [],
    recurrenceOverrides: [],
    estimateMinutes: input.estimateMinutes ?? null,
    spentMinutes: 0,
    sortOrder: input.sortOrder,
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  };
}

export async function buildInitialDemoVault(
  language: AppLanguage,
  timestamp = Date.now()
): Promise<InitialDemoVaultSeed> {
  const strings = buildDemoStrings(language);
  const project: Project = {
    id: crypto.randomUUID(),
    name: strings.projectName,
    color: DEFAULT_PROJECT_COLOR,
    x: 0,
    y: 0,
    sortOrder: sortOrder(1),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const folderEntries: Array<[DemoFolderKey, string]> = [
    ["start", strings.folders.start],
    ["notes", strings.folders.notes],
    ["canvases", strings.folders.canvases],
    ["planner", strings.folders.planner]
  ];
  const foldersByKey = new Map<DemoFolderKey, Folder>();
  const folders = folderEntries.map(([key, name], index) => {
    const folder: Folder = {
      id: crypto.randomUUID(),
      projectId: project.id,
      name,
      parentId: null,
      color: createColor(index),
      sortOrder: sortOrder(index + 1),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    foldersByKey.set(key, folder);
    return folder;
  });

  const tagEntries: Array<[DemoTagKey, string]> = [
    ["start", strings.tags.start],
    ["demo", strings.tags.demo],
    ["idea", strings.tags.idea],
    ["plan", strings.tags.plan],
    ["local", strings.tags.local]
  ];
  const tagsByKey = new Map<DemoTagKey, Tag>();
  const tags = tagEntries.map(([key, name], index) => {
    const tag: Tag = {
      id: crypto.randomUUID(),
      name,
      color: createColor(index + 2),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    tagsByKey.set(key, tag);
    return tag;
  });

  const startFolder = foldersByKey.get("start")!;
  const notesFolder = foldersByKey.get("notes")!;
  const canvasesFolder = foldersByKey.get("canvases")!;
  const plannerFolder = foldersByKey.get("planner")!;
  const startTag = tagsByKey.get("start")!;
  const demoTag = tagsByKey.get("demo")!;
  const ideaTag = tagsByKey.get("idea")!;
  const planTag = tagsByKey.get("plan")!;
  const localTag = tagsByKey.get("local")!;

  const welcomeNote = createNote({
    title: strings.notes.welcome,
    projectId: project.id,
    folderId: startFolder.id,
    sortOrder: sortOrder(1),
    tagIds: [startTag.id, demoTag.id, localTag.id],
    content: buildWelcomeContent(language, strings),
    timestamp,
    pinned: true
  });
  const editorNote = createNote({
    title: strings.notes.editor,
    projectId: project.id,
    folderId: notesFolder.id,
    sortOrder: sortOrder(2),
    tagIds: [demoTag.id, ideaTag.id],
    content: buildEditorDemoContent(language),
    timestamp,
    favorite: true
  });
  const vaultNote = createNote({
    title: strings.notes.vault,
    projectId: project.id,
    folderId: notesFolder.id,
    sortOrder: sortOrder(3),
    tagIds: [demoTag.id, localTag.id],
    content: buildVaultGuideContent(language),
    timestamp
  });
  const dailyReviewNote = createNote({
    title: strings.notes.dailyReview,
    projectId: project.id,
    folderId: plannerFolder.id,
    sortOrder: sortOrder(4),
    tagIds: [demoTag.id, planTag.id],
    content: buildDailyReviewContent(language),
    timestamp
  });
  const canvasContent = await buildDemoCanvasContent(strings);
  const canvasNote = createCanvasNote({
    title: strings.notes.canvas,
    projectId: project.id,
    folderId: canvasesFolder.id,
    sortOrder: sortOrder(5),
    tagIds: [demoTag.id, ideaTag.id],
    canvasContent,
    timestamp,
    favorite: true
  });

  const focusStartAt = nextHalfHour(timestamp + HOUR);
  const readDemoTask = createTask({
    title: strings.planner.readDemo,
    projectId: project.id,
    folderId: startFolder.id,
    noteId: welcomeNote.id,
    tagIds: [startTag.id, demoTag.id],
    links: [
      createTaskLink({
        kind: "note",
        label: welcomeNote.title,
        projectId: project.id,
        folderId: startFolder.id,
        noteId: welcomeNote.id,
        createdAt: timestamp
      })
    ],
    dueAt: atLocalTime(timestamp, 0, 18),
    estimateMinutes: 15,
    sortOrder: sortOrder(1),
    timestamp
  });
  const firstNoteTask = createTask({
    title: strings.planner.firstNote,
    status: "inbox",
    priority: "medium",
    projectId: project.id,
    folderId: notesFolder.id,
    noteId: editorNote.id,
    tagIds: [demoTag.id, ideaTag.id],
    links: [
      createTaskLink({
        kind: "note",
        label: editorNote.title,
        projectId: project.id,
        folderId: notesFolder.id,
        noteId: editorNote.id,
        createdAt: timestamp
      })
    ],
    dueAt: atLocalTime(timestamp, 1, 12),
    estimateMinutes: 25,
    sortOrder: sortOrder(2),
    timestamp
  });
  const sketchCanvasTask = createTask({
    title: strings.planner.sketchCanvas,
    status: "scheduled",
    priority: "low",
    projectId: project.id,
    folderId: canvasesFolder.id,
    canvasId: canvasNote.id,
    tagIds: [demoTag.id, ideaTag.id],
    links: [
      createTaskLink({
        kind: "canvas",
        label: canvasNote.title,
        projectId: project.id,
        folderId: canvasesFolder.id,
        canvasId: canvasNote.id,
        createdAt: timestamp
      })
    ],
    dueAt: atLocalTime(timestamp, 1, 17),
    scheduledStartAt: atLocalTime(timestamp, 1, 10),
    scheduledEndAt: atLocalTime(timestamp, 1, 10, 45),
    estimateMinutes: 45,
    sortOrder: sortOrder(3),
    timestamp
  });
  const weeklyReviewTask = createTask({
    title: strings.planner.weeklyReview,
    kind: "milestone",
    priority: "medium",
    projectId: project.id,
    folderId: plannerFolder.id,
    noteId: dailyReviewNote.id,
    tagIds: [demoTag.id, planTag.id],
    dueAt: atLocalTime(timestamp, 6, 17),
    estimateMinutes: 30,
    sortOrder: sortOrder(4),
    timestamp
  });

  const habit: Habit = {
    id: crypto.randomUUID(),
    title: strings.planner.habitTitle,
    description: strings.planner.habitDescription,
    status: "active",
    projectId: project.id,
    noteId: dailyReviewNote.id,
    color: createColor(3),
    icon: "spark",
    frequencyRule: "FREQ=DAILY;INTERVAL=1",
    frequencyTimezone: getResolvedTimeZone(),
    targetCount: 1,
    targetUnit: strings.planner.habitUnit,
    targetPeriod: "day",
    reminders: [],
    sortOrder: sortOrder(1),
    createdAt: timestamp,
    updatedAt: timestamp,
    pausedAt: null,
    archivedAt: null,
    pauseRanges: []
  };
  const habitLogs: HabitLog[] = [
    {
      id: crypto.randomUUID(),
      habitId: habit.id,
      occurredAt: atLocalTime(timestamp, -1, 18, 30),
      value: 1,
      unit: strings.planner.habitUnit,
      note: strings.planner.habitLogNote,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
  const goals: Goal[] = [
    {
      id: crypto.randomUUID(),
      title: strings.planner.goalTitle,
      description: strings.planner.goalDescription,
      status: "active",
      projectId: project.id,
      parentGoalId: null,
      color: createColor(5),
      metricLabel: strings.planner.goalMetric,
      targetValue: 100,
      currentValue: 15,
      startAt: startOfDay(timestamp),
      dueAt: atLocalTime(timestamp, 30, 18),
      completedAt: null,
      sortOrder: sortOrder(1),
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
  const timeBlocks: TimeBlock[] = [
    {
      id: crypto.randomUUID(),
      title: strings.planner.focusBlock,
      description: strings.planner.focusBlockDescription,
      status: "planned",
      taskId: readDemoTask.id,
      projectId: project.id,
      noteId: welcomeNote.id,
      canvasId: null,
      startAt: focusStartAt,
      endAt: focusStartAt + 45 * 60 * 1000,
      actualStartAt: null,
      actualEndAt: null,
      color: createColor(2),
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
  readDemoTask.status = "scheduled";
  readDemoTask.scheduledStartAt = timeBlocks[0].startAt;
  readDemoTask.scheduledEndAt = timeBlocks[0].endAt;

  return {
    project,
    folders,
    tags,
    notes: [welcomeNote, editorNote, vaultNote, dailyReviewNote, canvasNote],
    tasks: [readDemoTask, firstNoteTask, sketchCanvasTask, weeklyReviewTask],
    habits: [habit],
    habitLogs,
    goals,
    timeBlocks,
    activeNoteId: welcomeNote.id
  };
}
