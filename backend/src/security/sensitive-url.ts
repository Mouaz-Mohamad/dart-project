// Scrub a serialized URL, without mutating the request used for routing/verification.
const sensitiveParameter = /token|secret|password|passcode|credential|authorization|api[-_]?key|otp|mfa|session/i;

export function scrubSensitiveUrl(value: string): string {
  return value.replace(/([?&]|^)([^=?&#]+)=([^&#]*)/g, (match: string, separator: string, key: string) => {
    let decoded: string;
    try { decoded = decodeURIComponent(key.replace(/\+/g, " ")); }
    catch { return `${separator}${key}=[REDACTED]`; }
    return sensitiveParameter.test(decoded) ? `${separator}${key}=[REDACTED]` : match;
  });
}
