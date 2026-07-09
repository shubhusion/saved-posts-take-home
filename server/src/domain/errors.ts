/**
 * Domain errors are HTTP-agnostic: services express *what* went wrong in
 * business terms, and the controller layer owns the translation to status
 * codes. This is the "controllers convert domain errors to HTTP" rule from
 * the architecture blueprint.
 */

export class DomainError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const unauthenticated = (msg = "Authentication required") =>
  new DomainError("UNAUTHENTICATED", msg);

export const forbidden = (msg = "You do not have access to this resource") =>
  new DomainError("FORBIDDEN", msg);

export const notFound = (msg = "Resource not found") =>
  new DomainError("NOT_FOUND", msg);
