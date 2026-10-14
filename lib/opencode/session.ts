interface SessionActions {
  list: (options: { directory: string }) => Promise<{ data?: Array<{ id: string }> }>;
  create: (options: {
    title: string;
    location: { directory: string };
    agent?: string;
    model?: { id: string; providerID: string };
  }) => Promise<{ id: string }>;
}

interface EnsureSessionOptions {
  directory: string;
  sessionId?: string;
  title: string;
  agent?: string;
  model?: { id: string; providerID: string };
}

export async function ensureSession(
  session: SessionActions,
  options: EnsureSessionOptions
): Promise<string> {
  if (options.sessionId) {
    const result = await session.list({ directory: options.directory });
    if (result.data?.some((item) => item.id === options.sessionId)) {
      return options.sessionId;
    }
  }

  const created = await session.create({
    title: options.title,
    location: { directory: options.directory },
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.model ? { model: options.model } : {}),
  });
  return created.id;
}