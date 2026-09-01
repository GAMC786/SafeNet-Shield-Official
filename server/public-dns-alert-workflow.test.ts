import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import path from "node:path";
import test from "node:test";

const workflow = readFileSync(
  path.resolve(process.cwd(), ".github/workflows/build.yml"),
  "utf8",
);

const failureStep = "Alert maintainers about public DNS smoke failure";
const recoveryStep = "Close recovered public DNS smoke alert";

type Alert = {
  number: number;
  title: string;
  state: "open" | "closed";
  comments: string[];
};

type GitHubCall = {
  method: string;
  params: Record<string, unknown>;
};

function getStepBlock(stepName: string) {
  const stepStart = workflow.indexOf(`      - name: ${stepName}`);
  assert.notEqual(stepStart, -1, `Workflow step not found: ${stepName}`);

  const nextStep = workflow.indexOf("\n      - name:", stepStart + 1);
  return workflow.slice(stepStart, nextStep === -1 ? undefined : nextStep);
}

function getStepCondition(stepName: string) {
  const condition = getStepBlock(stepName).match(/\n        if: (.+)/)?.[1];
  assert.ok(condition, `Workflow condition not found: ${stepName}`);
  return condition;
}

function getEmbeddedScript(stepName: string) {
  const block = getStepBlock(stepName);
  const marker = "          script: |\n";
  const scriptStart = block.indexOf(marker);
  assert.notEqual(scriptStart, -1, `Embedded script not found: ${stepName}`);

  const scriptLines: string[] = [];
  const lines = block.slice(scriptStart + marker.length).split("\n");
  for (const line of lines) {
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

function createGitHubMock(
  openAlerts: Alert[],
  transientFailures: Partial<Record<string, number>> = {},
  acceptedWriteThenErrors: Partial<Record<string, number>> = {},
) {
  const calls: GitHubCall[] = [];
  const remainingTransientFailures = { ...transientFailures };
  const remainingAcceptedWriteThenErrors = { ...acceptedWriteThenErrors };
  const record = (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
  };
  const maybeFailTransiently = (method: string) => {
    const remaining = remainingTransientFailures[method] ?? 0;
    if (remaining === 0) return;

    remainingTransientFailures[method] = remaining - 1;
    const error = new Error(`simulated transient failure for ${method}`);
    Object.assign(error, { status: 503 });
    throw error;
  };
  const maybeFailAfterAcceptance = (method: string) => {
    const remaining = remainingAcceptedWriteThenErrors[method] ?? 0;
    if (remaining === 0) return;

    remainingAcceptedWriteThenErrors[method] = remaining - 1;
    const error = new Error(`simulated accepted write with lost response for ${method}`);
    Object.assign(error, { status: 503 });
    throw error;
  };

  const github = {
    rest: {
      issues: {
        getLabel: async (params: Record<string, unknown>) => {
          record("getLabel", params);
          maybeFailTransiently("getLabel");
          return { data: { name: params.name } };
        },
        createLabel: async (params: Record<string, unknown>) => {
          record("createLabel", params);
          maybeFailTransiently("createLabel");
          return { data: { name: params.name } };
        },
        listForRepo: async (params: Record<string, unknown>) => {
          record("listForRepo", params);
          maybeFailTransiently("listForRepo");
          return { data: openAlerts.filter((alert) => alert.state === "open") };
        },
        listComments: async (params: Record<string, unknown>) => {
          record("listComments", params);
          maybeFailTransiently("listComments");
          const alert = openAlerts.find(
            (candidate) => candidate.number === params.issue_number,
          );
          assert.ok(alert, `Alert not found: ${params.issue_number}`);
          return { data: alert.comments.map((body) => ({ body })) };
        },
        createComment: async (params: Record<string, unknown>) => {
          record("createComment", params);
          maybeFailTransiently("createComment");
          const alert = openAlerts.find(
            (candidate) => candidate.number === params.issue_number,
          );
          assert.ok(alert, `Alert not found: ${params.issue_number}`);
          alert.comments.push(String(params.body));
          maybeFailAfterAcceptance("createComment");
          return { data: { body: params.body } };
        },
        create: async (params: Record<string, unknown>) => {
          record("create", params);
          maybeFailTransiently("create");
          const alert: Alert = {
            number: 42,
            title: String(params.title),
            state: "open",
            comments: [],
          };
          openAlerts.push(alert);
          maybeFailAfterAcceptance("create");
          return { data: alert };
        },
        get: async (params: Record<string, unknown>) => {
          record("get", params);
          maybeFailTransiently("get");
          const alert = openAlerts.find(
            (candidate) => candidate.number === params.issue_number,
          );
          assert.ok(alert, `Alert not found: ${params.issue_number}`);
          return { data: alert };
        },
        update: async (params: Record<string, unknown>) => {
          record("update", params);
          maybeFailTransiently("update");
          const alert = openAlerts.find(
            (candidate) => candidate.number === params.issue_number,
          );
          assert.ok(alert, `Alert not found: ${params.issue_number}`);
          if (params.state === "closed") {
            alert.state = "closed";
          }
          maybeFailAfterAcceptance("update");
          return { data: alert };
        },
      },
    },
  };

  return { calls, github };
}

async function runEmbeddedScript(
  stepName: string,
  env: Record<string, string>,
  openAlerts: Alert[],
  transientFailures: Partial<Record<string, number>> = {},
  acceptedWriteThenErrors: Partial<Record<string, number>> = {},
) {
  const { calls, github } = createGitHubMock(
    openAlerts,
    transientFailures,
    acceptedWriteThenErrors,
  );
  const infoMessages: string[] = [];
  const warningMessages: string[] = [];
  const errorMessages: string[] = [];
  const script = new Script(
    `(async () => {\n${getEmbeddedScript(stepName)}\n})()`,
  );

  await script.runInNewContext({
    process: { env },
    github,
    context: { repo: { owner: "SafeNetInc", repo: "SafeNet-DNS" } },
    core: {
      info: (message: string) => infoMessages.push(message),
      warning: (message: string) => warningMessages.push(message),
      error: (message: string) => errorMessages.push(message),
    },
    setTimeout: (callback: () => void) => callback(),
  });

  return { calls, infoMessages, warningMessages, errorMessages };
}

test("failure alert script creates a labeled alert with run and evidence links", async () => {
  const alerts: Alert[] = [];
  const runUrl =
    "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12345";
  const evidenceUrl =
    "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12345/artifacts/67890";

  const { calls } = await runEmbeddedScript(
    failureStep,
    {
      ALERT_TITLE: "[Maintainer alert] Scheduled public DNS smoke failure",
      RUN_URL: runUrl,
      EVIDENCE_URL: evidenceUrl,
    },
    alerts,
  );

  const createCall = calls.find((call) => call.method === "create");
  assert.ok(createCall);
  assert.equal(
    createCall.params.title,
    "[Maintainer alert] Scheduled public DNS smoke failure",
  );
  assert.equal(
    (createCall.params.labels as string[]).join(","),
    "maintainer-alert",
  );
  assert.match(String(createCall.params.body), /failed/);
  assert.match(String(createCall.params.body), new RegExp(runUrl));
  assert.match(String(createCall.params.body), new RegExp(evidenceUrl));
  assert.equal(alerts[0]?.state, "open");
});

test("failure alert retries a transient GitHub error without changing the failure notification", async () => {
  const alerts: Alert[] = [];

  const { calls, infoMessages, warningMessages } = await runEmbeddedScript(
    failureStep,
    {
      ALERT_TITLE: "[Maintainer alert] Scheduled public DNS smoke failure",
      RUN_URL: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12347",
      EVIDENCE_URL: "",
    },
    alerts,
    { create: 1 },
  );

  assert.equal(
    calls.filter((call) => call.method === "create").length,
    2,
  );
  assert.equal(alerts.length, 1);
  assert.match(String(calls.at(-1)?.params.body), /failed/);
  assert.doesNotMatch(String(calls.at(-1)?.params.body), /recovered/);
  assert.ok(
    warningMessages.some((message) =>
      message.includes("Failure alert: create issue"),
    ),
  );
  assert.ok(
    infoMessages.some((message) =>
      message.includes("Failure alert: create issue succeeded after 2 attempts"),
    ),
  );
});

test("failure alert reconciles an accepted issue when the create response is lost", async () => {
  const alerts: Alert[] = [];

  const { calls, infoMessages } = await runEmbeddedScript(
    failureStep,
    {
      ALERT_TITLE: "[Maintainer alert] Scheduled public DNS smoke failure",
      RUN_URL: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12349",
      EVIDENCE_URL: "",
    },
    alerts,
    {},
    { create: 1 },
  );

  assert.equal(calls.filter((call) => call.method === "create").length, 1);
  assert.equal(calls.filter((call) => call.method === "listForRepo").length, 2);
  assert.equal(alerts.length, 1);
  assert.ok(
    infoMessages.some((message) =>
      message.includes("Failure alert: create issue response was ambiguous; reconciled with GitHub"),
    ),
  );
});

test("failure alert does not duplicate an accepted comment when the response is lost", async () => {
  const alerts: Alert[] = [
    {
      number: 9,
      title: "[Maintainer alert] Scheduled public DNS smoke failure",
      state: "open",
      comments: [],
    },
  ];

  const { calls } = await runEmbeddedScript(
    failureStep,
    {
      ALERT_TITLE: alerts[0].title,
      RUN_URL: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12350",
      EVIDENCE_URL: "",
    },
    alerts,
    {},
    { createComment: 1 },
  );

  assert.equal(calls.filter((call) => call.method === "createComment").length, 1);
  assert.equal(calls.filter((call) => call.method === "listComments").length, 1);
  assert.equal(alerts[0].comments.length, 1);
});

test("public recovery comments with the successful run URL before closing", async () => {
  const alerts: Alert[] = [
    {
      number: 7,
      title: "[Maintainer alert] Scheduled public DNS smoke failure",
      state: "open",
      comments: [],
    },
  ];
  const runUrl =
    "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12346";

  const { calls } = await runEmbeddedScript(
    recoveryStep,
    {
      ALERT_TITLE: alerts[0].title,
      RUN_URL: runUrl,
    },
    alerts,
  );

  const commentIndex = calls.findIndex((call) => call.method === "createComment");
  const updateIndex = calls.findIndex((call) => call.method === "update");
  assert.ok(commentIndex >= 0);
  assert.ok(updateIndex > commentIndex);
  assert.match(String(calls[commentIndex].params.body), /recovered successfully/);
  assert.match(
    String(calls[commentIndex].params.body),
    new RegExp(`Successful workflow run: \\[View run\\]\\(${runUrl}\\)`),
  );
  assert.equal(alerts[0].state, "closed");
});

test("recovery alert retries a transient GitHub error while preserving recovery semantics", async () => {
  const alerts: Alert[] = [
    {
      number: 8,
      title: "[Maintainer alert] Scheduled public DNS smoke failure",
      state: "open",
      comments: [],
    },
  ];

  const { calls, infoMessages, warningMessages } = await runEmbeddedScript(
    recoveryStep,
    {
      ALERT_TITLE: alerts[0].title,
      RUN_URL: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12348",
    },
    alerts,
    { createComment: 1 },
  );

  assert.equal(
    calls.filter((call) => call.method === "createComment").length,
    2,
  );
  assert.equal(alerts[0].comments.length, 1);
  assert.match(alerts[0].comments[0], /recovered successfully/);
  assert.equal(alerts[0].state, "closed");
  assert.ok(
    warningMessages.some((message) =>
      message.includes("Recovery alert: comment on recovered alert"),
    ),
  );
  assert.ok(
    infoMessages.some((message) =>
      message.includes(
        "Recovery alert: comment on recovered alert succeeded after 2 attempts",
      ),
    ),
  );
});

test("recovery reconciles accepted comment and closure writes when responses are lost", async () => {
  const alerts: Alert[] = [
    {
      number: 10,
      title: "[Maintainer alert] Scheduled public DNS smoke failure",
      state: "open",
      comments: [],
    },
  ];

  const { calls, infoMessages } = await runEmbeddedScript(
    recoveryStep,
    {
      ALERT_TITLE: alerts[0].title,
      RUN_URL: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12351",
    },
    alerts,
    {},
    { createComment: 1, update: 1 },
  );

  assert.equal(calls.filter((call) => call.method === "createComment").length, 1);
  assert.equal(calls.filter((call) => call.method === "listComments").length, 1);
  assert.equal(calls.filter((call) => call.method === "update").length, 1);
  assert.equal(calls.filter((call) => call.method === "get").length, 1);
  assert.equal(alerts[0].comments.length, 1);
  assert.equal(alerts[0].state, "closed");
  assert.ok(
    infoMessages.some((message) =>
      message.includes("Recovery alert: comment on recovered alert response was ambiguous; reconciled with GitHub"),
    ),
  );
  assert.ok(
    infoMessages.some((message) =>
      message.includes("Recovery alert: close recovered alert response was ambiguous; reconciled with GitHub"),
    ),
  );
});

test("controlled-fixture workflow runs skip public DNS alert actions", () => {
  const failureCondition = getStepCondition(failureStep);
  const recoveryCondition = getStepCondition(recoveryStep);

  assert.match(failureCondition, /github\.event_name == 'schedule'/);
  assert.match(recoveryCondition, /github\.event_name == 'schedule'/);
  assert.match(failureCondition, /^always\(\) &&/);
  assert.match(recoveryCondition, /^always\(\) &&/);
  assert.match(failureCondition, /DNS_ALERT_VALIDATION == 'lifecycle'/);
  assert.match(recoveryCondition, /DNS_ALERT_VALIDATION == 'lifecycle'/);
  assert.match(failureCondition, /ANDROID_SMOKE_COVERAGE == 'external-network'/);
  assert.match(recoveryCondition, /ANDROID_SMOKE_COVERAGE == 'external-network'/);
  assert.ok(
    workflow.includes(
      "ANDROID_SMOKE_COVERAGE: ${{ github.event_name == 'schedule' && 'external-network' || github.event.inputs.android_resolver_mode == 'public' && 'external-network' || 'controlled-fixture' }}",
    ),
  );
  assert.ok(
    workflow.includes(
      "DNS_ALERT_VALIDATION: ${{ github.event_name == 'workflow_dispatch' && github.event.inputs.dns_alert_validation || 'none' }}",
    ),
  );
  assert.match(workflow, /dns_alert_validation:\n\s+description: "Maintainer-only DNS alert lifecycle validation"/);
  assert.match(workflow, /default: none\n\s+type: choice\n\s+options:\n\s+- none\n\s+- lifecycle/);
  assert.match(
    workflow,
    /continue-on-error: \$\{\{ github\.event_name == 'schedule' \|\| env\.DNS_ALERT_VALIDATION == 'lifecycle' \}\}/,
  );
});

test("manual lifecycle validation runs failure and recovery against one GitHub alert", async () => {
  const alerts: Alert[] = [];
  const title = "[Maintainer alert] Scheduled public DNS smoke failure";

  const failureResult = await runEmbeddedScript(
    failureStep,
    {
      ALERT_TITLE: title,
      RUN_URL: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12352",
      EVIDENCE_URL:
        "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12352/artifacts/67891",
    },
    alerts,
  );
  const recoveryResult = await runEmbeddedScript(
    recoveryStep,
    {
      ALERT_TITLE: title,
      RUN_URL: "https://github.com/SafeNetInc/SafeNet-DNS/actions/runs/12352",
    },
    alerts,
  );

  assert.equal(failureResult.calls.filter((call) => call.method === "create").length, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.state, "closed");
  assert.equal(alerts[0]?.comments.length, 1);
  assert.match(alerts[0]?.comments[0] ?? "", /recovered successfully/);
  assert.ok(
    recoveryResult.calls.find(
      (call) =>
        call.method === "createComment" &&
        String(call.params.body).includes("Successful workflow run"),
    ),
  );
  assert.ok(
    recoveryResult.calls.find(
      (call) => call.method === "update" && call.params.state === "closed",
    ),
  );
});
