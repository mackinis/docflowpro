/** Upload binary documents with real byte progress and session cookies. */
export function uploadDocumentWithProgress(formData: FormData, onProgress?: (percent: number, loadedBytes?: number, totalBytes?: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents/upload');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(100, Math.floor((event.loaded / event.total) * 100)), event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = 'No se pudo guardar el archivo.';
        try { message = JSON.parse(xhr.responseText).error || message; } catch {}
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Falló la conexión durante la subida.'));
    xhr.onabort = () => reject(new Error('Se canceló la subida.'));
    xhr.send(formData);
  });
}
