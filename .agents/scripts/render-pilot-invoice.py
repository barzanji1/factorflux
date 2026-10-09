"""Render the uploaded pilot invoice for a visual check, without modifying it."""
import sys
from pathlib import Path
import fitz

source = Path(sys.argv[1])
output = Path(".agents/outputs/pilot-invoice-page-1.png")
output.parent.mkdir(parents=True, exist_ok=True)
with fitz.open(source) as pdf:
    pdf[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(str(output))
    print(f"Rendered first page of {len(pdf)} pages: {output}")
