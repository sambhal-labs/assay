---
name: exemplary
description: Fill, flatten, and extract fields from PDF forms (AcroForm and XFA). Use when the user asks to populate a PDF form with data, extract existing field values, flatten a completed form for distribution, or batch-fill many PDFs from a CSV or JSON source.
---

# PDF form filler

Fill PDF forms programmatically, extract their field values, and flatten
completed forms so they render identically everywhere.

## When to use this skill

Use this skill when the request involves PDF form fields: filling them from
structured data, reading values out of a completed form, or flattening a
filled form. For generating new PDFs from scratch or converting other formats
to PDF, this is the wrong skill.

## Steps

1. Inspect the form first. Run the field-listing snippet in
   [reference.md](reference.md) to enumerate field names, types, and current
   values. Never guess field names — they rarely match the visible labels.
2. Map the source data to field names. Build an explicit mapping table; for
   checkboxes use the export value from the inspection output, not `true`.
3. Fill the form with the fill snippet in [reference.md](reference.md),
   writing to a new file — never overwrite the input.
4. Verify the output. Re-run the field listing against the filled file and
   confirm every mapped field now holds the expected value.
5. Flatten only when asked. Flattening destroys interactivity; confirm the
   user wants a non-editable copy before applying it.

## Handling failures

- If the field listing comes back empty, the PDF has no AcroForm layer —
  it is likely a scanned or XFA-only document. Say so and offer OCR-based
  overlay filling as the fallback.
- If a fill step throws on a specific field, report the field name and the
  value that failed instead of retrying blindly; the type usually mismatches
  (text into a choice field is the most common case).
- If verification shows a stale value, the form probably uses JavaScript
  recalculation — flatten with appearance regeneration as shown in
  [reference.md](reference.md).

## Example

A request like "fill contract.pdf with the data in clients.csv, one output
per row" maps to: inspect once, build the mapping from CSV headers, loop the
fill step per row writing `contract-<row>.pdf`, verify a sample, and skip
flattening unless requested.
