// This is a one-time script to migrate your local JSON files to Vercel KV

// Load environment variables from the file Vercel created
require('dotenv').config({ path: '.env.development.local' });

const { kv } = require('@vercel/kv');
const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
// --- IMPORTANT: List all your client .json files here ---
const clientFiles = [
    'kirtan.json',
    'nayan.json',
    'Prarthana12.json',
    'Yogesh.json'
    // Add any other client.json files you have
];

async function migrate() {
    if (!process.env.KV_URL) {
        console.error('KV_URL not found. Did you run `vercel env pull`?');
        return;
    }

    console.log('Starting migration to Vercel KV...');

    try {
        const pipe = kv.pipeline();

        for (const file of clientFiles) {
            const filePath = path.join(DATA_DIR, file);
            if (await fs.pathExists(filePath)) {
                const data = await fs.readJson(filePath);
                const clientId = data.clientId;

                if (clientId) {
                    // Add commands to the pipeline
                    pipe.set(clientId, data);      // Set the client's data
                    pipe.sadd('clients', clientId); // Add the ID to the master set
                    console.log(`Queued migration for: ${clientId}`);
                }
            }
        }

        // Execute all commands at once
        await pipe.exec();
        console.log('Migration complete! All data is now in Vercel KV.');

    } catch (error) {
        console.error('Migration failed:', error);
    }
}

migrate();