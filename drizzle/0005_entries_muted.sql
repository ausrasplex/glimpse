-- A clip muted by its author or the project owner: silent when played, and its sound is left out of mashes.
ALTER TABLE entries ADD COLUMN muted boolean NOT NULL DEFAULT false;
