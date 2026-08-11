import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import * as apiClient from "../lib/api-client";
import CheckoutPage from "./checkout-page";

const products = [
  {
    id: "6dfa1297-43f9-49ce-8b84-94e4c88ee38f",
    sku: "CASE-IP15-CLR",
    name: "Capinha Transparente",
    description: "Proteção leve",
    priceCents: 4990,
    availableStock: 8,
  },
  {
    id: "59755db2-e6be-4ed3-a32d-58009e36b6f0",
    sku: "CASE-IP15-BLK",
    name: "Capinha Impact",
    description: "Proteção reforçada",
    priceCents: 7990,
    availableStock: 5,
  },
];

const pendingOrder = {
  id: "b3bf1364-fe46-43cc-9248-e5e5c2196e02",
  productId: products[1].id,
  quantity: 2,
  status: "PENDING" as const,
  failureCode: null,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
};

const pollIntervalMs = 1_000;
const pollingWindowMs = 30_000;

function mockProducts(onRequest?: () => void) {
  server.use(
    http.get(/\/api\/products$/, () => {
      onRequest?.();
      return HttpResponse.json({ items: products });
    }),
  );
}

async function chooseSecondProductAndQuantity(quantity = "2") {
  const user = userEvent.setup();
  const secondProduct = await screen.findByRole("radio", {
    name: /Capinha Impact/i,
  });
  await user.click(secondProduct);

  const quantityInput = screen.getByRole("spinbutton", {
    name: /Quantidade/i,
  });
  await user.clear(quantityInput);
  await user.type(quantityInput, quantity);

  return { user, secondProduct, quantityInput };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("CheckoutPage", () => {
  it("submits exactly the selected product, quantity, and a UUID key", async () => {
    mockProducts();
    let observedBody: unknown;
    let observedKey: string | null = null;
    let requestCount = 0;

    server.use(
      http.post(/\/api\/orders$/, async ({ request }) => {
        requestCount += 1;
        observedBody = await request.json();
        observedKey = request.headers.get("Idempotency-Key");
        return HttpResponse.json(
          { replayed: false, order: pendingOrder },
          { status: 202 },
        );
      }),
    );

    render(<CheckoutPage />);
    const { user } = await chooseSecondProductAndQuantity();
    await user.click(screen.getByRole("button", { name: /Comprar/i }));

    await waitFor(() => expect(requestCount).toBe(1));
    expect(observedBody).toEqual({
      productId: products[1].id,
      quantity: 2,
    });
    expect(observedKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(
      (screen.getByRole("button", { name: /Comprar/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(
      /Processando pedido/i,
    );
  });

  it("allows only one logical request during rapid clicks", async () => {
    mockProducts();
    let requestCount = 0;
    let releasePost!: () => void;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });

    server.use(
      http.post(/\/api\/orders$/, async () => {
        requestCount += 1;
        await postGate;
        return HttpResponse.json(
          {
            replayed: false,
            order: {
              ...pendingOrder,
              status: "FAILED",
              failureCode: "TEMPORARY_ERP_FAILURE",
            },
          },
          { status: 202 },
        );
      }),
    );

    render(<CheckoutPage />);
    await chooseSecondProductAndQuantity();
    const purchaseButton = screen.getByRole("button", { name: /Comprar/i });

    fireEvent.click(purchaseButton);
    fireEvent.click(purchaseButton);

    await waitFor(() => expect(requestCount).toBe(1));
    expect((purchaseButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(
      /Processando pedido/i,
    );

    releasePost();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveProperty(
        "textContent",
        "O processamento falhou temporariamente. Tente novamente.",
      ),
    );
  });

  it("rejects a non-positive safe integer before sending a request", async () => {
    mockProducts();
    let requestCount = 0;
    server.use(
      http.post(/\/api\/orders$/, () => {
        requestCount += 1;
        return HttpResponse.json(
          { replayed: false, order: pendingOrder },
          { status: 202 },
        );
      }),
    );

    render(<CheckoutPage />);
    await screen.findByRole("radio", { name: /Capinha Transparente/i });
    const quantityInput = screen.getByRole("spinbutton", {
      name: /Quantidade/i,
    });
    fireEvent.change(quantityInput, {
      target: { value: "9007199254740992" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Comprar/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Informe uma quantidade inteira positiva válida.",
    );
    expect(requestCount).toBe(0);
    expect((quantityInput as HTMLInputElement).value).toBe(
      "9007199254740992",
    );
  });

  it.each([
    [
      "VALIDATION_ERROR",
      "Revise os dados e informe uma quantidade inteira positiva.",
    ],
    ["PRODUCT_NOT_FOUND", "O produto selecionado não está mais disponível."],
    [
      "INSUFFICIENT_STOCK",
      "Estoque insuficiente para a quantidade solicitada.",
    ],
    [
      "IDEMPOTENCY_KEY_REUSED",
      "Esta tentativa duplicada foi enviada com dados diferentes.",
    ],
  ])("shows the %s message and retains form state", async (code, message) => {
    const observedKeys: string[] = [];
    mockProducts();
    server.use(
      http.post(/\/api\/orders$/, ({ request }) => {
        observedKeys.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json(
          {
            code,
            message: "Mensagem da API",
            correlationId: "9d5daf1b-92b1-4373-a0c0-c6c002d417d7",
          },
          {
            status:
              code === "VALIDATION_ERROR"
                ? 400
                : code === "PRODUCT_NOT_FOUND"
                  ? 404
                  : 409,
          },
        );
      }),

    );
    render(<CheckoutPage />);
    const { user, secondProduct, quantityInput } =
      await chooseSecondProductAndQuantity();
    await user.click(screen.getByRole("button", { name: /Comprar/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      message,
    );
    expect((secondProduct as HTMLInputElement).checked).toBe(true);
    expect((quantityInput as HTMLInputElement).value).toBe("2");
    expect(
      (screen.getByRole("button", { name: /Comprar/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: /Comprar/i }));
    await waitFor(() => expect(observedKeys).toHaveLength(2));
    expect(observedKeys[1]).not.toBe(observedKeys[0]);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveProperty("textContent", message),
    );
  });

  it.each([
    ["transport", new TypeError("Failed to fetch")],
    [
      "500 INTERNAL_ERROR",
      {
        code: "INTERNAL_ERROR",
        message: "Falha interna.",
        correlationId: "eb32958e-d286-49d9-9b41-37680fa10eee",
      },
    ],
  ])("resubmits the same payload and key after %s", async (_label, error) => {
    vi.spyOn(apiClient, "listProducts").mockResolvedValue({ items: products });
    const createOrder = vi
      .spyOn(apiClient, "createOrder")
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        replayed: true,
        order: { ...pendingOrder, status: "COMPLETED" },
      });

    render(<CheckoutPage />);
    await flushEffects();
    const { user } = await chooseSecondProductAndQuantity();
    const purchaseButton = screen.getByRole("button", { name: /Comprar/i });
    await user.click(purchaseButton);
    const retryButton = await screen.findByRole("button", {
      name: /Tentar novamente/i,
    });

    expect(purchaseButton).toHaveProperty("disabled", true);
    const form = purchaseButton.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    await flushEffects();
    expect(createOrder).toHaveBeenCalledTimes(1);

    await user.click(retryButton);

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1]?.[0]).toEqual(
      createOrder.mock.calls[0]?.[0],
    );
    expect(createOrder.mock.calls[1]?.[1]).toBe(
      createOrder.mock.calls[0]?.[1],
    );
    expect(
      await screen.findByText(/compra já havia sido recebida/i),
    ).not.toBeNull();
  });

  it("allows a fresh key only after checkout details change following an unknown result", async () => {
    vi.spyOn(apiClient, "listProducts").mockResolvedValue({ items: products });
    const createOrder = vi
      .spyOn(apiClient, "createOrder")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        replayed: false,
        order: { ...pendingOrder, status: "COMPLETED" },
      });

    render(<CheckoutPage />);
    await flushEffects();
    const { user, quantityInput } = await chooseSecondProductAndQuantity();
    await user.click(screen.getByRole("button", { name: /Comprar/i }));
    await screen.findByRole("button", { name: /Tentar novamente/i });

    fireEvent.change(quantityInput, { target: { value: "3" } });
    expect(
      screen.queryByRole("button", { name: /Tentar novamente/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Comprar/i }),
    ).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: /Comprar/i }));

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    expect(createOrder.mock.calls[1]?.[0]).toEqual({
      productId: products[1].id,
      quantity: 3,
    });
    expect(createOrder.mock.calls[1]?.[1]).not.toBe(
      createOrder.mock.calls[0]?.[1],
    );
  });

  it("distinguishes an idempotent replay and keeps submission locked", async () => {
    mockProducts();
    server.use(
      http.post(/\/api\/orders$/, () =>
        HttpResponse.json(
          { replayed: true, order: pendingOrder },
          { status: 200 },
        ),
      ),
    );

    render(<CheckoutPage />);
    const { user } = await chooseSecondProductAndQuantity();
    await user.click(screen.getByRole("button", { name: /Comprar/i }));

    expect(await screen.findByText(/compra já havia sido recebida/i)).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: /Comprar/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows temporary ERP failure and retains product and quantity", async () => {
    mockProducts();
    const observedKeys: string[] = [];
    const observedBodies: unknown[] = [];
    server.use(
      http.post(/\/api\/orders$/, async ({ request }) => {
        observedKeys.push(request.headers.get("Idempotency-Key") ?? "");
        observedBodies.push(await request.json());
        const status = observedKeys.length === 1 ? "FAILED" : "COMPLETED";
        return HttpResponse.json({
          replayed: observedKeys.length > 1,
          order: {
            ...pendingOrder,
            status,
            failureCode:
              status === "FAILED" ? "TEMPORARY_ERP_FAILURE" : null,
          },
        });
      }),
    );

    render(<CheckoutPage />);
    const { user, secondProduct, quantityInput } =
      await chooseSecondProductAndQuantity();
    await user.click(screen.getByRole("button", { name: /Comprar/i }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "O processamento falhou temporariamente. Tente novamente.",
    );
    expect((secondProduct as HTMLInputElement).checked).toBe(true);
    expect((quantityInput as HTMLInputElement).value).toBe("2");

    await user.click(screen.getByRole("button", { name: /Tentar novamente/i }));
    await waitFor(() => expect(observedKeys).toHaveLength(2));
    expect(observedKeys[1]).not.toBe(observedKeys[0]);
    expect(observedBodies[1]).toEqual(observedBodies[0]);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveProperty(
        "textContent",
        "Compra concluída com sucesso.",
      ),
    );
  });

  it("polls PENDING through PROCESSING to COMPLETED, then stops and refreshes the catalog", async () => {
    vi.useFakeTimers();
    const listProducts = vi
      .spyOn(apiClient, "listProducts")
      .mockResolvedValue({ items: products });
    vi.spyOn(apiClient, "createOrder").mockResolvedValue({
      replayed: false,
      order: pendingOrder,
    });
    const getOrder = vi
      .spyOn(apiClient, "getOrder")
      .mockResolvedValueOnce(pendingOrder)
      .mockResolvedValueOnce({ ...pendingOrder, status: "PROCESSING" })
      .mockResolvedValueOnce({ ...pendingOrder, status: "COMPLETED" });

    render(<CheckoutPage />);
    await flushEffects();
    fireEvent.click(screen.getByRole("radio", { name: /Capinha Impact/i }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /Quantidade/i }),
      { target: { value: "2" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Comprar/i }));
    await flushEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollIntervalMs * 3);
    });

    expect(getOrder).toHaveBeenCalledTimes(3);
    expect(listProducts).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveProperty(
      "textContent",
      "Compra concluída com sucesso.",
    );
    expect(
      (screen.getByRole("spinbutton", {
        name: /Quantidade/i,
      }) as HTMLInputElement).value,
    ).toBe("1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollIntervalMs * 2);
    });
    expect(getOrder).toHaveBeenCalledTimes(3);
    const pollingSignal = getOrder.mock.calls[0]?.[1];
    expect(pollingSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses after the polling window and resumes the same order with GET only", async () => {
    vi.useFakeTimers();
    vi.spyOn(apiClient, "listProducts").mockResolvedValue({ items: products });
    const createOrder = vi.spyOn(apiClient, "createOrder").mockResolvedValue({
      replayed: false,
      order: pendingOrder,
    });
    const getOrder = vi
      .spyOn(apiClient, "getOrder")
      .mockResolvedValue(pendingOrder);

    render(<CheckoutPage />);
    await flushEffects();
    fireEvent.click(screen.getByRole("button", { name: /Comprar/i }));
    await flushEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollingWindowMs);
    });

    expect(
      screen.getByRole("button", { name: /Comprar/i }),
    ).toHaveProperty("disabled", true);
    const resumeButton = screen.getByRole("button", {
      name: /Consultar novamente/i,
    });
    expect(screen.getByRole("status")).toHaveProperty(
      "textContent",
      "O pedido ainda está em processamento. Consulte novamente em instantes.",
    );
    const previousPollingSignal = getOrder.mock.calls[0]?.[1];
    expect(previousPollingSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(resumeButton);
    await flushEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollIntervalMs);
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(getOrder.mock.calls.at(-1)?.[0]).toBe(pendingOrder.id);
    const resumedPollingSignal = getOrder.mock.calls.at(-1)?.[1];
    expect(resumedPollingSignal).not.toBe(previousPollingSignal);
    expect(resumedPollingSignal?.aborted).toBe(false);
  });

  it("aborts a never-settling GET and pauses exactly at the polling deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(apiClient, "listProducts").mockResolvedValue({ items: products });
    vi.spyOn(apiClient, "createOrder").mockResolvedValue({
      replayed: false,
      order: pendingOrder,
    });
    const getOrder = vi
      .spyOn(apiClient, "getOrder")
      .mockImplementation((_orderId, signal) => {
        const { promise, reject } = Promise.withResolvers<never>();
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
        return promise;
      });

    render(<CheckoutPage />);
    await flushEffects();
    fireEvent.click(screen.getByRole("button", { name: /Comprar/i }));
    await flushEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollingWindowMs - 1);
    });

    expect(getOrder).toHaveBeenCalledTimes(1);
    const pollingSignal = getOrder.mock.calls[0]?.[1];
    expect(pollingSignal?.aborted).toBe(false);
    expect(
      screen.queryByRole("button", { name: /Consultar novamente/i }),
    ).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(pollingSignal?.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveProperty(
      "textContent",
      "O pedido ainda está em processamento. Consulte novamente em instantes.",
    );
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollingWindowMs);
    });
    expect(getOrder).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses after consecutive polling failures and aborts the failed poller", async () => {
    vi.useFakeTimers();
    vi.spyOn(apiClient, "listProducts").mockResolvedValue({ items: products });
    vi.spyOn(apiClient, "createOrder").mockResolvedValue({
      replayed: false,
      order: pendingOrder,
    });
    const getOrder = vi
      .spyOn(apiClient, "getOrder")
      .mockRejectedValue(new TypeError("Failed to fetch"));

    render(<CheckoutPage />);
    await flushEffects();
    fireEvent.click(screen.getByRole("button", { name: /Comprar/i }));
    await flushEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollIntervalMs * 3);
    });

    expect(getOrder).toHaveBeenCalledTimes(3);
    expect(
      screen.getByRole("button", { name: /Consultar novamente/i }),
    ).not.toBeNull();
    const pollingSignal = getOrder.mock.calls[0]?.[1];
    expect(pollingSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an in-flight GET and clears polling timers on unmount", async () => {
    vi.useFakeTimers();
    vi.spyOn(apiClient, "listProducts").mockResolvedValue({ items: products });
    vi.spyOn(apiClient, "createOrder").mockResolvedValue({
      replayed: false,
      order: pendingOrder,
    });
    const getOrder = vi
      .spyOn(apiClient, "getOrder")
      .mockImplementation((_orderId, signal) => {
        const { promise, reject } = Promise.withResolvers<never>();
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
        return promise;
      });

    const view = render(<CheckoutPage />);
    await flushEffects();
    fireEvent.click(screen.getByRole("button", { name: /Comprar/i }));
    await flushEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(pollIntervalMs);
    });

    expect(getOrder).toHaveBeenCalledTimes(1);
    const pollingSignal = getOrder.mock.calls[0]?.[1];
    expect(pollingSignal?.aborted).toBe(false);
    view.unmount();
    await flushEffects();

    expect(pollingSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(pollingWindowMs);
    expect(getOrder).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows success, refreshes products, and resets only the quantity", async () => {
    let productRequestCount = 0;
    mockProducts(() => {
      productRequestCount += 1;
    });
    server.use(
      http.post(/\/api\/orders$/, () =>
        HttpResponse.json({
          replayed: true,
          order: {
            ...pendingOrder,
            status: "COMPLETED",
          },
        }),
      ),
    );

    render(<CheckoutPage />);
    const { user, secondProduct, quantityInput } =
      await chooseSecondProductAndQuantity();
    await user.click(screen.getByRole("button", { name: /Comprar/i }));

    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Compra concluída com sucesso.",
    );
    await waitFor(() => expect(productRequestCount).toBe(2));
    expect((quantityInput as HTMLInputElement).value).toBe("1");
    expect((secondProduct as HTMLInputElement).checked).toBe(true);
  });
});
