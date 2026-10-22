import { STATUSES, type BookUpdate, type NewBook, type Status } from "./books.ts";
import { HttpError } from "./http.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(input: Record<string, unknown>, field: string, max: number): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "invalid_field", `'${field}' is required`);
  }
  if (value.length > max) {
    throw new HttpError(400, "invalid_field", `'${field}' must be at most ${max} characters`);
  }
  return value.trim();
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
  max: number,
): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new HttpError(
      400,
      "invalid_field",
      `'${field}' must be a string of at most ${max} characters`,
    );
  }
  return value;
}

export function parseStatus(value: unknown, field = "status"): Status {
  if (typeof value === "string" && (STATUSES as readonly string[]).includes(value)) {
    return value as Status;
  }
  throw new HttpError(400, "invalid_field", `'${field}' must be one of ${STATUSES.join(", ")}`);
}

export function parseNewBook(body: unknown): NewBook {
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "Expected a JSON object");
  const year = body.year;
  if (year !== undefined && year !== null && (!Number.isInteger(year) || (year as number) < 0)) {
    throw new HttpError(400, "invalid_field", "'year' must be a non-negative integer");
  }
  return {
    title: requiredString(body, "title", 200),
    author: requiredString(body, "author", 120),
    year: typeof year === "number" ? year : null,
    status: body.status === undefined ? "to-read" : parseStatus(body.status),
    notes: optionalString(body, "notes", 2000) ?? "",
  };
}

export function parseBookUpdate(body: unknown): BookUpdate {
  if (!isRecord(body)) throw new HttpError(400, "invalid_body", "Expected a JSON object");
  const update: BookUpdate = {};
  if (body.status !== undefined) update.status = parseStatus(body.status);
  const notes = optionalString(body, "notes", 2000);
  if (notes !== undefined) update.notes = notes;
  if (Object.keys(update).length === 0) {
    throw new HttpError(400, "invalid_body", "Nothing to update");
  }
  return update;
}
