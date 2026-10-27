import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];
type ObjectValue = Record<string, unknown>;

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function object(value: unknown, label: string): ObjectValue {
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value), `${label}: expected object`);
  return value as ObjectValue;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function strings(value: unknown, label: string): string[] {
  requireCondition(Array.isArray(value) && value.every(nonemptyString), `${label}: expected string array`);
  requireCondition(new Set(value).size === value.length, `${label}: duplicate entries`);
  return value;
}

function severity(value: unknown): Severity {
  requireCondition(SEVERITIES.some((item) => item === value), `unknown severity: ${String(value)}`);
  return value as Severity;
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((item) => expected.includes(item));
}

function validateAdvisory(value: unknown, name: string): ObjectValue {
  const advisory = object(value, `${name} advisory`);
  requireCondition(Number.isSafeInteger(advisory.source) && Number(advisory.source) > 0, `${name}: invalid advisory source`);
  requireCondition(advisory.name === name && advisory.dependency === name, `${name}: inconsistent advisory dependency`);
  for (const field of ["title", "url", "range"]) {
    requireCondition(nonemptyString(advisory[field]), `${name}: missing advisory ${field}`);
  }
  requireCondition(String(advisory.url).startsWith("https://"), `${name}: invalid advisory URL`);
  severity(advisory.severity);
  strings(advisory.cwe, `${name} CWE`);
  const cvss = object(advisory.cvss, `${name} CVSS`);
  requireCondition(typeof cvss.score === "number" && Number.isFinite(cvss.score) && cvss.score >= 0 && cvss.score <= 10, `${name}: invalid CVSS score`);
  requireCondition(cvss.vectorString === null || nonemptyString(cvss.vectorString), `${name}: invalid CVSS vector`);
  return advisory;
}

export function validateAuditReport(input: unknown): { vulnerabilityCount: number } {
  const report = object(input, "audit report");
  requireCondition(!Object.hasOwn(report, "error"), "npm audit returned an error envelope");
  requireCondition(report.auditReportVersion === 2, "unsupported audit report version");
  const vulnerabilities = object(report.vulnerabilities, "vulnerabilities");
  const metadata = object(report.metadata, "metadata");
  const totals = object(metadata.vulnerabilities, "vulnerability totals");
  const dependencyTotals = object(metadata.dependencies, "dependency totals");
  for (const key of ["prod", "dev", "optional", "peer", "peerOptional", "total"]) {
    requireCondition(Number.isSafeInteger(dependencyTotals[key]) && Number(dependencyTotals[key]) >= 0, `invalid dependency count: ${key}`);
  }
  const records = new Map<string, ObjectValue>();
  const counts: Record<Severity, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const [name, value] of Object.entries(vulnerabilities)) {
    const record = object(value, name);
    requireCondition(record.name === name && typeof record.isDirect === "boolean" && nonemptyString(record.range), `${name}: malformed vulnerability record`);
    counts[severity(record.severity)] += 1;
    const nodes = strings(record.nodes, `${name} nodes`);
    requireCondition(nodes.length > 0 && nodes.every((node) => node.startsWith("node_modules/") && !node.includes("..")), `${name}: invalid installation path`);
    strings(record.effects, `${name} effects`);
    requireCondition(Array.isArray(record.via) && record.via.length > 0, `${name}: missing advisory relationships`);
    for (const via of record.via) {
      if (typeof via === "string") requireCondition(nonemptyString(via), `${name}: empty via dependency`);
      else validateAdvisory(via, name);
    }
    if (typeof record.fixAvailable !== "boolean") {
      const fix = object(record.fixAvailable, `${name} fixAvailable`);
      requireCondition(nonemptyString(fix.name) && nonemptyString(fix.version) && typeof fix.isSemVerMajor === "boolean", `${name}: malformed fixAvailable`);
    }
    records.set(name, record);
  }
  for (const item of SEVERITIES) requireCondition(totals[item] === counts[item], `contradictory ${item} vulnerability total`);
  requireCondition(totals.total === records.size, "contradictory vulnerability total");

  const resolved = new Map<string, Severity>();
  function resolve(name: string, visiting = new Set<string>()): Severity {
    requireCondition(!visiting.has(name), `cyclic advisory relationship: ${name}`);
    const prior = resolved.get(name);
    if (prior) return prior;
    const record = records.get(name);
    requireCondition(record, `unresolved advisory dependency: ${name}`);
    visiting.add(name);
    const via = record.via as unknown[];
    const levels = via.map((item) => typeof item === "string" ? resolve(item, visiting) : severity(object(item, name).severity));
    visiting.delete(name);
    const level = SEVERITIES[Math.max(...levels.map((item) => SEVERITIES.indexOf(item)))];
    requireCondition(record.severity === level, `${name}: contradictory propagated severity`);
    const expectedEffects = [...records.entries()].filter(([, other]) => (other.via as unknown[]).includes(name)).map(([otherName]) => otherName);
    requireCondition(sameStrings(record.effects as string[], expectedEffects), `${name}: contradictory effects`);
    resolved.set(name, level);
    return level;
  }
  for (const name of records.keys()) resolve(name);

  const blocked = [...records.entries()].filter(([, record]) => SEVERITIES.indexOf(severity(record.severity)) >= SEVERITIES.indexOf("high"));
  requireCondition(blocked.length === 0, `unreviewed high/critical vulnerability: ${blocked.map(([name]) => name).join(", ")}`);
  return { vulnerabilityCount: records.size };
}

export type AuditCommandResult = {
  status: number | null;
  signal: string | null;
  stdout: string;
  error?: Error;
};

export function parseAuditCommand(result: AuditCommandResult): unknown {
  requireCondition(!result.error && !result.signal && (result.status === 0 || result.status === 1), `npm audit command failed: ${result.error?.message ?? result.signal ?? result.status}`);
  let report: unknown;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error("npm audit returned invalid or truncated JSON");
  }
  const totals = object(object(object(report, "audit report").metadata, "metadata").vulnerabilities, "vulnerability totals");
  requireCondition(Number.isSafeInteger(totals.high) && Number.isSafeInteger(totals.critical), "invalid high/critical totals");
  const expectedStatus = Number(totals.high) + Number(totals.critical) > 0 ? 1 : 0;
  requireCondition(result.status === expectedStatus, "npm audit exit status contradicts high/critical totals");
  return report;
}

function main(): void {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const result = spawnSync("npm", ["audit", "--json", "--audit-level=high", "--include=dev", "--include=optional", "--include=peer"], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(`${result.stdout.trimEnd()}\n`);
    const report = parseAuditCommand(result);
    const validation = validateAuditReport(report);
    process.stdout.write(`Complete dependency audit passed (${validation.vulnerabilityCount} reported package records).\n`);
  } catch (error) {
    process.stderr.write(`Dependency audit blocked: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
