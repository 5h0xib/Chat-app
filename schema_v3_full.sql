-- Run this script in the Supabase SQL Editor to apply Version 3 updates

-- 1. Create Groups Table
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    avatar_url TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create Group Members Table
CREATE TABLE IF NOT EXISTS group_members (
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

-- 3. Modify Messages Table for Groups and Deletions
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
ALTER COLUMN receiver_id DROP NOT NULL; -- Allow receiver_id to be null if it's a group message

-- 4. Create Group Avatars Bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('group-avatars', 'group-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Enable RLS on New Tables
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- 6. Setup RLS Policies for Groups

-- Helper function to bypass RLS recursion when checking group membership
CREATE OR REPLACE FUNCTION get_user_groups()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT group_id FROM group_members WHERE user_id = auth.uid();
$$;

-- Anyone can see a group they belong to
DROP POLICY IF EXISTS "Users can see groups they belong to" ON groups;
CREATE POLICY "Users can see groups they belong to" 
    ON groups FOR SELECT
    USING (
        id IN (SELECT get_user_groups())
    );

-- Any authenticated user can create a group
DROP POLICY IF EXISTS "Users can create groups" ON groups;
CREATE POLICY "Users can create groups" 
    ON groups FOR INSERT
    WITH CHECK (auth.uid() = created_by);

-- Only admins can update the group
DROP POLICY IF EXISTS "Admins can update groups" ON groups;
CREATE POLICY "Admins can update groups" 
    ON groups FOR UPDATE
    USING (auth.uid() = created_by);

-- 7. Setup RLS Policies for Group Members
-- Members can see other members of groups they belong to
DROP POLICY IF EXISTS "Users can see group members" ON group_members;
CREATE POLICY "Users can see group members" 
    ON group_members FOR SELECT
    USING (
        group_id IN (SELECT get_user_groups())
    );

-- Any user can insert themselves (when creating) OR an admin can insert others
DROP POLICY IF EXISTS "Users can join or admins can add members" ON group_members;
CREATE POLICY "Users can join or admins can add members" 
    ON group_members FOR INSERT
    WITH CHECK (
        auth.uid() = user_id OR 
        EXISTS (SELECT 1 FROM groups WHERE groups.id = group_members.group_id AND groups.created_by = auth.uid())
    );

-- Admins can remove members, or users can leave
DROP POLICY IF EXISTS "Admins can remove or users can leave" ON group_members;
CREATE POLICY "Admins can remove or users can leave" 
    ON group_members FOR DELETE
    USING (
        auth.uid() = user_id OR 
        EXISTS (SELECT 1 FROM groups WHERE groups.id = group_members.group_id AND groups.created_by = auth.uid())
    );

-- 8. Update Messages RLS to support Group Chats and Deletions
-- This effectively replaces the older 'SELECT' and 'INSERT' policies.
-- In Supabase, multiple policies are combined with OR. We just add new policies for groups.

DROP POLICY IF EXISTS "Users can see messages in their groups" ON messages;
CREATE POLICY "Users can see messages in their groups" 
    ON messages FOR SELECT
    USING (
        group_id IS NOT NULL AND 
        group_id IN (SELECT get_user_groups())
    );

DROP POLICY IF EXISTS "Users can insert messages to their groups" ON messages;
CREATE POLICY "Users can insert messages to their groups" 
    ON messages FOR INSERT
    WITH CHECK (
        group_id IS NOT NULL AND auth.uid() = sender_id AND
        group_id IN (SELECT get_user_groups())
    );

-- Allow senders to SOFT DELETE their own messages
DROP POLICY IF EXISTS "Users can soft delete their own messages" ON messages;
CREATE POLICY "Users can soft delete their own messages" 
    ON messages FOR UPDATE
    USING (auth.uid() = sender_id);

-- Allow receivers to UPDATE read status
DROP POLICY IF EXISTS "Users can update receipt status of messages they receive" ON messages;
CREATE POLICY "Users can update receipt status of messages they receive" 
    ON messages FOR UPDATE 
    USING (auth.uid() = receiver_id);

-- 9. Setup Storage Policies for Group Avatars
DROP POLICY IF EXISTS "Public Access to Group Avatars" ON storage.objects;
CREATE POLICY "Public Access to Group Avatars" 
    ON storage.objects FOR SELECT 
    USING (bucket_id = 'group-avatars');

DROP POLICY IF EXISTS "Authenticated users can upload group avatars" ON storage.objects;
CREATE POLICY "Authenticated users can upload group avatars" 
    ON storage.objects FOR INSERT 
    TO authenticated 
    WITH CHECK (bucket_id = 'group-avatars');

DROP POLICY IF EXISTS "Authenticated users can update group avatars" ON storage.objects;
CREATE POLICY "Authenticated users can update group avatars" 
    ON storage.objects FOR UPDATE 
    TO authenticated 
    USING (bucket_id = 'group-avatars');


