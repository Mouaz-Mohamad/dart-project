// DART CODE GUIDE | backend/src/middleware/not-found.ts
// الغرض: Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes.
import type { RequestHandler } from "express";
import { AppError } from "../http/app-error.js";

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new AppError(404, "ROUTE_NOT_FOUND", `Route ${request.method} ${request.path} was not found`));
};
