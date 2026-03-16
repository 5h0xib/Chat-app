-- schema_v4_events.sql
-- Run this in the Supabase SQL Editor to add group event (system) message support

-- 1. Add a 'message_type' column to messages table.
--    'chat'  = normal message (default, existing rows)
--    'event' = system event notification (member added/removed/left)
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'chat'
    CHECK (message_type IN ('chat', 'event'));

-- 2. Allow 'event' messages without a sender (sender_id can be null for system messages)
--    If your current schema has sender_id NOT NULL, drop that constraint:
-- ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
-- (Only run the line above if you get an error about sender_id being NOT NULL)

-- 3. RLS: Allow group members to INSERT event messages
--    (The existing "Users can insert messages to their groups" policy already covers this
--     since it checks group_id membership. No additional policy needed.)

-- Done! The JavaScript will now insert rows with message_type='event' when
-- members are added, removed, or leave a group.
