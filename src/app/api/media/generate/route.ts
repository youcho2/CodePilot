import { NextRequest } from 'next/server';
import { generateImage, NoImageGeneratedError } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getDb, getSession } from '@/lib/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot');
const MEDIA_DIR = path.join(dataDir, '.codepilot-media');

interface GenerateRequest {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceImages?: { mimeType: string; data: string }[];
  referenceImagePaths?: string[];
  sessionId?: string;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: GenerateRequest = await request.json();

    if (!body.prompt) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: prompt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const db = getDb();
    const provider = db.prepare(
      "SELECT api_key FROM api_providers WHERE provider_type = 'gemini-image' AND api_key != '' LIMIT 1"
    ).get() as { api_key: string } | undefined;

    if (!provider) {
      return new Response(
        JSON.stringify({ error: 'No Gemini Image provider configured. Please add a provider with type "gemini-image" in Settings.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const requestedModel = body.model || 'gemini-3-pro-image-preview';
    const aspectRatio = (body.aspectRatio || '1:1') as `${number}:${number}`;
    const imageSize = body.imageSize || '1K';

    const google = createGoogleGenerativeAI({ apiKey: provider.api_key });

    // Build prompt: plain string or { text, images } for reference images
    // Support both base64 referenceImages and on-disk referenceImagePaths
    let refImageData: string[] = [];
    if (body.referenceImages && body.referenceImages.length > 0) {
      refImageData = body.referenceImages.map(img => img.data);
    } else if (body.referenceImagePaths && body.referenceImagePaths.length > 0) {
      for (const filePath of body.referenceImagePaths) {
        if (fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          refImageData.push(buf.toString('base64'));
        }
      }
    }
    const prompt = refImageData.length > 0
      ? { text: body.prompt, images: refImageData }
      : body.prompt;

    const { images } = await generateImage({
      model: google.image(requestedModel),
      prompt,
      providerOptions: {
        google: {
          imageConfig: { aspectRatio, imageSize },
        },
      },
      maxRetries: 3,
      abortSignal: AbortSignal.timeout(120_000),
    });

    const elapsed = Date.now() - startTime;
    console.log(`[media/generate] ${requestedModel} ${imageSize} completed in ${elapsed}ms`);

    // Ensure media directory exists
    if (!fs.existsSync(MEDIA_DIR)) {
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }

    // Write images to disk
    const savedImages: Array<{ mimeType: string; localPath: string }> = [];

    for (const img of images) {
      const ext = img.mediaType === 'image/jpeg' ? '.jpg'
        : img.mediaType === 'image/webp' ? '.webp'
        : '.png';
      const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      const filePath = path.join(MEDIA_DIR, filename);

      fs.writeFileSync(filePath, Buffer.from(img.uint8Array));

      savedImages.push({
        mimeType: img.mediaType,
        localPath: filePath,
      });
    }

    // Copy images to project directory if sessionId is provided
    if (body.sessionId) {
      try {
        const session = getSession(body.sessionId);
        if (session?.working_directory) {
          const projectImgDir = path.join(session.working_directory, '.codepilot-images');
          if (!fs.existsSync(projectImgDir)) {
            fs.mkdirSync(projectImgDir, { recursive: true });
          }
          for (const saved of savedImages) {
            const destPath = path.join(projectImgDir, path.basename(saved.localPath));
            fs.copyFileSync(saved.localPath, destPath);
          }
          console.log(`[media/generate] Copied ${savedImages.length} image(s) to ${projectImgDir}`);
        }
      } catch (copyErr) {
        console.warn('[media/generate] Failed to copy images to project directory:', copyErr);
      }
    }

    // Save reference images to disk for gallery display
    const savedRefImages: Array<{ mimeType: string; localPath: string }> = [];
    if (refImageData.length > 0) {
      const refMimeTypes = body.referenceImages
        ? body.referenceImages.map(img => img.mimeType)
        : body.referenceImagePaths
          ? body.referenceImagePaths.map(() => 'image/png')
          : [];
      for (let i = 0; i < refImageData.length; i++) {
        const mime = refMimeTypes[i] || 'image/png';
        const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
        const filename = `ref-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        const filePath = path.join(MEDIA_DIR, filename);
        fs.writeFileSync(filePath, Buffer.from(refImageData[i], 'base64'));
        savedRefImages.push({ mimeType: mime, localPath: filePath });
      }
    }

    // DB record
    const id = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    const localPath = savedImages.length > 0 ? savedImages[0].localPath : '';

    const metadata: Record<string, unknown> = {
      imageCount: savedImages.length,
      elapsedMs: elapsed,
      model: requestedModel,
    };
    if (savedRefImages.length > 0) {
      metadata.referenceImages = savedRefImages;
    }

    db.prepare(
      `INSERT INTO media_generations (id, type, status, provider, model, prompt, aspect_ratio, image_size, local_path, thumbnail_path, session_id, message_id, tags, metadata, error, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, 'image', 'completed', 'gemini', requestedModel, body.prompt,
      aspectRatio, imageSize, localPath, '',
      body.sessionId || null, null,
      '[]', JSON.stringify(metadata),
      null, now, now
    );

    return new Response(
      JSON.stringify({
        id,
        text: '',
        images: savedImages,
        model: requestedModel,
        imageSize,
        elapsedMs: elapsed,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[media/generate] Failed after ${elapsed}ms:`, error);

    if (NoImageGeneratedError.isInstance(error)) {
      return new Response(
        JSON.stringify({ error: 'No images were generated. Try a different prompt.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to generate image';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
