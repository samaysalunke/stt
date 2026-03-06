import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.pdf'];

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function uploadFile(file: File): Promise<{ url: string; filename: string }> {
  // Validate type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPG, PNG, and PDF are allowed.');
  }

  // Validate size
  if (file.size > MAX_SIZE) {
    throw new Error('File too large. Maximum size is 5MB.');
  }

  // Get extension safely
  const originalExt = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTS.includes(originalExt)) {
    throw new Error('Invalid file extension.');
  }

  const filename = `${randomUUID()}${originalExt}`;
  const filepath = path.join(UPLOADS_DIR, filename);

  const buffer = await file.arrayBuffer();
  fs.writeFileSync(filepath, Buffer.from(buffer));

  return {
    url: `/uploads/${filename}`,
    filename,
  };
}
