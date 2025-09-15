// backend/middleware/upload.js
const path = require('path');
const fs = require('fs');
const multer = require('multer');

let storage;
let usingCloudinary = false;

// If Cloudinary env is present, try to use multer-storage-cloudinary
const hasCloudinaryEnv =
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

if (hasCloudinaryEnv) {
  try {
    const { v2: cloudinary } = require('cloudinary');
    const { CloudinaryStorage } = require('multer-storage-cloudinary');

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });

    storage = new CloudinaryStorage({
      cloudinary,
      params: {
        folder: process.env.CLOUDINARY_FOLDER || 'uploads',
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
    });
    usingCloudinary = true;
    console.log('📸 Using Cloudinary storage for uploads');
  } catch (err) {
    console.warn(
      '⚠️  Cloudinary storage not available (module missing?). Falling back to disk:',
      err.message
    );
  }
}

// Fallback to local disk storage if Cloudinary not available
if (!storage) {
  const LOCAL_UPLOAD_DIR = process.env.UPLOAD_DIR ||
    path.join(__dirname, '..', 'uploads');

  fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });

  storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LOCAL_UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const base = path.basename(file.originalname, ext)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${base || 'img'}-${unique}${ext}`);
    },
  });

  console.log('💾 Using local disk storage for uploads:', LOCAL_UPLOAD_DIR);
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ok = (file.mimetype || '').startsWith('image/');
    cb(ok ? null : new Error('Only image uploads are allowed'), ok);
  },
});

module.exports = upload;
module.exports.usingCloudinary = usingCloudinary;
