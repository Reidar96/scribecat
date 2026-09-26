# Changelog

## [0.24.3] - 2026-09-26

### New features and improvements
- Show the number of direct notes and subfolders on every folder card in File Viewer, alongside the modified date.
- Improve the built-in PDF reader with direct page jumping and a **Copy page text** action.
- Let a local PDF linked from a Markdown note open beside that note in desktop split view using the same PDF reader.
- Keep split PDFs attached to their owning Markdown tab instead of creating a separate PDF tab. Switching away hides the PDF, returning to the owner restores it, and closing the owner closes the PDF attachment.
- Mark tabs that currently have an attached PDF with a small PDF badge.

## [0.24.2] - 2026-09-25

### Fixes and improvements
- Add **Open selected in split view** and **Open selected as tabs** to the File Viewer selection-mode **…** menu when exactly two Markdown documents are selected.
- Keep the same two-document and folder-exclusion rules as the existing right-click actions.

## [0.24.1] - 2026-09-25

### Improvements
- Add **Open selected in split view** when exactly two Markdown documents are selected in the sidebar file tree or File Viewer on desktop.
- Add **Open selected as tabs** for the same two-document selection in both the sidebar and File Viewer.
- Keep folder selections out of these actions so the commands only appear for two actual Markdown documents.
- Fix split layout corruption after swapping the left/right panes and then opening or replacing a document on either side.
- Hide the left/right split **+** controls until the pointer is actually over the corresponding editor edge.
- Stabilize the mobile tab bar so it stays a fixed horizontal row under the header instead of expanding into the document area.
- Add **Close all tabs** on both desktop and mobile without discarding cached drafts.

## [0.24.0] - 2026-09-25

### New features
- Add open-document tabs with a close button for every Markdown document. Tabs appear below the header on mobile and along the bottom of the desktop document panel, and can be reordered by dragging.
- Add a desktop-only two-document split editor with one shared formatting toolbar and an adjustable divider.
- Open another document on either the left or right side from edge **+** pickers, by dragging a Markdown file from the sidebar, or by dragging an open tab.
- Show a clear half-width drop preview on the side where a dragged document will open.
- Add a center-divider swap control to exchange the left and right documents.
- Add close and replace controls to both split panes; closing either side leaves the other document open as a normal single editor.
- Keep each open document's unsaved content in the existing document cache while switching tabs or editing the second pane.

## [0.23.7] - 2026-09-25

### Fixes and improvements
- Fix File Viewer manual reordering so multi-column grids use left/right hover and drop indicators, while single-column layouts keep the existing top/bottom behavior.
- Keep Journal and Tasks storage out of Graph View: their Markdown files and folders are excluded, tags originating only from those files disappear, and links to those hidden files are not added to the graph.

## [0.23.6] - 2026-09-25

### Fixes and improvements
- Lazy-load diary gallery images and overview thumbnails near the viewport, and render the diary overview incrementally as you scroll.
- Add a red **Delete entry** action at the bottom of an open diary entry.
- Support the existing diary delete context menu with long-press on touch devices as well as right-click on desktop.
- Show a **+** on previous/next day navigation when that adjacent day has no diary entry yet, making it clear that navigation will create one.

## [0.23.5] - 2026-09-25

### Fixes and improvements
- Add **Change order** to the Calendar image context menu, including the same long-press menu on touch devices.
- Open a dedicated image reordering mode that uses Pointer Events for reliable finger drag-and-drop, live card movement and edge auto-scroll on mobile.
- Keep the existing desktop HTML5 image drag-and-drop behavior unchanged unless the explicit reordering mode is opened.

## [0.23.4] - 2026-09-25

### Fixes and improvements
- Replace the File Viewer multi-selection **Move to…** button with a compact **…** menu containing the relevant batch actions from the right-click menu: Duplicate, Copy, Move to…, Export, Export manuscript, and Delete.
- Keep **Select all** and **Clear selection** directly visible while leaving single-item right-click behavior unchanged.

## [0.23.3] - 2026-09-25

### Fixes and improvements
- Add a visible **Move to…** action to File Viewer multi-selection, so selected files and folders can be moved directly after marking them without first opening a right-click menu.
- Keep single-item right-click behavior unchanged while making the multi-selection action bar wrap cleanly on narrow and mobile layouts.

## [0.23.2] - 2026-09-25

### Fixes and improvements
- Keep File Viewer manual drag-and-drop reordering available while multi-selection mode is active. Reordering now starts from the visible drag handle, so selecting cards and sorting them no longer disable each other.
- Show a clickable checkbox on every File Viewer card while selection mode is active, with **Select all** and **Clear selection** actions above the grid.
- Keep right-click and long-press context menus independent from selection state: opening a menu no longer silently selects the clicked card.
- Reserve the File Viewer drag handle and manual-sorted file-tree rows for drag gestures on touch devices, while suppressing the synthesized touch context-menu event that previously competed with dragging.
- Remove the unavailable **Copy image** action from image menus; **Download image** remains available.

## [0.23.1] - 2026-09-25

### Fixes and improvements
- Prevent ScribeCat long-press menus from appearing together with the browser/OS touch callout on mobile file, folder, category and image targets.
- Add **Copy image** and **Download image** to image context menus in notes, Calendar entries and the full-screen image preview. The same compact ScribeCat menu is used across these views.
- Replace the editor's native right-click menu with a limited ScribeCat copy/paste menu. Selected text keeps the formatted, Markdown and plain-text copy choices; Paste is available without exposing the platform-specific browser menu.
- Keep task category actions and sorting beside the category heading on narrow screens instead of wrapping them below the title.


## [0.23.0] - 2026-09-25

### Improvements
- Replace Tasks category sorting by recently modified with **Name, Date and Manual**. Date sorting puts undated tasks last, and existing vault settings that used the old recently-modified option migrate to Date.
- Centralize internal `scribecat:*` task metadata parsing and serialization so invisible Markdown metadata has one implementation and remains extensible.
- Move category actions into a compact `…` menu on small screens while keeping the main rename/delete controls visible on desktop.
- Add long-press context menus on touch devices for task categories, files and folders, matching desktop right-click behavior.
- Add category duplication and “Move all tasks…” actions. Deleting a category now moves its tasks to **Uncategorized** instead of deleting the tasks, while keeping the user in the resulting category context.
- Share the core file/folder context-action model between the sidebar and Start/folder File Viewer: rename, duplicate, copy, move, export and delete use the same action surface.
- Make note copy/move attachment-aware. Referenced images and document links under `_attachments` follow the Markdown file; moving a note only removes the old attachment copy when no other Markdown file still references it.
- Make folder copy/move preserve the full folder tree, including nested `_attachments`, empty subfolders, manual ordering and folder/file icons.
- Add File Viewer multi-selection with Ctrl/Cmd-click or selection mode. Selected entries can be duplicated, copied, moved, exported or deleted together; Delete/Backspace deletes, F2 renames one selected entry, and Ctrl/Cmd+D duplicates the selection.
- Add a folder-background context menu in File Viewer with New note, New folder, Paste and sort choices.


## [0.22.20] - 2026-09-25

### Fixes and improvements
- Fix task sorting so “recently modified” is based on the individual task/group rather than the category Markdown file. ScribeCat stores the task edit timestamp as an invisible HTML comment on the Markdown task line, keeping Markdown as the source of truth.
- Keep alphabetical sorting task-based, while Manual continues to follow the actual Markdown order inside category files. Time-based views keep date groups stable.
- Keep a newly created task at the top of the current view while it is being edited.
- Move category rename/delete controls out of the category scroller on both mobile and desktop. When a category is open, labelled “Rename” and “Delete category” actions are shown in the category heading instead of the passive check icon.
- Add right-click actions to task categories for rename and delete.
- Add right-click menus to notes and folders in Start/folder collection views with the relevant sidebar actions: rename, duplicate notes, move, export, Markdown/ZIP download where available, print notes, reveal local folders, and delete.


## [0.22.19] - 2026-09-25

### Improvements
- Add clear drag-and-drop insertion feedback for tasks and subtasks, including a faded source and visible before/after insertion marker.
- Allow manual reordering of main tasks inside the same Markdown category file. In Today, week, month and next-month views, manual reordering is additionally limited to tasks with the same date; unavailable targets are visibly greyed out.
- Add task sorting by name, recently modified and manual order, using the same menu pattern as the file sidebar. The task sort preference is stored with the vault.
- Insert new tasks at the top of their Markdown category and keep a newly created task at the top of the manual view while it is being worked on.
- Show “Ingen dato” / “No date” when a task has no deadline instead of an empty date field.
- Add the sidebar sort menu to folder/Start collection views and support manual drag-and-drop reordering of cards when Manual sorting is selected.
- Create notes from the collection view directly with their final filename, removing the temporary “new note” flash and rename delay.
- Avoid rewriting the vault manual-order sidecar when an existing Markdown file is merely updated, reducing unnecessary writes during task edits.


## [0.22.18] - 2026-09-25

### Improvements
- Create a new task directly as a normal Markdown-backed task row and focus/select its title instead of opening a separate creation form.
- Create a new subtask as a real subtask row directly below its parent, then focus/select its title for immediate editing.
- Insert new subtasks first under their parent and allow active sibling subtasks to be reordered with the existing drag handle.
- Keep subtask reordering inside the same parent and separate from dragging main tasks between categories.
- Apply contextual defaults when creating tasks from Today, week, month, next month, category and tag views so the new task stays visible in the current view.
- Align the mobile editor header height, spacing and sidebar/title position with Start, Calendar, Graph and Tasks.
- Remove the obsolete task-creation form styles now that task creation happens inline.


## [0.22.17] - 2026-09-25

### Fixes and improvements
- Move the task priority dots to the lower-right corner of each main task card, with reserved space so metadata does not overlap them.
- Prevent a stale file-watcher read from briefly flipping a task's completed state back while the updated Markdown is being written.
- Keep the delete button for completed subtasks pinned to the far right on narrow screens as well as desktop.


## [0.22.16] - 2026-09-25

### Fixes
- On mobile, remove the standalone X from the sidebar content and place a dedicated collapse-sidebar button beside Settings instead. Desktop sidebar controls are unchanged.
- Keep completed subtasks compact while restoring the delete button alongside the checkbox and title.


## [0.22.15] - 2026-09-25

### Fixes and improvements
- Restore the Calendar, Graph and Tasks shortcuts on the mobile Start view, including wider mobile/tablet layouts where the previous React and CSS breakpoints could disagree.
- Place the split new-folder/new-note tile after all existing folders and notes in folder collections.
- Keep completed subtasks compact while restoring their checkbox so an individual subtask can be marked incomplete again.
- Keep subtask deadline, category, tags and priority hidden as a presentation choice only; the Markdown task data remains unchanged on disk.
- Make Tasks feel faster by refreshing task Markdown only when task files change, progressively showing categories instead of waiting for every category file, and reflecting pending Markdown writes immediately in the view.


## [0.22.14] - 2026-09-25

### Fixes and improvements
- Finish the split create tile in Start/folder collections with inline naming for folders and notes, so creation stays in the view where it was started.
- Create new collection entries inside the folder currently being viewed and keep the collection open after creating a note.
- Respect the configured custom Tasks folder when hidden task storage is filtered from Start and folder collections.
- Preserve the 0.22.13 graph-physics and compact-subtask changes while shipping them through a verified release build.


## [0.22.13] - 2026-09-25

### Improvements
- Show Graph note/folder structure immediately while Markdown metadata is still being scanned.
- Give graph nodes more natural breathing room while keeping the rounded bubble layout.
- Keep graph physics active during dragging so nearby nodes move aside like barriers instead of being crossed through.
- Wake and settle the graph again after drag interactions, with fewer and stronger layout steps for faster stabilization.
- Make active subtasks visually lighter by hiding deadline, category, tags and priority while preserving all Markdown-backed data.
- Keep active subtask notes editable without expanding the metadata row.
- Reduce completed subtasks to a title-only presentation.
- Restore a small, even amount of space and padding between every task row so compact groups still have air.
- Add a split create tile to folder collections: folder on the left, note on the right, creating directly inside the currently open folder.


## [0.22.12] - 2026-09-25

### Improvements
- Extend Graph folder relationships through every ancestor folder all the way to Start/root, instead of linking notes only to their immediate folder.
- Add a configurable Tasks storage folder under Open folder settings, matching the existing configurable Diary folder.
- Keep subtasks attached to their main task in Today, week and month views; subtasks no longer need or show their own deadline.
- Keep completed subtasks compactly beneath an active main task instead of moving them into the separate Completed section.
- Completing a main task now completes all of its subtasks and moves the whole group together into Completed.
- Prevent subtasks from being dragged independently away from their main task.
- Tighten subtask styling and remove the extra lower divider so a task group reads as one compact block.


## [0.22.11] - 2026-09-25

### Improvements
- Move completed tasks into a collapsible **Completed** section below active tasks.
- Keep sidebar/task-filter counts focused on active work while completed items remain available inside the selected view.
- Add one-level Markdown subtasks beneath a main task using ordinary indentation (`  - [ ] ...`).
- Add a compact inline subtask composer to main tasks.
- Keep parent/subtask relationships when moving a main task to another category.
- Deleting a main task also removes its nested subtasks, matching the visible hierarchy.

## [0.22.10] - 2026-09-24

### Fixes
- Make Start a stable navigation destination by clearing only the active editor selection while preserving the previous note and unsaved draft in memory.
- Make Home buttons in collection views navigate explicitly to Start instead of merely closing the collection and revealing an older selected note.
- Never show a Home button on the Start/root collection itself.
- Prevent Diary and Tasks folders from flashing on Start or in the sidebar while per-vault visibility settings are still loading.
- Tie the startup visibility gate to the exact active vault path so stale settings from another or previous vault cannot render for a frame.

## [0.22.9] - 2026-09-24

### Fixes and improvements
- Make the browser image picker more reliable on iPhone/iPad by keeping the file input attached to the document while the native picker is open.
- Accept and serve modern phone photo formats including AVIF, HEIC and HEIF, and add a suitable extension when a picked image has no filename extension.
- Increase the text size for Diary overview, search results and tag-filtered day results.
- Recalculate the self-sizing Diary note field when a hidden mobile day pane becomes visible, so existing text expands the field immediately without requiring a keystroke.
- Make clicking an already-open Calendar, Graph or Tasks sidebar button return directly to Start instead of revealing the selected Markdown file.
- Align the Start header padding with Calendar, Graph and Tasks on mobile, while removing the redundant house icon from the Start title.

## [0.22.8] - 2026-09-24

### Improvements
- Add previous/next day controls to the desktop diary entry view.
- Group both day-navigation arrows together on the right side of the date field.
- Reuse the existing mobile date-navigation rules, including disabling forward navigation at today.

## [0.22.7] - 2026-09-24

### Improvements
- Introduce a shared UI typography scale for compact, small, medium and heading text.
- Reduce oversized task-navigation text so filters, categories and the new-task action match the rest of the interface better.
- Increase small Calendar/Diary text such as search fields, day labels and tags for better balance and readability.
- Align typography in Start cards, Graph filters, sidebar search/tags and the working-set list.
- Keep document/prose text and touch-focused mobile form inputs separate from the UI scale.

## [0.22.6] - 2026-09-24

### Fixes
- Apply the same hidden-storage rules to the Start/folder collection view as the sidebar, so hidden Diary and Tasks folders no longer reappear on Start.
- Hide the active server-vault address row from the sidebar, so the server IP/host is no longer shown there.

## [0.22.5] - 2026-09-24

### Improvements
- Move the desktop “Nytt gjøremål” button above “Alle”.
- Match the new-task button height and typography to the “Alle” filter button.
- Keep the phone new-task control as a compact + before “Alle”.
- Revert the mobile task-category chips to the previous category layout from 0.22.3.

## [0.22.4] - 2026-09-24

### Improvements
- Make the desktop new-task trigger span the full task sidebar width and label it “Nytt gjøremål”.
- Keep the mobile new-task trigger as a compact + button and place it before “Alle”.
- Render task categories on phones as compact wrapping chips instead of a full-width horizontal bar.
- Keep category count, rename and delete controls directly on each mobile category chip.

## [0.22.3] - 2026-09-24

### Improvements
- Add a right-click **Delete image** action to images in ordinary notes.
- Add the same right-click image deletion to diary/calendar image cards.
- Removing an image deletes its Markdown reference immediately; when the note is saved, the attachment file is removed from disk only if no other Markdown file in the vault still references it.
- Shared images and external image URLs are therefore never removed from local storage by mistake.

## [0.22.2] - 2026-09-24

### Improvements
- Add a right-click delete action to diary overview/search entries, using the same confirmation dialog as normal note deletion.
- Move the server-connection action out of the sidebar vault switcher and into Settings > Server.
- Replace close X buttons in Calendar, Graph, Tasks and collection views with a Start/Home action, and align the primary view headers to the same height.
- Hide the new-task composer behind a + button placed next to the task time filters.
- Replace the native task-category delete prompt with ScribeCat's standard delete dialog.
- Keep task categories visible on their own row below the time filters on phones.
- Tighten the spacing between diary tags and the note field.

## [0.22.1] - 2026-09-24

### Improvements
- Show Calendar, Graph and Tasks shortcuts in the mobile sidebar as well as on the Start screen.
- Make the diary note field start compact and grow automatically with its text instead of reserving a large empty area.
- Add horizontal swipe navigation between images in the full-screen image viewer.
- Split the Open folder settings into Document, Diary, File list and Folders sections.
- Move the “Hide Tasks folder” option into Open folder settings and store it with the vault.
- Add a “Next month” deadline view to Tasks.

## [0.22.0] - 2026-09-24

### Highlights
- Simplify the Calendar, Graph and Tasks shortcuts to icon-only primary buttons, and make closing any of those views return to Start instead of reopening the currently selected Markdown note.
- Remove the standalone delete button from the sidebar toolbar; deletion remains available through selection actions and the file-tree context menu.
- Add Today, This week and This month task views based on deadlines, above the category list.
- Extend portable task Markdown with optional notes, tags and three-level priority while keeping existing plain checkbox tasks compatible.
- Add category rename/delete and drag-and-drop task moves between categories.
- Add task-tag filtering and an option to hide the `Gjøremål/` storage folder from the normal file tree and tag overview, matching the diary's hidden-storage behaviour.
- Sort open tasks by priority (red/high, yellow/medium, green/low) before deadline.

## [0.21.0] - 2026-09-24

### Highlights
- Add a dedicated Markdown-first Tasks view alongside Calendar and Graph.
- Store each task category as its own ordinary Markdown document under `Gjøremål/` (for example `Gjøremål/Jobb.md` and `Gjøremål/Fritid.md`). Tasks without a category use `Gjøremål/Uten kategori.md`.
- Use portable Markdown checkboxes such as `- [ ] Send rapport 📅 2026-10-01`; the deadline is optional, and manually edited checkbox lines in category documents are detected automatically.
- Add category filtering, inline task completion/editing, optional deadline editing and deletion in the Tasks view.
- Promote Calendar, Graph and Tasks to three primary buttons at the top of the desktop sidebar, with the existing file-management actions kept as smaller controls underneath.
- Add Calendar, Graph and Tasks as three prominent shortcuts at the top of the Start view on phones.

## [0.20.8] - 2026-09-24

### Improvement
- Match the mobile month and year selector height to the previous/next calendar buttons for a more even calendar header.

## [0.20.7] - 2026-09-24

### Improvement
- Add a close/back button to the diary Overview on phones. It mirrors the search/tag result close control and returns directly to the calendar view.

## [0.20.6] - 2026-09-24

### Improvements
- Restore a true masonry-style diary gallery while preserving row-prioritized Markdown order and the live drag-and-drop behaviour from 0.20.5.
- Size masonry rows from each rendered image card so portrait, landscape and square images pack tightly without reverting to column-first ordering.
- Simplify calendar controls to month and year selectors only; keep Today and previous/next month navigation.
- Show the Overview button on desktop as well as mobile.
- Give the mobile year selector more width so the complete four-digit year remains visible, and shorten the Norwegian mobile button label from “Se kalender” to “Kalender”.

## [0.20.5] - 2026-09-24

### Improvements
- Make the diary gallery strictly row-first: images 1, 2 and 3 occupy the first row before 4, 5 and 6 continue below, instead of CSS columns filling top-to-bottom.
- Rework diary image drag-and-drop so cards reorder live while dragging and nearby images visibly move into their new positions.
- Keep stable image-card identities while reordering so already loaded images are reused instead of being remounted/reloaded after every move.
- Use the actual image card as the drag preview and keep the dragged card visible in the gallery until the Markdown order is committed on drop.

## [0.20.4] - 2026-09-24

### Improvements
- Remove the per-image order strip with arrows and image numbers from the diary gallery while keeping drag-and-drop reordering.
- Add a diary overview that appears when no date is selected and uses the same card layout as search/tag results.
- Show the first image from each diary entry as a square-cropped thumbnail on the right side of overview, search and tag result cards.
- Add an Overview button on both the phone calendar screen and phone entry navigation so the full diary list is always one tap away.

## [0.20.3] - 2026-09-24

### Improvements
- Rework Graph View into a softer organic bubble: disconnected groups use a spiral layout instead of rectangular cells, and focusing a node pushes unrelated nodes away while keeping its direct neighbours close. Click once to focus a node and click it again to open it.
- Remove the duplicate diary "Add images" toolbar button. The gallery add tile remains the single image entry point and already supports selecting multiple images at once.
- Allow multiple image files to be dropped directly onto the diary gallery add tile and store them through the same ordinary Markdown image flow.
- Increase phone touch targets for the diary's calendar controls, day-navigation bar, tag chips, tag input and search controls.

## [0.20.2] - 2026-09-24

### Improvements
- Make the diary text box directly editable at all times; remove the extra Edit and Full Markdown actions from the diary view.
- Move per-day tag editing directly below the locked date, while the calendar column now shows an aggregated clickable tag list. Tag filters open matching diary days as a result list in the main view.
- Add diary full-text search below the calendar. Search results use the same dated result-list layout as tag filters and open the selected day directly.
- Stop calendar navigation in the future while extending the year picker back to 1900 (or earlier when imported diary files require it).
- Change the image gallery to a responsive masonry-style layout with image shapes clamped between 16:9 and 9:16.
- On phones, hide the calendar after opening a day and add previous-day, calendar and next-day navigation above the entry.

## [0.20.1] - 2026-09-24

### Improvements
- Keep the diary date separate and read-only in the diary view, with the weekday shown before the full date. Existing Markdown date headings are preserved on disk but no longer appear inside the editable daily text.
- Move diary tags below the calendar and add inline controls for adding and removing YAML tags.
- Allow previous/next browsing in the enlarged diary image viewer, including keyboard arrow navigation and an image counter.
- Show three gallery columns on large screens and two on narrower layouts.
- Remove the explanatory helper text from the diary view and diary-specific vault settings.

## [0.20.0] - 2026-09-24

### Highlights
- Add a Daily Notes calendar beside Graph View and Settings in the sidebar. It opens the current month, supports month/year/date navigation, marks dates that already have notes, and creates missing notes on click.
- Keep the diary fully portable: dates are discovered from ordinary Markdown paths, with selectable Norwegian, ISO and compact year structures. No journal database or proprietary file format is introduced.
- Add a dedicated diary reading/editing view with Markdown text, YAML tags and a two-column image gallery. Images are stored as normal Markdown references below a `## Bilder` section, can be added from the gallery, previewed, dragged/reordered, or moved with accessible arrow controls.
- Add per-vault diary settings for the diary folder, filename structure and optional sidebar hiding. Hiding the diary also removes diary-only tag occurrences from the normal sidebar tag overview without deleting or changing the files.
- Existing Markdown dropped into the configured date structure is detected automatically, and legacy image-table entries are recognized by the diary gallery.

## [0.19.1] - 2026-09-24

### Improvements
- Make the graph layout form clearer connection-based clusters: directly connected nodes stay close, unrelated nodes repel over a longer distance, and disconnected groups get separate areas of the canvas.
- Reduce the old central pull so the graph reads as distinct islands and strings instead of one dense central cloud.

## [0.19.0] - 2026-09-24

### Highlights
- Add a global Graph View, opened from the sidebar, that builds a live network directly from ordinary Markdown links, YAML tags and note folder placement.
- Graph nodes keep ScribeCat navigation intact: notes open the editor, tags open the tag grid and folders open the folder grid.
- The graph is interactive: drag nodes, pan and zoom the canvas, fit the whole network to the window, hover to focus immediate connections, and toggle notes, tags or folders independently.
- No graph database or proprietary link syntax is introduced; the vault's Markdown files remain the source of truth.

## [0.18.5] - 2026-09-24

### Improvements
- Center the table row/column add button on the active cell edge instead of the whole table.
- Show Start/Home as a clickable root crumb while editing a note, and remove spacing after separators in tag result paths.
- Add a delete action for the open note to the editor's overflow menu, using the existing confirmation flow.
- Add a sidebar button that collapses every expanded folder at once.

All notable changes to ScribeDog are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.15.1] - 2026-09-22

### Bug Fixes
- The emoji picker showed a bare grid with no search and no categories in the installed app, and inline styles were refused elsewhere in the editor. Tauri adds a nonce to the app's content security policy, and a nonce makes the browser ignore the "unsafe-inline" that lets a stylesheet be applied from script. Only the desktop builds were affected; the browser edition never sees that policy

## [0.15.0] - 2026-09-22

### Highlights
- Tables in the editor: insert, edit, add and remove rows and columns, with a guard that stops content the Markdown export cannot represent from being silently lost
- Icons for files and folders: pick an emoji from a row's context menu, or click an icon in the path above a note. Icons are stored in the vault (`.scribedog/icons.json`), not in the notes, so setting one is not an edit: no unsaved changes, no new version, nothing in an export or a diff. They travel with the folder and follow a file when it is renamed or moved inside ScribeDog
- Open a folder in the system file manager from its context menu in the tree

### Improvements
- New files and folders are named in the file tree now, next to the siblings whose names they have to differ from, instead of in the path above the editor. On a phone the file list stays open, so creating several notes in a row no longer means reopening it every time. A new folder opens its folder note once the name is confirmed, so Escape leaves it as "New folder" instead of pulling you into a document
- The path above a note scrolls instead of being cut off. Truncating could only ever show one end of it, and the folders it hid are what says where a note lives; on a phone renaming has moved to the file tree with it

### Bug Fixes
- Image selection and stray blank lines in the editor
- The banner that pauses saving when a note cannot be written as Markdown showed no text

## [0.14.1] - 2026-09-21

### Bug Fixes
- Closing the window with the title bar button works again. 0.14.0 intercepted the close request to write the hot-exit drafts first, but lacked the permission to close the window afterwards, so the app could only be ended from the task manager

## [0.14.0] - 2026-09-21

### Highlights
- Hot exit: unsaved edits survive a restart. Dirty notes are kept as drafts in `.scribedog/drafts/` (in the browser edition: in local storage) and come back exactly as left when the vault is opened again; switching notes, opening another vault and closing the window no longer ask about unsaved edits
- "In progress" list above the file tree: pin notes (double-click, Enter, context menu) or, with a setting, let edited notes join automatically; close entries with the cross, middle-click or the new remappable Ctrl+W; the list is stored per vault and restored on open
- Save-time conflict check: a manual save over a file changed outside the app stops and asks (overwrite or cancel), and the disk version goes into the history first; an auto-save never overwrites, it leaves the note dirty until the next manual save
- URLs inside code blocks are clickable

### Bug Fixes
- Keep the toolbar in view after a large paste
- Undo/redo from a touch screen no longer raises the on-screen keyboard when the editor wasn't focused

## [0.13.1] - 2026-09-20

### Bug Fixes
- Stop code block controls from covering the first line: the copy and language buttons now sit as two small badges on the block's top edge and only show while the caret is inside the block

## [0.13.0] - 2026-09-20

### Highlights
- Highlight text with a marker (`==text==`): toolbar button, Ctrl+Shift+H, or a marker mode for the pointer; the highlight goes into every export
- Auto-save (off by default): saves the note after a pause in typing and on the way out of a note
- Paste Markdown: pasted plain text with Markdown markers becomes headings, lists, tables and bold right away; Ctrl+Shift+V pastes the raw text
- Check spelling and grammar of the whole document without selecting text first (Ctrl+Shift+X)
- Zen mode text zoom: pinch on touch screens, Ctrl+wheel on the desktop, remembered separately from the document font size

### Improvements
- Show the note title as a breadcrumb; with folder notes on, each crumb opens that folder's note
- File tree: hide the .md extension, drop the file icons, add "New folder" to the context menu
- Heading numbering: choose whether numbers show everywhere or only in the outline, and whether the `{-}` marker is always visible or only in the heading being edited (#47)
- Add undo and redo buttons to the toolbar
- Phone layout: group the AI actions into one menu and move the AI quick settings into Settings
- Swipe from the left edge to open the file list on phones, swipe back to close it
- Download the server certificate from Settings, Account in the browser, with a short explanation and a link to the install guide
- Slightly lighter default text in the dark theme
- Grammar check now tolerates the loose JSON of small local models (prose around the array, fences mid-sentence, list-shaped answers)
- AI error messages can be dismissed with an X
- Disable page pinch zoom on phones and tablets; the layout is built for the width it has

### Bug Fixes
- Fix code blocks hanging the tab on Android
- Fix the on-screen keyboard opening on Android when ticking a checkbox or tapping an image
- Fix extra spacing below indented checkboxes that sometimes remained after removing them
- Fix Ctrl+Shift+Up/Down not moving a list item past a blockquote, image or paragraph next to the list

## [0.12.2] - 2026-09-19

### Bug Fixes
- Fix the app failing to load a note (and then failing to start at all) once it contains an image whose file name is purely numeric, such as photos from a phone camera

## [0.12.1] - 2026-09-19

### Highlights
- Add image picker on mobile/web and rework phone toolbar
- Serve the CA certificate over HTTPS for direct download

### Improvements
- Make docker-compose.yml's data dir fallback generic
- Rename person slots and make base paths env-driven

### Bug Fixes
- Keep context menu closed on Android double-tap selection

## [0.12.0] - 2026-09-18

### Highlights
- Add ScribeDog Server Edition: run ScribeDog as a self-hosted web app with a full file API, live updates, and a PUID/PGID Docker entrypoint
- Open a vault on a ScribeDog server directly from the desktop app, next to local folders
- Let a remote vault download notes and folders directly
- Enable folder notes
- Add automatic heading numbering

### Improvements
- Restructure the settings dialog into grouped settings pages
- Add a duplicate-file action to the file tree context menu
- Add a selection context menu with copy variants / copy a selection as Markdown or bare text on touch
- Add a paper-white surface option for dark theme

### Bug Fixes
- Fix outline active-heading detection at the scroll limit
- Scale default text opacity per theme
- Keep inline marks when only part of a block is serialized
- Pick a certificate for browsers that open the site by IP
- Keep a note ending in a code block clean on open

## [0.11.0] - 2026-09-12

### Highlights
- Add a live outline to the details panel: jump to any heading with a click or the keyboard, tracks the section you're in as you type or scroll

## [0.10.1] - 2026-09-11

### Bug Fixes
- Report skipped plan steps instead of always marking them done

## [0.10.0] - 2026-09-02

### Highlights
- Add a portable Windows build (ScribeDog_X.Y.Z_portable.zip) alongside the installer: no installation, no admin rights, no registry entries or Start Menu shortcuts.

## [0.9.1] - 2026-08-25

### Bug Fixes
- Fix AI chat failing with Ollama after a tool was used ("Value looks like object, but can't find closing '}' symbol")

## [0.9.0] - 2026-08-05

### Highlights
- Add a vault-wide chat agent with staged changes, checkpoints, and file tools (read, write, edit, rename, delete, search) across the whole vault, not just the open document

## [0.8.3] - 2026-07-30

### Bug Fixes
- Fix local AI connections (Ollama, Jan.ai, LM Studio) returning 403 in the installed app, while working fine in development

## [0.8.2] - 2026-07-30

### Highlights
- Enable find/replace without an open file, with cumulative folder match badges when searching across the vault
- Default the file tree to Manual sort order, so drag & drop works right away — the starting order is the familiar folders-first alphabetical one

### Improvements
- Add spacing to the shortcuts-settings dialog

### Bug Fixes
- Normalize pasted slices with stray hard breaks

## [0.8.1] - 2026-07-29

### Highlights
- Add fuzzy/approximate text matching with punctuation tolerance
- Add theme boot and enhance import/drag-drop UX
- Add retrieval-augmented generation with indexing

### Improvements
- Consolidate shortcuts into settings dialog

## [0.8.0] - 2026-07-28

### Highlights
- RAG: retrieval-augmented generation with document indexing and search
- RAG: knowledge base folder controls and file attachments
- Chat: handle links in AI-generated answers

## [0.7.1] - 2026-07-27

### Highlights
- Add details panel showing document stats (word count, reading time), links, and backlinks
- Improve PDF export quality with manuscript rendering and expanded font support

## [0.7.0] - 2026-07-26

### Highlights
- Add AI chat panel with agent tools and context management
- Add request timeout and running indicator for active session
- Add document versioning with diff preview and restore
- Add document links, navigation history, and customizable shortcuts

## [0.6.0] - 2026-07-23

### Highlights
- Add zen mode for distraction-free writing

## [0.5.4] - 2026-07-23

### Highlights
- Add code language picker for syntax highlighting

### Bug Fixes
- Write grammar-check explanations in the app UI language
- Honor the image display width in PDF, DOCX and ODT export
- Stop moving a file from deleting its images
- Never rewrite image paths that point outside the vault
- Persist rewritten image paths when moving an opened file

## [0.5.3] - 2026-07-22

### Bug Fixes
- Voice transcription is roughly 4x faster — whisper.cpp was being built
  without optimizations in release binaries

## [0.5.2] - 2026-07-20

### Improvements
- AI thinking mode is now disabled by default

## [0.5.1] - 2026-07-19

Improve voice transcription performance and language handling.

## [0.5.0] - 2026-07-19

### Highlights
- Add voice input with model download and streaming transcription
- Add custom assistants management with templates and settings
- Add zoom control, find/replace panel, and improved UI toggles

## [0.4.1] - 2026-07-19

### Highlights
- Add document printing with print-optimized styling
- Add file selection and batch delete/export operations

## [0.4.0] - 2026-07-18

### Highlights
- Add document import for PDF, DOCX, HTML with image extraction
- Add export to PDF, DOCX, ODT, HTML with emoji and sans-serif styling

## [0.3.0] - 2026-07-14

### Highlights
- Add AI-powered spelling and grammar check
- Add support for 10 languages: English, German, Spanish, French, Italian, Japanese, Portuguese, Russian, Ukrainian, and Chinese

## [0.2.0] - 2026-07-13

### Highlights
- Add AI diff review interface for before-accept workflow
- Add drag-and-drop file organization with vault metadata

## [0.1.0] - 2026-07-12

### Highlights
- Initial release of ScribeDog
