-- Run this script in the Supabase SQL Editor to fix the read receipts issue

-- Allow message receivers to update the "is_read" status of messages
CREATE POLICY "Users can update receipt status of messages they receive" 
    ON messages FOR UPDATE 
    USING (auth.uid() = receiver_id);
