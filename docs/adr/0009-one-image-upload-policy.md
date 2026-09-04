# One image upload policy, one owner of each image column, and cleanup after the row

The MIME allowlist, the size cap and the guard live in `src/lib/image-upload-policy.ts`, client-safe, and every upload surface reads them; a test walks `src` and fails any other file that names two image types, because three copies had drifted. An upload stores the object and returns its key and writes no row: the caller passes the key to the ordinary update, so an image change is an ordinary edit that reaches the diff and the edit log. The update is the only writer of the column, and both create paths refuse a key outright because the key is `<domain>/<id>/` and the id does not exist until the insert does.

The old object is deleted after the row write lands, never inside the transaction, since a rollback would destroy the object the surviving row still points at, and only when the key is inside the row's own prefix, checked by one predicate that also serves the write guard. The column is client-writable, so an unscoped delete would let a caller point at another row's key and have the next save destroy it. Hard delete cleans up; soft delete keeps the row and so keeps the image.

## Consequences

The write guard checks the change, not the content: legacy rows hold absolute URLs from before uploads, and checking content would make them uneditable. A row that already holds a bad value keeps it until an operator clears it with the script `DEPLOYMENT.md` names.
