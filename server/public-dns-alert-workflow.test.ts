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

function createGitHubMock(openAlerts: Alert[]) {
  const calls: GitHubCall[] = [];
  const record = (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
  };

  const github = {
    rest: {
      issues: {
        getLabel: async (params: Record<string, unknown>) => {
          record("getLabel", params);
          return { data: { name: params.name } };
        },
        createLabel: async (params: Record<string, unknown>) => {
          record("createLabel", params);
          return { data: { name: params.name } };
        },
        listForRepo: async (params: Record<string, unknown>) => {
          record("listForRepo", params);
          return { data: openAlerts.filter((alert) => alert.state === "open") };
        },
        createComment: async (params: Record<string, unknown>) => {
          record("createComment", params);
          const alert = openAlerts.find(
            (candidate) => candidate.number === params.issue_number,
          );
          assert.ok(alert, `Alert not found: ${params.issue_number}`);
          alert.comments.push(String(params.body));
          return { data: { body: params.body } };
        },
        create: async (params: Record<string, unknown>) => {
          record("create", params);
          const alert: Alert = {
            number: 42,
            title: String(params.title),
            state: "open",
            comments: [],
          };
          openAlerts.push(alert);
          return { data: alert };
        },
        update: async (params: Record<string, unknown>) => {
          record("update", params);
          const alert = openAlerts.find(
            (candidate) => candidate.number === params.issue_number,
          );
          assert.ok(alert, `Alert not found: ${params.issue_number}`);
          if (params.state === "closed") {
            alert.state = "closed";
          }
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
) {
  const { calls, github } = createGitHubMock(openAlerts);
  const infoMessages: string[] = [];
  const script = new Script(
    `(async () => {\n${getEmbeddedScript(stepName)}\n})()`,
  );

  await script.runInNewContext({
    process: { env },
    github,
    context: { repo: { owner: "SafeNetInc", repo: "SafeNet-DNS" } },
    core: { info: (message: string) => infoMessages.push(message) },
  });

  return { calls, infoMessages };
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

test("controlled-fixture workflow runs skip public DNS alert actions", () => {
  const failureCondition = getStepCondition(failureStep);
  const recoveryCondition = getStepCondition(recoveryStep);

  assert.match(failureCondition, /github\.event_name == 'schedule'/);
  assert.match(recoveryCondition, /github\.event_name == 'schedule'/);
  assert.match(failureCondition, /ANDROID_SMOKE_COVERAGE == 'external-network'/);
  assert.match(recoveryCondition, /ANDROID_SMOKE_COVERAGE == 'external-network'/);
  assert.ok(
    workflow.includes(
      "ANDROID_SMOKE_COVERAGE: ${{ github.event_name == 'schedule' && 'external-network' || github.event.inputs.android_resolver_mode == 'public' && 'external-network' || 'controlled-fixture' }}",
    ),
  );
});