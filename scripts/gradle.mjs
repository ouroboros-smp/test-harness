import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const java = process.env.OURO_HARNESS_JAVA
  ?? (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java");
const wrapper = join(repository, "gradle", "wrapper", "gradle-wrapper.jar");
const child = spawn(java, ["-classpath", wrapper, "org.gradle.wrapper.GradleWrapperMain", "--no-daemon", ...process.argv.slice(2)], {
  cwd: repository,
  stdio: "inherit",
  windowsHide: true,
});
child.once("exit", (code) => process.exit(code ?? 1));
child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});
