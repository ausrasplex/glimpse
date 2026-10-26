-- When a notification was read, so read ones can be cleared a day later. Ones already read count from when they were sent.
ALTER TABLE notifications ADD COLUMN read_at timestamptz;
UPDATE notifications SET read_at = created_at WHERE read AND read_at IS NULL;
