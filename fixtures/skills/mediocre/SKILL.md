---
name: mediocre
description: Helps with various document processing needs and workflows.
---

# Document helper

This skill supports a broad range of document processing scenarios, from simple format conversion to more involved restructuring of long reports. The sections below describe the different areas the skill touches on and provide background on how the various pieces fit together. Most of the material is descriptive rather than procedural, because document work tends to vary a great deal from one request to the next and rigid procedures rarely survive contact with real files.

The general philosophy behind the skill is that documents are containers for structure, and that structure is what users actually care about. A paragraph is not just a run of characters; it carries alignment, spacing, style references, and language tags. When a document moves between formats, the goal is to carry as much of that structure across as the target format can represent, and to degrade gracefully where it cannot.

## Supported formats

The skill is comfortable with the mainstream office formats as well as a long tail of older ones. On the word processing side that means DOCX, ODT, RTF, and the legacy binary DOC format, plus HTML and Markdown for lightweight documents. On the layout side it covers PDF in both tagged and untagged variants. For tabular material it handles XLSX, ODS, and CSV, and for presentations PPTX and ODP are supported at a basic level.

Format support is not uniform. DOCX and PDF receive the most attention because they dominate real-world traffic. The older binary formats are handled through a compatibility layer that converts them to their modern XML equivalents before any other processing happens, which means some fidelity loss is possible for documents that rely on long-deprecated features such as embedded WordArt or classic form fields.

Plain text deserves a special mention. Many pipelines treat it as trivial, but real plain text files arrive with a surprising variety of encodings, line ending conventions, and implicit structure such as indented headings or underlined titles. The skill applies a set of heuristics to recover that implicit structure so downstream conversion has something to work with.

## How the pipeline is organized

Processing happens in stages. An intake stage sniffs the file type from magic bytes rather than trusting the extension, because mislabeled files are one of the most common sources of confusion. A parsing stage builds an internal tree that represents the document independently of its source format. Transformation passes then operate on that tree, and a rendering stage serializes the tree into the requested output format.

The internal tree is deliberately richer than any single format. It records styles as named references plus resolved properties, so a transformation can either preserve the reference or flatten it to direct formatting depending on what the target format supports. It records lists as logical structures with level and numbering metadata rather than as literal bullet characters, which is what makes clean conversion between list styles possible.

Each transformation pass is small and focused. One pass normalizes whitespace, another resolves style inheritance, another rewrites internal cross references, and so on. The passes run in a fixed order, and the order matters: whitespace normalization has to happen before pagination estimates, and style resolution has to happen before any pass that reasons about visual appearance.

## Working with PDF documents

PDF is the most requested format and also the least cooperative one. A PDF file is fundamentally a set of drawing instructions, and recovering logical structure from drawing instructions is an inherently lossy exercise. Tagged PDFs make this far easier because the producer embedded the structure explicitly, and the skill uses those tags whenever they are present.

Untagged PDFs go through a reconstruction phase. Text runs are clustered into lines based on baseline positions, lines are clustered into blocks based on spacing patterns, and blocks are classified as headings, body text, captions, or page furniture using font size and position statistics gathered across the whole document. The classification is statistical, so unusual layouts can produce odd results, particularly documents that mix multiple column counts on the same page.

Extraction quality depends heavily on the producer. PDFs generated from word processors carry consistent font metrics and predictable spacing, and they reconstruct well. PDFs assembled by scanning hardware or by print drivers can place every character individually with no word or line grouping at all, and those require much more aggressive clustering before anything useful comes out.

Password protected PDFs are handled by asking the user for the password rather than attempting anything clever. Permissions flags that forbid extraction are respected and reported back to the user, since silently working around them would be inappropriate for a general purpose tool.

## Word processing formats

DOCX files are ZIP containers holding XML parts, and most of the interesting behavior lives in the relationships between parts. The main document part references styles, numbering definitions, footnotes, comments, headers, and footers, each stored separately. The skill loads the full relationship graph up front so that a transformation never encounters a dangling reference halfway through.

Styles in word processing formats form an inheritance chain: a paragraph references a style, the style references a parent style, and properties resolve through the chain with the nearest definition winning. Flattening this chain too early bloats the document with repeated direct formatting; keeping it too long makes some conversions impossible. The pipeline resolves the chain lazily, only when a target format demands concrete values.

Tracked changes are preserved through conversion when the target format supports them and applied or rejected according to user preference when it does not. Comments follow the same policy. Footnotes and endnotes convert between each other where a format only supports one of the two, with numbering adjusted to stay continuous.

## Spreadsheets and tabular data

Spreadsheet handling focuses on the data layer rather than the presentation layer. Cell values, formulas, number formats, and merged ranges are all captured, but conditional formatting rules and charts are carried through only when converting between spreadsheet formats, not when exporting to documents. Formula translation between engines is approximate: common functions map cleanly, while vendor specific ones are left as text with a note attached.

CSV input receives dialect sniffing, since the format is standardized only in theory. Delimiters, quoting styles, and header rows are inferred from the first few kilobytes of content. Ambiguous files, such as those where a semicolon could be either a delimiter or punctuation inside a quoted field, produce a summary of the interpretation chosen so the user can spot a wrong guess quickly.

Numeric precision is preserved by keeping values as strings until arithmetic is actually needed. Dates are the perennial trouble spot: a bare value like 03/04/05 is ambiguous across locales, and the skill leans on document metadata and surrounding context to pick an interpretation, noting the choice in its output when the ambiguity is real.

## Plain text and markup

Markdown output follows the CommonMark specification with tables and footnotes from the GFM extension set. When converting rich documents down to Markdown, structure that Markdown cannot express, such as text color or exotic table layouts, degrades to the nearest representable form and a short remark records what was dropped. Round tripping a document through Markdown is therefore lossy by design, and the skill says so rather than pretending the trip is free.

HTML output is deliberately conservative: semantic tags for structure, a small embedded stylesheet for appearance, and no scripting of any kind. The produced markup favors longevity over pixel fidelity, on the theory that an HTML export is usually the start of a new life for the content rather than an archival snapshot of the old one.

Reflowing text is the subtle part of markup work. Hard line breaks inside paragraphs, common in email and in text exported from terminals, have to be distinguished from intentional breaks in poetry or addresses. The heuristics look at line length distribution, punctuation at line ends, and capitalization at line starts to decide which breaks are structural and which are accidental.

## Images and scanned pages

Embedded images are extracted with their original bytes wherever possible instead of being re-encoded, because every re-encode of a JPEG loses quality. Image formats are converted only when the target document format cannot embed the original, and in that situation the conversion picks the closest lossless option available.

Scanned pages are detected by the ratio of image area to text area. A document that is entirely images of pages gets routed toward OCR, with the user informed that recognition output will need human attention for anything where accuracy matters. Recognition quality varies enormously with scan resolution, skew, and the typefaces involved, and the skill reports a rough character error estimate alongside the recognized text.

Mixed documents, where some pages are digital text and others are scans, are handled page by page so the digital pages keep their perfect fidelity. Page images are deskewed and despeckled before recognition, and the geometry corrections are recorded so coordinates can be mapped back to the original scan when needed.

## Fonts and typography

Font handling distinguishes between the font a document requests and the font actually available at rendering time. Requested fonts are recorded by family, weight, and style, and substitutions at render time follow a mapping table that pairs common commercial fonts with metric compatible free alternatives, so line breaks shift as little as possible when a substitute is used.

Embedded font subsets in PDFs complicate extraction, because a subset font may map glyph codes in a private order that has nothing to do with Unicode. The skill relies on the embedded ToUnicode tables when present and falls to glyph name analysis when they are not, flagging any text runs whose mapping remains uncertain after both attempts.

Ligatures, small caps, and other OpenType features are preserved as features rather than baked into the text where formats allow. Baking a ligature into its presentation form makes later searching and editing harder, so the text layer keeps plain characters and the style layer keeps the feature settings.

## Encodings and character sets

Encoding detection runs on every text input regardless of any declared encoding, because declarations lie more often than seems reasonable. The detector combines byte pattern statistics with language models for common languages, and a declared encoding is honored only when the observed bytes are consistent with it.

Everything internal is UTF-8. Conversions to legacy encodings on output are supported for the handful of situations that still demand them, with unmappable characters handled by a user selected policy: transliterate, replace with a marker, or stop and report. Transliteration tables cover the common European and Cyrillic cases and fall back to Unicode decomposition elsewhere.

Normalization matters more than most users expect. Two visually identical strings can differ in composed versus decomposed accents, and mixing the two in one document breaks searching and sorting. The pipeline normalizes to NFC on intake and preserves that form throughout, recording the original form only when a format specific reason requires it.

## Page layout and pagination

Pagination is estimated rather than computed exactly, because exact pagination requires a full layout engine with the precise fonts installed. The estimator uses font metrics, page geometry, and paragraph spacing rules to predict page breaks, and it lands within a page or two of the true count for typical office documents.

Section breaks, page orientation changes, and differing margins per section are all modeled explicitly. Documents that mix portrait and landscape sections keep those transitions through conversion, and formats without a section concept receive the nearest emulation, usually a page break plus adjusted table widths.

Widow and orphan control settings, keep-with-next flags, and manual page breaks are carried through as declarative properties. The estimator honors them when predicting page counts, which is where most of its remaining error comes from: interacting keep rules can cascade in ways only a full layout pass resolves.

## Headers, footers, and page furniture

Running headers and footers are extracted as templates with field codes for page numbers, dates, and document titles, rather than as literal text per page. This is what allows a converted document to keep live page numbering instead of freezing the numbers that happened to be rendered. First page and even/odd variations are modeled and preserved.

Page furniture in PDFs, meaning repeated headers, footers, and watermarks, is detected by comparing content across pages and looking for blocks that repeat with near identical geometry. Detected furniture is separated from body content so extraction does not interleave a running title into every page of body text, which is one of the most common defects in naive PDF extractors.

Watermarks receive special handling: text watermarks are recorded as document level metadata plus a style, while image watermarks are extracted once and referenced per page. Reapplying a watermark after transformation keeps its transparency and rotation settings.

## Tables

Tables are the hardest structure to move between formats faithfully. The internal model supports row and column spans, nested tables, per cell borders and shading, header row repetition, and column width policies expressed as fixed, percentage, or auto. Every conversion maps this model onto whatever the target format offers and records what could not be expressed.

Table recovery from PDFs uses ruling lines when the table has them and whitespace alignment analysis when it does not. Borderless tables are genuinely ambiguous, and the recovery pass errs toward keeping text in reading order when its confidence in a grid interpretation is low, since a wrongly imposed grid scrambles content far worse than a missed one.

Long tables that cross page boundaries are stitched back together during recovery, using column geometry continuity and header row repetition as the joining signals. The stitcher is conservative near section boundaries because two adjacent but unrelated tables with similar geometry can masquerade as one continued table.

## Styles and themes

Named styles are first class citizens through the whole pipeline. A user request to restyle a document, for example moving a report onto a corporate template, is executed by remapping style references rather than walking every paragraph, which keeps direct formatting overrides intact where authors applied them deliberately.

Theme colors and fonts, the indirection layer that lets office suites swap a palette across a whole document, are resolved or preserved depending on the target. Conversions between theme aware formats keep the indirection alive; exports to flat formats resolve the theme at that moment and note which theme was in effect.

Direct formatting that merely duplicates the underlying style is stripped during cleanup passes, because it bloats files and frustrates later restyling. Direct formatting that differs from the style is kept, since it usually encodes an author decision. The cleanup report lists how much duplication was removed.

## Metadata

Document metadata is read from every layer that carries it: the format native properties, embedded XMP packets, and file system timestamps. Conflicts between layers are resolved in that order of preference, and the full set of observed values is available on request rather than silently discarded.

Sensitive metadata is a real concern in document workflows. Author names, revision logs, comments, and hidden text can all travel with a file accidentally. A scrubbing pass can strip these categories selectively, and the skill lists exactly what was removed so the user has a record of the operation.

Custom properties used by workflow systems, such as case numbers or approval states, are preserved by default through every conversion that has anywhere to put them. Formats without custom property support receive the values as a metadata appendix when the user wants them kept visible.

## Large documents

Documents beyond a few hundred pages shift the constraints from correctness to resource management. Parsing switches to a streaming mode that keeps only a sliding window of the tree in memory, and transformation passes that require whole document context, such as cross reference resolution, run on an index built during a first pass rather than on the full tree.

Progress reporting matters at this scale. Long operations emit stage level progress so the user can tell a slow conversion from a stuck one. Partial output is produced where the format allows it, letting the user start looking at early chapters while later ones are still rendering.

Memory ceilings are respected by spilling intermediate results to temporary storage under a dedicated working directory. The spill files use a compact binary representation of the internal tree, and they are cleaned up when the operation finishes or is cancelled.

Chapter level parallelism is available for documents whose sections are independent, which is common in assembled reports where each chapter came from a different author. The splitter finds safe boundaries by looking for section breaks with no cross references spanning them, processes the pieces concurrently, and reassembles the result with continuous numbering restored at the joins.

## Batch operations

Batches are treated as a unit of work with a manifest. The manifest records every input file, the operation requested, the output produced, and the outcome, so a batch over hundreds of files produces an auditable summary rather than a pile of outputs with no explanation.

Ordering within a batch follows the manifest rather than file system enumeration order, which keeps runs reproducible across machines whose directory listings differ. Independent files are processed concurrently up to a configured limit, with the concurrency kept low enough that a single huge file cannot starve the rest of the batch.

A single problematic file does not abort the batch. The file is recorded with its diagnosis in the manifest, the batch continues, and the summary highlights the exceptions at the end. Users repeatedly report that this behavior, obvious as it sounds, is the main thing that makes large migrations tolerable.

## Temporary files and cleanup

All intermediate artifacts live under one working directory created per operation, with names derived from a content hash of the input rather than the input filename. Content addressed names make reruns idempotent: an interrupted operation resumes cleanly because completed intermediates are found by hash and reused.

Cleanup runs on both success and cancellation paths, and the working directory is removed as a unit. Nothing is written outside that directory at any point, so the containing environment stays clean even when an operation is interrupted abruptly and cleanup does not get its chance until the next run notices the leftover directory.

## Naming conventions

Output naming follows a template mechanism with fields for the base name, the operation, a timestamp, and a sequence number for batches. The default template appends the operation to the base name, producing names like report-converted.docx, which keeps outputs adjacent to inputs in a sorted listing without shadowing them.

Collisions are resolved by sequence suffix rather than by overwriting, and the manifest records the mapping from requested name to final name. Locale sensitive characters in filenames are kept as typed rather than transliterated, with the exception of characters the target file system genuinely cannot store.

## Accessibility

Accessible output is treated as a structural property, not an afterthought. Exports to tagged PDF build the tag tree from the internal document structure, so headings, lists, tables, and reading order come out right by construction. Alternative text on images is carried through every format that can hold it, and images without alternative text are listed in the conversion report.

Reading order deserves emphasis for multi column layouts, where the visual order and the logical order diverge. The internal tree stores logical order explicitly, and layout hints are attached separately, so screen reader traversal of exported documents follows the author intent rather than the geometry.

Color contrast issues introduced by restyling are reported when a remapped theme pushes text below common contrast guidance. The report includes the affected style names and the measured ratios so a designer can adjust the palette deliberately instead of hunting for the problem paragraph by paragraph.

## Localization

Documents carry language tags at the paragraph and run level, and the skill preserves them through conversion because so much downstream behavior depends on them: hyphenation, spellchecking, text to speech, and font selection all key off language. Untagged content gets a detected language attached, with mixed language paragraphs split at run boundaries where the detector is confident.

Right to left scripts flow through the pipeline with direction stored as a logical property. Bidirectional text, where a Hebrew paragraph embeds a Latin product name, relies on the Unicode bidirectional algorithm at render time rather than on stored visual ordering, which is what keeps such text editable after conversion.

Number, date, and list formatting follow the document language rather than the machine locale, so a batch run on a server in one country does not quietly reformat dates for another. Locale data comes from CLDR and is versioned with the skill so results stay stable over time.

## Performance notes

Most operations are bound by parsing rather than by transformation, and parsing cost tracks file complexity more than file size. A five megabyte presentation full of embedded media parses faster than a two megabyte word document with thousands of tracked changes, because revisions multiply the tree without adding bytes.

Caching helps repeated work on the same inputs. Parsed trees are cached keyed by content hash, so a user iterating on conversion options for one document pays the parse cost once. The cache is bounded and evicts by recency, and cached entries are dropped eagerly when memory pressure is reported by the environment.

Profiling across a representative corpus guides where optimization effort goes. The corpus covers office documents in a dozen languages, scanned material of varying quality, and adversarially messy files collected from real support traffic, weighted toward the formats that dominate actual usage.

## Cross references and links

Internal cross references, meaning the live links from a table of contents entry or a "see section 4.2" phrase to its target, are stored as symbolic references against stable element identifiers rather than as page and offset positions. Transformations that move, merge, or delete content update the reference table as they go, so a converted document keeps working links even after heavy restructuring. References whose targets were removed are rewritten as plain text with a remark noting the loss.

External hyperlinks pass through untouched, including their tooltips and target frames where the format stores them. Link text and link target are tracked separately, which matters for accessibility exports where a bare address as link text reads poorly in a screen reader, and for restyling operations that want uniform link appearance without touching destinations.

Bookmarks and named destinations receive the same symbolic treatment as cross references. Documents that arrive with duplicate bookmark names, which the office formats tolerate more than their specifications suggest, have the duplicates renamed with numeric suffixes and a mapping recorded in the conversion report.

## Forms and interactive elements

Form fields in word processing documents, meaning text inputs, dropdowns, and tick boxes, are modeled with their name, type, current value, and constraints. Conversions between form capable formats keep the fields interactive. Exports to flat formats render the current values as ordinary content and list the fields that lost interactivity.

Content controls and structured document tags, the mechanism behind modern fill-in templates, are preserved with their bindings where the target format has an equivalent concept. Legacy form field types from older office versions are migrated to their modern equivalents during the compatibility pass, with any behavior differences noted.

PDF forms are a separate world with their own field model and appearance streams. The skill reads field values and structure for extraction purposes and can flatten a filled form into static content, but it does not author new interactive PDF forms; requests in that direction are declined with an explanation rather than half fulfilled.

## Revision history and provenance

Documents that carry revision history keep it through format conversions that support it, and the history is summarized in plain language on request: who changed what, when, and how much. The summary aggregates by author and by section, which turns a noisy revision log into something a human can act on.

Provenance for the skill's own operations is recorded as a processing note in the output metadata: source format, operations applied, and the versions of the mapping tables used. Reprocessing the same input with the same versions yields byte identical output for deterministic operations, and the note makes it possible to tell which version produced a given file long after the fact.

## Embedded and linked media

Audio and video embedded in presentations are carried as opaque streams with their codecs untouched, since transcoding is out of scope. Linked media, where the document stores only a path to an external file, is resolved relative to the document location when the target is present and recorded as an unresolved link when it is not, with the distinction surfaced in the report.

Poster frames, playback settings, and trim points for media objects survive conversion between presentation formats. Exports to document formats replace the media with its poster frame image plus a caption noting the original media type and duration where known.

## Templates and boilerplate

Template application separates content from presentation at the moment of merge: the incoming document contributes its text, structure, and semantic styles, while the template contributes the style definitions, theme, page geometry, and furniture. Collisions between style names are resolved in favor of the template, since adopting the template's look is the point of the operation.

Boilerplate insertion, such as standard disclaimers or letterheads, happens through named building blocks with their own styles carried alongside. The insertion point is expressed structurally, for example after the title block or before the signature section, so the same operation lands correctly across documents with different lengths and layouts.

## Color management

Colors travel through the pipeline in their authored color space with the space recorded alongside the values, because silently reinterpreting spot colors or wide gamut values as generic RGB is the kind of quiet damage that only shows up at print time. Conversions between formats that disagree about color models translate at the last possible moment and note the translation in the report.

Named document colors and palette references stay symbolic for as long as the target format allows, mirroring the treatment of styles and themes. A rebranding operation that swaps a palette therefore updates every dependent color in one place, while colors that authors hard coded are left as they were and listed so a designer can decide about them case by case.

Transparency and blending are preserved between formats that support them and flattened against the page background for formats that do not, with the flattening resolution chosen to match the document's dominant output intent, print or screen, as recorded in its metadata.

## Interoperability quirks

Real documents diverge from their format specifications constantly, and the parser follows the observed behavior of the major office suites rather than the letter of the specification when the two disagree. A file that a mainstream suite opens without complaint should parse here too, and the quirks layer that makes this possible is versioned and documented internally so its decisions are traceable.

Vendor extensions inside standard files, such as proprietary XML islands or nonstandard part types, are preserved as opaque blocks by default. Stripping them is available as an explicit cleanup option for users who want maximally portable files and accept the loss of whatever the extensions carried.

Line ending and whitespace conventions differ across platforms in ways that still bite in the plainest of formats. The pipeline records the incoming convention and reapplies it on output for round trips, while normalizing internally, so a file edited on one platform does not come back with every line marked as changed by version control on another.

## Known limitations

TODO: handle edge cases.

Presentations receive less attention than documents and spreadsheets, and complex animation or transition effects are dropped with a note rather than emulated. Embedded OLE objects from legacy office suites are carried as opaque blobs: they survive round trips but their content is not interpreted. Digital signatures do not survive any transformation, since a transformed file is by definition no longer the signed artifact, and the skill states this plainly whenever a signed input arrives.

Equation handling is partial. Modern equation markup converts between the office formats reasonably well, but equations embedded as images or as legacy equation editor objects come through as images only. Chemical notation, music notation, and other specialized markup are out of scope entirely.

## Further reading

More detail on the formatting model lives in the [formatting guide](guide.md), including the full mapping tables between style systems and worked examples of the trickier table conversions.
