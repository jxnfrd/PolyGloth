import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Manual Env Load
try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = dotenv.parse(fs.readFileSync(envPath));
        for (const k in envConfig) {
            process.env[k] = envConfig[k];
        }
    }
} catch (e) {
    console.error("Env load error", e);
}

async function printInstructions() {
    console.log("🛠️ Applying Migration: 20260110_create_pure_ai_predictions.sql...");

    const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/20260110_create_pure_ai_predictions.sql');
    if (!fs.existsSync(sqlPath)) {
        console.error("❌ Migration file not found!");
        return;
    }
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log("\n⚠️ ACTION REQUIRED: Run this SQL in your Supabase Dashboard SQL Editor\n");
    console.log("---------------------------------------------------------");
    console.log(sql);
    console.log("---------------------------------------------------------\n");
}

printInstructions();
