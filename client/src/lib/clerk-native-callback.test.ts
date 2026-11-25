import assert from "node:assert/strict";
import test from "node:test";
import {
  CLERK_ANDROID_CALLBACK_URL,
  getClerkSsoCallbackUrl,
  getNativeClerkCallbackTarget,
} from "./clerk-native-callback";

test("Android Clerk sign-in uses the registered app callback URI", () => {
  assert.equal(
    getClerkSsoCallbackUrl({
      isAndroid: true,
      origin: "https://localhost",
      basePath: "",
    }),
    CLERK_ANDROID_CALLBACK_URL,
  );
});

test("browser Clerk sign-in keeps the same-origin callback route", () => {
  assert.equal(
    getClerkSsoCallbackUrl({
      isAndroid: false,
      origin: "https://safenet.example",
      basePath: "",
    }),
    "https://safenet.example/sign-in/sso-callback",
  );
});

test("the Android app callback is forwarded to the local Clerk callback route", () => {
  assert.equal(
    getNativeClerkCallbackTarget({
      callbackUrl: "com.safenet.dns://callback?__clerk_status=complete&ticket=t",
      origin: "https://localhost",
      basePath: "",
    }),
    "https://localhost/sign-in/sso-callback?__clerk_status=complete&ticket=t",
  );
});

test("the Android app callback preserves a callback hash", () => {
  assert.equal(
    getNativeClerkCallbackTarget({
      callbackUrl: "com.safenet.dns://callback?state=abc#session=xyz",
      origin: "https://localhost",
      basePath: "/app",
    }),
    "https://localhost/app/sign-in/sso-callback?state=abc#session=xyz",
  );
});

test("unrelated or malformed deep links are ignored", () => {
  for (const callbackUrl of [
    "https://evil.example/callback?ticket=t",
    "com.safenet.dns://other?ticket=t",
    "com.safenet.dns://callback/extra?ticket=t",
    "not a URL",
  ]) {
    assert.equal(
      getNativeClerkCallbackTarget({
        callbackUrl,
        origin: "https://localhost",
        basePath: "",
      }),
      undefined,
    );
  }
});
