-- Waveform for each music track: up to 200 loudness values from 0 to 1.
ALTER TABLE tracks ADD COLUMN peaks jsonb;
