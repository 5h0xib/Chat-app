const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://dmrsqcorjsewragvbqvc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtcnNxY29yanNld3JhZ3ZicXZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMjAxNTQsImV4cCI6MjA4ODg5NjE1NH0.mIwTe7dUcH75YbSbZV8pLsYOnXno6wyM5wWiduvBLXA';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
    console.log('Testing...');
    // test the query run in loadFriends
    const { data: groupsData, error: groupsError } = await supabase
        .from('group_members')
        .select('groups(*)');
        
    if (groupsError) {
        console.error('Group Error:', groupsError);
    } else {
        console.log('Group Data:', groupsData);
    }
}
test();
