import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/build.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

const jobStart = workflow.indexOf("  workflow-lint-history-watchdog:");
const jobEnd = workflow.indexOf("\n  android-release-smoke:", jobStart);
assert.notEqual(jobStart, -1);
assert.notEqual(jobEnd, -1);
const watchdogJob = workflow.slice(jobStart, jobEnd);

function getEmbeddedScript() {
  const marker = "          script: |\n";
  const scriptStart = watchdogJob.indexOf(marker);
  assert.notEqual(scriptStart, -1);

  const scriptLines = [];
  for (const line of watchdogJob.slice(scriptStart + marker.length).split("\n")) {
    if (line.startsWith("            ")) {
      scriptLines.push(line.slice("            ".length));
    } else if (line === "") {
      scriptLines.push("");
    } else {
      break;
    }
  }
  return scriptLines.join("\n");
}

function createGitHubMock({ runs, jobsByRun, history }) {
  const calls = [];
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async (params) => {
          calls.push({ method: "listWorkflowRuns", params });
          return { data: { workflow_runs: runs } };
        },
        listJobsForWorkflowRun: async (params) => {
          calls.push({ method: "listJobsForWorkflowRun", params });
          return { data: { jobs: jobsByRun[params.run_id] ?? [] } };
        },
      },
      repos: {
        getContent: async (params) => {
          calls.push({ method: "getContent", params });
          return {
            data: {
              content: Buffer.from(JSON.stringify(history)).toString("base64"),
              encoding: "base64",
            },
          };
        },
      },
      issues: {
        getLabel: async (params) => {
          calls.push({ method: "getLabel", params });
          return { data: { name: params.name } };
        },
        createLabel: async (params) => {
          calls.push({ method: "createLabel", params });
          return { data: { name: params.name } };
        },
        listForRepo: async (params) => {
          calls.push({ method: "listForRepo", params });
          return { data: [] };
        },
        create: async (params) => {
          calls.push({ method: "create", params });
          return { data: { number: 1 } };
        },
      },
    },
  };
  return { calls, github };
}

async function runWatchdog({ runs, jobsByRun, history }) {
  const { calls, github } = createGitHubMock({ runs, jobsByRun, history });
  const infoMessages = [];
  const warningMessages = [];
  await new Script(`(async () => {\n${getEmbeddedScript()}\n})()`).runInNewContext({
    Buffer,
    process: {
      env: {
        ALERT_TITLE: "[Maintainer alert] Monthly workflow lint record missing",
        CHECKED_AT: "2026-09-02T05:00:00Z",
        DEFAULT_BRANCH: "main",
        HISTORY_PATH: ".github/workflow-lint-history.json",
        HISTORY_URL:
          "https://github.com/SafeNetInc/SafeNet-DNS/blob/main/.github/workflow-lint-history.json",
        RUN_URL: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/900",
        WORKFLOW_FILE: "build.yml",
      },
    },
    github,
    context: { repo: { owner: "SafeNetInc", repo: "SafeNet-DNS" } },
    core: {
      info: (message) => infoMessages.push(message),
      warning: (message) => warningMessages.push(message),
    },
  });
  return { calls, infoMessages, warningMessages };
}

const monthlyRun = {
  id: 101,
  created_at: "2026-09-01T04:47:00Z",
  html_url: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/101",
};
const monthlyJobs = {
  101: [{ name: "Workflow lint (Windows x64 on windows-latest)" }],
};

test("does not alert or write when the monthly run has all three history outcomes", async () => {
  const result = await runWatchdog({
    runs: [monthlyRun],
    jobsByRun: monthlyJobs,
    history: {
      schema_version: 1,
      retention_runs: 24,
      runs: [
        {
          run_id: "101",
          results: [
            { platform: "Windows", architecture: "x64" },
            { platform: "macOS", architecture: "x64" },
            { platform: "macOS", architecture: "arm64" },
          ],
        },
      ],
    },
  });

  assert.equal(result.calls.filter((call) => call.method === "create").length, 0);
  assert.equal(result.calls.filter((call) => call.method === "createComment").length, 0);
  assert.ok(result.infoMessages.some((message) => message.includes("all three history outcomes")));
});

test("alerts with the affected run and history file when the monthly run is absent", async () => {
  const nearestRun = {
    id: 100,
    created_at: "2026-09-02T04:17:00Z",
    html_url: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/100",
  };
  const result = await runWatchdog({
    runs: [nearestRun],
    jobsByRun: { 100: [{ name: "Build Android APK and Windows MSI" }] },
    history: { schema_version: 1, retention_runs: 24, runs: [] },
  });

  const createCall = result.calls.find((call) => call.method === "create");
  assert.ok(createCall);
  assert.match(String(createCall.params.body), /No scheduled workflow run containing the cross-platform lint matrix/);
  assert.match(String(createCall.params.body), /actions\/runs\/100/);
  assert.match(String(createCall.params.body), /workflow-lint-history\.json/);
  assert.match(String(createCall.params.body), /No synthetic history entry was created/);
  assert.equal(
    result.calls.filter((call) => call.method === "getContent").length,
    1,
  );
  assert.equal(
    result.calls.some((call) =>
      ["createOrUpdateFileContents", "deleteFile"].includes(call.method),
    ),
    false,
  );
});

test("alerts when the monthly history record does not contain all expected outcomes", async () => {
  const result = await runWatchdog({
    runs: [monthlyRun],
    jobsByRun: monthlyJobs,
    history: {
      schema_version: 1,
      retention_runs: 24,
      runs: [
        {
          run_id: "101",
          results: [{ platform: "Windows", architecture: "x64" }],
        },
      ],
    },
  });

  const createCall = result.calls.find((call) => call.method === "create");
  assert.ok(createCall);
  assert.match(String(createCall.params.body), /Monthly workflow run 101 is missing outcome records/);
  assert.match(String(createCall.params.body), /macOS\/x64/);
  assert.match(String(createCall.params.body), /macOS\/arm64/);
});

test("keeps the first-day watchdog run deferred until the monthly schedule can start", async () => {
  const result = await runWatchdog({
    runs: [],
    jobsByRun: {},
    history: { schema_version: 1, retention_runs: 24, runs: [] },
  });

  // The embedded script uses the checked timestamp; this test's timestamp is
  // deliberately changed to the first day without making any GitHub calls.
  const firstDayScript = getEmbeddedScript().replace(
    "2026-09-02T05:00:00Z",
    "2026-09-01T04:17:00Z",
  );
  const { calls, github } = createGitHubMock({
    runs: [],
    jobsByRun: {},
    history: { schema_version: 1, retention_runs: 24, runs: [] },
  });
  await new Script(`(async () => {\n${firstDayScript}\n})()`).runInNewContext({
    Buffer,
    process: {
      env: {
        ALERT_TITLE: "[Maintainer alert] Monthly workflow lint record missing",
        CHECKED_AT: "2026-09-01T04:17:00Z",
        DEFAULT_BRANCH: "main",
        HISTORY_PATH: ".github/workflow-lint-history.json",
        HISTORY_URL: "https://example.test/history",
        RUN_URL: "https://example.test/run",
        WORKFLOW_FILE: "build.yml",
      },
    },
    github,
    context: { repo: { owner: "SafeNetInc", repo: "SafeNet-DNS" } },
    core: { info: () => {}, warning: () => {} },
  });

  assert.equal(result.calls.filter((call) => call.method === "listWorkflowRuns").length, 1);
  assert.equal(calls.length, 0);
});