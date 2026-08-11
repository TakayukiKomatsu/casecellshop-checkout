import { expect, test, type Page, type Request } from "@playwright/test";

const SEEDED_PRODUCT = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Capinha Crystal Galaxy S24",
  initialStock: 3,
};

interface CreateOrderBody {
  replayed: boolean;
  order: {
    id: string;
    productId: string;
    quantity: number;
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  };
}

let browserErrors: string[];

test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Escolha sua capinha" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: new RegExp(SEEDED_PRODUCT.name) }),
  ).toBeVisible();
});

test.afterEach(() => {
  expect(browserErrors, "browser console and page errors").toEqual([]);
});

function captureOrderRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/orders" || path.startsWith("/api/orders/")) {
      requests.push(request);
    }
  });
  return requests;
}

function productCard(page: Page) {
  return page
    .getByRole("listitem")
    .filter({ hasText: SEEDED_PRODUCT.name });
}

test("@success submits the seeded product and exact quantity, then decrements stock", async ({
  page,
}) => {
  const orderRequests = captureOrderRequests(page);
  const product = page.getByRole("radio", {
    name: new RegExp(SEEDED_PRODUCT.name),
  });
  const quantity = page.getByRole("spinbutton", { name: "Quantidade" });
  const buy = page.getByRole("button", { name: "Comprar" });

  await expect(productCard(page)).toContainText(
    `${SEEDED_PRODUCT.initialStock} em estoque`,
  );
  await product.check();
  await quantity.fill("2");

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/orders",
  );
  await buy.click();

  await expect(buy).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "Processando pedido. Aguarde." }),
  ).toBeVisible();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(202);
  const created = (await createResponse.json()) as CreateOrderBody;
  expect(created.order.productId).toBe(SEEDED_PRODUCT.id);
  expect(created.order.quantity).toBe(2);

  const createRequest = createResponse.request();
  expect(createRequest.postDataJSON()).toEqual({
    productId: SEEDED_PRODUCT.id,
    quantity: 2,
  });
  expect(createRequest.headers()["idempotency-key"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await expect(
    page.getByRole("status").filter({ hasText: "Compra concluída com sucesso." }),
  ).toBeVisible();
  await expect(productCard(page)).toContainText("1 em estoque");
  await expect(quantity).toHaveValue("1");
  expect(
    orderRequests.filter((request) => request.method() === "POST"),
  ).toHaveLength(1);
});

test("@scripted fails first and retries with a new key and new order successfully", async ({
  page,
}) => {
  const orderRequests = captureOrderRequests(page);
  const product = page.getByRole("radio", {
    name: new RegExp(SEEDED_PRODUCT.name),
  });
  const quantity = page.getByRole("spinbutton", { name: "Quantidade" });

  await product.check();
  await quantity.fill("2");

  const firstResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/orders",
  );
  await page.getByRole("button", { name: "Comprar" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Processando pedido. Aguarde." }),
  ).toBeVisible();

  const firstResponse = await firstResponsePromise;
  const firstCreated = (await firstResponse.json()) as CreateOrderBody;
  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "O processamento falhou temporariamente. Tente novamente.",
      }),
  ).toBeVisible();
  await expect(product).toBeChecked();
  await expect(quantity).toHaveValue("2");

  const retryResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/orders",
  );
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Processando pedido. Aguarde." }),
  ).toBeVisible();

  const retryResponse = await retryResponsePromise;
  const retryCreated = (await retryResponse.json()) as CreateOrderBody;
  await expect(
    page.getByRole("status").filter({ hasText: "Compra concluída com sucesso." }),
  ).toBeVisible();

  const posts = orderRequests.filter((request) => request.method() === "POST");
  expect(posts).toHaveLength(2);
  expect(posts[0].postDataJSON()).toEqual({
    productId: SEEDED_PRODUCT.id,
    quantity: 2,
  });
  expect(posts[1].postDataJSON()).toEqual(posts[0].postDataJSON());
  expect(posts[1].headers()["idempotency-key"]).not.toBe(
    posts[0].headers()["idempotency-key"],
  );
  expect(retryCreated.order.id).not.toBe(firstCreated.order.id);
  expect(retryCreated.order.productId).toBe(firstCreated.order.productId);
  expect(retryCreated.order.quantity).toBe(firstCreated.order.quantity);
  await expect(productCard(page)).toContainText("1 em estoque");
});

test("@paused resumes a paused order with GET requests only until completion", async ({
  page,
}) => {
  const orderRequests = captureOrderRequests(page);
  const product = page.getByRole("radio", {
    name: new RegExp(SEEDED_PRODUCT.name),
  });
  const quantity = page.getByRole("spinbutton", { name: "Quantidade" });
  const buy = page.getByRole("button", { name: "Comprar" });

  await product.check();
  await quantity.fill("2");

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/orders",
  );
  await buy.click();
  const createResponse = await createResponsePromise;
  const created = (await createResponse.json()) as CreateOrderBody;
  const idempotencyKey = createResponse.request().headers()["idempotency-key"];

  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "O pedido ainda está em processamento." }),
  ).toBeVisible({ timeout: 40_000 });
  await expect(buy).toBeDisabled();

  const getsBeforeResume = orderRequests.filter(
    (request) => request.method() === "GET",
  ).length;
  expect(getsBeforeResume).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Consultar novamente" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "Compra concluída com sucesso." }),
  ).toBeVisible({ timeout: 15_000 });

  expect(idempotencyKey).toBeTruthy();
  expect(orderRequests[0].method()).toBe("POST");
  expect(
    orderRequests.filter((request) => request.method() === "POST"),
  ).toHaveLength(1);
  const statusRequests = orderRequests.slice(1);
  expect(statusRequests.length).toBeGreaterThan(getsBeforeResume);
  for (const request of statusRequests) {
    expect(request.method()).toBe("GET");
    expect(new URL(request.url()).pathname).toBe(
      `/api/orders/${created.order.id}`,
    );
  }
});
