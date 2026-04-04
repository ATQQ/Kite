import fs from 'fs';

interface UploadOptions {
  serverUrl: string;
  token: string;
  zipFilePath: string;
  projectId: string;
  preDeploy?: string;
  postDeploy?: string;
}

export async function uploadZip(options: UploadOptions): Promise<void> {
  const { serverUrl, token, zipFilePath, projectId, preDeploy, postDeploy } = options;

  const fileData = await fs.promises.readFile(zipFilePath);
  const blob = new Blob([fileData], { type: 'application/zip' });

  const form = new FormData();
  form.append('projectId', projectId);
  form.append('file', blob, 'archive.zip');

  if (preDeploy) form.append('preDeploy', preDeploy);
  if (postDeploy) form.append('postDeploy', postDeploy);

  const endpoint = `${serverUrl.replace(/\/$/, '')}/api/deploy/upload`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        // do not set Content-Type, fetch will set it with the boundary correctly
      },
      body: form as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[${response.status}] ${errorText}`);
    }

    const data = await response.json();
    console.log('Server response:', data);
  } catch (error: any) {
    throw new Error(`Upload failed: ${error.message}`);
  }
}
