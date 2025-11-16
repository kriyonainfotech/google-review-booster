/*
 * ===============================================
 * Google Review Booster - Backend Server (v2)
 * ===============================================
 * This single file contains the entire Node.js
 * Express server logic.
 *
 * It handles:
 * 1. Serving the static frontend (public/index.html)
 * 2. All API routes for managing clients and reviews
 * 3. All business logic (reading/writing JSON files)
 * 4. Validation and Error Handling
 *
 * --- V2 CHANGES ---
 * + Added GET /api/data-files to list available JSON files in /data.
 * + Modified POST /api/client to accept a 'sourceReviewFile' body
 * parameter, allowing selection of which JSON file to
 * populate initial reviews from.
 * ===============================================
 */

// --- 1. Imports ---
const express = require("express");
const cors = require("cors");
const Joi = require("joi");
const fs = require("fs-extra"); // 'fs-extra' is 'fs' with more features
const path = require("path");
const qrcode = require("qrcode");
require("dotenv").config(); // Loads .env file variables

// --- 2. App Initialization ---
const app = express();
const PORT = process.env.PORT || 5000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

// --- 3. Paths and Constants ---
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const SAMPLE_REVIEWS_FILE = path.join(DATA_DIR, "sample-reviews-200.json");
const getClientDataPath = (clientId) => path.join(DATA_DIR, `${clientId}.json`);

// --- 4. Middleware ---
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON request bodies
app.use(express.static(PUBLIC_DIR)); // Serve static files from 'public' folder

// Custom logging middleware
app.use((req, res, next) => {
  console.log(`[Server] ${req.method} ${req.url}`);
  next();
});

// --- 5. Helper Functions (Business Logic) ---

/**
 * Reads all sample reviews from a specified file.
 * @param {string} [fileName] - The JSON file to read from (e.g., "sample-reviews-200.json")
 * @returns {Promise<string[]>} List of reviews
 */
async function getReviewsFromFile(fileName = "sample-reviews-200.json") {
  // NEW: Handle empty string or null fileName
  if (!fileName) {
    fileName = "sample-reviews-200.json";
  }

  const filePath = path.join(DATA_DIR, fileName);

  // Basic security check: prevent path traversal
  if (!filePath.startsWith(DATA_DIR)) {
    console.warn(`[Server] Blocked potential path traversal: ${fileName}`);
    return ["Security warning: Invalid file path."];
  }

  try {
    if (await fs.pathExists(filePath)) {
      const data = await fs.readJson(filePath);
      if (Array.isArray(data.reviews)) {
        console.log(
          `[Server] Loaded ${data.reviews.length} reviews from ${fileName}.`
        );
        return data.reviews;
      }
    }
    // Fallback if file doesn't exist or is malformed
    console.warn(
      `[Server] Could not read ${fileName}, falling back to default sample.`
    );
    const defaultData = await fs.readJson(SAMPLE_REVIEWS_FILE);
    return defaultData.reviews || ["Excellent service!"];
  } catch (error) {
    console.error(
      `[Server] CRITICAL: Could not read reviews from ${fileName}.`,
      error
    );
    return ["Excellent service!", "Very professional."]; // Hard fallback
  }
}

/**
 * Reads a specific client's data file.
 * @param {string} clientId
 * @returns {Promise<object | null>} Client data object or null if not found
 */
async function getClientData(clientId) {
  const filePath = getClientDataPath(clientId);
  try {
    if (await fs.pathExists(filePath)) {
      return await fs.readJson(filePath);
    }
    return null;
  } catch (error) {
    console.error(`[Server] Error reading client data for ${clientId}:`, error);
    return null;
  }
}

/**
 * Writes data to a specific client's JSON file.
 * @param {string} clientId
 * @param {object} data
 * @returns {Promise<boolean>} Success status
 */
async function writeClientData(clientId, data) {
  try {
    await fs.writeJson(getClientDataPath(clientId), data, { spaces: 2 });
    return true;
  } catch (error) {
    console.error(`[Server] Error writing client data for ${clientId}:`, error);
    return false;
  }
}

// --- 6. Joi Validation Schemas ---

const clientCreateSchema = Joi.object({
  clientId: Joi.string().alphanum().min(3).max(50).required(),
  clientName: Joi.string().min(3).max(100).required(),
  googleReviewLink: Joi.string().uri().required(),
  logoUrl: Joi.string().uri().allow("").optional(),
  primaryColor: Joi.string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .required(),
  secondaryColor: Joi.string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .required(),
  sourceReviewFile: Joi.string()
    .pattern(/^[\w\.-]+\.json$/)
    .allow("")
    .optional(), // UPDATED: Allow empty string and dots
});

const clientUpdateSchema = Joi.object({
  clientName: Joi.string().min(3).max(100).required(),
  googleReviewLink: Joi.string().uri().required(),
  logoUrl: Joi.string().uri().allow("").optional(),
  primaryColor: Joi.string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .required(),
  secondaryColor: Joi.string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .required(),
});

const addReviewSchema = Joi.object({
  review: Joi.string().min(5).max(500).required(),
});

// Validation Middleware
const validateBody = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ message: error.details[0].message });
  }
  next();
};

// --- 7. API Routes ---

/*
 * =======================
 * DATA & CLIENT API
 * =======================
 */

/**
 * GET /api/data-files
 * NEW: Get a list of all .json files in the /data directory.
 */
app.get("/api/data-files", async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));
    res.json(jsonFiles);
  } catch (error) {
    console.error("[Server] Error reading data directory:", error);
    res.status(500).json({ message: "Error reading data directory." });
  }
});

/**
 * GET /api/clients
 * Get a list of all existing client IDs and names.
 */
app.get("/api/clients", async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const clientFiles = files.filter(
      (file) => file.endsWith(".json") // We list all JSONs as potential clients, but filter sample
    );

    const clients = await Promise.all(
      clientFiles.map(async (file) => {
        const clientId = file.replace(".json", "");
        const data = await getClientData(clientId);
        // Add a check in case data is null or doesn't have clientId
        if (data && data.clientId && data.clientName) {
          return {
            clientId: data.clientId,
            clientName: data.clientName,
          };
        }
        return null; // Return null for invalid files
      })
    );

    // Filter out any null results from broken files
    res.json(clients.filter((client) => client !== null));
  } catch (error) {
    console.error("[Server] Error reading client directory:", error);
    res.status(500).json({ message: "Error reading client directory." });
  }
});

/**
 * POST /api/client
 * Create a new client.
 * UPDATED: Now uses 'sourceReviewFile'
 */
app.post("/api/client", validateBody(clientCreateSchema), async (req, res) => {
  const { clientId, sourceReviewFile, ...clientDetails } = req.body;
  const filePath = getClientDataPath(clientId);

  if (await fs.pathExists(filePath)) {
    return res.status(409).json({ message: "Client ID already exists." });
  }

  // UPDATED: Get reviews from the selected file, or default
  const initialReviews = await getReviewsFromFile(sourceReviewFile);

  const newClientData = {
    ...clientDetails,
    clientId: clientId, // Ensure clientId is set
    reviews: initialReviews,
  };

  const success = await writeClientData(clientId, newClientData);
  if (success) {
    res.status(201).json(newClientData);
  } else {
    res.status(500).json({ message: "Failed to create client file." });
  }
});

/**
 * GET /api/client/:clientId
 * Get a specific client's details (WITHOUT review list).
 */
app.get("/api/client/:clientId", async (req, res) => {
  const { clientId } = req.params;
  const data = await getClientData(clientId);

  if (!data) {
    return res.status(404).json({ message: "Client not found." });
  }

  // Omit reviews list for performance
  const { reviews, ...clientDetails } = data;
  res.json(clientDetails);
});

/**
 * PUT /api/client/:clientId
 * Update a specific client's details.
 */
app.put(
  "/api/client/:clientId",
  validateBody(clientUpdateSchema),
  async (req, res) => {
    const { clientId } = req.params;
    const data = await getClientData(clientId);

    if (!data) {
      return res.status(4404).json({ message: "Client not found." });
    }

    const updatedData = {
      ...data, // Keep existing reviews
      ...req.body, // Overwrite details
      clientId: clientId, // Ensure clientId cannot be changed
    };

    const success = await writeClientData(clientId, updatedData);
    if (success) {
      res.json(updatedData);
    } else {
      res.status(500).json({ message: "Failed to update client data." });
    }
  }
);

/**
 * DELETE /api/client/:clientId
 * Delete a client.
 */
app.delete("/api/client/:clientId", async (req, res) => {
  const { clientId } = req.params;
  const filePath = getClientDataPath(clientId);

  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ message: "Client not found." });
  }

  try {
    await fs.remove(filePath);
    res.status(204).send(); // 204 No Content
  } catch (error) {
    res.status(500).json({ message: "Error deleting client file." });
  }
});

/*
 * =======================
 * REVIEW MANAGEMENT API
 * =======================
 */

/**
 * GET /api/client/:clientId/reviews
 * Get all reviews for a specific client.
 */
app.get("/api/client/:clientId/reviews", async (req, res) => {
  const { clientId } = req.params;
  const data = await getClientData(clientId);

  if (!data) {
    return res.status(404).json({ message: "Client not found." });
  }

  res.json({ reviews: data.reviews || [] });
});

/**
 * GET /api/client/:clientId/random-review
 * Get one random review for a client.
 */
app.get("/api/client/:clientId/random-review", async (req, res) => {
  const { clientId } = req.params;
  const data = await getClientData(clientId);

  if (!data || !data.reviews || data.reviews.length === 0) {
    return res
      .status(404)
      .json({ message: "Client not found or has no reviews." });
  }

  const randomIndex = Math.floor(Math.random() * data.reviews.length);
  const randomReview = data.reviews[randomIndex];

  res.json({ review: randomReview });
});

/**
 * POST /api/client/:clientId/reviews
 * Add a new review to a client's list.
 */
app.post(
  "/api/client/:clientId/reviews",
  validateBody(addReviewSchema),
  async (req, res) => {
    const { clientId } = req.params;
    const { review } = req.body;
    const data = await getClientData(clientId);

    if (!data) {
      return res.status(404).json({ message: "Client not found." });
    }

    data.reviews = [review, ...(data.reviews || [])]; // Add to front

    const success = await writeClientData(clientId, data);
    if (success) {
      res.status(201).json({ review });
    } else {
      res.status(500).json({ message: "Failed to add review." });
    }
  }
);

/**
 * DELETE /api/client/:clientId/reviews
 * Delete a specific review (by its text content, for simplicity).
 */
app.delete("/api/client/:clientId/reviews", async (req, res) => {
  const { clientId } = req.params;
  const { review } = req.body; // Expects { "review": "The review text to delete" }

  if (!review) {
    return res.status(400).json({ message: "Review text is required." });
  }

  const data = await getClientData(clientId);

  if (!data) {
    return res.status(404).json({ message: "Client not found." });
  }

  const reviewIndex = (data.reviews || []).indexOf(review);
  if (reviewIndex === -1) {
    return res.status(404).json({ message: "Review not found." });
  }

  data.reviews.splice(reviewIndex, 1); // Remove the review

  const success = await writeClientData(clientId, data);
  if (success) {
    res.status(200).json({ message: "Review deleted." });
  } else {
    res.status(500).json({ message: "Failed to delete review." });
  }
});

/*
 * =======================
 * QR CODE API
 * =======================
 */

/**
 * POST /api/client/:clientId/generate-qr
 * Generate a QR code for the client's review page.
 */
app.post("/api/client/:clientId/generate-qr", async (req, res) => {
  const { clientId } = req.params;
  const reviewPageUrl = `${APP_BASE_URL}/review/${clientId}`;

  try {
    const dataUrl = await qrcode.toDataURL(reviewPageUrl, {
      errorCorrectionLevel: "H",
      type: "image/png",
      margin: 2,
      width: 300,
    });
    res.json({ qrDataUrl: dataUrl, link: reviewPageUrl });
  } catch (err) {
    console.error("[Server] QR Code generation failed:", err);
    res.status(500).json({ message: "Failed to generate QR code." });
  }
});

// --- 8. Frontend Route Handlers ---
/*
 * This section makes sure that if a user directly visits
 * /review/some-client or /admin, they get the
 * React app, which will then handle the routing.
 */

const serveApp = (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
};

app.use("/api", (req, res) => {
  res.status(404).json({ message: "API route not found." });
});

// --- FRONTEND ROUTES (MUST BE LAST) ---
app.get("/review/:clientId", serveApp);
app.get("/admin", serveApp);
app.get("/", serveApp);
app.get("*", serveApp);

// --- ERROR HANDLER ---
app.use((err, req, res, next) => {
  console.error("[Server] Unhandled Error:", err.stack);
  res.status(500).send("Something broke!");
});
 

// Start the server
app.listen(PORT, async () => {
  await fs.ensureDir(DATA_DIR); // Ensure /data directory exists
  console.log(
    `[Server] Review Booster server running on http://localhost:${PORT}`
  );
});
