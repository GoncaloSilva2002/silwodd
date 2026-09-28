const crypto = require("crypto");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "documents";
const storage = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

let bucketReady = false;

async function ensureBucket() {
  if (!storage) {
    throw new Error("Configura SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para guardar anexos no Supabase Storage.");
  }
  if (bucketReady) return;
  const { data } = await storage.storage.getBucket(bucket);
  if (!data) {
    const { error } = await storage.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: 20 * 1024 * 1024,
      allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]
    });
    if (error && !String(error.message).toLowerCase().includes("already")) throw error;
  }
  bucketReady = true;
}

async function uploadFile(file, folder, preferredExtension = "") {
  await ensureBucket();
  const originalExtension = path.extname(String(file.originalname || "")).toLowerCase();
  const extension = preferredExtension || originalExtension || "";
  const objectPath = `${folder}/${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension}`;
  const { error } = await storage.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false
  });
  if (error) throw error;
  return `storage:${objectPath}`;
}

async function getFileUrl(storedPath) {
  if (!storedPath || !String(storedPath).startsWith("storage:")) return storedPath || null;
  if (!storage) return null;
  const objectPath = String(storedPath).slice("storage:".length);
  // Mantem os anexos privados, mas evita que uma obra aberta durante o dia
  // fique com imagens quebradas ao fim de apenas uma hora.
  const { data, error } = await storage.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24 * 7);
  if (error) return null;
  return data?.signedUrl || null;
}

module.exports = { uploadFile, getFileUrl };
