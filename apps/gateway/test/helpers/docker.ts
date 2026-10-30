import { getContainerRuntimeClient } from "testcontainers";

/** True when a container runtime is reachable (CI); Testcontainers suites skip otherwise. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    await getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}
