# dsh-symlink-to-copy removed for dsh-v0.2.0-rc.2

`dsh-symlink-to-copy` removed for `dsh-v0.2.0-rc.2`: upstream app-boot no longer creates profile
symlinks (runtime resolution creates no links; entries occupy `$DSH_HOME/profiles/node_modules`
directly), so the HarmonyOS symlink→cpSync fallback has no code to patch. No replacement needed.
