import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAuditCommand, validateAuditReport } from "./dependency-audit.ts";

type Advisory = {
  source: number; name: string; dependency: string; title: string; url: string;
  severity: string; range: string; cwe: string[];
  cvss: { score: number; vectorString: string | null };
};
type Fixture = {
  auditReportVersion: number;
  vulnerabilities: Record<string, {
    name: string; severity: string; isDirect: boolean; via: (string | Advisory)[];
    effects: string[]; range: string; nodes: string[]; fixAvailable: unknown;
  }>;
  metadata: { vulnerabilities: Record<string, number>; dependencies: Record<string, number> };
};
const remaining: Fixture = {
  "auditReportVersion": 2,
  "vulnerabilities": {
    "@next/eslint-plugin-next": {
      "name": "@next/eslint-plugin-next",
      "severity": "high",
      "isDirect": false,
      "via": [
        "fast-glob"
      ],
      "effects": [
        "eslint-config-next"
      ],
      "range": ">=14.3.0-canary.0",
      "nodes": [
        "node_modules/@next/eslint-plugin-next"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "braces": {
      "name": "braces",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1240992,
          "name": "braces",
          "dependency": "braces",
          "title": "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns",
          "url": "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
          "severity": "high",
          "cwe": [
            "CWE-674"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
          },
          "range": "<=3.0.3"
        }
      ],
      "effects": [
        "micromatch"
      ],
      "range": "*",
      "nodes": [
        "node_modules/braces"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "eslint-config-next": {
      "name": "eslint-config-next",
      "severity": "high",
      "isDirect": true,
      "via": [
        "@next/eslint-plugin-next"
      ],
      "effects": [],
      "range": ">=14.3.0-canary.0",
      "nodes": [
        "node_modules/eslint-config-next"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "fast-glob": {
      "name": "fast-glob",
      "severity": "high",
      "isDirect": false,
      "via": [
        "micromatch"
      ],
      "effects": [
        "@next/eslint-plugin-next"
      ],
      "range": "*",
      "nodes": [
        "node_modules/fast-glob"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "micromatch": {
      "name": "micromatch",
      "severity": "high",
      "isDirect": false,
      "via": [
        "braces"
      ],
      "effects": [
        "fast-glob"
      ],
      "range": ">=0.2.0",
      "nodes": [
        "node_modules/micromatch"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    }
  },
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 5,
      "critical": 0,
      "total": 5
    },
    "dependencies": {
      "prod": 21,
      "dev": 455,
      "optional": 121,
      "peer": 0,
      "peerOptional": 0,
      "total": 513
    }
  }
};

const original: Fixture = {
  "auditReportVersion": 2,
  "vulnerabilities": {
    "@next/eslint-plugin-next": {
      "name": "@next/eslint-plugin-next",
      "severity": "high",
      "isDirect": false,
      "via": [
        "fast-glob"
      ],
      "effects": [
        "eslint-config-next"
      ],
      "range": ">=14.3.0-canary.0",
      "nodes": [
        "node_modules/@next/eslint-plugin-next"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "brace-expansion": {
      "name": "brace-expansion",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1240103,
          "name": "brace-expansion",
          "dependency": "brace-expansion",
          "title": "brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service",
          "url": "https://github.com/advisories/GHSA-q2hr-2g5m-vwhr",
          "severity": "moderate",
          "cwe": [
            "CWE-400",
            "CWE-407"
          ],
          "cvss": {
            "score": 5.3,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L"
          },
          "range": ">=4.0.0 <5.0.12"
        },
        {
          "source": 1240107,
          "name": "brace-expansion",
          "dependency": "brace-expansion",
          "title": "brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion",
          "url": "https://github.com/advisories/GHSA-qhr7-859c-m2p7",
          "severity": "high",
          "cwe": [
            "CWE-400",
            "CWE-674"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
          },
          "range": ">=4.0.0 <5.0.11"
        },
        {
          "source": 1240111,
          "name": "brace-expansion",
          "dependency": "brace-expansion",
          "title": "brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion",
          "url": "https://github.com/advisories/GHSA-6j4f-fj2g-mc7p",
          "severity": "high",
          "cwe": [
            "CWE-400",
            "CWE-674"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
          },
          "range": ">=4.0.0 <5.0.10"
        }
      ],
      "effects": [],
      "range": "4.0.0 - 5.0.11",
      "nodes": [
        "node_modules/brace-expansion"
      ],
      "fixAvailable": true
    },
    "braces": {
      "name": "braces",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1240992,
          "name": "braces",
          "dependency": "braces",
          "title": "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns",
          "url": "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
          "severity": "high",
          "cwe": [
            "CWE-674"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
          },
          "range": "<=3.0.3"
        }
      ],
      "effects": [
        "micromatch"
      ],
      "range": "*",
      "nodes": [
        "node_modules/braces"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "eslint-config-next": {
      "name": "eslint-config-next",
      "severity": "high",
      "isDirect": true,
      "via": [
        "@next/eslint-plugin-next"
      ],
      "effects": [],
      "range": ">=14.3.0-canary.0",
      "nodes": [
        "node_modules/eslint-config-next"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "fast-glob": {
      "name": "fast-glob",
      "severity": "high",
      "isDirect": false,
      "via": [
        "micromatch"
      ],
      "effects": [
        "@next/eslint-plugin-next"
      ],
      "range": "*",
      "nodes": [
        "node_modules/fast-glob"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "micromatch": {
      "name": "micromatch",
      "severity": "high",
      "isDirect": false,
      "via": [
        "braces"
      ],
      "effects": [
        "fast-glob"
      ],
      "range": ">=0.2.0",
      "nodes": [
        "node_modules/micromatch"
      ],
      "fixAvailable": {
        "name": "eslint-config-next",
        "version": "14.2.35",
        "isSemVerMajor": true
      }
    },
    "next": {
      "name": "next",
      "severity": "critical",
      "isDirect": true,
      "via": [
        {
          "source": 1240609,
          "name": "next",
          "dependency": "next",
          "title": "Next.js: Remote Code Execution in next/og ImageResponse",
          "url": "https://github.com/advisories/GHSA-vcvr-r3jv-pc5j",
          "severity": "critical",
          "cwe": [
            "CWE-1395"
          ],
          "cvss": {
            "score": 0,
            "vectorString": null
          },
          "range": ">=16.2.0 <16.3.6"
        },
        {
          "source": 1241489,
          "name": "next",
          "dependency": "next",
          "title": "Next.js: Pending `use cache` fill can leak Draft Mode content into regular responses and persisted pages",
          "url": "https://github.com/advisories/GHSA-3w37-wq28-93x7",
          "severity": "moderate",
          "cwe": [
            "CWE-524"
          ],
          "cvss": {
            "score": 4.2,
            "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N"
          },
          "range": ">=16.3.0 <16.3.8"
        },
        {
          "source": 1241490,
          "name": "next",
          "dependency": "next",
          "title": "Next.js has cache poisoning of SSG and ISR pages in self-hosted applications",
          "url": "https://github.com/advisories/GHSA-4jqv-mc3x-m676",
          "severity": "moderate",
          "cwe": [
            "CWE-524"
          ],
          "cvss": {
            "score": 5.3,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L"
          },
          "range": ">=16.0.0 <16.3.8"
        },
        {
          "source": 1241492,
          "name": "next",
          "dependency": "next",
          "title": "Next.js has information disclosure in development server's Model Context Protocol endpoint",
          "url": "https://github.com/advisories/GHSA-39w2-rjm5-chcv",
          "severity": "low",
          "cwe": [
            "CWE-346"
          ],
          "cvss": {
            "score": 5.4,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N"
          },
          "range": ">=16.0.0 <16.3.8"
        },
        {
          "source": 1241493,
          "name": "next",
          "dependency": "next",
          "title": "Next.js has information disclosure in App Router metadata image routes via dynamicParams bypass",
          "url": "https://github.com/advisories/GHSA-f87g-xv8r-7p7x",
          "severity": "moderate",
          "cwe": [
            "CWE-346"
          ],
          "cvss": {
            "score": 5.3,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N"
          },
          "range": ">=16.0.0 <16.3.8"
        },
        {
          "source": 1241495,
          "name": "next",
          "dependency": "next",
          "title": "Next.js has cache poisoning in SSG/ISR rendering that leads to cross-user content substitution and persistent denial of service",
          "url": "https://github.com/advisories/GHSA-mcj8-r9mp-w47p",
          "severity": "moderate",
          "cwe": [
            "CWE-524"
          ],
          "cvss": {
            "score": 4.8,
            "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:L"
          },
          "range": ">=16.0.0 <16.3.8"
        },
        {
          "source": 1241496,
          "name": "next",
          "dependency": "next",
          "title": "Next.js has Server-Side Request Forgery in Image Optimization",
          "url": "https://github.com/advisories/GHSA-cjq9-62q9-8jv4",
          "severity": "high",
          "cwe": [
            "CWE-918"
          ],
          "cvss": {
            "score": 6.5,
            "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:L/A:N"
          },
          "range": ">=16.0.0 <16.3.8"
        },
        "sharp"
      ],
      "effects": [],
      "range": "9.5.6-canary.0 - 10.0.7 || 14.3.0-canary.0 - 15.5.23 || 15.6.0-canary.0 - 16.3.7",
      "nodes": [
        "node_modules/next"
      ],
      "fixAvailable": {
        "name": "next",
        "version": "16.4.0",
        "isSemVerMajor": false
      }
    },
    "sharp": {
      "name": "sharp",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1241331,
          "name": "sharp",
          "dependency": "sharp",
          "title": "sharp : Vulnerability in librsvg dependency CVE-2026-96889",
          "url": "https://github.com/advisories/GHSA-wq5f-xc86-pv6w",
          "severity": "high",
          "cwe": [
            "CWE-416",
            "CWE-1395"
          ],
          "cvss": {
            "score": 0,
            "vectorString": null
          },
          "range": "<0.35.5"
        }
      ],
      "effects": [
        "next"
      ],
      "range": "<0.35.5",
      "nodes": [
        "node_modules/sharp"
      ],
      "fixAvailable": {
        "name": "next",
        "version": "16.4.0",
        "isSemVerMajor": false
      }
    },
    "source-map-js": {
      "name": "source-map-js",
      "severity": "high",
      "isDirect": false,
      "via": [
        {
          "source": 1241209,
          "name": "source-map-js",
          "dependency": "source-map-js",
          "title": "source-map-js allows event-loop denial of service through indexed source-map section offsets",
          "url": "https://github.com/advisories/GHSA-68fv-2mgg-jv7q",
          "severity": "high",
          "cwe": [
            "CWE-1284"
          ],
          "cvss": {
            "score": 7.5,
            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
          },
          "range": ">=1.0.0 <1.2.2"
        }
      ],
      "effects": [],
      "range": "1.0.0 - 1.2.1",
      "nodes": [
        "node_modules/source-map-js"
      ],
      "fixAvailable": true
    }
  },
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 8,
      "critical": 1,
      "total": 9
    },
    "dependencies": {
      "prod": 21,
      "dev": 455,
      "optional": 121,
      "peer": 0,
      "peerOptional": 0,
      "total": 513
    }
  }
};

function check(report: unknown = fresh()) {
  return validateAuditReport(report);
}

function recount(report: Fixture): void {
  const counts: Record<string, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const record of Object.values(report.vulnerabilities)) {
    counts[record.severity] += 1;
    counts.total += 1;
  }
  report.metadata.vulnerabilities = counts;
}

// The braces chain downgraded below the threshold keeps a realistic, passing graph.
function fresh() {
  const report = structuredClone(remaining);
  for (const record of Object.values(report.vulnerabilities)) record.severity = "moderate";
  advisory(report).severity = "moderate";
  recount(report);
  return report;
}
function advisory(report: Fixture): Advisory { return report.vulnerabilities.braces.via[0] as Advisory; }
function command(stdout = JSON.stringify(remaining), status: number | null = 1) {
  return { stdout, status, signal: null };
}

function addFinding(report: Fixture, name = "new-package", severity = "high") {
  const via = { ...advisory(report), source: 9999999, name, dependency: name, severity, url: "https://github.com/advisories/GHSA-new-finding" };
  report.vulnerabilities[name] = { name, severity, isDirect: true, via: [via], effects: [], range: "*", nodes: [`node_modules/${name}`], fixAvailable: false };
  recount(report);
}

test("clean report passes", () => {
  const report = fresh();
  report.vulnerabilities = {};
  recount(report);
  assert.deepEqual(check(parseAuditCommand(command(JSON.stringify(report), 0))), { vulnerabilityCount: 0 });
});

test("former braces exception chain now blocks", () => {
  assert.throws(() => check(parseAuditCommand(command())), /unreviewed high\/critical/);
});

test("original authentic nine-finding report blocks", () => {
  assert.throws(() => check(original), /unreviewed high\/critical/);
});

test("unrelated below-threshold findings remain visible without blocking", () => {
  const report = fresh();
  addFinding(report, "low-package", "low");
  assert.equal(check(report).vulnerabilityCount, 6);
});

test("new direct and transitive high/critical findings block", () => {
  for (const level of ["high", "critical"]) {
    const report = fresh();
    addFinding(report, "new-package", level);
    assert.throws(() => check(report), /unreviewed high\/critical/);
    report.vulnerabilities["new-package"].isDirect = false;
    report.vulnerabilities["new-parent"] = { name: "new-parent", severity: level, isDirect: true, via: ["new-package"], effects: [], range: "*", nodes: ["node_modules/new-parent"], fixAvailable: false };
    report.vulnerabilities["new-package"].effects = ["new-parent"];
    recount(report);
    assert.throws(() => check(report), /unreviewed high\/critical/);
  }
});

test("malformed records, errors, unsupported reports and contradictory totals block", () => {
  const changes = [
    (r: Fixture) => { r.auditReportVersion = 1; },
    (r: Fixture) => { r.vulnerabilities.braces.severity = "unknown"; },
    (r: Fixture) => { r.vulnerabilities.braces.nodes = []; },
    (r: Fixture) => { r.vulnerabilities.braces.via = []; },
    (r: Fixture) => { r.vulnerabilities.braces.fixAvailable = null; },
    (r: Fixture) => { r.vulnerabilities.braces.effects = []; },
    (r: Fixture) => { r.metadata.vulnerabilities.high = 4; },
    (r: Fixture) => { r.metadata.vulnerabilities.total = 6; },
    (r: Fixture) => { r.metadata.dependencies.total = -1; },
    (r: Fixture) => { advisory(r).source = NaN; },
    (r: Fixture) => { advisory(r).cvss.score = Infinity; },
  ];
  for (const mutate of changes) {
    const report = fresh();
    mutate(report);
    assert.throws(() => check(report));
  }
  for (const report of [null, [], {}, { ...remaining, error: { code: "EAUDITNOLOCK" } }]) {
    assert.throws(() => check(report));
  }
});

test("unresolved, cyclic and altered dependency relationships block", () => {
  const missing = fresh();
  missing.vulnerabilities.micromatch.via = ["missing"];
  assert.throws(() => check(missing), /unresolved/);
  const cyclic = fresh();
  cyclic.vulnerabilities.braces.via = ["micromatch"];
  assert.throws(() => check(cyclic), /cyclic/);
  const wrong = fresh();
  wrong.vulnerabilities["eslint-config-next"].via = ["braces"];
  assert.throws(() => check(wrong), /effects|dependency/);
});

test("command errors, timeout, signals, unexpected status and invalid JSON block", () => {
  for (const result of [
    { ...command(), error: new Error("ENOENT") },
    { ...command(), error: new Error("ETIMEDOUT"), status: null },
    { ...command(), status: null, signal: "SIGTERM" },
    command(JSON.stringify(remaining), 2),
    command(JSON.stringify(remaining), 0),
    command(""), command("{"), command("registry unavailable"),
    command(JSON.stringify({ error: { code: "E500" } })),
  ]) {
    assert.throws(() => parseAuditCommand(result));
  }
  const clean = fresh();
  clean.vulnerabilities = {};
  recount(clean);
  assert.throws(() => parseAuditCommand(command(JSON.stringify(clean), 1)), /exit status/);
});
