-- Run this script in the Supabase SQL Editor to apply Version 2 updates

-- 1. Add new columns to existing tables
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

-- 2. Create Storage Buckets
-- Note: You might need to confirm these via the Supabase Dashboard UI 
-- under Storage -> "New Bucket" if the SQL insert doesn't work directly due to permissions.
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('chat-images', 'chat-images', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Set Storage Security Policies for 'avatars' Bucket
-- Allow everyone to view avatars
CREATE POLICY "Public Access to Avatars" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'avatars');

-- Allow authenticated users to upload/update their own avatar
CREATE POLICY "Users can upload their own avatar" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (
    bucket_id = 'avatars' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own avatar" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING (
    bucket_id = 'avatars' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. Set Storage Security Policies for 'chat-images' Bucket
-- Allow authenticated users to view chat images
CREATE POLICY "Authenticated users can view chat images" 
ON storage.objects FOR SELECT 
TO authenticated 
USING (bucket_id = 'chat-images');

-- Allow authenticated users to upload chat images
CREATE POLICY "Authenticated users can upload chat images" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'chat-images');

-- 5. Broadcast updates on 'messages' table for read receipts
-- We need to ensure that UPDATE events on 'messages' are broadcasted to Realtime too.
-- The previous schema enabled the table, but typically we want the full row replica for updates.
ALTER TABLE messages REPLICA IDENTITY FULL;
