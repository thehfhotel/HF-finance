// Convert a data URL (e.g. from <input type=file> + FileReader.readAsDataURL)
// back into a File object so it can be sent as multipart form data.

export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}
