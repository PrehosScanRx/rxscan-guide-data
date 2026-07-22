# Immutable Guide editorial releases

Each child directory is an append-only candidate release. Once committed, its
files must never be changed, moved, or deleted. Corrections require a new
release ID. Channel promotion changes only `channels/stable.json`.
