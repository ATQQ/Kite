import fs from 'fs';

interface UploadOptions {
  serverUrl: string;
  token: string;
  zipFilePath: string;
  projectId: string;
  preDeploy?: string;
  postDeploy?: string;
  env?: Record<string, string>;
  startedAt?: string;
}

interface UploadResult {
  success: boolean;
  deployId?: string;
  duration?: string;
  error?: string;
}

export async function uploadZip(options: UploadOptions): Promise<UploadResult> {
  const { serverUrl, token, zipFilePath, projectId, preDeploy, postDeploy, env, startedAt } = options;

  const fileData = await fs.promises.readFile(zipFilePath);
  const blob = new Blob([fileData], { type: 'application/zip' });

  const form = new FormData();
  form.append('projectId', projectId);
  form.append('file', blob, 'archive.zip');

  if (preDeploy) form.append('preDeploy', preDeploy);
  if (postDeploy) form.append('postDeploy', postDeploy);
  if (env && Object.keys(env).length > 0) form.append('env', JSON.stringify(env));
  if (startedAt) form.append('startedAt', startedAt);

  const endpoint = `${serverUrl.replace(/\/$/, '')}/api/deploy/upload`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: form as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const data = JSON.parse(errorText);
        message = data.error || data.message || errorText;
      } catch {
        message = errorText;
      }
      throw new Error(`[${response.status}] ${message}`);
    }

    // Stream NDJSON response — print log lines in real-time
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: UploadResult = { success: false };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.event === 'log') {
            process.stdout.write(event.data + '\n');
          } else if (event.event === 'status') {
            result = {
              success: event.status === 'success',
              deployId: event.deployId,
              duration: event.duration,
            };
          }
        } catch {
          // Skip malformed lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (event.event === 'log') process.stdout.write(event.data + '\n');
        if (event.event === 'status') {
          result = { success: event.status === 'success', deployId: event.deployId, duration: event.duration };
        }
      } catch {}
    }

    return result;
  } catch (error: any) {
    throw new Error(`Upload failed: ${error.message}`);
  }
}
