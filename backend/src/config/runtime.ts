export function shouldStartHttpListener(
  environment: { VERCEL?: string | undefined } = process.env,
): boolean {
  return environment.VERCEL !== "1";
}
