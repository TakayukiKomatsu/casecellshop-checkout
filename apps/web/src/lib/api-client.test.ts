import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { createOrder, getOrder, listProducts } from "./api-client";

const apiError = {
  code: "VALIDATION_ERROR",
  message: "Dados inválidos.",
  correlationId: "8c95f345-2380-4468-91cd-c7c0f734704d",
  details: { field: "quantity" },
};

describe("API client error decoding", () => {
  it("decodes a non-successful product response", async () => {
    server.use(
      http.get(/\/api\/products$/, () =>
        HttpResponse.json(apiError, { status: 500 }),
      ),
    );

    await expect(listProducts()).rejects.toEqual(apiError);
  });

  it("decodes a non-successful create-order response", async () => {
    server.use(
      http.post(/\/api\/orders$/, () =>
        HttpResponse.json(apiError, { status: 400 }),
      ),
    );

    await expect(
      createOrder(
        {
          productId: "e1fa77de-c8d2-4ee6-b424-287b3256b10f",
          quantity: 2,
        },
        "92b15913-95ca-4e69-a8ce-402bac35e14d",
      ),
    ).rejects.toEqual(apiError);
  });

  it("decodes a non-successful order response", async () => {
    server.use(
      http.get(/\/api\/orders\/.+$/, () =>
        HttpResponse.json(apiError, { status: 404 }),
      ),
    );

    await expect(
      getOrder("2911078a-c04c-4f68-a2f6-87829eb853e1"),
    ).rejects.toEqual(apiError);
  });
});
