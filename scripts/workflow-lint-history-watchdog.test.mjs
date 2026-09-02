import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const summaryJobStart = workflow.indexOf("  cross-platform-workflow-lint-summary:");
const summaryJobEnd = workflow.indexOf("\n  build-android:", summaryJobStart);
assert.notEqual(summaryJobStart, -1);
assert.notEqual(summaryJobEnd, -1);
const summaryJob = workflow.slice(summaryJobStart, summaryJobEnd);

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

function getHistoryWriterScript() {
  const marker = "          node --input-type=module <<'NODE'\n";
  const scriptStart = summaryJob.indexOf(marker);
  assert.notEqual(scriptStart, -1);

  const scriptEnd = summaryJob.indexOf("\n          NODE", scriptStart);
  assert.notEqual(scriptEnd, -1);

  return summaryJob
    .slice(scriptStart + marker.length, scriptEnd)
    .split("\n")
    .map((line) => line.slice("          ".length))
    .join("\n");
}

function createGitHubMock({
  runs,
  jobsByRun,
  history,
  openAlerts = [],
  comments = [],
}) {
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
          return { data: openAlerts };
        },
        listComments: async (params) => {
          calls.push({ method: "listComments", params });
          return { data: comments };
        },
        create: async (params) => {
          calls.push({ method: "create", params });
          return { data: { number: 1 } };
        },
        createComment: async (params) => {
          calls.push({ method: "createComment", params });
          return { data: { id: 1, body: params.body } };
        },
        update: async (params) => {
          calls.push({ method: "update", params });
          return { data: { number: params.issue_number, state: params.state } };
        },
      },
    },
  };
  return { calls, github };
}

async function runWatchdog({
  runs,
  jobsByRun,
  history,
  openAlerts,
  comments,
}) {
  const { calls, github } = createGitHubMock({
    runs,
    jobsByRun,
    history,
    openAlerts,
    comments,
  });
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

const recoveredAlert = {
  number: 42,
  title: "[Maintainer alert] Monthly workflow lint record missing",
};

function expectedRecoveryComment() {
  return [
    "The monthly hosted-runner workflow lint record recovered successfully.",
    "",
    "Successful workflow run: [101](https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/101)",
    "History file: [Open .github/workflow-lint-history.json](https://github.com/SafeNetInc/SafeNet-DNS/blob/main/.github/workflow-lint-history.json)",
    "",
    "Closing this alert while preserving the previous finding history.",
  ].join("\n");
}

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

test("comments with the recovered run and history file before closing an open alert", async () => {
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
    openAlerts: [recoveredAlert],
  });

  const commentIndex = result.calls.findIndex((call) => call.method === "createComment");
  const updateIndex = result.calls.findIndex((call) => call.method === "update");
  assert.notEqual(commentIndex, -1);
  assert.notEqual(updateIndex, -1);
  assert.ok(commentIndex < updateIndex);
  assert.equal(result.calls[commentIndex].params.issue_number, recoveredAlert.number);
  assert.equal(result.calls[commentIndex].params.body, expectedRecoveryComment());
  assert.equal(result.calls[updateIndex].params.owner, "SafeNetInc");
  assert.equal(result.calls[updateIndex].params.repo, "SafeNet-DNS");
  assert.equal(result.calls[updateIndex].params.issue_number, recoveredAlert.number);
  assert.equal(result.calls[updateIndex].params.state, "closed");
  assert.equal(result.calls[updateIndex].params.state_reason, "completed");
  assert.equal(result.calls.filter((call) => call.method === "create").length, 0);
});

test("does not duplicate the recovery comment when the alert already contains it", async () => {
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
    openAlerts: [recoveredAlert],
    comments: [{ body: expectedRecoveryComment() }],
  });

  assert.equal(result.calls.filter((call) => call.method === "createComment").length, 0);
  assert.equal(result.calls.filter((call) => call.method === "create").length, 0);
  assert.equal(result.calls.filter((call) => call.method === "update").length, 1);
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

test("replaces rerun records without consuming retention slots", () => {
  const configuredHistory = JSON.parse(
    readFileSync(new URL("../.github/workflow-lint-history.json", import.meta.url), "utf8"),
  );
  const workspace = mkdtempSync(join(tmpdir(), "workflow-lint-history-rerun-"));
  const historyDirectory = join(workspace, ".github");
  const resultsDirectory = join(workspace, "workflow-lint-results");
  const writerScript = getHistoryWriterScript();
  const results = [
    {
      platform: "Windows",
      architecture: "x64",
      runner: "windows-latest",
    },
    {
      platform: "macOS",
      architecture: "x64",
      runner: "macos-13",
    },
    {
      platform: "macOS",
      architecture: "arm64",
      runner: "macos-14",
    },
  ];

  function writeHistory({ runId, runAttempt, recordedAt, commit }) {
    for (const result of results) {
      writeFileSync(
        join(
          resultsDirectory,
          `workflow-lint-result-${result.platform}-${result.architecture}.json`,
        ),
        `${JSON.stringify(
          { ...result, stage: "completed", outcome: "success" },
          null,
          2,
        )}\n`,
      );
    }

    const writer = spawnSync(process.execPath, ["--input-type=module"], {
      cwd: workspace,
      encoding: "utf8",
      input: writerScript,
      env: {
        ...process.env,
        RESULTS_DIRECTORY: resultsDirectory,
        RUN_ID: String(runId),
        RUN_ATTEMPT: String(runAttempt),
        EVENT_NAME: "schedule",
        RECORDED_AT: recordedAt,
        REF_NAME: "main",
        COMMIT_SHA: commit,
      },
    });
    assert.equal(
      writer.status,
      0,
      `history writer failed for run ${runId}, attempt ${runAttempt}:\n${writer.stderr}`,
    );
  }

  try {
    mkdirSync(historyDirectory);
    mkdirSync(resultsDirectory);
    writeFileSync(
      join(historyDirectory, "workflow-lint-history.json"),
      `${JSON.stringify(configuredHistory, null, 2)}\n`,
    );

    writeHistory({
      runId: 101,
      runAttempt: 1,
      recordedAt: "2026-09-01T04:47:00Z",
      commit: "first-attempt",
    });
    writeHistory({
      runId: 100,
      runAttempt: 1,
      recordedAt: "2026-08-01T04:47:00Z",
      commit: "previous-month",
    });
    writeHistory({
      runId: 101,
      runAttempt: 2,
      recordedAt: "2026-09-01T05:12:00Z",
      commit: "second-attempt",
    });

    const history = JSON.parse(
      readFileSync(join(historyDirectory, "workflow-lint-history.json"), "utf8"),
    );
    assert.deepEqual(
      history.runs.map((run) => run.run_id),
      ["101", "100"],
    );
    assert.equal(history.runs[0].run_attempt, 2);
    assert.equal(history.runs[0].recorded_at, "2026-09-01T05:12:00Z");
    assert.equal(history.runs[0].commit, "second-attempt");
    assert.equal(
      history.runs.filter((run) => run.run_id === "101").length,
      1,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("retains only the newest configured runs with every matrix outcome", () => {
  const configuredHistory = JSON.parse(
    readFileSync(new URL("../.github/workflow-lint-history.json", import.meta.url), "utf8"),
  );
  const retentionRuns = configuredHistory.retention_runs;
  const totalRuns = retentionRuns + 3;
  const expectedOutcomes = new Set([
    "Windows/x64",
    "macOS/x64",
    "macOS/arm64",
  ]);
  const workspace = mkdtempSync(join(tmpdir(), "workflow-lint-history-"));
  const historyDirectory = join(workspace, ".github");
  const resultsDirectory = join(workspace, "workflow-lint-results");
  const writerScript = getHistoryWriterScript();

  try {
    mkdirSync(historyDirectory);
    mkdirSync(resultsDirectory);
    writeFileSync(
      join(historyDirectory, "workflow-lint-history.json"),
      `${JSON.stringify(configuredHistory, null, 2)}\n`,
    );

    for (let runNumber = 1; runNumber <= totalRuns; runNumber += 1) {
      for (const file of [
        "workflow-lint-result-Windows-x64.json",
        "workflow-lint-result-macOS-x64.json",
        "workflow-lint-result-macOS-arm64.json",
      ]) {
        rmSync(join(resultsDirectory, file), { force: true });
      }

      const results = [
        {
          platform: "Windows",
          architecture: "x64",
          runner: "windows-latest",
        },
        {
          platform: "macOS",
          architecture: "x64",
          runner: "macos-13",
        },
        {
          platform: "macOS",
          architecture: "arm64",
          runner: "macos-14",
        },
      ];
      results.forEach((result) => {
        writeFileSync(
          join(
            resultsDirectory,
            `workflow-lint-result-${result.platform}-${result.architecture}.json`,
          ),
          `${JSON.stringify(
            { ...result, stage: "completed", outcome: "success" },
            null,
            2,
          )}\n`,
        );
      });

      const writer = spawnSync(process.execPath, ["--input-type=module"], {
        cwd: workspace,
        encoding: "utf8",
        input: writerScript,
        env: {
          ...process.env,
          RESULTS_DIRECTORY: resultsDirectory,
          RUN_ID: String(runNumber),
          RUN_ATTEMPT: "1",
          EVENT_NAME: "schedule",
          RECORDED_AT: `2026-09-${String(runNumber).padStart(2, "0")}T04:47:00Z`,
          REF_NAME: "main",
          COMMIT_SHA: `commit-${runNumber}`,
        },
      });
      assert.equal(
        writer.status,
        0,
        `history writer failed for run ${runNumber}:\n${writer.stderr}`,
      );
    }

    const history = JSON.parse(
      readFileSync(join(historyDirectory, "workflow-lint-history.json"), "utf8"),
    );
    assert.equal(history.retention_runs, retentionRuns);
    assert.equal(history.runs.length, retentionRuns);
    assert.deepEqual(
      history.runs.map((run) => run.run_id),
      Array.from(
        { length: retentionRuns },
        (_, index) => String(totalRuns - index),
      ),
    );
    for (const run of history.runs) {
      assert.deepEqual(
        new Set(
          run.results.map(
            (result) => `${result.platform}/${result.architecture}`,
          ),
        ),
        expectedOutcomes,
      );
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});