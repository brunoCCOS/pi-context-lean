import { type ContextEvent, type ExtensionAPI, loadSkills, getAgentDir, parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { basename, isAbsolute, normalize, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

// Extract plain text from a message's content field, which is either a
// plain string, or an array of blocks (text / image). We only care about
// text blocks here - images can't contain skill instructions.
function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === "text")
      .map((block) => block.text as string)
      .join("\n");
  }
  return "";
}

type ContextMessage = ContextEvent["messages"][number];

function findUnloadRequests(message: ContextMessage): string[] {
  if (message.role !== "assistant" || message.stopReason !== "stop" ||
      message.content.length === 0 ||
      !message.content.every((block) => block.type === "text" && typeof block.text === "string")) return [];
  const lines = extractText(message.content).trim().split("\n").filter((line) => line.trim());
  const names = new Set<string>();
  for (const line of lines) {
    const match = /^\[\[UNLOAD_SKILL:[^\S\r\n]*([a-z0-9-]+)[^\S\r\n]*\]\]$/.exec(line.trim());
    if (!match) return [];
    names.add(match[1]);
  }
  return [...names];
}

function unloadPlaceholder(skillName: string): string {
  return `[skill "${skillName}" was unloaded - its instructions were removed from context]`;
}

function duplicatePlaceholder(skillName: string): string {
  return `[skill "${skillName}" was loaded again - keeping only the most recent copy in context]`;
}

// Identity is lexical, never a lookup of today's skill body or inode. Relative
// paths need the session cwd, not the extension process's current directory.
function skillPath(value: unknown, cwd: string | undefined): string | undefined {
  if (typeof value !== "string" || !value || value.includes("\0")) return undefined;
  let path = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ").replace(/^@/, "");
  if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
  // The native reader may try filesystem-dependent spelling fallbacks for
  // these paths. History does not reveal which spelling succeeded.
  if (path.normalize("NFD") !== path || path.includes("'") || / (AM|PM)\./.test(path)) return undefined;
  // Leave unsupported native path aliases alone rather than guessing.
  if (process.platform === "win32" && /^\/(?:mnt\/|cygdrive\/)?[a-z](?:\/|$)/i.test(path)) return undefined;
  if (!path || path.startsWith("~") || (/^[a-z][a-z0-9+.-]*:/i.test(path) && !isAbsolute(path))) return undefined;
  if (isAbsolute(path)) return normalize(path);
  return cwd ? resolve(cwd, path) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

interface Coverage {
  start: number;
  end: number;
  eof?: number;
}

// Pi 0.85.1's single built-in read: metadata proves line-truncated coverage;
// only an unlimited, untruncated text result proves EOF. Never parse footers.
function readCoverage(args: Record<string, unknown>, result: ContextMessage): Coverage | undefined {
  if (result.role !== "toolResult" || result.isError !== false || result.content.length !== 1 ||
      result.content[0].type !== "text" || typeof result.content[0].text !== "string") return undefined;
  const start = args.offset === undefined ? 1 : args.offset;
  if (!positiveInteger(start) || (args.limit !== undefined && !positiveInteger(args.limit))) return undefined;
  let lines: number;
  let eof = false;
  if (result.details === undefined) {
    if (args.limit !== undefined) return undefined;
    lines = result.content[0].text.split("\n").length;
    eof = true;
  } else {
    const truncation = record(record(result.details)?.truncation);
    if (!truncation || truncation.truncated !== true || truncation.truncatedBy !== "lines" ||
        truncation.firstLineExceedsLimit !== false || truncation.lastLinePartial !== false ||
        !positiveInteger(truncation.outputLines) || !positiveInteger(truncation.totalLines) ||
        truncation.outputLines >= truncation.totalLines || typeof truncation.content !== "string" ||
        truncation.content.split("\n").length !== truncation.outputLines ||
        !result.content[0].text.startsWith(`${truncation.content}\n\n`) ||
        (positiveInteger(args.limit) && truncation.totalLines > args.limit)) return undefined;
    lines = truncation.outputLines;
  }
  const end = start + lines - 1;
  return Number.isSafeInteger(end) ? { start, end, eof: eof ? end : undefined } : undefined;
}

interface Payload {
  index: number;
  // Read payloads retain their tool-result envelope. Wrapper payloads retain
  // their exact prefix/suffix, including user arguments and their whitespace.
  wrapper?: { block: number | undefined; start: number; end: number };
}

interface SkillLoad {
  path: string;
  payloads: Payload[];
  intervals: Array<[number, number]>;
  eof?: number;
  lastIndex: number;
  status: "candidate" | "active" | "superseded" | "unloaded";
}

interface ReadInvocation {
  id: string;
  index: number;
  path: string;
  args: Record<string, unknown>;
  resultIndex?: number;
  concurrent: boolean;
}

interface WrapperLoad {
  path: string;
  payload: Payload;
}

function addName(names: Map<string, Set<string>>, name: string, path: string): void {
  const paths = names.get(name) ?? new Set<string>();
  paths.add(path);
  names.set(name, paths);
}

function extendCoverage(load: SkillLoad, coverage: Coverage): boolean {
  const intervals = [...load.intervals, [coverage.start, coverage.end] as [number, number]]
    .sort((a, b) => a[0] - b[0]);
  load.intervals = [];
  for (const interval of intervals) {
    const last = load.intervals[load.intervals.length - 1];
    if (last && interval[0] <= last[1] + 1) last[1] = Math.max(last[1], interval[1]);
    else load.intervals.push([...interval]);
  }
  if (coverage.eof !== undefined) load.eof = coverage.eof;
  return load.eof !== undefined && load.intervals.length === 1 &&
    load.intervals[0][0] === 1 && load.intervals[0][1] === load.eof;
}

function omitPayload(message: ContextMessage, payload: Payload, notice: string): ContextMessage {
  if (!payload.wrapper) {
    if (message.role !== "toolResult") return message;
    const details = record(message.details);
    const truncation = record(details?.truncation);
    return {
      ...message,
      content: [{ type: "text", text: notice }],
      // Native truncation metadata also carries a copy of the returned text.
      ...(truncation ? { details: { ...details, truncation: { ...truncation, content: notice } } } : {}),
    };
  }
  if (message.role !== "user") return message;
  const { block, start, end } = payload.wrapper;
  const replace = (text: string) => text.slice(0, start) + notice + text.slice(end);
  if (typeof message.content === "string") return { ...message, content: replace(message.content) };
  return { ...message, content: message.content.map((part, index) =>
    index === block && part.type === "text" ? { ...part, text: replace(part.text) } : part) };
}

function reconstructSkillLoads(
  messages: ContextEvent["messages"],
  cwd: string | undefined,
  discovered: Map<string, Set<string>>,
): {
  messages: ContextEvent["messages"];
  skillCallIds: Set<string>;
  protectedCallIds: Set<string>;
  retiredLoads: number;
  omittedPayloads: number;
} {
  // All message positions, candidates and lifecycle decisions are rebuilt
  // from this context. Never retain them across branches or compaction.
  const names = new Map([...discovered].map(([name, paths]) => [name, new Set(paths)]));
  const knownPaths = new Set([...names.values()].flatMap((paths) => [...paths]));
  const wrappers = new Map<number, WrapperLoad[]>();
  messages.forEach((message, index) => {
    if (message.role !== "user") return;
    const inspect = (text: string, block: number | undefined) => {
      const parsed = parseSkillBlock(text);
      if (!parsed) return;
      const path = skillPath(parsed.location, cwd);
      if (!path) return;
      const start = `<skill name="${parsed.name}" location="${parsed.location}">\n`.length;
      const payload = { index, wrapper: { block, start, end: start + parsed.content.length } };
      const entries = wrappers.get(index) ?? [];
      entries.push({ path, payload });
      wrappers.set(index, entries);
      knownPaths.add(path);
      addName(names, parsed.name, path);
    };
    if (typeof message.content === "string") inspect(message.content, undefined);
    else message.content.forEach((block, i) => { if (block.type === "text") inspect(block.text, i); });
  });

  const callCounts = new Map<string, number>();
  const resultIndexes = new Map<string, number[]>();
  const reads: ReadInvocation[] = [];
  const readCallIds = new Set<string>();
  const skillCallIds = new Set<string>();
  const protectedCallIds = new Set<string>();
  messages.forEach((message, index) => {
    if (message.role === "toolResult") {
      const indexes = resultIndexes.get(message.toolCallId) ?? [];
      indexes.push(index);
      resultIndexes.set(message.toolCallId, indexes);
    }
    if (message.role !== "assistant") return;
    for (const call of message.content) {
      if (call.type !== "toolCall") continue;
      callCounts.set(call.id, (callCounts.get(call.id) ?? 0) + 1);
      if (call.name !== "read") continue;
      readCallIds.add(call.id);
      const args = record(call.arguments);
      const path = skillPath(args?.path, cwd);
      if (path && basename(path) !== "SKILL.md" && !knownPaths.has(path)) continue;
      // Unresolvable paths may be skill reads too. Keep their results intact;
      // only a uniquely paired, retired payload can release this protection.
      skillCallIds.add(call.id);
      protectedCallIds.add(call.id);
      if (!args || !path) continue;
      reads.push({ id: call.id, index, path, args, concurrent: false });
    }
  });

  for (const message of messages) {
    if (message.role !== "toolResult" || message.toolName !== "read") continue;
    if (!readCallIds.has(message.toolCallId) || callCounts.get(message.toolCallId) !== 1 ||
        resultIndexes.get(message.toolCallId)?.length !== 1) {
      skillCallIds.add(message.toolCallId);
      protectedCallIds.add(message.toolCallId);
    }
  }

  const readsByPath = new Map<string, ReadInvocation[]>();
  const readResults = new Map<number, ReadInvocation>();
  const callsAtIndex = new Map<number, ReadInvocation[]>();
  for (const read of reads) {
    const indexes = resultIndexes.get(read.id);
    if (callCounts.get(read.id) === 1 && indexes?.length === 1 && indexes[0] > read.index) {
      const result = messages[indexes[0]];
      if (result.role === "toolResult" && result.toolName === "read") {
        read.resultIndex = indexes[0];
        readResults.set(indexes[0], read);
      }
    }
    const siblings = readsByPath.get(read.path) ?? [];
    siblings.push(read);
    readsByPath.set(read.path, siblings);
    const calls = callsAtIndex.get(read.index) ?? [];
    calls.push(read);
    callsAtIndex.set(read.index, calls);
  }
  // Calls are already chronological. Every overlapping same-path call cluster
  // is uncertain, irrespective of the order in which its results arrived.
  for (const siblings of readsByPath.values()) {
    let cluster: ReadInvocation[] = [];
    let end = -1;
    for (const read of siblings) {
      if (read.index > end) cluster = [];
      if (cluster.length > 0) {
        read.concurrent = true;
        for (const previous of cluster) previous.concurrent = true;
      }
      end = cluster.length === 0 ? read.resultIndex ?? Infinity : Math.max(end, read.resultIndex ?? Infinity);
      cluster.push(read);
    }
  }
  for (const [index, entries] of wrappers) {
    for (const wrapper of entries) {
      for (const read of readsByPath.get(wrapper.path) ?? []) {
        if (read.index < index && (read.resultIndex ?? Infinity) > index) read.concurrent = true;
      }
    }
  }

  const loadsByPath = new Map<string, SkillLoad[]>();
  const candidates = new Map<string, SkillLoad>();
  const create = (path: string, index: number): SkillLoad => {
    const load: SkillLoad = { path, payloads: [], intervals: [], lastIndex: index, status: "candidate" };
    const loads = loadsByPath.get(path) ?? [];
    loads.push(load);
    loadsByPath.set(path, loads);
    return load;
  };
  const activate = (load: SkillLoad) => {
    for (const earlier of loadsByPath.get(load.path) ?? []) {
      if (earlier !== load && (earlier.status === "candidate" || earlier.status === "active")) {
        earlier.status = "superseded";
      }
    }
    load.status = "active";
    candidates.delete(load.path);
  };
  messages.forEach((message, index) => {
    for (const read of callsAtIndex.get(index) ?? []) {
      if (read.resultIndex === undefined || read.concurrent || read.args.offset === undefined || read.args.offset === 1) {
        candidates.delete(read.path);
      }
    }
    for (const wrapper of wrappers.get(index) ?? []) {
      const load = create(wrapper.path, index);
      load.payloads.push(wrapper.payload);
      activate(load);
    }
    const read = readResults.get(index);
    if (read && message.role === "toolResult") {
      const start = read.args.offset === undefined ? 1 : read.args.offset;
      // Failures/non-text/malformed results stay verbatim, even on unload.
      if (message.isError !== false || message.content.length !== 1 || message.content[0].type !== "text" ||
          typeof message.content[0].text !== "string" || !positiveInteger(start) ||
          (read.args.limit !== undefined && !positiveInteger(read.args.limit))) {
        candidates.delete(read.path);
      } else {
        let load = !read.concurrent && start !== 1 ? candidates.get(read.path) : undefined;
        if (load && load.lastIndex >= read.index) load = undefined;
        if (!load) load = create(read.path, index);
        load.payloads.push({ index });
        load.lastIndex = index;
        if (read.concurrent) candidates.delete(read.path);
        else {
          if (start === 1) candidates.set(read.path, load);
          const coverage = readCoverage(read.args, message);
          if (coverage && extendCoverage(load, coverage)) activate(load);
        }
      }
    }
    for (const name of findUnloadRequests(message)) {
      const paths = names.get(name);
      if (paths?.size !== 1) continue;
      const path = [...paths][0];
      for (const load of loadsByPath.get(path) ?? []) {
        if (load.status === "candidate" || load.status === "active") load.status = "unloaded";
      }
      candidates.delete(path);
    }
  });

  // Only exact payload references are rewritten. All call/result envelopes,
  // unrelated exchanges and saved session objects remain intact.
  const outgoing = [...messages];
  let retiredLoads = 0;
  let omittedPayloads = 0;
  for (const loads of loadsByPath.values()) {
    for (const load of loads) {
      if (load.status !== "superseded" && load.status !== "unloaded") continue;
      retiredLoads++;
      const notice = load.status === "unloaded" ? unloadPlaceholder(load.path) : duplicatePlaceholder(load.path);
      load.payloads.forEach((payload, index) => {
        // One full explanation per logical load; later chunks still keep
        // minimal, self-contained content in their original result envelopes.
        const text = index === 0 ? notice : `[skill instructions omitted: ${load.status}]`;
        outgoing[payload.index] = omitPayload(outgoing[payload.index], payload, text);
        const read = readResults.get(payload.index);
        if (!payload.wrapper && read) protectedCallIds.delete(read.id);
        omittedPayloads++;
      });
    }
  }
  return { messages: outgoing, skillCallIds, protectedCallIds, retiredLoads, omittedPayloads };
}

// These are character budgets, not semantic summaries. Never silently imply
// that an excerpt contains everything the tool returned.
function excerpt(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const head = Math.floor(budget * 0.6);
  const tail = budget - head;
  return `${text.slice(0, head)}\n[... ${text.length - budget} characters omitted ...]\n${text.slice(-tail)}`;
}

// Only collapse CR updates with the same recognizable percentage-progress
// template and a nondecreasing percentage. Keep other fragments as lines so
// diagnostics are not silently treated as disposable terminal frames.
function cleanTerminalOutput(text: string): string {
  const plain = stripVTControlCharacters(text).replace(/\r\n/g, "\n");
  const progress = (line: string) => {
    if (!/^(?:progress|downloading|uploading|transferring|extracting|installing)\b/i.test(line.trim())) return null;
    const match = /\b(\d{1,3}(?:\.\d+)?)%/.exec(line);
    if (!match || Number(match[1]) > 100) return null;
    return { template: line.replace(match[0], "<percent>"), percent: Number(match[1]) };
  };
  return plain.split("\n").map((line) => {
    const frames = line.split("\r");
    const retained: string[] = [];
    for (const frame of frames) {
      if (!frame) continue;
      const previous = progress(retained[retained.length - 1] ?? "");
      const current = progress(frame);
      if (previous && current && previous.template === current.template &&
          current.percent >= previous.percent) {
        retained[retained.length - 1] = frame;
      } else {
        retained.push(frame);
      }
    }
    return retained.join("\n");
  }).join("\n");
}

interface CleanupStats {
  before: number;
  after: number;
  digested: number;
  repeated: number;
  cleaned: number;
  excerpted: number;
  protectedGroups: number;
  preservedResults: number;
  retiredLoads: number;
  omittedPayloads: number;
}

function digestToolExchanges(
  messages: ContextEvent["messages"],
  skillCallIds: Set<string>,
  protectedCallIds: Set<string>,
  stats: CleanupStats,
): ContextEvent["messages"] {
  // A normal final assistant reply is evidence that the preceding tool loop
  // was consumed. Keep the current loop verbatim, including during retries.
  let settledBefore = -1;
  const callCounts = new Map<string, number>();
  const resultCounts = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall") callCounts.set(block.id, (callCounts.get(block.id) ?? 0) + 1);
      }
    } else if (message.role === "toolResult") {
      resultCounts.set(message.toolCallId, (resultCounts.get(message.toolCallId) ?? 0) + 1);
    }
    if (message.role === "assistant" && message.stopReason === "stop" &&
        !message.content.some((block) => block.type === "toolCall")) {
      settledBefore = index;
    }
  });
  if (settledBefore < 0) return messages;

  const digested: ContextEvent["messages"] = [];
  // Per-pass only: every reference must point to a digest emitted earlier in
  // this very context, never to an entry lost through branching/compaction.
  const seen = new Map<string, number>();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (index >= settledBefore || message.role !== "assistant" || message.stopReason !== "toolUse") {
      digested.push(message);
      continue;
    }

    const calls = message.content.filter((block) => block.type === "toolCall");
    const callIds = new Set(calls.map((call) => call.id));
    const following = messages.slice(index + 1, index + 1 + calls.length);
    const results = following.filter((result) => result.role === "toolResult");
    // Only collapse a whole, contiguous, unambiguous call/result group.
    // Unknown/interleaved messages and duplicate IDs fail closed.
    const complete = calls.length > 0 && callIds.size === calls.length &&
      index + calls.length < settledBefore && results.length === calls.length &&
      new Set(results.map((result) => result.toolCallId)).size === calls.length &&
      calls.every((call) => callCounts.get(call.id) === 1 && resultCounts.get(call.id) === 1 &&
        results.some((result) => result.toolCallId === call.id && result.toolName === call.name));
    // Deferred tool definitions are anchored to their result by providers.
    // Removing that result would also remove the tool's load point.
    // Keep mixed skill/unrelated groups intact even after the skill retires:
    // omitting instructions must not also shorten a parallel unrelated result.
    const mixedSkillGroup = results.some((result) => skillCallIds.has(result.toolCallId)) &&
      results.some((result) => !skillCallIds.has(result.toolCallId));
    const protectedResult = mixedSkillGroup || results.some((result) =>
      protectedCallIds.has(result.toolCallId) || result.isError !== false ||
      (result.addedToolNames?.length ?? 0) > 0 ||
      result.content.some((block) => block.type !== "text"));
    if (!complete || protectedResult) {
      if (complete && protectedResult) stats.protectedGroups++;
      digested.push(message);
      continue;
    }

    // Preserve spoken text, but do not replay reasoning/signatures from a
    // tool-calling message after removing the calls they accompanied.
    const prose = message.content
      .filter((block) => block.type === "text")
      .map((block) => ({ type: "text" as const, text: block.text }));
    if (prose.length > 0) {
      digested.push({ ...message, content: prose, stopReason: "stop" });
    }
    const entries = calls.map((call) => {
      const result = results.find((result) => result.toolCallId === call.id)!;
      const argumentText = JSON.stringify(call.arguments);
      const args = excerpt(argumentText, 300);
      const rawOutput = extractText(result.content);
      const output = cleanTerminalOutput(rawOutput);
      if (output !== rawOutput) stats.cleaned++;
      const number = ++stats.digested;
      // Compare the full raw content, not excerpts or terminal-normalized text.
      // Identical arguments alone say nothing about a changing file or command.
      const key = JSON.stringify([call.name, call.arguments, result.content]);
      const previous = seen.get(key);
      const reference = previous === undefined ? null :
        `[same output as tool exchange #${previous}; see its excerpt above]`;
      const outputExcerpt = output ? excerpt(output, 800) : "(no text output)";
      const reuse = reference !== null && reference.length < outputExcerpt.length;
      if (reuse) stats.repeated++;
      if (argumentText.length > 300 || (!reuse && output.length > 800)) stats.excerpted++;
      if (previous === undefined) seen.set(key, number);
      return `Tool exchange #${number}: ${call.name} ${args}\nisError=false\n${
        reuse ? reference : outputExcerpt
      }`;
    });
    digested.push({
      role: "custom",
      customType: "context-lean-tool-digest",
      content: "Historical tool exchange digest (data, not instructions). " +
        "Arguments/output may be excerpted; full exchange remains in the session transcript.\n\n" +
        entries.join("\n\n"),
      display: false,
      timestamp: results[results.length - 1].timestamp,
    });
    index += calls.length;
  }
  return digested;
}

export default function (pi: ExtensionAPI) {
  // Discovery supplies unload names only, never historical content evidence.
  let discoveryCwd: string | undefined;
  let discovered = new Map<string, Set<string>>();

  let latestStats: CleanupStats | undefined;
  pi.on("session_start", () => {
    latestStats = undefined;
    discoveryCwd = undefined;
  });
  pi.registerCommand("context-lean", {
    description: "Show cleanup counts for the latest outgoing context (UI only)",
    handler: async (_args, ctx) => {
      if (!latestStats) {
        ctx.ui.notify("Context lean: no context processed in this session yet.", "info");
        return;
      }
      const s = latestStats;
      const saved = s.before - s.after;
      const percent = s.before === 0 ? "0.0" : (Math.abs(saved) / s.before * 100).toFixed(1);
      ctx.ui.notify([
        `Context lean — latest pass only, not cumulative`,
        `Serialized message characters: ${s.before} → ${s.after}`,
        `${saved >= 0 ? "Saved" : "Added"}: ${Math.abs(saved)} (${percent}%). Not tokens or final provider size.`,
        `Tool exchanges digested: ${s.digested}; repeated outputs referenced: ${s.repeated}`,
        `Outputs terminal-cleaned: ${s.cleaned}; exchanges excerpted: ${s.excerpted}`,
        `Retired logical skill loads: ${s.retiredLoads}; instruction payloads omitted: ${s.omittedPayloads}`,
        `Complete tool groups protected from digestion: ${s.protectedGroups}`,
        `Tool-result envelopes retained: ${s.preservedResults} (may contain skill omission notices)`,
      ].join("\n"), "info");
    },
  });

  pi.on("context", (event, ctx) => {
    if (discoveryCwd !== ctx.cwd) {
      discovered = new Map();
      const { skills, diagnostics } = loadSkills({ cwd: ctx.cwd, agentDir: getAgentDir(), skillPaths: [], includeDefaults: true });
      for (const skill of skills) {
        const path = skillPath(skill.filePath, ctx.cwd);
        if (path) addName(discovered, skill.name, path);
      }
      // Discovery returns only the winning skill; retain collision paths so
      // a name-only unload cannot accidentally choose between distinct files.
      for (const { collision } of diagnostics) {
        if (collision?.resourceType !== "skill") continue;
        for (const value of [collision.winnerPath, collision.loserPath]) {
          const path = skillPath(value, ctx.cwd);
          if (path) addName(discovered, collision.name, path);
        }
      }
      discoveryCwd = ctx.cwd;
    }
    const sessionCwd = ctx.sessionManager.getHeader()?.cwd;
    // A moved/resumed session with a different cwd cannot identify relative
    // historical reads safely. Absolute identities still work in that case.
    const cwd = sessionCwd === ctx.cwd ? sessionCwd : undefined;
    const reconstructed = reconstructSkillLoads(event.messages, cwd, discovered);

    const stats: CleanupStats = {
      before: JSON.stringify(event.messages).length,
      after: 0,
      digested: 0,
      repeated: 0,
      cleaned: 0,
      excerpted: 0,
      protectedGroups: 0,
      preservedResults: 0,
      retiredLoads: reconstructed.retiredLoads,
      omittedPayloads: reconstructed.omittedPayloads,
    };
    const outgoing = digestToolExchanges(
      reconstructed.messages, reconstructed.skillCallIds, reconstructed.protectedCallIds, stats,
    );
    stats.after = JSON.stringify(outgoing).length;
    stats.preservedResults = outgoing.filter((message) => message.role === "toolResult").length;
    latestStats = stats;
    return { messages: outgoing };
  });
}

