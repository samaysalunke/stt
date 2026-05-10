import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.pdf'];

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function uploadFile(file: File): Promise<{ url: string; filename: string }> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPG, PNG, and PDF are allowed.');
  }

  if (file.size > MAX_SIZE) {
    throw new Error('File too large. Maximum size is 5MB.');
  }

  const originalExt = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTS.includes(originalExt)) {
    throw new Error('Invalid file extension.');
  }

  const filename = `${randomUUID()}${originalExt}`;
  const buffer = await file.arrayBuffer();
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(buffer));

  return {
    url: `/api/uploads/${filename}`,
    filename,
  };
}
