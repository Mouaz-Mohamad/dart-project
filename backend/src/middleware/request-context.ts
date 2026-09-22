// DART CODE GUIDE | backend/src/middleware/request-context.ts
// الغرض: Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes.
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function requestContext(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(request, response) {
      const incoming = request.headers["x-request-id"];
      const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
      const requestId = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
      response.setHeader("x-request-id", requestId);
      return requestId;
    },
    customLogLevel(_request, response, error) {
      if (error || response.statusCode >= 500) return "error";
      if (response.statusCode >= 400) return "warn";
      return "info";
    },
    customProps(request) {
      return { requestId: String(request.id) };
    },
  });
}
