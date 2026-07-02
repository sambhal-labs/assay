# Reference snippets

## List form fields

```python
from pypdf import PdfReader

reader = PdfReader("form.pdf")
fields = reader.get_fields() or {}
for name, field in fields.items():
    print(name, field.get("/FT"), field.get("/V"))
```

## Fill fields

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("form.pdf")
writer = PdfWriter(clone_from=reader)
writer.update_page_form_field_values(
    writer.pages[0], {"applicant_name": "Jane Doe", "agree": "/Yes"},
    auto_regenerate=True,
)
with open("form-filled.pdf", "wb") as fh:
    writer.write(fh)
```

## Flatten a filled form

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("form-filled.pdf")
writer = PdfWriter(clone_from=reader)
writer.flatten_annotations()  # regenerates appearances, drops interactivity
with open("form-flat.pdf", "wb") as fh:
    writer.write(fh)
```
