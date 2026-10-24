-- Motion photos: where the photo's short video is ("embedded:<byte offset>" or "immich:<asset id>") and how long it runs.
ALTER TABLE media ADD COLUMN motion_video text;
ALTER TABLE media ADD COLUMN motion_duration real;
