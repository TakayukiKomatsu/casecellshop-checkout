import type { ApiError } from "../lib/api-types";
import {
  isUnknownSubmissionResult,
  type AttemptState,
} from "./attempt-state";

const errorMessages: Record<string, string> = {
  VALIDATION_ERROR:
    "Revise os dados e informe uma quantidade inteira positiva.",
  PRODUCT_NOT_FOUND: "O produto selecionado não está mais disponível.",
  INSUFFICIENT_STOCK: "Estoque insuficiente para a quantidade solicitada.",
  IDEMPOTENCY_KEY_REUSED:
    "Esta tentativa duplicada foi enviada com dados diferentes.",
  TEMPORARY_ERP_FAILURE:
    "O processamento falhou temporariamente. Tente novamente.",
};

function ErrorFeedback({ error }: { error: ApiError }) {
  const expectedMessage = errorMessages[error.code];
  if (expectedMessage) {
    return <p role="alert">{expectedMessage}</p>;
  }

  return (
    <p role="alert">
      {error.message || "Não foi possível concluir a compra."}
      {error.correlationId ? (
        <>
          {" "}
          Código de suporte: <code>{error.correlationId}</code>
        </>
      ) : null}
    </p>
  );
}

interface OrderFeedbackProps {
  attempt: AttemptState;
  replayed: boolean;
  onResumeTracking: () => void;
  onRetryUnknown: () => void;
  onRetryTerminal: () => void;
}

export default function OrderFeedback({
  attempt,
  replayed,
  onResumeTracking,
  onRetryUnknown,
  onRetryTerminal,
}: OrderFeedbackProps) {
  if (attempt.kind === "idle") {
    return null;
  }

  const replayNotice = replayed ? (
    <p>Esta compra já havia sido recebida. Acompanhando o pedido existente.</p>
  ) : null;

  if (attempt.kind === "submitting" || attempt.kind === "tracking") {
    return (
      <div aria-live="polite">
        {replayNotice}
        <p role="status">Processando pedido. Aguarde.</p>
      </div>
    );
  }

  if (attempt.kind === "tracking_paused") {
    return (
      <div>
        {replayNotice}
        <p role="status">
          O pedido ainda está em processamento. Consulte novamente em instantes.
        </p>
        <button type="button" onClick={onResumeTracking}>
          Consultar novamente
        </button>
      </div>
    );
  }

  if (attempt.kind === "succeeded") {
    return (
      <div>
        {replayNotice}
        <p role="status">Compra concluída com sucesso.</p>
      </div>
    );
  }

  const retryUnknown =
    !attempt.order && isUnknownSubmissionResult(attempt.error);
  const retryTerminal = attempt.order?.status === "FAILED";

  return (
    <div>
      {replayNotice}
      <ErrorFeedback error={attempt.error} />
      {retryUnknown ? (
        <button type="button" onClick={onRetryUnknown}>
          Tentar novamente
        </button>
      ) : null}
      {retryTerminal ? (
        <button type="button" onClick={onRetryTerminal}>
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}
