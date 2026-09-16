import { Router } from "express";
import multer from "multer";
import { uploadPdPhoto } from "../storage";
import { asyncRoute } from "../middleware/errors";

export const uploadsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — plenty for a field photo
});

/**
 * @openapi
 * /api/uploads:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload a PD measurement evidence photo to MinIO, returns its public URL
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201: { description: Uploaded }
 *       400: { description: No file provided }
 */
uploadsRouter.post(
  "/api/uploads",
  upload.single("file"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ message: "No file provided (expected multipart field \"file\")." });
      return;
    }
    const url = await uploadPdPhoto(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.status(201).json({ data: { url }, message: "Uploaded" });
  })
);
