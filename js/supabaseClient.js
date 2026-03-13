// js/supabaseClient.js

// Replace these with your actual Supabase Project URL and Anon Key
const SUPABASE_URL = 'https://dmrsqcorjsewragvbqvc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtcnNxY29yanNld3JhZ3ZicXZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMjAxNTQsImV4cCI6MjA4ODg5NjE1NH0.mIwTe7dUcH75YbSbZV8pLsYOnXno6wyM5wWiduvBLXA';

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
