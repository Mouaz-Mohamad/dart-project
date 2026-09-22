// DART CODE GUIDE | backend/scripts/check-env.ts
// الغرض: أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح.
import {
  EnvironmentConfigError,
  loadConfig,
} from "../src/config/env.js";

try {
  loadConfig(process.env);
  process.stdout.write("Environment configuration is valid\n");
} catch (error) {
  if (error instanceof EnvironmentConfigError) {
    process.stderr.write(
      `Invalid environment fields: ${error.fields.join(", ")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stderr.write("Environment configuration validation failed\n");
    process.exitCode = 1;
  }
}
