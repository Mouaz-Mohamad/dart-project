export function shouldStartHttpListener(
  environment: { VERCEL?: string | undefined } = process.env,
): boolean {
  return environment.VERCEL !== "1";
}


export function shouldRunRuntimeMigrations(
  environment: { VERCEL?: string | undefined } = process.env,
): boolean {
  return environment.VERCEL === "1";
}
