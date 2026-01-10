import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.local' });

console.log('🔒 Applying RLS Fixes...');

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260110_fix_rls.sql'), 'utf8');

console.log('\n--- EXECUTE THIS SQL IN SUPABASE DASHBOARD ---\n');
console.log(sql);
console.log('\n----------------------------------------------');
console.log('Supabase JS client cannot execute DDL (ALTER TABLE) directly.');
console.log('Please copy/paste the SQL above into your Supabase SQL Editor.');
