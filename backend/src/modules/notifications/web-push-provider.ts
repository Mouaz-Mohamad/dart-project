// DART CODE GUIDE | backend/src/modules/notifications/web-push-provider.ts
// Provider outcomes are classified without logging endpoints, keys or response bodies.
import webPush from "web-push";
import type { AppConfig } from "../../config/env.js";
import type { BrowserPushSubscription } from "./push-validation.js";

export class PushDeliveryError extends Error {
  constructor(
    readonly disposition: "retryable" | "terminal" | "unknown",
    message: string,
  ) {
    super(message);
  }
}
export interface WebPushProvider {
  configured(): boolean;
  publicKey(): string;
  send(
    subscription: BrowserPushSubscription,
    payload: string,
    topic: string,
  ): Promise<"accepted" | "expired">;
}
export class ConfiguredWebPushProvider implements WebPushProvider {
  constructor(
    private readonly config: Pick<
      AppConfig,
      "webPushVapidPublicKey" | "webPushVapidPrivateKey" | "webPushVapidSubject"
    >,
  ) {}
  public configured(): boolean {
    return Boolean(
      this.config.webPushVapidPublicKey &&
        this.config.webPushVapidPrivateKey &&
        this.config.webPushVapidSubject,
    );
  }
  public publicKey(): string {
    return this.config.webPushVapidPublicKey || "";
  }
  public async send(
    subscription: BrowserPushSubscription,
    payload: string,
    topic: string,
  ): Promise<"accepted" | "expired"> {
    if (!this.configured())
      throw new PushDeliveryError(
        "retryable",
        "Browser notification delivery is not configured",
      );
    try {
      await webPush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
        {
          TTL: 86400,
          timeout: 8000,
          topic,
          contentEncoding: "aes128gcm",
          vapidDetails: {
            subject: this.config.webPushVapidSubject!,
            publicKey: this.config.webPushVapidPublicKey!,
            privateKey: this.config.webPushVapidPrivateKey!,
          },
        },
      );
      return "accepted";
    } catch (error) {
      const failure = error as {
        statusCode?: number;
        code?: string;
        syscall?: string;
      };
      if ([404, 410].includes(failure.statusCode || 0)) return "expired";
      if (failure.statusCode === 429)
        throw new PushDeliveryError(
          "retryable",
          "Push provider temporarily rejected delivery",
        );
      if (
        failure.statusCode &&
        failure.statusCode >= 400 &&
        failure.statusCode < 500
      )
        throw new PushDeliveryError(
          "terminal",
          "Push provider rejected delivery",
        );
      if (
        ["ENOTFOUND", "EAI_AGAIN"].includes(failure.code || "") ||
        (failure.syscall === "connect" &&
          ["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(
            failure.code || "",
          ))
      )
        throw new PushDeliveryError(
          "retryable",
          "Push connection failed before delivery",
        );
      throw new PushDeliveryError(
        "unknown",
        "Push delivery outcome requires reconciliation",
      );
    }
  }
}
