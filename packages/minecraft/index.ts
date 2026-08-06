export interface MinecraftServerEngine {
  type: string;
  version: string;
  downloadUrl?: string;
}

export function parseServerProperties(content: string): Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const [key, value] = line.split('=').map((s) => s.trim());
    if (value === 'true') result[key] = true;
    else if (value === 'false') result[key] = false;
    else if (!isNaN(Number(value)) && value !== '') result[key] = Number(value);
    else result[key] = value;
  }
  return result;
}
