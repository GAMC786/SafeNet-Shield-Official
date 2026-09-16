import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const projectName = "SafeNet Shield DNS";
const androidPackageName = "com.safenet.dns";
const productIdentifier = "premium_monthly";
const playStoreProductIdentifier = `${productIdentifier}:monthly`;
const entitlementIdentifier = "premium";
const offeringIdentifier = "default";
const packageIdentifier = "$rc_monthly";

type Item = Record<string, any>;
type Collection = { items?: Item[]; [key: string]: unknown };

async function request<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const response = await connectors.proxy("revenuecat", `/v2${path}`, {
    method: options.method,
    body: options.body,
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });
  const responseText = await response.text();
  let payload: (T & { message?: string }) | null = null;
  try {
    payload = responseText ? JSON.parse(responseText) as T & { message?: string } : null;
  } catch {
    throw new Error(
      `RevenueCat ${options.method ?? "GET"} ${path} returned an unreadable response ` +
      `(HTTP ${response.status}): ${responseText.slice(0, 160)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `RevenueCat ${options.method ?? "GET"} ${path} failed with ${response.status}: ${payload?.message ?? "unknown error"}`,
    );
  }
  return payload as T;
}

function items(payload: Collection) {
  return Array.isArray(payload.items) ? payload.items : [];
}

async function ensureProject() {
  const projects = await request<Collection>("/projects?limit=100");
  const existing = items(projects).find((project) => project.name === projectName);
  if (existing) return existing;
  return request<Item>("/projects", {
    method: "POST",
    body: { name: projectName },
  });
}

async function ensureApp(projectId: string, apps: Item[], type: "test_store" | "play_store") {
  const existing = apps.find((app) => app.type === type);
  if (existing) return existing;

  return request<Item>(`/projects/${projectId}/apps`, {
    method: "POST",
    body:
      type === "test_store"
        ? { name: `${projectName} Test Store`, type }
        : {
            name: `${projectName} Android`,
            type,
            play_store: { package_name: androidPackageName },
          },
  });
}

async function ensureProduct(
  projectId: string,
  products: Item[],
  app: Item,
  storeIdentifier: string,
  isTestStore: boolean,
) {
  const existing = products.find(
    (product) => product.app_id === app.id && product.store_identifier === storeIdentifier,
  );
  if (existing) return existing;

  return request<Item>(`/projects/${projectId}/products`, {
    method: "POST",
    body: {
      store_identifier: storeIdentifier,
      app_id: app.id,
      type: "subscription",
      display_name: "SafeNet Shield DNS Server+",
      ...(isTestStore
        ? {
            title: "SafeNet Shield DNS Server+",
            subscription: { duration: "P1M" },
          }
        : {}),
    },
  });
}

async function ensureEntitlement(projectId: string, entitlements: Item[]) {
  const existing = entitlements.find((entitlement) => entitlement.lookup_key === entitlementIdentifier);
  if (existing) return existing;
  return request<Item>(`/projects/${projectId}/entitlements`, {
    method: "POST",
    body: {
      lookup_key: entitlementIdentifier,
      display_name: "SafeNet Premium Access",
    },
  });
}

async function ensureOffering(projectId: string, offerings: Item[]) {
  const existing = offerings.find((offering) => offering.lookup_key === offeringIdentifier);
  if (existing) return existing;
  return request<Item>(`/projects/${projectId}/offerings`, {
    method: "POST",
    body: {
      lookup_key: offeringIdentifier,
      display_name: "SafeNet Premium",
    },
  });
}

async function setup() {
  const project = await ensureProject();
  const projectId = project.id as string;
  const apps = items(await request<Collection>(`/projects/${projectId}/apps?limit=100`));
  const testStore = await ensureApp(projectId, apps, "test_store");
  const playStore = await ensureApp(projectId, apps, "play_store");

  const products = items(await request<Collection>(`/projects/${projectId}/products?limit=100`));
  const testProduct = await ensureProduct(projectId, products, testStore, productIdentifier, true);
  const playProduct = await ensureProduct(
    projectId,
    products,
    playStore,
    playStoreProductIdentifier,
    false,
  );

  try {
    await request(`/projects/${projectId}/products/${testProduct.id}/test_store_prices`, {
      method: "POST",
      body: { prices: [{ amount_micros: 5_000_000, currency: "CAD" }] },
    });
  } catch (error) {
    if (!(error instanceof Error && /already exists|409/i.test(error.message))) throw error;
  }

  const entitlements = items(
    await request<Collection>(`/projects/${projectId}/entitlements?limit=100`),
  );
  const entitlement = await ensureEntitlement(projectId, entitlements);
  try {
    await request(`/projects/${projectId}/entitlements/${entitlement.id}/actions/attach_products`, {
      method: "POST",
      body: { product_ids: [testProduct.id, playProduct.id] },
    });
  } catch (error) {
    if (!(error instanceof Error && /already|unprocessable|attached/i.test(error.message))) throw error;
  }

  const offerings = items(await request<Collection>(`/projects/${projectId}/offerings?limit=100`));
  const offering = await ensureOffering(projectId, offerings);
  if (!offering.is_current) {
    await request(`/projects/${projectId}/offerings/${offering.id}`, {
      method: "POST",
      body: { is_current: true },
    });
  }

  const packages = items(
    await request<Collection>(`/projects/${projectId}/offerings/${offering.id}/packages?limit=100`),
  );
  const pkg =
    packages.find((candidate) => candidate.lookup_key === packageIdentifier) ??
    (await request<Item>(`/projects/${projectId}/offerings/${offering.id}/packages`, {
      method: "POST",
      body: {
        lookup_key: packageIdentifier,
        display_name: "Monthly Subscription",
      },
    }));
  try {
    await request(`/projects/${projectId}/packages/${pkg.id}/actions/attach_products`, {
      method: "POST",
      body: {
        products: [
          { product_id: testProduct.id, eligibility_criteria: "all" },
          { product_id: playProduct.id, eligibility_criteria: "all" },
        ],
      },
    });
  } catch (error) {
    if (!(error instanceof Error && /already|unprocessable|attached/i.test(error.message))) throw error;
  }

  const testKeys = await request<Collection>(
    `/projects/${projectId}/apps/${testStore.id}/public_api_keys`,
  );
  const playKeys = await request<Collection>(
    `/projects/${projectId}/apps/${playStore.id}/public_api_keys`,
  );

  console.log(
    JSON.stringify(
      {
        projectId,
        testStoreAppId: testStore.id,
        playStoreAppId: playStore.id,
        entitlementIdentifier,
        testStoreApiKey: items(testKeys)[0]?.key ?? null,
        androidApiKey: items(playKeys)[0]?.key ?? null,
      },
      null,
      2,
    ),
  );
}

setup().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});