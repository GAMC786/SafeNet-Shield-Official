import assert from "node:assert/strict";
import test from "node:test";

const originalDsn = process.env.GLITCHTIP_DSN;
const { getGlitchTipClientConfig } = await import("./glitchtip");

test("GlitchTip client config stays disabled without a DSN", () => {
  delete process.env.GLITCHTIP_DSN;
  try {
    const config = getGlitchTipClientConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.dsn, null);
    assert.equal(typeof config.release, "string");
  } finally {
    if (originalDsn === undefined) delete process.env.GLITCHTIP_DSN;
    else process.env.GLITCHTIP_DSN = originalDsn;
  }
});

test("GlitchTip client config exposes only the public DSN and runtime metadata", () => {
  process.env.GLITCHTIP_DSN = "https://public-key@example.glitchtip.test/1";
  try {
    const config = getGlitchTipClientConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.dsn, "https://public-key@example.glitchtip.test/1");
    assert.equal(typeof config.environment, "string");
    assert.equal(typeof config.release, "string");
    assert.equal(Object.keys(config).sort().join(","), "dsn,enabled,environment,release");
  } finally {
    if (originalDsn === undefined) delete process.env.GLITCHTIP_DSN;
    else process.env.GLITCHTIP_DSN = originalDsn;
  }
});