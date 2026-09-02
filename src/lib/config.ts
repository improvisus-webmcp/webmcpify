export async function resolveRecordArtifacts(): Promise<boolean> {
  return false;
}

export async function resolveDurable(
  flag: boolean | undefined,
  _basePath?: string
): Promise<boolean> {
  if (flag !== undefined) return flag;

  const environmentValue = process.env.WEBMCPIFY_DURABLE;
  if (environmentValue !== undefined) {
    const normalized = environmentValue.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error(
      `Invalid WEBMCPIFY_DURABLE value "${environmentValue}". Use true or false.`
    );
  }

  return false;
}
