# Map format compatibility

Q3Edit reads Quake III classic brushes, Q3Radiant `brushDef`, `patchDef2`, and
Q3Radiant `terrainDef` blocks. Entity epairs, face flags, patch header flags,
brush-primitive matrices, terrain sample materials, and Q3Edit group comments
round-trip structurally.

| Source construct | Editable | Save behavior |
| --- | --- | --- |
| Entity epairs | Yes | Preserved structurally; escaping and ordering may normalize after edits |
| Classic brush | Yes | Preserved structurally |
| `brushDef` | Yes | Preserved structurally, including brush-local epairs |
| `patchDef2` | Yes | Preserved structurally |
| `terrainDef` | Yes | Preserved while its regular lattice remains serializable |
| `//` comments and whitespace | No | Original source is returned byte-for-byte until the first edit |
| Unknown nested blocks such as `brushDef3` | No | Catalogued with source lines; an edited map requires reviewed lossy export |

An unedited opened map is saved from its original source, preserving comments,
formatting, and unsupported blocks byte-for-byte. After an edit, Q3Edit
normalizes supported content. If the source contains comments or unsupported
blocks, normal Save displays the affected lines and is cancelled by default.
Confirming the warning explicitly exports only the editable representation.

Compiler output is always generated from the supported editable representation
and strips Q3Edit-only metadata.

## Linked geometry groups

Linked groups use ordinary flattened brushes and patches, so compiled maps and
other editors see complete valid geometry without understanding Q3Edit
instances. A `group_info` entity records the source group and instance offset in
`_q3edit_link_source_group` and `_q3edit_link_offset` epairs. Q3Edit reconstructs
that relationship on load and keeps each locked instance synchronized when its
source geometry changes.

Linked groups intentionally cover brush and patch geometry only. Point entities
and entity properties remain independent. Saving through another editor may
remove the Q3Edit metadata; the flattened geometry remains intact, but the link
cannot be reconstructed. If only part of the metadata survives, the Groups panel
marks the instance as a broken link so it can be explicitly unlinked.
