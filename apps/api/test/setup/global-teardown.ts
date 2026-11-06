interface Stoppable {
  stop(): Promise<unknown>;
}

export default async function globalTeardown(): Promise<void> {
  const containers = (globalThis as Record<string, unknown>).__CONTAINERS__ as
    Stoppable[] | undefined;
  await Promise.all((containers ?? []).map((container) => container.stop()));
}
