import { z } from "zod";
import {
  EventSchema,
  Event,
  EmbeddingAttributes,
  VectorOpAttributes,
  ChainAttributes,
  ToolCallAttributes,
  LlmCallAttributes,
} from "./event.schema.js";

const attributeSchemaByType: Partial<
  Record<Event["type"], z.ZodTypeAny>
> = {
  embedding: EmbeddingAttributes,
  vector_op: VectorOpAttributes,
  chain: ChainAttributes,
  tool_call: ToolCallAttributes,
  llm_call: LlmCallAttributes,
};

export class EventValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = "EventValidationError";
  }
}

export function validateEvent(raw: unknown): Event {
  const envelopeResult = EventSchema.safeParse(raw);
  if (!envelopeResult.success) {
    throw new EventValidationError(
      "Event failed envelope validation",
      envelopeResult.error.issues,
    );
  }

  const event = envelopeResult.data;
  const attrSchema = attributeSchemaByType[event.type];

  if (attrSchema) {
    const attrResult = attrSchema.safeParse(event.attributes);
    if (!attrResult.success) {
      throw new EventValidationError(
        `Event attributes failed validation for type "${event.type}"`,
        attrResult.error.issues,
      );
    }
  }

  if (event.type === "chain" && !event.trace_id) {
    throw new EventValidationError(
      'Event of type "chain" must carry a trace_id to nest under its parent trace',
      [],
    );
  }

  return event;
}

export function safeValidateEvent(
  raw: unknown,
):
  | { ok: true; event: Event }
  | { ok: false; error: EventValidationError } {
  try {
    return { ok: true, event: validateEvent(raw) };
  } catch (err) {
    if (err instanceof EventValidationError) {
      return { ok: false, error: err };
    }
    throw err;
  }
}